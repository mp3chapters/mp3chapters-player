import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { createPodcastApi } from './PodcastApi.js';
import { createEpisodeDownloader, getCacheFilename, getCacheKey, findCachedEpisode, formatFileSize } from './PodcastDownloads.js';
import { installPodcastNavigation } from './PodcastNavigation.js';
import { openExternalUrl } from '@common/Links.js';

/* global __PODCAST_PROXY_URL__ */
const apiRequest = createPodcastApi(__PODCAST_PROXY_URL__);
const MAX_RECENT_PODCASTS = 8;
const STORAGE_KEY = 'recentPodcasts';

let _handleMP3FilePath = null;
let state = 'SEARCH';
let cachedPodcasts = [];
let cachedEpisodes = [];
let currentPodcast = null;
let currentEpisode = null;
let searchTimeout = null;
let requestGeneration = 0;
let panelOpener = null;

// --- Recent podcasts (localStorage) ---

function getRecentPodcasts() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
}

function addRecentPodcast(podcast) {
    const recent = getRecentPodcasts().filter(p => p.id !== podcast.id);
    recent.unshift({
        id: podcast.id,
        title: podcast.title,
        author: podcast.author || '',
        artwork: podcast.artwork || podcast.image || '',
    });
    recent.splice(MAX_RECENT_PODCASTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
}

function removeRecentPodcast(podcastId) {
    const recent = getRecentPodcasts().filter(p => p.id !== podcastId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
}

// --- API ---

// --- DOM helpers ---

const $ = (id) => document.getElementById(id);

function getPanel() { return $('podcast-panel'); }
function getList() { return $('podcast-list'); }
function getStatus() { return $('podcast-status'); }
function getSearchInput() { return $('podcast-search-input'); }
function getNavBar() { return $('podcast-nav-bar'); }
function getNavTitle() { return $('podcast-nav-title'); }

// --- Panel toggle ---

export function togglePodcastPanel() {
    const panel = getPanel();
    if (isPodcastPanelOpen()) { closePodcastPanel(); return; }
    panelOpener = document.activeElement;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    requestGeneration++;
    clearTimeout(searchTimeout);
    setState('SEARCH');
    getSearchInput().value = '';
    getSearchInput().focus();
}

function closePodcastPanel() {
    requestGeneration++;
    clearTimeout(searchTimeout);
    getPanel().classList.add('hidden');
    getPanel().setAttribute('aria-hidden', 'true');
    if (panelOpener?.isConnected && panelOpener.tabIndex >= 0 && panelOpener.getClientRects().length) panelOpener.focus();
    else document.querySelector('media-play-button')?.focus();
}

export function isPodcastPanelOpen() {
    return !getPanel().classList.contains('hidden');
}

// --- State ---

function setState(newState, focusFirst = false) {
    state = newState;
    const navBar = getNavBar();
    const searchInput = getSearchInput();
    const status = getStatus();

    status.textContent = '';

    switch (newState) {
        case 'SEARCH':
            navBar.style.display = 'none';
            searchInput.parentElement.style.display = '';
            cachedPodcasts = [];
            cachedEpisodes = [];
            currentPodcast = null;
            renderRecentPodcasts();
            break;
        case 'PODCASTS':
            navBar.style.display = 'none';
            searchInput.parentElement.style.display = '';
            renderPodcasts();
            break;
        case 'EPISODES':
            getNavTitle().textContent = currentPodcast ? currentPodcast.title : 'Episodes';
            navBar.style.display = '';
            searchInput.parentElement.style.display = 'none';
            renderEpisodes(focusFirst);
            break;
        case 'EPISODE_DETAIL':
            getNavTitle().textContent = currentPodcast ? currentPodcast.title : 'Episodes';
            navBar.style.display = '';
            searchInput.parentElement.style.display = 'none';
            renderEpisodeDetail();
            break;
        case 'DOWNLOADING':
            break;
    }
}

// --- Render ---

function renderRecentPodcasts() {
    const list = getList();
    list.innerHTML = '';
    const recent = getRecentPodcasts();

    if (recent.length > 0) {
        const label = document.createElement('div');
        label.className = 'podcast-section-label';
        label.textContent = 'Recent';
        list.appendChild(label);

        for (const podcast of recent) {
            list.appendChild(createPodcastItem(podcast, true));
        }
    }

    const powered = document.createElement('div');
    powered.className = 'podcast-powered-by';
    powered.innerHTML = 'Powered by <a href="https://podcastindex.org/" target="_blank">Podcast Index</a>';
    powered.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        openExternalUrl('https://podcastindex.org/').catch(console.error);
    });
    list.appendChild(powered);
}

function createPodcastItem(podcast, showRemove = false) {
    const item = document.createElement('div');
    item.className = 'podcast-item';
    const action = createRowAction(() => loadEpisodes(podcast));

    const img = document.createElement('img');
    img.src = podcast.artwork || podcast.image || '';
    img.alt = '';
    img.loading = 'lazy';

    const textDiv = document.createElement('span');
    textDiv.className = 'podcast-item-text';

    const titleEl = document.createElement('span');
    titleEl.className = 'podcast-item-title';
    titleEl.textContent = podcast.title;

    const authorEl = document.createElement('span');
    authorEl.className = 'podcast-item-author';
    authorEl.textContent = podcast.author || '';

    textDiv.appendChild(titleEl);
    textDiv.appendChild(authorEl);
    action.appendChild(img);
    action.appendChild(textDiv);
    item.appendChild(action);

    if (showRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'podcast-item-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from recent';
        removeBtn.setAttribute('aria-label', `Remove ${podcast.title} from recent podcasts`);
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeRecentPodcast(podcast.id);
            renderRecentPodcasts();
        });
        item.appendChild(removeBtn);
    }

    return item;
}

function createRowAction(activate) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'podcast-item-main';
    action.dataset.podcastRow = '';
    action.addEventListener('click', activate);
    return action;
}

function renderPodcasts() {
    const list = getList();
    list.innerHTML = '';
    for (const podcast of cachedPodcasts) {
        list.appendChild(createPodcastItem(podcast));
    }
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function episodeMetadata(episode) {
    return {
        show: currentPodcast?.title || episode.feedTitle || 'Podcast',
        title: episode.title || 'Episode',
        artwork: episode.image || episode.feedImage || currentPodcast?.artwork || currentPodcast?.image || null,
    };
}

async function getCachePath(episode) {
    const files = await invoke('get_podcast_cache');
    const key = await getCacheKey(episode.enclosureUrl);
    const cached = findCachedEpisode(files, key);
    const dataDir = await appDataDir();
    const cacheDir = await join(dataDir, 'podcast-cache-v2');
    const filename = cached?.filename || await getCacheFilename(episode.enclosureUrl, episode.podcast || episodeMetadata(episode));
    return { filename, destPath: await join(cacheDir, filename), cached };
}

async function renderEpisodes(focusFirst = false) {
    const list = getList();
    const episodes = cachedEpisodes;
    const podcast = currentPodcast;
    let files = [];
    try { files = await invoke('get_podcast_cache'); }
    catch (error) { console.error('Could not check downloaded episodes:', error); }
    const cached = await Promise.all(episodes.map(async episode => {
        if (!episode.enclosureUrl) return null;
        try { return findCachedEpisode(files, await getCacheKey(episode.enclosureUrl)); }
        catch { return null; }
    }));
    if (state !== 'EPISODES' || cachedEpisodes !== episodes || currentPodcast !== podcast || !isPodcastPanelOpen()) return;
    list.innerHTML = '';
    for (const [index, episode] of episodes.entries()) {
        const item = document.createElement('div');
        item.className = 'podcast-item podcast-episode-item';
        const action = createRowAction(() => downloadAndPlay(episode));

        const img = document.createElement('img');
        img.src = episode.image || episode.feedImage || '';
        img.alt = '';
        img.loading = 'lazy';

        const textDiv = document.createElement('span');
        textDiv.className = 'podcast-item-text';

        const titleEl = document.createElement('span');
        titleEl.className = 'podcast-item-title';
        titleEl.textContent = episode.title;

        const metaEl = document.createElement('span');
        metaEl.className = 'podcast-item-author';
        const parts = [];
        if (episode.datePublished) parts.push(formatDate(episode.datePublished));
        if (episode.duration) parts.push(formatDuration(episode.duration));
        parts.push(formatFileSize(cached[index]?.size || episode.enclosureLength));
        metaEl.textContent = parts.join(' · ');

        textDiv.appendChild(titleEl);
        textDiv.appendChild(metaEl);
        action.appendChild(img);
        action.appendChild(textDiv);
        if (cached[index]) {
            const badge = document.createElement('span');
            badge.className = 'podcast-cached';
            badge.textContent = '✓';
            badge.title = 'Downloaded — available offline';
            badge.setAttribute('role', 'img');
            badge.setAttribute('aria-label', 'Downloaded — available offline');
            action.appendChild(badge);
        }
        item.appendChild(action);

        // Info button
        const infoBtn = document.createElement('button');
        infoBtn.className = 'podcast-item-info';
        infoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="10" y="14.5" text-anchor="middle" font-size="12" font-weight="600" font-family="inherit">i</text></svg>';
        infoBtn.title = 'Episode info';
        infoBtn.setAttribute('aria-label', `Info about ${episode.title}`);
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showEpisodeDetail(episode);
        });
        item.appendChild(infoBtn);

        list.appendChild(item);
    }
    if (focusFirst) list.querySelector('[data-podcast-row]')?.focus();
}

function showEpisodeDetail(episode) {
    currentEpisode = episode;
    setState('EPISODE_DETAIL');
}

function renderEpisodeDetail() {
    const list = getList();
    list.innerHTML = '';
    const ep = currentEpisode;
    if (!ep) return;

    const detail = document.createElement('div');
    detail.className = 'podcast-episode-detail';

    // Header with image and title
    const header = document.createElement('div');
    header.className = 'podcast-episode-detail-header';

    const img = document.createElement('img');
    img.src = ep.image || ep.feedImage || '';
    img.alt = '';

    const headerText = document.createElement('div');
    headerText.className = 'podcast-episode-detail-header-text';

    const titleEl = document.createElement('div');
    titleEl.className = 'podcast-episode-detail-title';
    titleEl.textContent = ep.title;

    const metaEl = document.createElement('div');
    metaEl.className = 'podcast-item-author';
    const parts = [];
    if (ep.datePublished) parts.push(formatDate(ep.datePublished));
    if (ep.duration) parts.push(formatDuration(ep.duration));
    parts.push(formatFileSize(ep.enclosureLength));
    metaEl.textContent = parts.join(' · ');

    headerText.appendChild(titleEl);
    headerText.appendChild(metaEl);
    header.appendChild(img);
    header.appendChild(headerText);
    detail.appendChild(header);

    // Play button
    const playBtn = document.createElement('button');
    playBtn.className = 'podcast-episode-detail-play';
    playBtn.textContent = '▶ Play Episode';
    // Check cache to show different label
    if (ep.enclosureUrl) {
        getCachePath(ep).then(({ cached }) => {
            if (cached) {
                playBtn.textContent = '▶ Play Downloaded Episode';
                parts[parts.length - 1] = formatFileSize(cached.size);
                metaEl.textContent = parts.join(' · ') + ' · ✓ Downloaded';
            }
        }).catch(() => {});
    }
    playBtn.addEventListener('click', () => downloadAndPlay(ep));
    detail.appendChild(playBtn);

    // Description
    if (ep.description) {
        const descEl = document.createElement('div');
        descEl.className = 'podcast-episode-detail-desc';
        // Strip HTML tags for safety, render as text
        const parsed = new DOMParser().parseFromString(ep.description, 'text/html');
        descEl.textContent = parsed.body.textContent;
        detail.appendChild(descEl);
    }

    list.appendChild(detail);
    playBtn.focus();
}

// --- Search ---

async function searchPodcasts(query) {
    const generation = ++requestGeneration;
    if (!query || query.length < 2) {
        setState('SEARCH');
        return;
    }
    getStatus().textContent = 'Searching…';
    getList().innerHTML = '';
    try {
        const result = await apiRequest('/search/byterm', { q: query, max: 20 });
        if (generation !== requestGeneration || !isPodcastPanelOpen()) return;
        cachedPodcasts = result.feeds || [];
        getStatus().textContent = '';
        setState('PODCASTS');
        if (cachedPodcasts.length === 0) {
            getStatus().textContent = 'No podcasts found.';
        }
    } catch (e) {
        if (generation !== requestGeneration || !isPodcastPanelOpen()) return;
        console.error('Podcast search error:', e);
        getStatus().textContent = e.message || 'Search failed.';
    }
}

// --- Episodes ---

async function loadEpisodes(podcast) {
    clearTimeout(searchTimeout);
    const generation = ++requestGeneration;
    currentPodcast = podcast;
    cachedEpisodes = [];
    addRecentPodcast(podcast);
    setState('EPISODES');
    getStatus().textContent = 'Loading episodes…';
    getList().innerHTML = '';
    try {
        const result = await apiRequest('/episodes/byfeedid', { id: podcast.id, max: 50 });
        if (generation !== requestGeneration || !isPodcastPanelOpen()) return;
        cachedEpisodes = result.items || [];
        getStatus().textContent = '';
        renderEpisodes(true);
        if (cachedEpisodes.length === 0) {
            getStatus().textContent = 'No episodes found.';
        }
    } catch (e) {
        if (generation !== requestGeneration || !isPodcastPanelOpen()) return;
        console.error('Episode load error:', e);
        getStatus().textContent = 'Failed to load episodes.';
    }
}

// --- Download ---

const downloadEpisode = createEpisodeDownloader({
    getCachePath,
    exists,
    download: (url, filename) => invoke('download_file', { url, filename }),
    subscribe: (filename, progress) => listen('download-progress', event => {
        if (event.payload.filename === filename) progress(event.payload.percent);
    }),
    open: async (path, episode) => { await _handleMP3FilePath(path, episode.podcast); closePodcastPanel(); },
    reportStatus: text => { getStatus().textContent = text; },
});

async function downloadAndPlay(episode) {
    try { await downloadEpisode({ ...episode, podcast: episodeMetadata(episode) }); }
    catch (error) {
        console.error('Download error:', error);
        getStatus().textContent = 'Could not open episode: ' + (typeof error === 'string' ? error : error.message);
    }
}

// --- Init ---

export function initPodcastBrowser(handleMP3FilePath) {
    _handleMP3FilePath = handleMP3FilePath;
    installPodcastNavigation({ panel: getPanel(), list: getList(), searchInput: getSearchInput() });

    getSearchInput().addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        requestGeneration++;
        const val = e.target.value.trim();
        if (!val) {
            setState('SEARCH');
            return;
        }
        searchTimeout = setTimeout(() => searchPodcasts(val), 400);
    });

    $('podcast-back-btn').addEventListener('click', () => {
        requestGeneration++;
        if (state === 'EPISODE_DETAIL') {
            setState('EPISODES', true);
        } else {
            setState(cachedPodcasts.length ? 'PODCASTS' : 'SEARCH');
            getSearchInput().parentElement.style.display = '';
            getSearchInput().focus();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPodcastPanelOpen()) {
            e.stopPropagation();
            closePodcastPanel();
        }
    });

    getPanel().addEventListener('mousedown', (e) => {
        if (e.target === getPanel()) {
            closePodcastPanel();
        }
    });
}
