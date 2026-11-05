import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadFile, loadStream } from '../src-common/FileLoader.js';

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

test('streaming fallback clears stale local chapters, file, and artwork without fetching audio', (t) => {
    const originals = Object.fromEntries(['window', 'document', 'fetch'].map(key => [key, globalThis[key]]));
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    t.after(() => {
        for (const [key, value] of Object.entries(originals)) {
            if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
        }
        if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        else delete globalThis.navigator;
    });
    let chapters;
    const image = { style: {} };
    globalThis.window = {
        currentFile: new Blob(['old file']), chapterImages: ['old image'], id3Title: 'Old title',
        chapters: { setChapters(value) { chapters = value; } },
    };
    globalThis.document = { getElementById: id => id === 'cover-image' ? image : null };
    globalThis.fetch = () => assert.fail('Streaming metadata must not try to fetch blocked audio');
    const result = loadStream({ state: { duration: 20 } }, 'episode.mp3', { show: 'New show', title: 'New episode', artwork: 'https://example.org/new.jpg' });
    assert.equal(window.currentFile, null);
    assert.equal(window.id3Title, null);
    assert.deepEqual(window.chapterImages, []);
    assert.deepEqual(chapters, []);
    assert.equal(image.src, 'https://example.org/new.jpg');
    assert.equal(window.mediaTitle, 'New episode');
    assert.equal(result.id3Title, null);
});

function metadataFixture(t, readTags) {
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
    const requests = [];
    globalThis.window = { currentFilename: 'previous.mp3', id3Title: 'Previous title', chapters: { setChapters() {} } };
    globalThis.document = { getElementById: id => id === 'cover-image' ? image : null };
    globalThis.fetch = async (_, options) => {
        requests.push(options);
        return new Response(new Blob(['fixture'], { type: 'audio/mpeg' }));
    };
    globalThis.readTags = readTags;
    return { player: { state: { duration: 2 } }, requests };
}

test('metadata reader errors reject without changing the active metadata and allow another file to load', async t => {
    const f = metadataFixture(t, (_, __, onError) => {
        queueMicrotask(() => onError(new Error('Audio file read failed')));
    });
    await assert.rejects(loadFile(f.player, 'blob:bad', 'bad.mp3'), /Audio file read failed/);
    assert.equal(window.currentFilename, 'previous.mp3');
    globalThis.readTags = (_, callback) => callback({ title: 'Good title' });
    await loadFile(f.player, 'blob:good', 'good.mp3');
    assert.equal(window.currentFilename, 'good.mp3');
    assert.equal(window.id3Title, 'Good title');
});

test('metadata readers that never call back time out and are aborted', async t => {
    let aborts = 0;
    const f = metadataFixture(t, () => ({ abort() { aborts++; } }));
    await assert.rejects(loadFile(f.player, 'blob:stalled', 'stalled.mp3', null, { metadataTimeoutMs: 0 }), /Could not read audio metadata/);
    assert.equal(aborts, 1);
    assert.equal(window.currentFilename, 'previous.mp3');
});

test('cancellation aborts metadata reads and late callbacks cannot replace the next file', async t => {
    let lateCallback, aborts = 0, started;
    const reading = new Promise(resolve => { started = resolve; });
    const f = metadataFixture(t, (_, callback) => {
        lateCallback = callback;
        started();
        return { abort() { aborts++; } };
    });
    const controller = new AbortController();
    const pending = loadFile(f.player, 'blob:old', 'old.mp3', null, { signal: controller.signal });
    await reading;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(aborts, 1);
    assert.equal(f.requests[0].signal, controller.signal);
    globalThis.readTags = (_, callback) => callback({ title: 'Current title' });
    await loadFile(f.player, 'blob:current', 'current.mp3');
    lateCallback({ title: 'Stale title' });
    await Promise.resolve();
    assert.equal(window.currentFilename, 'current.mp3');
    assert.equal(window.id3Title, 'Current title');
});

test('cancellation between the metadata callback and application prevents stale metadata', async t => {
    const controller = new AbortController();
    const f = metadataFixture(t, (_, callback) => {
        callback({ title: 'Cancelled title' });
        controller.abort();
    });
    await assert.rejects(loadFile(f.player, 'blob:cancelled', 'cancelled.mp3', null, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(window.currentFilename, 'previous.mp3');
});

test('an already cancelled load never fetches or parses the file', async t => {
    const f = metadataFixture(t, () => assert.fail('Cancelled metadata must not parse'));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(loadFile(f.player, 'blob:cancelled', 'cancelled.mp3', null, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(f.requests.length, 0);
});

test('the bundled ID3 wrapper reports FileReader failures, cancellations and parsing errors', async () => {
    const source = await readFile(new URL('../src-common/node-id3-browserify.js', import.meta.url), 'utf8');
    const start = source.indexOf('// Function to read a file as a buffer');
    const end = source.indexOf('window.addTags = addTags;', start);
    assert.ok(start >= 0 && end > start);
    let lastReader;
    class FileReaderFixture {
        constructor() { lastReader = this; }
        readAsArrayBuffer() {}
        abort() { this.onabort?.(); }
    }
    const parserError = new Error('Invalid ID3 metadata');
    const wrapper = vm.runInNewContext(source.slice(start, end) + '\n({ readTags, addTags })', {
        FileReader: FileReaderFixture, Buffer, DOMException,
        NodeID3: { read() { throw parserError; }, write() { return Buffer.from('written'); } },
        convertUint8ArraysToBuffers() {},
    });
    let reported;
    const reader = wrapper.readTags(new Blob(['audio']), () => assert.fail('Reader errors must not return tags'), error => { reported = error; });
    assert.equal(reader, lastReader);
    reader.error = new Error('FileReader failed');
    reader.onerror();
    assert.equal(reported, reader.error);
    reader.abort();
    assert.equal(reported.name, 'AbortError');
    reader.onload({ target: { result: new ArrayBuffer(3) } });
    assert.equal(reported, parserError);
    let written;
    wrapper.addTags({}, new Blob(['audio']), value => { written = value; });
    lastReader.onload({ target: { result: new ArrayBuffer(3) } });
    assert.equal(written.toString(), 'written');
});
