import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { createPodcastApi } from './PodcastApi.js';
import { createEpisodeDownloader, getCacheFilename } from './PodcastDownloads.js';
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
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
        setState('SEARCH');
        getSearchInput().value = '';
        getSearchInput().focus();
    }
}

function closePodcastPanel() {
    getPanel().classList.add('hidden');
}

export function isPodcastPanelOpen() {
    return !getPanel().classList.contains('hidden');
}

// --- State ---

function setState(newState) {
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
            renderEpisodes();
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

    const img = document.createElement('img');
    img.src = podcast.artwork || podcast.image || '';
    img.alt = '';
    img.loading = 'lazy';

    const textDiv = document.createElement('div');
    textDiv.className = 'podcast-item-text';

    const titleEl = document.createElement('div');
    titleEl.className = 'podcast-item-title';
    titleEl.textContent = podcast.title;

    const authorEl = document.createElement('div');
    authorEl.className = 'podcast-item-author';
    authorEl.textContent = podcast.author || '';

    textDiv.appendChild(titleEl);
    textDiv.appendChild(authorEl);
    item.appendChild(img);
    item.appendChild(textDiv);

    if (showRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'podcast-item-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from recent';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeRecentPodcast(podcast.id);
            renderRecentPodcasts();
        });
        item.appendChild(removeBtn);
    }

    item.addEventListener('click', () => loadEpisodes(podcast));
    return item;
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

async function getCachePath(enclosureUrl) {
    const dataDir = await appDataDir();
    const cacheDir = await join(dataDir, 'podcast-cache-v2');
    const filename = await getCacheFilename(enclosureUrl);
    return { filename, destPath: await join(cacheDir, filename) };
}

async function renderEpisodes() {
    const list = getList();
    list.innerHTML = '';
    for (const episode of cachedEpisodes) {
        const item = document.createElement('div');
        item.className = 'podcast-item podcast-episode-item';

        const img = document.createElement('img');
        img.src = episode.image || episode.feedImage || '';
        img.alt = '';
        img.loading = 'lazy';

        const textDiv = document.createElement('div');
        textDiv.className = 'podcast-item-text';

        const titleEl = document.createElement('div');
        titleEl.className = 'podcast-item-title';
        titleEl.textContent = episode.title;

        const metaEl = document.createElement('div');
        metaEl.className = 'podcast-item-author';
        const parts = [];
        if (episode.datePublished) parts.push(formatDate(episode.datePublished));
        if (episode.duration) parts.push(formatDuration(episode.duration));
        metaEl.textContent = parts.join(' · ');

        textDiv.appendChild(titleEl);
        textDiv.appendChild(metaEl);
        item.appendChild(img);
        item.appendChild(textDiv);

        // Check cache async, append indicator to meta line when ready
        if (episode.enclosureUrl) {
            getCachePath(episode.enclosureUrl).then(({ destPath }) =>
                exists(destPath).then(cached => {
                    if (cached) metaEl.textContent += ' · ✓ Downloaded';
                })
            ).catch(() => {});
        }

        // Info button
        const infoBtn = document.createElement('button');
        infoBtn.className = 'podcast-item-info';
        infoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="10" y="14.5" text-anchor="middle" font-size="12" font-weight="600" font-family="inherit">i</text></svg>';
        infoBtn.title = 'Episode info';
        infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showEpisodeDetail(episode);
        });
        item.appendChild(infoBtn);

        item.addEventListener('click', () => downloadAndPlay(episode));
        list.appendChild(item);
    }
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
    metaEl.textContent = parts.join(' · ');

    headerText.appendChild(titleEl);
    headerText.appendChild(metaEl);
    header.appendChild(img);
    header.appendChild(headerText);
    detail.appendChild(header);

    if (ep.enclosureLength) {
        const mb = (ep.enclosureLength / (1024 * 1024)).toFixed(1);
        metaEl.textContent += ` · ${mb} MB`;
    }

    // Play button
    const playBtn = document.createElement('button');
    playBtn.className = 'podcast-episode-detail-play';
    playBtn.textContent = '▶ Play Episode';
    // Check cache to show different label
    if (ep.enclosureUrl) {
        getCachePath(ep.enclosureUrl).then(({ destPath }) =>
            exists(destPath).then(cached => {
                if (cached) playBtn.textContent = '▶ Play Episode (Downloaded)';
            })
        ).catch(() => {});
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
}

// --- Search ---

async function searchPodcasts(query) {
    if (!query || query.length < 2) {
        renderRecentPodcasts();
        getStatus().textContent = '';
        return;
    }
    getStatus().textContent = 'Searching…';
    getList().innerHTML = '';
    try {
        const result = await apiRequest('/search/byterm', { q: query, max: 20 });
        cachedPodcasts = result.feeds || [];
        getStatus().textContent = '';
        setState('PODCASTS');
        if (cachedPodcasts.length === 0) {
            getStatus().textContent = 'No podcasts found.';
        }
    } catch (e) {
        console.error('Podcast search error:', e);
        getStatus().textContent = e.message || 'Search failed.';
    }
}

// --- Episodes ---

async function loadEpisodes(podcast) {
    currentPodcast = podcast;
    addRecentPodcast(podcast);
    setState('EPISODES');
    getStatus().textContent = 'Loading episodes…';
    getList().innerHTML = '';
    try {
        const result = await apiRequest('/episodes/byfeedid', { id: podcast.id, max: 50 });
        cachedEpisodes = result.items || [];
        getStatus().textContent = '';
        renderEpisodes();
        if (cachedEpisodes.length === 0) {
            getStatus().textContent = 'No episodes found.';
        }
    } catch (e) {
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
    open: async path => { await _handleMP3FilePath(path); closePodcastPanel(); },
    reportStatus: text => { getStatus().textContent = text; },
});

async function downloadAndPlay(episode) {
    try { await downloadEpisode(episode); }
    catch (error) {
        console.error('Download error:', error);
        getStatus().textContent = 'Could not open episode: ' + (typeof error === 'string' ? error : error.message);
    }
}

// --- Init ---

export function initPodcastBrowser(handleMP3FilePath) {
    _handleMP3FilePath = handleMP3FilePath;

    getSearchInput().addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const val = e.target.value.trim();
        if (!val) {
            setState('SEARCH');
            return;
        }
        searchTimeout = setTimeout(() => searchPodcasts(val), 400);
    });

    $('podcast-back-btn').addEventListener('click', () => {
        if (state === 'EPISODE_DETAIL') {
            setState('EPISODES');
        } else {
            setState('PODCASTS');
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
