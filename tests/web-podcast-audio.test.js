import test from 'node:test';
import assert from 'node:assert/strict';
import { createPodcastPlayer } from '../src-web/PodcastAudio.js';
import { getCacheFilename } from '../src-common/PodcastDownloads.js';

const episode = {
    enclosureUrl: 'https://example.org/episode.mp3',
    podcast: { show: 'Show', title: 'Current title', artwork: 'https://example.org/art.jpg' },
};

function fixture(overrides = {}) {
    const opened = [], streamed = [], saved = [], statuses = [];
    const cache = {
        list: async () => [], get: async () => null,
        save: async (filename, blob) => { saved.push({ filename, blob }); return true; },
        ...overrides.cache,
    };
    const play = createPodcastPlayer({
        cache,
        openBlob: async (...args) => { opened.push(args); },
        openStream: async (...args) => { streamed.push(args); },
        fetchImpl: overrides.fetchImpl || (async () => new Response('ID3 audio', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '9' } })),
    });
    return { play: (value = episode, signal) => play(value, text => statuses.push(text), signal), opened, streamed, saved, statuses };
}

test('opens saved audio without a fetch even when the episode title changed', async () => {
    const filename = await getCacheFilename(episode.enclosureUrl, { show: 'Show', title: 'Old title' });
    const blob = new Blob(['ID3 audio'], { type: 'audio/mpeg' });
    const f = fixture({
        cache: { list: async () => [{ filename, size: blob.size }], get: async key => { assert.equal(key, filename); return blob; } },
        fetchImpl() { assert.fail('Saved audio must not fetch'); },
    });
    await f.play();
    assert.deepEqual(f.opened, [[blob, filename, episode.podcast, { cached: true }]]);
    assert.equal(f.saved.length, 0);
});

test('downloads complete audio, reports progress, saves it and preserves show metadata', async () => {
    const f = fixture();
    await f.play();
    assert.equal(f.saved.length, 1);
    assert.equal(await f.saved[0].blob.text(), 'ID3 audio');
    assert.equal(f.saved[0].blob.type, 'audio/mpeg');
    assert.equal(f.opened[0][2], episode.podcast);
    assert.deepEqual(f.opened[0][3], { cached: true });
    assert.ok(f.statuses.includes('Downloading… 100%'));
    assert.equal(f.statuses.at(-1), 'Opening…');
    assert.equal(f.streamed.length, 0);
});

test('an initial CORS/network rejection falls back to direct streaming', async () => {
    const f = fixture({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    await f.play();
    assert.equal(f.streamed.length, 1);
    assert.equal(f.streamed[0][0], episode.enclosureUrl);
    assert.equal(f.streamed[0][2], episode.podcast);
    assert.equal(f.saved.length, 0);
    assert.equal(f.opened.length, 0);
});

test('cancellation never falls back, saves, or opens an episode', async () => {
    for (const useSignal of [false, true]) {
        const controller = new AbortController();
        const f = fixture({ fetchImpl: async (_, options) => {
            if (useSignal) { assert.equal(options.signal, controller.signal); controller.abort(); }
            throw new DOMException('Cancelled', 'AbortError');
        } });
        await assert.rejects(f.play(episode, controller.signal), { name: 'AbortError' });
        assert.equal(f.streamed.length + f.saved.length + f.opened.length, 0);
    }
});

test('HTTP errors and non-audio error pages never become streams or saved episodes', async () => {
    for (const response of [
        new Response('missing', { status: 404 }),
        new Response('<html>login required</html>', { headers: { 'Content-Type': 'text/html' } }),
        Response.json({ error: 'access denied' }),
    ]) {
        const f = fixture({ fetchImpl: async () => response });
        await assert.rejects(f.play(), /HTTP 404|instead of an audio file/);
        assert.equal(f.streamed.length + f.saved.length + f.opened.length, 0);
    }
});

test('partial body failures and truncated downloads never cache or open partial audio', async () => {
    for (const truncated of [false, true]) {
        let part = 0;
        const body = new ReadableStream({
            pull(controller) {
                if (part++ === 0) controller.enqueue(new TextEncoder().encode('ID3'));
                else if (truncated) controller.close();
                else controller.error(new TypeError('Network interrupted'));
            },
        });
        const f = fixture({ fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '30' } }) });
        await assert.rejects(f.play(), /Network interrupted|incomplete/);
        assert.equal(f.streamed.length + f.saved.length + f.opened.length, 0);
    }
});

test('quota and unavailable storage do not prevent playback of a complete download', async () => {
    for (const throws of [false, true]) {
        const f = fixture({ cache: { save: async () => {
            if (throws) throw new DOMException('Full', 'QuotaExceededError');
            return false;
        } } });
        await f.play();
        assert.equal(f.opened.length, 1);
        assert.deepEqual(f.opened[0][3], { cached: false });
        assert.equal(f.streamed.length, 0);
    }
});

test('rejects unsafe URLs and HTTP audio on an HTTPS page before any fetch', async t => {
    const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:' }, configurable: true });
    t.after(() => { if (location) Object.defineProperty(globalThis, 'location', location); else delete globalThis.location; });
    for (const enclosureUrl of ['javascript:alert(1)', 'file:///private/audio.mp3', 'https://user:password@example.org/audio.mp3', 'http://example.org/audio.mp3']) {
        const f = fixture({ fetchImpl() { assert.fail('Unsafe audio URLs must not fetch'); } });
        await assert.rejects(f.play({ ...episode, enclosureUrl }), /valid audio URL|insecure audio link/);
    }
});
