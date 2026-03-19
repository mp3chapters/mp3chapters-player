import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';

import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getMatches } from '@tauri-apps/plugin-cli';
import { listen } from '@tauri-apps/api/event';

import { loadFile } from '@common/FileLoader.js';
import { startUp, toggleShortcutsPanel, goToNextChapter, goToPreviousChapter, SEEK_SECONDS, SPEED_STEP, MIN_SPEED, MAX_SPEED, VOLUME_STEP } from '@common/Player.js';
const appWindow = getCurrentWebviewWindow()

async function handleMP3FilePath(filePath) {
    const url = convertFileSrc(filePath);
    console.log("Opening file: " + url);
    player.src = { src: url, type: 'audio/mpeg' };
    const fileName = filePath.split('\\').pop().split('/').pop();
    const { id3Title } = await loadFile(player, url);
    if (id3Title) {
        appWindow.setTitle(`${id3Title} [${fileName}]`);
    } else {
        appWindow.setTitle(fileName);
    }
}

// Listen for drag-drop events (v2 renamed from file-drop to drag-drop)
listen('tauri://drag-drop', event => {
    console.log(event);
    const payload = event.payload;
    // In v2, payload has { paths: string[], position: { x, y } }
    if (payload.paths) {
        for (let file of payload.paths) {
            if (file.endsWith('.mp3')) {
                handleMP3FilePath(file);
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
            { name: "Audio Files", extensions: ["mp3", "ogg"] },
        ],
    });
    console.log(selected);
    if (selected) {
        handleMP3FilePath(selected);
    }
}

// Listen for menu events from Rust
listen('menu-event', async (event) => {
    const menuId = event.payload;
    console.log('Menu clicked: ' + menuId);
    switch (menuId) {
        case 'open':
            openFile();
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

const player = document.querySelector("media-player");

startUp();

// reading arguments from the command line
getMatches().then((matches) => {
    console.log("Matches:");
    console.log(matches);
    window.matches = matches;
    if (matches.args.filename.value) {
        console.log(matches.args.filename.value);
        handleMP3FilePath(matches.args.filename.value);
    }
});
