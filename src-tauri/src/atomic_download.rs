use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn valid_cache_filename(filename: &str) -> bool {
    let Some((hash, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        && matches!(extension, "mp3" | "ogg" | "m4a" | "aac" | "wav" | "flac")
}

pub struct PendingDownload {
    file: Option<File>,
    temporary: PathBuf,
    destination: PathBuf,
    pub received: u64,
}

impl PendingDownload {
    pub fn new(destination: &Path) -> io::Result<Self> {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let temporary =
            destination.with_extension(format!("{}.{}.part", std::process::id(), suffix));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        Ok(Self {
            file: Some(file),
            temporary,
            destination: destination.to_owned(),
            received: 0,
        })
    }

    pub fn write_chunk(&mut self, chunk: &[u8]) -> io::Result<()> {
        self.file.as_mut().unwrap().write_all(chunk)?;
        self.received += chunk.len() as u64;
        Ok(())
    }

    pub fn complete(mut self, expected: Option<u64>) -> io::Result<()> {
        if self.received == 0 || expected.is_some_and(|size| size != self.received) {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Incomplete audio download",
            ));
        }
        self.file.take().unwrap().sync_all()?;
        fs::rename(&self.temporary, &self.destination)
    }
}

impl Drop for PendingDownload {
    fn drop(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.temporary);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    fn directory() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mp3chapters-atomic-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn failed_downloads_leave_no_final_or_partial_file() {
        let dir = directory();
        let dest = dir.join("episode.mp3");
        {
            let mut pending = PendingDownload::new(&dest).unwrap();
            pending.write_chunk(b"partial").unwrap();
        }
        assert!(!dest.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn checks_length_and_publishes_only_complete_downloads() {
        let dir = directory();
        let dest = dir.join("episode.mp3");
        let mut pending = PendingDownload::new(&dest).unwrap();
        pending.write_chunk(b"short").unwrap();
        assert!(pending.complete(Some(10)).is_err());
        assert!(!dest.exists());
        let mut pending = PendingDownload::new(&dest).unwrap();
        pending.write_chunk(b"audio").unwrap();
        assert!(!dest.exists());
        pending.complete(Some(5)).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"audio");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_empty_downloads_and_unsafe_cache_paths() {
        let dir = directory();
        assert!(PendingDownload::new(&dir.join("empty.mp3"))
            .unwrap()
            .complete(None)
            .is_err());
        for name in [
            "../outside.mp3",
            "/tmp/outside.mp3",
            "episode.mp3",
            "hash.mp3/../../outside",
            "a.part",
        ] {
            assert!(!valid_cache_filename(name));
        }
        assert!(valid_cache_filename(&format!("{}.mp3", "a".repeat(64))));
        assert!(!valid_cache_filename(&format!("{}.txt", "a".repeat(64))));
        fs::remove_dir(&dir).unwrap();
    }
}
