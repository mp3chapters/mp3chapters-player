import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open, message } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from '@tauri-apps/api/event';

import { loadFile } from '@common/FileLoader.js';
import { startUp, toggleShortcutsPanel, goToNextChapter, goToPreviousChapter, SEEK_SECONDS, SPEED_STEP, MIN_SPEED, MAX_SPEED, VOLUME_STEP } from '@common/Player.js';
import { initPodcastBrowser, togglePodcastPanel } from './PodcastBrowser.js';
const appWindow = getCurrentWebviewWindow()
let isDesktop = false;
let activeBlobUrl;
let fileLoadQueue = Promise.resolve();

function showFileError(error) {
    console.error('Could not open audio file:', error);
    message(typeof error === 'string' ? error : error.message, { title: 'Could not open audio file', kind: 'error' }).catch(console.error);
}

function requestFileOpen(filePath, podcast = null) {
    fileLoadQueue = fileLoadQueue.catch(() => {}).then(() => handleMP3FilePath(filePath, podcast));
    return fileLoadQueue;
}

function audioMimeType(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    return { ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac' }[extension] || 'audio/mpeg';
}

async function handleMP3FilePath(filePath, podcast = null) {
    if (isDesktop && !podcast) {
        const recent = await invoke('get_recent_files');
        podcast = recent.find(file => file.path === filePath)?.podcast || null;
    }
    let url;
    const isFileUri = /^(file|content):\/\//.test(filePath);
    const mime = audioMimeType(filePath);
    if (isFileUri) {
        // On mobile, the dialog returns file:// URIs which the asset protocol can't handle;
        // read via fs plugin and create a blob URL instead
        const contents = await readFile(filePath);
        const blob = new Blob([contents], { type: mime });
        url = URL.createObjectURL(blob);
    } else {
        url = convertFileSrc(filePath);
    }
    console.log("Opening file: " + url);
    player.src = { src: url, type: mime };
    if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = isFileUri ? url : null;
    const fileName = filePath.split('\\').pop().split('/').pop();
    window.currentFilename = fileName;
    const { id3Title, artist, album } = await loadFile(player, url, fileName, podcast);
    if (!podcast && /[\\/]podcast-cache-v2[\\/]/.test(filePath)) {
        podcast = { show: album || artist || 'Podcast', title: id3Title || 'Episode', artwork: null };
    }
    const displayName = podcast ? `${podcast.show} > ${podcast.title}` : id3Title ? `${id3Title} [${fileName}]` : fileName;
    if (isDesktop) await appWindow.setTitle(displayName);
    const filenameChip = document.getElementById('filename-chip');
    filenameChip.textContent = displayName;
    filenameChip.title = filePath;
    filenameChip.classList.add('visible');
    document.getElementById('welcome-screen')?.classList.add('hidden');
    if (isDesktop) {
        await invoke('add_recent_file', { path: filePath, podcast });
    }
}

// Listen for drag-drop events (v2 renamed from file-drop to drag-drop)
listen('tauri://drag-drop', event => {
    console.log(event);
    const payload = event.payload;
    // In v2, payload has { paths: string[], position: { x, y } }
    if (payload.paths) {
        for (let file of payload.paths) {
            if (/\.(mp3|ogg|m4a|aac|wav|flac)$/i.test(file)) {
                requestFileOpen(file).catch(showFileError);
                break;
            }
        }
    }
});

async function openFile() {
    const selected = await open({
        title: "Open Audio File",
        multiple: false,
        directory: false,
        filters: [
            { name: "Audio Files", extensions: ["mp3", "ogg", "m4a", "aac", "wav", "flac"] },
        ],
    });
    console.log(selected);
    if (selected) {
        await requestFileOpen(selected);
    }
}

// Listen for menu events from Rust
listen('menu-event', async (event) => {
    const menuId = event.payload;
    console.log('Menu clicked: ' + menuId);
    switch (menuId) {
        case 'open':
            openFile().catch(showFileError);
            break;
        case 'open_podcast':
            togglePodcastPanel();
            break;
        case 'keyboard_shortcuts':
            toggleShortcutsPanel();
            break;
        // Playback controls
        case 'play_pause':
            if (player.paused) {
                player.play();
            } else {
                player.pause();
            }
            break;
        case 'mute':
            player.muted = !player.muted;
            break;
        case 'seek_forward':
            player.currentTime = Math.min(player.duration, player.currentTime + SEEK_SECONDS);
            break;
        case 'seek_backward':
            player.currentTime = Math.max(0, player.currentTime - SEEK_SECONDS);
            break;
        case 'go_to_beginning':
            player.currentTime = 0;
            break;
        case 'go_to_end':
            player.currentTime = player.duration;
            break;
        // Volume controls
        case 'volume_up':
            player.volume = Math.min(1, player.volume + VOLUME_STEP);
            break;
        case 'volume_down':
            player.volume = Math.max(0, player.volume - VOLUME_STEP);
            break;
        // Speed controls
        case 'increase_speed':
            player.playbackRate = Math.min(MAX_SPEED, player.playbackRate + SPEED_STEP);
            break;
        case 'decrease_speed':
            player.playbackRate = Math.max(MIN_SPEED, player.playbackRate - SPEED_STEP);
            break;
        case 'reset_speed':
            player.playbackRate = 1.0;
            break;
        // Chapter navigation
        case 'next_chapter':
            goToNextChapter(player, window.chapters);
            break;
        case 'previous_chapter':
            goToPreviousChapter(player, window.chapters);
            break;
    }
});

// Register before the startup handshake so cold-start Finder events aren't lost.
const fileListenerReady = listen('open-file', event => {
    isDesktop = event.payload.desktop;
    requestFileOpen(event.payload.path).catch(showFileError);
});
const errorListenerReady = listen('file-open-error', event => showFileError(event.payload));

const player = document.querySelector("media-player");

startUp();
initPodcastBrowser(requestFileOpen);

// Welcome screen buttons
document.getElementById('welcome-open-file')?.addEventListener('click', () => openFile().catch(showFileError));
document.getElementById('welcome-open-podcast')?.addEventListener('click', () => togglePodcastPanel());
window.togglePodcastPanel = togglePodcastPanel;

Promise.all([fileListenerReady, errorListenerReady]).then(() => invoke('frontend_ready')).then(async startup => {
    isDesktop = startup.desktop;
    for (const filePath of startup.files) await requestFileOpen(filePath);
}).catch(showFileError);
