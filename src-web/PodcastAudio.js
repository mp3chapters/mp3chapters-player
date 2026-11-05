import { findCachedEpisode, getCacheFilename, getCacheKey } from '../src-common/PodcastDownloads.js';

function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('Episode loading was cancelled.', 'AbortError');
}

function audioUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('This episode does not have a valid audio URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('This episode does not have a valid audio URL.');
    }
    if (globalThis.location?.protocol === 'https:' && url.protocol === 'http:') {
        throw new Error('This episode uses an insecure audio link. Download it from the podcast website and open the file here, or use the desktop app.');
    }
    return url.href;
}

async function readAudio(response, reportStatus, signal, defaultType) {
    const contentType = response.headers.get('Content-Type') || defaultType || 'audio/mpeg';
    if (/^(?:text\/|application\/(?:json|[^;]+\+json|xml|[^;]+\+xml|javascript)(?:;|$))/i.test(contentType)) {
        throw new Error('The podcast host returned a page instead of an audio file.');
    }
    const length = Number(response.headers.get('Content-Length'));
    const total = Number.isFinite(length) && length > 0 ? length : null;
    if (!response.body?.getReader) {
        const blob = await response.blob();
        checkAbort(signal);
        if (!blob.size) throw new Error('The podcast host returned an empty audio file.');
        return blob;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    try {
        while (true) {
            checkAbort(signal);
            const { done, value } = await reader.read();
            checkAbort(signal);
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            reportStatus(total ? `Downloading… ${Math.min(99, Math.floor(100 * loaded / total))}%` : `Downloading… ${(loaded / 1e6).toFixed(1)} MB`);
        }
        if (!loaded) throw new Error('The podcast host returned an empty audio file.');
        if (total && loaded < total && !response.headers.get('Content-Encoding')) {
            throw new Error('The episode download was incomplete. Please try again.');
        }
        reportStatus('Downloading… 100%');
        return new Blob(chunks, { type: contentType });
    } catch (error) {
        try { await reader.cancel(error); } catch { /* The failed body may already be closed. */ }
        throw error;
    } finally {
        reader.releaseLock();
    }
}

export function createPodcastPlayer({ cache, openBlob, openStream, fetchImpl = fetch }) {
    return async (episode, reportStatus = () => {}, signal) => {
        checkAbort(signal);
        const url = audioUrl(episode.enclosureUrl);
        const key = await getCacheKey(episode.enclosureUrl);
        let cached;
        try { cached = findCachedEpisode(await cache.list(), key); } catch { /* Storage is optional. */ }
        checkAbort(signal);
        if (cached) {
            let blob;
            try { blob = await cache.get(cached.filename); } catch { /* Try downloading if storage is unavailable. */ }
            checkAbort(signal);
            if (blob) {
                reportStatus('Opening…');
                return openBlob(blob, cached.filename, episode.podcast, { cached: true });
            }
        }
        const filename = await getCacheFilename(episode.enclosureUrl, episode.podcast);
        checkAbort(signal);
        reportStatus('Downloading… 0%');
        let response;
        try {
            response = await fetchImpl(url, { signal, credentials: 'omit' });
        } catch (error) {
            checkAbort(signal);
            // Cross-origin audio can still stream when the host denies JavaScript access.
            // Only an initial network/CORS rejection may use this fallback; partial reads cannot.
            if (error instanceof TypeError) {
                reportStatus('Opening stream…');
                return openStream(url, filename, episode.podcast);
            }
            throw error;
        }
        checkAbort(signal);
        if (!response.ok) throw new Error(`The podcast host could not serve this episode (HTTP ${response.status}).`);
        const blob = await readAudio(response, reportStatus, signal, episode.enclosureType);
        checkAbort(signal);
        let saved = false;
        try { saved = await cache.save(filename, blob); } catch { /* Quota or unavailable storage must not prevent playback. */ }
        checkAbort(signal);
        reportStatus('Opening…');
        return openBlob(blob, filename, episode.podcast, { cached: Boolean(saved) });
    };
}
