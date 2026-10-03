use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PodcastEpisode {
    pub show: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "StoredRecentFile")]
pub struct RecentFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub podcast: Option<PodcastEpisode>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredRecentFile {
    Legacy(String),
    Entry {
        path: String,
        #[serde(default)]
        podcast: Option<PodcastEpisode>,
    },
}

impl From<StoredRecentFile> for RecentFile {
    fn from(value: StoredRecentFile) -> Self {
        match value {
            StoredRecentFile::Legacy(path) => Self {
                path,
                podcast: None,
            },
            StoredRecentFile::Entry { path, podcast } => Self { path, podcast },
        }
    }
}

impl RecentFile {
    pub fn label(&self) -> String {
        if let Some(podcast) = &self.podcast {
            let clean = |value: &str| value.split_whitespace().collect::<Vec<_>>().join(" ");
            return format!("{} > {}", clean(&podcast.show), clean(&podcast.title));
        }
        let filename = self.path.rsplit(['/', '\\']).next().unwrap_or(&self.path);
        if self.path.replace('\\', "/").contains("/podcast-cache-v2/") {
            return format!(
                "Podcast episode · {}",
                filename.chars().take(8).collect::<String>()
            );
        }
        filename.to_owned()
    }
}

pub fn remember(
    files: &mut Vec<RecentFile>,
    path: String,
    podcast: Option<PodcastEpisode>,
    limit: usize,
) {
    let podcast = podcast.or_else(|| {
        files
            .iter()
            .find(|file| file.path == path)
            .and_then(|file| file.podcast.clone())
    });
    files.retain(|file| file.path != path);
    files.insert(0, RecentFile { path, podcast });
    files.truncate(limit);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_legacy_recents_without_losing_order_or_paths() {
        let files: Vec<RecentFile> =
            serde_json::from_str(r#"["/audio/first.mp3","C:\\audio\\second.mp3"]"#).unwrap();
        assert_eq!(files[0].label(), "first.mp3");
        assert_eq!(files[1].label(), "second.mp3");
        let saved = serde_json::to_string(&files).unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<RecentFile>>(&saved).unwrap(),
            files
        );
    }

    #[test]
    fn retains_episode_labels_when_reopened_and_limits_history() {
        let mut files = Vec::new();
        let podcast = PodcastEpisode {
            show: "Show\nName".into(),
            title: "Episode title".into(),
            artwork: None,
        };
        remember(&mut files, "/cache/episode.mp3".into(), Some(podcast), 2);
        remember(&mut files, "/audio/local.mp3".into(), None, 2);
        remember(&mut files, "/cache/episode.mp3".into(), None, 2);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].label(), "Show Name > Episode title");
        let saved = serde_json::to_string(&files).unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<RecentFile>>(&saved).unwrap(),
            files
        );
        remember(&mut files, "/audio/new.mp3".into(), None, 2);
        assert_eq!(files.len(), 2);
    }
}
