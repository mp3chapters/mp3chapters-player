import 'vidstack/player';
import 'vidstack/player/layouts';
import 'vidstack/player/ui';

import { startUp } from '@common/Player.js';
import { loadFile } from '@common/FileLoader.js';


function isAudioFile(ev) {
    const data = ev.dataTransfer.items;
    for (let i = 0; i < data.length; i += 1) {
        if (data[i].kind === "file" && data[i].type.match("^audio/")) {
            return true;
        }
    }
    return false;
}

function selectAndLoadFile() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.addEventListener('change', async function () {
        const file = fileInput.files[0];
        const fileName = file.name;
        const url = URL.createObjectURL(file);
        player.src = { src: url, type: 'audio/mpeg' };
        const { id3Title } = await loadFile(player, url);
        if (id3Title) {
            document.title = `${id3Title} [${fileName}]`;
        } else {
            document.title = fileName;
        }
        fileInput.remove();
        document.getElementById('cover-image').style.cursor = 'default';
        document.getElementById('cover-image').removeEventListener('click', selectAndLoadFile);
    });
    fileInput.click();
}


// if gallery is not visible, display a full screen drop overlay
// if gallery is visible, display a drop overlay only over the hero image

export function initializeDragDrop(callback) {
    // const dropOverlay = document.getElementById('drop-overlay');
    // const heroOverlay = document.getElementById('hero-drop-overlay');

    function dragOverHandler(ev) {
    //     if (isAudioFile(ev) && !isGalleryVisible()) {
    //         dropOverlay.style.display = "block";
    //     }
        ev.preventDefault();
    }

    // function heroDragOverHandler(ev) {
    //     if (isAudioFile(ev) && isGalleryVisible()) {
    //         heroOverlay.style.display = "block";
    //     }
    //     ev.preventDefault();
    // }

    // function dragEndHandler(ev) {
    //     dropOverlay.style.display = "none";
    //     heroOverlay.style.display = "none";
    //     ev.preventDefault();
    // }

    function dropHandler(ev) {
        // dropOverlay.style.display = "none";
        // heroOverlay.style.display = "none";

        ev.preventDefault();

        if (isAudioFile(ev) && ev.dataTransfer.items) {
            [...ev.dataTransfer.items].forEach((item) => {
                if (item.kind === "file") {
                    let file = item.getAsFile();
                    let reader = new FileReader();

                    reader.onload = function (e) {
                        let blob = e.target.result;
                        // Call the provided callback with the file name and file text
                        callback(file.name, blob);
                    };

                    reader.readAsArrayBuffer(file);
                }
            });
        }
    }

    document.body.addEventListener('drop', (e) => {
        dropHandler(e);
    });
    document.body.addEventListener('dragover', dragOverHandler);
    // document.body.addEventListener('dragenter', dragOverHandler);
    // document.body.addEventListener('dragleave', dragEndHandler);

    // hero.addEventListener('drop', dropHandler);
    // hero.addEventListener('dragover', heroDragOverHandler);
    // hero.addEventListener('dragenter', heroDragOverHandler);
    // hero.addEventListener('dragleave', dragEndHandler);

}


window.addEventListener("DOMContentLoaded", async () => {

    startUp();

    initializeDragDrop(async (filename, blob) => {
        const file = new File([blob], filename);
        const url = URL.createObjectURL(file);
        player.src = { src: url, type: 'audio/mpeg' };
        const { id3Title } = await loadFile(player, url);
        if (id3Title) {
            document.title = `${id3Title} [${filename}]`;
        } else {
            document.title = filename;
        }
    });


    const coverImageElement = document.getElementById('cover-image');
    coverImageElement.style.cursor = 'pointer';
    coverImageElement.addEventListener('click', selectAndLoadFile);

    // document.querySelector(".container").addEventListener("click", 
    //   async function openFile() {
    //     /* show open file dialog */
    //     const selected = await open({
    //       title: "Open Audio File",
    //       multiple: false,
    //       directory: false,
    //       filters: [
    //         { name: "Audio Files", extensions: ["mp3", "ogg"] },
    //       ],
    //     });

    //     /* read data into a Uint8Array */
    //     const d = await readBinaryFile(selected);
    //   });

    // greetInputEl = document.querySelector("#greet-input");
    // greetMsgEl = document.querySelector("#greet-msg");
    // document.querySelector("#greet-form").addEventListener("submit", (e) => {
    //   e.preventDefault();
    //   greet();
    // });
});
