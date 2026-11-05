import { safeExternalUrl } from './Links.js';

function arrayEquals(a, b) {
    return a.length === b.length &&
        a.every((val, index) => val === b[index]);
}

function checkAbort(signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('Audio metadata loading was cancelled.', 'AbortError');
}

function readMetadata(file, signal, metadataTimeoutMs) {
    return new Promise((resolve, reject) => {
        let reader;
        let settled = false;
        let cancelled = false;
        const finish = (error, tags) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve(tags || {});
        };
        const abortRead = error => {
            cancelled = true;
            finish(error);
            try { reader?.abort(); } catch { /* The reader may already have finished. */ }
        };
        const onAbort = () => abortRead(signal.reason || new DOMException('Audio metadata loading was cancelled.', 'AbortError'));
        const timeoutMs = Number.isFinite(metadataTimeoutMs) && metadataTimeoutMs >= 0 ? metadataTimeoutMs : 15000;
        const timeout = setTimeout(() => abortRead(new Error('Could not read audio metadata. Please try opening the file again.')), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) { onAbort(); return; }
        try {
            reader = readTags(file, tags => finish(null, tags), error => finish(error || new Error('Could not read audio metadata.')));
            if (cancelled) reader?.abort();
        } catch (error) { abortRead(error); }
    });
}

export async function loadFile(player, url, filename = 'audiofile', podcast = null, { signal, metadataTimeoutMs = 15000 } = {}) {
    checkAbort(signal);
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    checkAbort(signal);
    const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
    const tags = await readMetadata(file, signal, metadataTimeoutMs);
    checkAbort(signal);
    return applyMetadata(player, file, filename, podcast, tags);
}

// Streaming hosts may permit playback while denying JavaScript access to ID3.
export function loadStream(player, filename, podcast) {
    return applyMetadata(player, null, filename, podcast, {});
}

function applyMetadata(player, file, filename, podcast, tags) {
    window.currentFilename = filename;
    window.currentFile = file;
    window.chapters.duration = -1;
    window.chapterImages = [];
    window.id3Title = null; // Will be set if ID3 title tag exists

    // Extract ID3 title if available
    if (tags.hasOwnProperty('title') && tags.title) {
        window.id3Title = tags.title;
    }

    // console.log(tags);
    let toc = [];
    if (tags.hasOwnProperty('tableOfContents') && tags.tableOfContents.length > 0 && tags.tableOfContents[0].elements) {
        toc = tags.tableOfContents[0].elements;
    }
    if (tags.hasOwnProperty('chapter')) {
        const parsedChapters = [];
        for (let chapter of tags.chapter) {
            const chapterObject = {
                title: chapter.tags.title,
                start: chapter.startTimeMs,
            };
            if (!toc.includes(chapter.elementID)) {
                if (chapterObject.title != undefined) {
                    chapterObject.title = "_" + chapterObject.title;
                } else {
                    chapterObject.title = "_";
                }
                chapterObject.toc = false;
            } else {
                chapterObject.toc = true;
            }
            if (chapter.tags.hasOwnProperty('userDefinedUrl')) {
                chapterObject.url = chapter.tags.userDefinedUrl[0].url;
            }
            if (chapter.tags.hasOwnProperty('image')) {
                // check if image is already in array (same buffer)
                let found = -1;
                for (let i = 0; i < window.chapterImages.length; i++) {
                    if (arrayEquals(window.chapterImages[i].imageBuffer, chapter.tags.image.imageBuffer)) {
                        found = i;
                        break;
                    }
                }
                if (found != -1) {
                    chapterObject.imageId = found;
                } else {
                    window.chapterImages.push(chapter.tags.image);
                    chapterObject.imageId = window.chapterImages.length - 1;
                }
            }
            parsedChapters.push(chapterObject);
        }
        window.chapters.duration = player.state.duration;
        window.chapters.setChapters(parsedChapters);
    } else if (file) {
        const baseChapters = [
            {
                "title": "Introduction",
                "start": 0,
                "toc": true
            }
        ]
        window.chapters.setChapters(baseChapters);
    } else {
        window.chapters.setChapters([]);
    }

    if (tags.hasOwnProperty('encodedBy')) {
        tags.encodedBy = `${tags.encodedBy} and mp3chapters.github.io`;
    }

    const img = document.getElementById('cover-image');
    const fileInfoDisplay = document.getElementById('file-info-display');
    const fallbackArt = safeExternalUrl(podcast?.artwork);
    const showCover = () => {
        img.style.display = '';
        img.style.visibility = 'visible';
        if (fileInfoDisplay) fileInfoDisplay.style.display = 'none';
        window.hasCoverArt = true;
    };
    if (tags.hasOwnProperty('image')) {
        const blob = new Blob([tags.image.imageBuffer], { type: tags.image.mime });
        const url = URL.createObjectURL(blob);
        img.src = url;
        showCover();
    } else if (fallbackArt) {
        img.src = fallbackArt;
        showCover();
    } else {
        img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
        img.style.display = fileInfoDisplay ? 'none' : '';
        // Show text info instead
        const title = podcast?.title || tags.title || window.currentFilename || '';
        const artist = podcast?.show || tags.artist || '';
        const album = tags.album || '';
        for (const [id, text] of [['file-info-title', title], ['file-info-artist', artist], ['file-info-album', album]]) {
            const element = document.getElementById(id);
            if (element) element.textContent = text;
        }
        if (fileInfoDisplay) fileInfoDisplay.style.display = '';
        window.hasCoverArt = false;
    }
    window.coverImg = img.src;
    window.mediaTitle = podcast?.title || tags.title || window.currentFilename || '';

    // Set Media Session metadata for lock screen / control center
    if ('mediaSession' in navigator) {
        const artwork = [];
        if (tags.hasOwnProperty('image')) {
            const artBlob = new Blob([tags.image.imageBuffer], { type: tags.image.mime });
            const artUrl = URL.createObjectURL(artBlob);
            artwork.push({ src: artUrl, type: tags.image.mime });
        } else if (fallbackArt) {
            artwork.push({ src: fallbackArt });
        }
        navigator.mediaSession.metadata = new MediaMetadata({
            title: window.mediaTitle,
            artist: podcast?.show || tags.artist || '',
            album: podcast?.show || tags.album || '',
            artwork,
        });
    }

    // Return the ID3 title for use by callers (e.g., setting window title)
    return { id3Title: window.id3Title, artist: tags.artist || '', album: tags.album || '' };
}
