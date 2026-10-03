export async function getCacheFilename(enclosureUrl) {
    const url = new URL(enclosureUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid audio URL.');
    const extension = url.pathname.split('.').pop().toLowerCase();
    const suffix = ['mp3', 'ogg', 'm4a', 'aac', 'wav', 'flac'].includes(extension) ? extension : 'mp3';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(enclosureUrl));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hash}.${suffix}`;
}

export function createEpisodeDownloader({ getCachePath, exists, download, subscribe, open, reportStatus }) {
    let busy = false;
    return async episode => {
        if (busy) return;
        busy = true;
        let unlisten;
        try {
            if (!episode.enclosureUrl) throw new Error('No audio URL available.');
            const { filename, destPath } = await getCachePath(episode.enclosureUrl);
            if (!(await exists(destPath))) {
                reportStatus('Downloading… 0%');
                unlisten = await subscribe(filename, percent => reportStatus(`Downloading… ${percent}%`));
                await download(episode.enclosureUrl, filename);
            }
            reportStatus('Opening…');
            await open(destPath);
        } finally {
            unlisten?.();
            busy = false;
        }
    };
}
