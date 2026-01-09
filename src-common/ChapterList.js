import { TextTrack } from 'vidstack';

export function secondsToString(milliseconds, useWords = false) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const ms = milliseconds % 1000;

    const paddedHours = hours.toString().padStart(2, '0');
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = secs.toString().padStart(2, '0');
    const paddedMs = ms.toString().padEnd(3, '0');
    // const MsString = ms > 0 || window.chapters.usesMs ? `.${paddedMs}` : '';
    const MsString = '';

    if (!useWords) {
        if (hours > 0) {
            return `${paddedHours}:${paddedMinutes}:${paddedSeconds}${MsString}`;
        } else {
            return `${paddedMinutes}:${paddedSeconds}${MsString}`;
        }
    } else {
        let result = '';
        if (hours > 0) {
            result += `${hours} hour${hours == 1 ? '' : 's'} `;
        }
        if (minutes > 0) {
            result += `${minutes} min `;
        }
        if (secs > 0) {
            result += `${secs} sec`;
        }
        return result.trim();
    }
}

export class ChapterList {
    constructor() {
        this.chapters = [];
        this.eventListeners = [];
        this._duration = -1;
        this.usesMs = false;
    }

    set duration(newDuration) {
        this._duration = newDuration;
        if (newDuration != -1) {
            this.setChapters(this.chapters);
        }
    }

    get duration() {
        return this._duration;
    }

    chapterAtTime(time) {
        for (let chapter of this.chapters) {
            if (chapter.start <= time && chapter.end > time) {
                return chapter;
            }
        }
        return undefined;
    }

    visibleChapterAtTime(time) {
        for (let chapter of this.chapters) {
            if (chapter.start <= time && chapter.officialEnd > time) {
                return chapter;
            }
        }
        return undefined;
    }

    // Get the next chapter after the given time (only TOC entries)
    nextChapterAfterTime(time) {
        for (let chapter of this.chapters) {
            if (chapter.toc && chapter.start > time) {
                return chapter;
            }
        }
        return undefined;
    }

    // Get the previous chapter before the given time (only TOC entries)
    previousChapterBeforeTime(time) {
        let prevChapter = undefined;
        for (let chapter of this.chapters) {
            if (chapter.toc && chapter.start < time) {
                prevChapter = chapter;
            } else if (chapter.start >= time) {
                break;
            }
        }
        return prevChapter;
    }

    // Method to get chapters
    getChapters() {
        return this.chapters;
    }

    // Method to set chapters
    setChapters(newChapters) {
        // Sort the chapters by their start time
        this.chapters = newChapters.sort((a, b) => a.start - b.start);

        // Update the end time of each chapter to match the start time of the next chapter
        for (let i = 0; i < this.chapters.length - 1; i++) {
            this.chapters[i].end = this.chapters[i + 1].start;
        }

        // Warn if chapter starts after duration
        if (this.duration != -1) {
            for (let chapter of this.chapters) {
                if (chapter.start > this.duration * 1000) {
                    chapter.warning = 'Warning: Chapter starts after the end of the file';
                }
            }
        }

        // Update the end time of the last chapter to match the duration of the video
        if (this.chapters.length > 0) {
            const finalChapter = this.chapters[this.chapters.length - 1];
            finalChapter.end = Math.max(Math.round(this.duration * 1000), finalChapter.start, 0);
            if (this.chapters[0].start != 0) {
                this.chapters[0].warning = 'Best practice: First chapter should start at 00:00';
            }
        }

        // Update the "official" end time as the start time of the next chapter that is a TOC entry
        for (let i = 0; i < this.chapters.length; i++) {
            const chapter = this.chapters[i];
            chapter.chapterIndex = i;
            if (!chapter.toc) continue;
            // delete officialEnd if it exists
            if (chapter.hasOwnProperty('officialEnd')) {
                delete chapter.officialEnd;
            }
            for (let j = i + 1; j < this.chapters.length; j++) {
                if (this.chapters[j].toc) {
                    chapter.officialEnd = this.chapters[j].start;
                    break;
                }
            }
            if (!chapter.hasOwnProperty('officialEnd')) {
                chapter.officialEnd = Math.max(Math.round(this.duration * 1000), chapter.start, 0);
            }
        }


        // check if ms are used
        this.usesMs = false;
        for (let chapter of this.chapters) {
            if (chapter.start != -1 && chapter.start % 1000 != 0) {
                this.usesMs = true;
                break;
            }
        }

        this.triggerEventListeners();
    }

    addChapter(title, start) {
        const newChapter = { title, start, end: undefined };
        newChapter.start = Math.round(newChapter.start);
        this.chapters.push(newChapter);
        this.setChapters(this.chapters);
    }

    // Method to add an event listener
    addEventListener(listener) {
        this.eventListeners.push(listener);
    }

    // Method to trigger event listeners
    triggerEventListeners() {
        this.eventListeners.forEach(listener => listener(this.chapters));
    }

    addToPlayer() {
        const player = document.querySelector('media-player');
        player.textTracks.clear();
        const track = new TextTrack({
            kind: 'chapters',
            label: 'Chapters',
            language: 'en',
            default: true,
        });
        for (let chapter of this.chapters) {
            if (chapter.error == undefined && chapter.toc) {
                track.addCue(new VTTCue(
                    chapter.start / 1000,
                    chapter.officialEnd / 1000,
                    chapter.title
                ));
            }
        }
        player.textTracks.add(track);
        track.mode = 'showing';
    }

    populateChapterList() {
        const chaptersContainer = document.querySelector('.chapter-toc-list');
        if (!chaptersContainer) return;

        chaptersContainer.innerHTML = ''; // Clear existing content

        let chapterNumber = 0;
        let chapterIndex = -1;
        for (let chapter of this.chapters) {
            chapterIndex++;
            if (chapter.error != undefined || chapter.toc == false) continue;
            chapterNumber++;

            const chapterDiv = document.createElement('div');
            chapterDiv.className = 'chapter-toc-item';
            chapterDiv.dataset.chapterIndex = chapterIndex;

            let chapterImage;
            if (chapter.hasOwnProperty('imageId') && chapter.imageId != -1 && window.chapterImages[chapter.imageId] != undefined) {
                chapterImage = document.createElement('img');
                chapterImage.className = 'chapter-toc-image';
                const imageBlob = new Blob([window.chapterImages[chapter.imageId].imageBuffer], { type: window.chapterImages[chapter.imageId].mime });
                chapterImage.src = URL.createObjectURL(imageBlob);
                chapterImage.alt = 'Chapter Image';
            } else {
                chapterImage = document.createElement('div');
                chapterImage.className = 'chapter-toc-image';
                chapterImage.textContent = chapterNumber;
            }

            const chapterTextDiv = document.createElement('div');
            chapterTextDiv.className = 'chapter-toc-item-text';

            const chapterTitle = document.createElement('div');

            const chapterTime = document.createElement('div');
            chapterTime.className = 'chapter-toc-item-time';
            chapterTime.textContent = secondsToString(chapter.start, false);

            chapterTitle.appendChild(chapterTime);

            chapterTitle.className = 'chapter-toc-item-title';
            const chapterTitleText = document.createTextNode(chapter.title);
            chapterTitle.appendChild(chapterTitleText);

            const chapterDuration = document.createElement('div');
            chapterDuration.className = 'chapter-toc-item-duration';
            chapterDuration.textContent = secondsToString(chapter.officialEnd - chapter.start, true);

            const chapterLink = document.createElement('a');
            chapterLink.href = chapter.url;
            chapterLink.className = 'chapter-toc-item-link';
            chapterLink.textContent = chapter.url;

            chapterTextDiv.appendChild(chapterTitle);
            chapterTextDiv.appendChild(chapterDuration);
            chapterTextDiv.appendChild(chapterLink);

            chapterDiv.appendChild(chapterImage);
            chapterDiv.appendChild(chapterTextDiv);

            chaptersContainer.appendChild(chapterDiv);

            chapterDiv.addEventListener('click', () => {
                window.player.currentTime = chapter.start / 1000;
                window.player.play();
            });
        }
    }

}