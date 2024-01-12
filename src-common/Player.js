import '@common/node-id3-browserify.js';
import { ChapterList } from '@common/ChapterList.js';

export function startUp() {
    const chapters = new ChapterList();
    window.chapters = chapters;
    window.chapterImages = [];
    window.chapters.addEventListener(() => { window.chapters.addToPlayer(); window.chapters.populateChapterList(); });

    const player = document.querySelector("media-player");
    window.player = player;

    setTimeout(() => {
        document.querySelector("media-play-button").disabled = true;
        document.querySelector("media-time-slider").disabled = true;
    }, 100);
    
    player.addEventListener('loaded-data', (e) => {
        if (player.src == "silence.mp3" || player.src == "404.mp3") {
            document.querySelector("media-play-button").disabled = true;
            document.querySelector("media-time-slider").disabled = true;
        } else {
            document.querySelector("media-play-button").disabled = false;
            document.querySelector("media-time-slider").disabled = false;
        }
        chapters.duration = player.state.duration;
        window.chapters.addToPlayer();
        // add data-tauri-drag-region to most elements
        document.querySelector('.vds-chapter-title').setAttribute('data-tauri-drag-region', '');
        for (const elem of document.querySelectorAll('media-controls-group')) {
            elem.setAttribute('data-tauri-drag-region', '');
        }
    });
    
    player.addEventListener('duration-change', (e) => {
        chapters.duration = e.detail;
    });
    
    let displayedImage = -1;
    player.addEventListener('time-update', (e) => {
        window.currentTime = e.detail.currentTime * 1000;
        if (chapters.duration != player.state.duration) {
            chapters.duration = player.state.duration;
        }
        const currentChapter = chapters.chapterAtTime(window.currentTime);
        // show image if chapter has one
        const img = document.getElementById('cover-image');
        if (currentChapter && currentChapter.hasOwnProperty('imageId')) {
            if (currentChapter.imageId !== displayedImage) {
                displayedImage = currentChapter.imageId;
                const image = window.chapterImages[currentChapter.imageId];
                const blob = new Blob([image.imageBuffer], { type: image.mime });
                const url = URL.createObjectURL(blob);
                img.src = url;
                img.style.visibility = "visible";
            }
        } else if (displayedImage !== -1) {
            displayedImage = -1;
            img.src = window.coverImg;
            img.style.visibility = "hidden";
        }
        // update chapter list
        const currentVisibleChapter = chapters.visibleChapterAtTime(window.currentTime);
        if (currentVisibleChapter) {
            for (let chapterItem of document.querySelectorAll('.chapter-toc-item')) {
                if (chapterItem.dataset.chapterIndex == currentVisibleChapter.chapterIndex) {
                    if (!chapterItem.classList.contains('current-toc-item')) {
                        chapterItem.classList.add('current-toc-item');
                        chapterItem.scrollIntoView({block: "center", behavior: "smooth"});
                    }
                } else {
                    chapterItem.classList.remove('current-toc-item');
                }
            }
        }
    });
}