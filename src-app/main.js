import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';

import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { appWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { getMatches } from '@tauri-apps/api/cli';
import { listen } from '@tauri-apps/api/event';

import { loadFile } from '@common/FileLoader.js';
import { startUp, toggleShortcutsPanel } from '@common/Player.js';

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

listen('tauri://file-drop', event => {
    console.log(event);
    const filesDrop = event.payload;
    for (let file of filesDrop) {
        if (file.endsWith('.mp3')) {
            handleMP3FilePath(file);
            break;
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

const unlisten = await appWindow.onMenuClicked(async ({ payload: menuId }) => {
    console.log('Menu clicked: ' + menuId);
    if (menuId == 'open') {
        openFile();
    } else if (menuId == 'keyboard_shortcuts') {
        toggleShortcutsPanel();
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
