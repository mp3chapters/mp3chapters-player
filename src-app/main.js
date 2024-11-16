import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';

import { invoke } from '@tauri-apps/api/tauri';
import { open } from '@tauri-apps/api/dialog';
import { appWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event'

import { loadFile } from '@common/FileLoader.js';
import { startUp } from '@common/Player.js';

listen('tauri://file-drop', event => {
    console.log(event);
    const filesDrop = event.payload;
    for (let file of filesDrop) {
        if (file.endsWith('.mp3')) {
            const url = convertFileSrc(file);
            console.log(url);
            player.src = { src: url, type: 'audio/mpeg' };
            loadFile(player, url);
            const fileName = file.split('\\').pop().split('/').pop();
            appWindow.setTitle(fileName);
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
    const url = convertFileSrc(selected);
    console.log(url);
    player.src = { src: url, type: 'audio/mpeg' };
    loadFile(player, url);
    const fileName = selected.split('\\').pop().split('/').pop();
    appWindow.setTitle(fileName);
}

const unlisten = await appWindow.onMenuClicked(async ({ payload: menuId }) => {
    console.log('Menu clicked: ' + menuId);
    if (menuId == 'open') {
        openFile();
    }
});

const player = document.querySelector("media-player");

startUp();

window.addEventListener("DOMContentLoaded", async () => {
    // greetInputEl = document.querySelector("#greet-input");
    // greetMsgEl = document.querySelector("#greet-msg");
    // document.querySelector("#greet-form").addEventListener("submit", (e) => {
    //   e.preventDefault();
    //   greet();
    // });
});

function handleMP3FilePath(filePath) {
    const url = convertFileSrc(filePath);
    player.src = { src: url, type: 'audio/mpeg' };
    loadFile(player, url);
    const fileName = filePath.split('\\').pop().split('/').pop();
    appWindow.setTitle(fileName);
}

listen('load-file', event => {
    const filePath = event.payload;
    handleMP3FilePath(filePath);
});
