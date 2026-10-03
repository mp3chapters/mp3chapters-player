#[derive(Default)]
pub struct OpenFileQueue {
    ready: bool,
    paths: Vec<String>,
}

impl OpenFileQueue {
    // Return an immediate event only after the frontend has installed its listener.
    pub fn push(&mut self, path: String) -> Option<String> {
        if self.ready {
            return Some(path);
        }
        if !self.paths.contains(&path) {
            self.paths.push(path);
        }
        None
    }

    pub fn ready(&mut self) -> Vec<String> {
        self.ready = true;
        std::mem::take(&mut self.paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_start_files_wait_for_the_frontend_without_duplicates() {
        let mut queue = OpenFileQueue::default();
        assert_eq!(queue.push("episode.mp3".into()), None);
        assert_eq!(queue.push("episode.mp3".into()), None);
        assert_eq!(queue.push("second.mp3".into()), None);
        assert_eq!(queue.ready(), vec!["episode.mp3", "second.mp3"]);
        assert!(queue.ready().is_empty());
    }

    #[test]
    fn files_opened_after_startup_are_delivered_immediately() {
        let mut queue = OpenFileQueue::default();
        queue.ready();
        assert_eq!(queue.push("episode.mp3".into()), Some("episode.mp3".into()));
        assert!(queue.ready().is_empty());
    }
}
