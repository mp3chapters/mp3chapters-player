import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';
import { startUp, toggleShortcutsPanel } from '@common/Player.js';
import { loadFile, loadStream } from '@common/FileLoader.js';
import { initPodcastBrowser, togglePodcastPanel } from '@common/PodcastBrowser.js';
import { getCacheKey, findCachedEpisode } from '@common/PodcastDownloads.js';
import { createAudioCache } from './AudioCache.js';
import { createPodcastPlayer } from './PodcastAudio.js';
import { audioType, localCacheKey } from './AudioType.js';

/* global __WEB_VERSION__ */
document.documentElement.dataset.version = __WEB_VERSION__;
const player = document.querySelector('media-player');
const cache = createAudioCache();
const RECENTS = 'mp3chapter-player-recent-audio';
let activeBlobUrl;
let requestId = 0;
let pendingRequest;
let loadQueue = Promise.resolve();

const toolbar = document.createElement('nav');
toolbar.className = 'web-toolbar';
toolbar.setAttribute('aria-label', 'Player actions');
function toolbarButton(label, action, iconSelector) {
    const button = document.createElement('button');
    button.type = 'button';
    if (iconSelector) button.append(document.querySelector(iconSelector).cloneNode(true));
    button.append(document.createTextNode(label));
    button.addEventListener('click', action);
    toolbar.append(button);
    return button;
}
toolbarButton('Open File', selectFile, '#welcome-open-file svg');
toolbarButton('Browse Podcasts', togglePodcastPanel, '#welcome-open-podcast svg');
const help = toolbarButton('?', toggleShortcutsPanel);
help.className = 'web-help';
help.setAttribute('aria-label', 'Keyboard shortcuts');
help.title = 'Keyboard shortcuts';
document.body.prepend(toolbar);

const notice = document.createElement('div');
notice.className = 'web-message';
notice.hidden = true;
notice.setAttribute('role', 'status');
toolbar.after(notice);
function showNotice(text, audioUrl) {
    notice.replaceChildren();
    const message = document.createElement('span');
    message.textContent = text;
    notice.append(message);
    if (audioUrl) {
        const link = document.createElement('a');
        link.textContent = 'Open episode audio ↗';
        link.href = audioUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        notice.append(link);
    }
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss message');
    close.addEventListener('click', () => { notice.hidden = true; });
    notice.append(close);
    notice.hidden = false;
}
function showError(error) {
    if (error?.name !== 'AbortError') showNotice(error?.message || 'Could not open this audio file.');
}
function beginRequest() {
    pendingRequest?.abort();
    pendingRequest = new AbortController();
    notice.hidden = true;
    return ++requestId;
}
function assertCurrent(id) {
    if (id !== requestId) throw new DOMException('Another file was opened.', 'AbortError');
}
function recents() {
    try {
        const value = JSON.parse(localStorage.getItem(RECENTS));
        return Array.isArray(value) ? value.filter(item => item && typeof item.filename === 'string' && typeof item.label === 'string').slice(0, 3) : [];
    } catch { return []; }
}
function remember(item) {
    try { localStorage.setItem(RECENTS, JSON.stringify([item, ...recents().filter(old => old.filename !== item.filename)].slice(0, 3))); }
    catch { /* Playback also works with browser storage disabled. */ }
}
async function renderRecents() {
    const list = document.getElementById('welcome-recent-list');
    const available = await cache.list();
    list.replaceChildren();
    for (const item of recents()) {
        if (!item.url && !available.some(file => file.filename === item.filename)) continue;
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'welcome-recent-item';
        const icon = document.querySelector(item.podcast ? '#welcome-open-podcast svg' : '#welcome-open-file svg').cloneNode(true);
        icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'welcome-recent-name';
        name.textContent = item.label;
        button.append(icon, name);
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                if (item.url) await playEpisode({ enclosureUrl: item.url, podcast: item.podcast }, () => {});
                else {
                    const id = beginRequest();
                    const blob = await cache.get(item.filename);
                    assertCurrent(id);
                    if (!blob) throw new Error('This saved file is no longer available. Please open it again.');
                    await openBlob(blob, item.name || item.filename, item.podcast, { cached: true, cacheKey: item.filename }, id);
                }
            } catch (error) { showError(error); }
            finally { button.disabled = false; }
        });
        row.append(button);
        list.append(row);
    }
    document.getElementById('welcome-recent').hidden = list.children.length === 0;
}
function showLoaded(filename, podcast, metadata) {
    const label = podcast ? `${podcast.show} › ${podcast.title}` : metadata.id3Title ? `${metadata.id3Title} [${filename}]` : filename;
    document.title = `${label} — MP3 Chapter Player`;
    const chip = document.getElementById('filename-chip');
    chip.textContent = label;
    chip.title = label;
    chip.classList.add('visible');
    document.getElementById('welcome-screen').classList.add('hidden');
    return label;
}
async function openBlob(blob, filename, podcast, options = {}, id = requestId) {
    loadQueue = loadQueue.catch(() => {}).then(async () => {
        assertCurrent(id);
        const url = URL.createObjectURL(blob);
        const previous = activeBlobUrl;
        activeBlobUrl = url;
        player.src = { src: url, type: audioType(blob, filename) };
        if (previous) URL.revokeObjectURL(previous);
        const metadata = await loadFile(player, url, filename, podcast, { signal: pendingRequest?.signal });
        assertCurrent(id);
        const label = showLoaded(filename, podcast, metadata);
        if (options.cached) remember({ filename: options.cacheKey || filename, name: filename, label, podcast });
        if (podcast && !options.cached) showNotice('Playing this episode, but your browser could not save a copy for later.');
        if (podcast) await tryPlay(id);
    });
    return loadQueue;
}
async function openStream(url, filename, podcast, id) {
    loadQueue = loadQueue.catch(() => {}).then(async () => {
        assertCurrent(id);
        player.src = { src: url, type: 'audio/mpeg' };
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
        // Let source-change clear the old file before installing fallback metadata.
        await Promise.resolve();
        assertCurrent(id);
        const metadata = loadStream(player, filename, podcast);
        const label = showLoaded(filename, podcast, metadata);
        remember({ filename, label, podcast, url });
        showNotice('Streaming without embedded chapters because the browser could not read this audio file. Download the file and open it here to view its chapters.', url);
        await tryPlay(id);
    });
    return loadQueue;
}
async function tryPlay(id) {
    if (!player.state.canPlay) {
        await new Promise((resolve, reject) => {
            const signal = pendingRequest?.signal;
            const cleanup = () => {
                clearTimeout(timeout);
                player.removeEventListener('can-play', ready);
                player.removeEventListener('error', failed);
                signal?.removeEventListener('abort', cancelled);
            };
            const ready = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error('This episode could not be played. Please try opening the audio file locally.')); };
            const cancelled = () => { cleanup(); reject(new DOMException('Another file was opened.', 'AbortError')); };
            const timeout = setTimeout(failed, 20000);
            player.addEventListener('can-play', ready, { once: true });
            player.addEventListener('error', failed, { once: true });
            signal?.addEventListener('abort', cancelled, { once: true });
            if (signal?.aborted) cancelled();
            else if (player.state.canPlay) ready();
        });
    }
    assertCurrent(id);
    try { await player.play(); }
    catch (error) {
        if (error?.name !== 'NotAllowedError') throw error;
        if (notice.hidden) showNotice('Episode ready. Press Play to start listening.');
    }
}
async function playEpisode(episode, reportStatus) {
    const id = beginRequest();
    const controller = pendingRequest;
    const play = createPodcastPlayer({ cache,
        openBlob: (blob, filename, podcast, options) => openBlob(blob, filename, podcast, options, id),
        openStream: (url, filename, podcast) => openStream(url, filename, podcast, id),
    });
    try { await play(episode, reportStatus, controller.signal); }
    finally { if (pendingRequest === controller) pendingRequest = null; }
}
async function loadLocal(file) {
    const id = beginRequest();
    const key = await localCacheKey(file);
    const cached = await cache.save(key, file);
    assertCurrent(id);
    await openBlob(file, file.name, null, { cached, cacheKey: key }, id);
}
const picker = document.createElement('input');
picker.type = 'file';
picker.accept = 'audio/*,.mp3,.ogg,.m4a,.aac,.wav,.flac';
picker.hidden = true;
picker.setAttribute('aria-label', 'Choose an audio file');
document.body.append(picker);
picker.addEventListener('change', () => {
    const file = picker.files[0];
    picker.value = '';
    if (file) loadLocal(file).catch(showError);
});
function selectFile() { picker.click(); }
document.getElementById('welcome-open-file').addEventListener('click', selectFile);
document.getElementById('welcome-open-podcast').addEventListener('click', togglePodcastPanel);
window.togglePodcastPanel = togglePodcastPanel;
document.addEventListener('dragover', event => { event.preventDefault(); });
document.addEventListener('drop', event => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer?.files || []).find(value => value.type.startsWith('audio/') || /\.(mp3|ogg|m4a|aac|wav|flac)$/i.test(value.name));
    if (file) loadLocal(file).catch(showError);
});
player.addEventListener('error', () => {
    showNotice('This audio could not be played. Try downloading it from the podcast host and opening the file here.');
});
startUp();
initPodcastBrowser({
    getCachedEpisodes: () => cache.list(),
    getCachedEpisode: async episode => findCachedEpisode(await cache.list(), await getCacheKey(episode.enclosureUrl)) || null,
    playEpisode,
    cachedLabel: 'Saved in this browser',
});
renderRecents().catch(console.error);
