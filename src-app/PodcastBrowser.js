import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { initPodcastBrowser as initSharedPodcastBrowser } from '@common/PodcastBrowser.js';
import { createEpisodeDownloader, getCacheFilename, getCacheKey, findCachedEpisode } from '@common/PodcastDownloads.js';

export { togglePodcastPanel, isPodcastPanelOpen } from '@common/PodcastBrowser.js';

async function getCachePath(episode) {
    const files = await invoke('get_podcast_cache');
    const key = await getCacheKey(episode.enclosureUrl);
    const cached = findCachedEpisode(files, key);
    const cacheDir = await join(await appDataDir(), 'podcast-cache-v2');
    const filename = cached?.filename || await getCacheFilename(episode.enclosureUrl, episode.podcast);
    return { filename, destPath: await join(cacheDir, filename), cached };
}

export function initPodcastBrowser(handleMP3FilePath) {
    initSharedPodcastBrowser({
        getCachedEpisodes: () => invoke('get_podcast_cache'),
        getCachedEpisode: async episode => (await getCachePath(episode)).cached || null,
        playEpisode: async (episode, reportStatus) => {
            const download = createEpisodeDownloader({
                getCachePath,
                exists,
                download: (url, filename) => invoke('download_file', { url, filename }),
                subscribe: (filename, progress) => listen('download-progress', event => {
                    if (event.payload.filename === filename) progress(event.payload.percent);
                }),
                open: (path, value) => handleMP3FilePath(path, value.podcast),
                reportStatus,
            });
            await download(episode);
        },
    });
}
