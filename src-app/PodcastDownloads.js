export async function getCacheKey(enclosureUrl) {
    const url = new URL(enclosureUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid audio URL.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(enclosureUrl));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function slug(value, limit) {
    return Array.from(String(value || '').normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, limit).join('').replace(/-+$/g, '');
}

export async function getCacheFilename(enclosureUrl, podcast = {}) {
    const hash = await getCacheKey(enclosureUrl);
    const url = new URL(enclosureUrl);
    const extension = url.pathname.split('.').pop().toLowerCase();
    const suffix = ['mp3', 'ogg', 'm4a', 'aac', 'wav', 'flac'].includes(extension) ? extension : 'mp3';
    const name = [slug(podcast.show, 14), slug(podcast.title, 20)].filter(Boolean).join('-') || 'episode';
    return `${name}--${hash.slice(0, 24)}.${suffix}`;
}

export function findCachedEpisode(files, key) {
    return files.find(({ filename }) => {
        const stem = filename.slice(0, filename.lastIndexOf('.'));
        return stem === key || stem.endsWith(`--${key.slice(0, 24)}`);
    });
}

export function formatFileSize(bytes) {
    bytes = Number(bytes);
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unknown';
    for (const [unit, divisor] of [['GB', 1e9], ['MB', 1e6], ['KB', 1e3]]) {
        if (bytes >= divisor) return `${(bytes / divisor).toFixed(1)} ${unit}`;
    }
    return `${Math.round(bytes)} B`;
}

export function createEpisodeDownloader({ getCachePath, exists, download, subscribe, open, reportStatus }) {
    let busy = false;
    return async episode => {
        if (busy) return;
        busy = true;
        let unlisten;
        try {
            if (!episode.enclosureUrl) throw new Error('No audio URL available.');
            const { filename, destPath } = await getCachePath(episode);
            if (!(await exists(destPath))) {
                reportStatus('Downloading… 0%');
                unlisten = await subscribe(filename, percent => reportStatus(`Downloading… ${percent}%`));
                await download(episode.enclosureUrl, filename);
            }
            reportStatus('Opening…');
            await open(destPath, episode);
        } finally {
            unlisten?.();
            busy = false;
        }
    };
}
