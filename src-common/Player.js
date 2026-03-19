import '@common/node-id3-browserify.js';
import { ChapterList } from '@common/ChapterList.js';

// Keyboard shortcuts configuration
// Standard shortcuts based on VLC, YouTube, and other popular media players
export const SEEK_SECONDS = 10;
export const VOLUME_STEP = 0.1; // 10%
export const SPEED_STEP = 0.25;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 3.0;

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

export function goToNextChapter(player, chapters) {
    const currentTimeMs = player.currentTime * 1000;
    const nextChapter = chapters.nextChapterAfterTime(currentTimeMs);
    if (nextChapter) {
        player.currentTime = nextChapter.start / 1000;
    }
}

export function goToPreviousChapter(player, chapters) {
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
        // Within first 3 seconds: go to previous chapter
        // Look for chapter before the START of the current chapter, not current time
        const prevChapter = chapters.previousChapterBeforeTime(currentChapter.start);
        if (prevChapter) {
            player.currentTime = prevChapter.start / 1000;
        } else {
            player.currentTime = 0;
        }
        return;
    }

    // No current chapter found, try to find any previous chapter
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
        const fileInfoDisplay = document.getElementById('file-info-display');
        if (currentChapter && currentChapter.hasOwnProperty('imageId')) {
            if (currentChapter.imageId !== displayedImage) {
                displayedImage = currentChapter.imageId;
                const image = window.chapterImages[currentChapter.imageId];
                const blob = new Blob([image.imageBuffer], { type: image.mime });
                const url = URL.createObjectURL(blob);
                img.src = url;
                img.style.display = '';
                img.style.visibility = "visible";
                fileInfoDisplay.style.display = 'none';
            }
        } else if (displayedImage !== -1) {
            displayedImage = -1;
            img.src = window.coverImg;
            if (window.hasCoverArt) {
                img.style.display = '';
                img.style.visibility = "visible";
                fileInfoDisplay.style.display = 'none';
            } else {
                img.style.display = 'none';
                img.style.visibility = "hidden";
                fileInfoDisplay.style.display = '';
            }
        }
        // show/hide chapter URL chip
        const chipEl = document.getElementById('chapter-url-chip');
        if (chipEl) {
            if (currentChapter && currentChapter.url) {
                chipEl.href = currentChapter.url;
                chipEl.innerHTML = currentChapter.url.replace(/^https?:\/\//, '') + ' <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-left: 3px;"><path d="M4.5 1.5H2a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V7.5"/><path d="M7 1.5h3.5V5"/><path d="M5.5 6.5L10.5 1.5"/></svg>';
                chipEl.classList.add('visible');
            } else {
                chipEl.classList.remove('visible');
            }
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