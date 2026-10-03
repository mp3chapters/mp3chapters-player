import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFile } from '../src-common/FileLoader.js';

for (const [hasCover, podcast] of [[false, null], [true, null], [false, { show: 'Show', title: 'Episode', artwork: 'https://example.org/cover.jpg' }], [true, { artwork: 'https://example.org/cover.jpg' }], [false, { artwork: 'javascript:alert(1)' }]]) {
    test(`loads metadata with embedded cover=${hasCover}, podcast artwork=${podcast?.artwork || 'none'}`, async (t) => {
        const originals = Object.fromEntries(['window', 'document', 'readTags', 'fetch'].map(key => [key, globalThis[key]]));
        const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
        t.after(() => {
            for (const [key, value] of Object.entries(originals)) {
                if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
            }
            if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
            else delete globalThis.navigator;
        });
        const image = { style: {} };
        let chapters;
        globalThis.window = { chapters: { setChapters(value) { chapters = value; } } };
        globalThis.document = { getElementById: id => id === 'cover-image' ? image : null };
        globalThis.fetch = async () => new Response(new Blob(['fixture'], { type: 'audio/mpeg' }));
        globalThis.readTags = (_, callback) => callback(hasCover ? {
            title: 'Episode', image: { mime: 'image/png', imageBuffer: new Uint8Array([1]) },
        } : {});
        const result = await loadFile({ state: { duration: 2 } }, 'blob:fixture', 'episode.mp3', podcast);
        assert.equal(window.currentFilename, 'episode.mp3');
        assert.equal(window.currentFile.name, 'episode.mp3');
        assert.equal(result.id3Title, hasCover ? 'Episode' : null);
        assert.equal(image.style.display, '');
        assert.equal(chapters[0].toc, true);
        assert.equal(window.coverImg, image.src);
        if (hasCover) assert.ok(image.src.startsWith('blob:'));
        else if (podcast?.artwork?.startsWith('https:')) assert.equal(image.src, podcast.artwork);
        else assert.ok(image.src.startsWith('data:'));
        assert.equal(window.hasCoverArt, hasCover || Boolean(podcast?.artwork?.startsWith('https:')));
    });
}
