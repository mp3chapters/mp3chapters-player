import '@common/node-id3-browserify.js';
import { ChapterList } from '@common/ChapterList.js';

// Keyboard shortcuts configuration
// Standard shortcuts based on VLC, YouTube, and other popular media players
const SEEK_SECONDS = 10;
const VOLUME_STEP = 0.1; // 10%
const SPEED_STEP = 0.25;
const MIN_SPEED = 0.25;
const MAX_SPEED = 3.0;

function setupKeyboardShortcuts(player, chapters) {
    document.addEventListener('keydown', (e) => {
        // Ignore shortcuts when typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        const key = e.key.toLowerCase();

        switch (key) {
            // Play/Pause: Space or K (YouTube style)
            case ' ':
            case 'k':
                e.preventDefault();
                if (player.paused) {
                    player.play();
                } else {
                    player.pause();
                }
                break;

            // Mute/Unmute: M
            case 'm':
                e.preventDefault();
                player.muted = !player.muted;
                break;

            // Volume Up: Up Arrow
            case 'arrowup':
                e.preventDefault();
                player.volume = Math.min(1, player.volume + VOLUME_STEP);
                break;

            // Volume Down: Down Arrow
            case 'arrowdown':
                e.preventDefault();
                player.volume = Math.max(0, player.volume - VOLUME_STEP);
                break;

            // Seek Forward: Right Arrow or L (YouTube style)
            case 'arrowright':
            case 'l':
                e.preventDefault();
                player.currentTime = Math.min(player.duration, player.currentTime + SEEK_SECONDS);
                break;

            // Seek Backward: Left Arrow or J (YouTube style)
            case 'arrowleft':
            case 'j':
                e.preventDefault();
                player.currentTime = Math.max(0, player.currentTime - SEEK_SECONDS);
                break;

            // Decrease Playback Speed: [ or , (< without shift)
            case '[':
            case ',':
                e.preventDefault();
                player.playbackRate = Math.max(MIN_SPEED, player.playbackRate - SPEED_STEP);
                break;

            // Increase Playback Speed: ] or . (> without shift)
            case ']':
            case '.':
                e.preventDefault();
                player.playbackRate = Math.min(MAX_SPEED, player.playbackRate + SPEED_STEP);
                break;

            // Next Chapter: N or Page Down
            case 'n':
            case 'pagedown':
                e.preventDefault();
                goToNextChapter(player, chapters);
                break;

            // Previous Chapter: P or Page Up
            case 'p':
            case 'pageup':
                e.preventDefault();
                goToPreviousChapter(player, chapters);
                break;

            // Go to Beginning: Home
            case 'home':
                e.preventDefault();
                player.currentTime = 0;
                break;

            // Go to End: End
            case 'end':
                e.preventDefault();
                player.currentTime = player.duration;
                break;

            // Jump to percentage: 0-9 keys
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                e.preventDefault();
                const percent = parseInt(key) * 10;
                player.currentTime = (percent / 100) * player.duration;
                break;

            // Show/hide keyboard shortcuts: ?
            case '?':
                e.preventDefault();
                toggleShortcutsPanel();
                break;

            // Close shortcuts panel: Escape
            case 'escape':
                const panel = document.getElementById('shortcuts-panel');
                if (panel && !panel.classList.contains('hidden')) {
                    e.preventDefault();
                    panel.classList.add('hidden');
                }
                break;
        }
    });
}

function goToNextChapter(player, chapters) {
    const currentTimeMs = player.currentTime * 1000;
    const nextChapter = chapters.nextChapterAfterTime(currentTimeMs);
    if (nextChapter) {
        player.currentTime = nextChapter.start / 1000;
    }
}

function goToPreviousChapter(player, chapters) {
    const currentTimeMs = player.currentTime * 1000;
    const currentChapter = chapters.visibleChapterAtTime(currentTimeMs);

    // If we're more than 3 seconds into the current chapter, go to its start
    // Otherwise, go to the previous chapter
    if (currentChapter && currentChapter.toc) {
        const secondsIntoChapter = (currentTimeMs - currentChapter.start) / 1000;
        if (secondsIntoChapter > 3) {
            player.currentTime = currentChapter.start / 1000;
            return;
        }
    }

    const prevChapter = chapters.previousChapterBeforeTime(currentTimeMs);
    if (prevChapter) {
        player.currentTime = prevChapter.start / 1000;
    } else {
        player.currentTime = 0;
    }
}

// Toggle keyboard shortcuts help panel
export function toggleShortcutsPanel() {
    const panel = document.getElementById('shortcuts-panel');
    if (panel) {
        panel.classList.toggle('hidden');
    }
}

// Make it available globally for the onclick handler
window.toggleShortcutsPanel = toggleShortcutsPanel;

export function startUp() {
    const chapters = new ChapterList();
    window.chapters = chapters;
    window.chapterImages = [];
    window.chapters.addEventListener(() => { window.chapters.addToPlayer(); window.chapters.populateChapterList(); });

    const player = document.querySelector("media-player");
    window.player = player;

    // Set up keyboard shortcuts for playback control
    setupKeyboardShortcuts(player, chapters);

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
                    const percentPlayed = 100 * (window.currentTime - currentVisibleChapter.start) / (currentVisibleChapter.end - currentVisibleChapter.start);
                    chapterItem.style.background = `linear-gradient(to right, var(--toc-progress-color) ${percentPlayed}%, var(--toc-item-background-color) ${percentPlayed}%)`;
                } else {
                    chapterItem.classList.remove('current-toc-item');
                    chapterItem.style.background = "";
                }
            }
        }
    });
}