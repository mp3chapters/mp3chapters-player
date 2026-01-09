// import { buildGallery } from "./ImageHandler.js";

function arrayEquals(a, b) {
    return a.length === b.length &&
        a.every((val, index) => val === b[index]);
}

export async function loadFile(player, url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    const file = new File([blob], "audiofile", { type: "audio/mpeg" });

    window.currentFilename = file.name;
    window.currentFile = file;
    window.chapters.duration = -1;
    window.chapterImages = [];
    window.id3Title = null; // Will be set if ID3 title tag exists

    let tags = await new Promise((resolve) => {
        readTags(file, (fileTags) => {
            resolve(fileTags);
        });
    });

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
        chapters.duration = player.state.duration;
        window.chapters.setChapters(parsedChapters);
    } else {
        const baseChapters = [
            {
                "title": "Introduction",
                "start": 0
            }
        ]
        window.chapters.setChapters(baseChapters);
    }

    if (tags.hasOwnProperty('encodedBy')) {
        tags.encodedBy = `${tags.encodedBy} and mp3chapters.github.io`;
    }

    const img = document.getElementById('cover-image');
    if (tags.hasOwnProperty('image')) {
        const blob = new Blob([tags.image.imageBuffer], { type: tags.image.mime });
        const url = URL.createObjectURL(blob);
        img.src = url;
    } else {
        img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkqAcAAIUAgUW0RjgAAAAASUVORK5CYII=";
    }
    window.coverImg = img.src;

    // buildGallery();

    // document.getElementById('filename').innerText = file.name;

    // Return the ID3 title for use by callers (e.g., setting window title)
    return { id3Title: window.id3Title };
}