import test from 'node:test';
import assert from 'node:assert/strict';
import { getCacheFilename, getCacheKey, findCachedEpisode, formatFileSize, createEpisodeDownloader } from '../src-app/PodcastDownloads.js';

test('cache names are stable, collision-resistant, and never contain URL paths', async () => {
    const url = 'https://example.org/audio.MP3?token=first';
    const metadata = { show: 'Planet Money', title: 'A very long episode title: ../../ what happened?' };
    const name = await getCacheFilename(url, metadata);
    assert.match(name, /^planet-money-a-very-long-episode--[a-f0-9]{24}\.mp3$/);
    assert.ok(name.length < 68);
    assert.equal(await getCacheFilename(url, metadata), name);
    assert.notEqual(await getCacheFilename(url.replace('first', 'second')), name);
    assert.match(await getCacheFilename('https://example.org/download'), /^episode--[a-f0-9]{24}\.mp3$/);
    assert.match(await getCacheFilename(url, { title: 'Café / 東京' }), /^cafe-東京--[a-f0-9]{24}\.mp3$/);
    await assert.rejects(getCacheFilename('file:///private/audio.mp3'), /Invalid audio URL/);
    await assert.rejects(getCacheFilename('https://user:password@example.org/audio.mp3'), /Invalid audio URL/);
});

test('reuses legacy downloads and finds new downloads even after episode titles change', async () => {
    const url = 'https://example.org/audio.mp3';
    const key = await getCacheKey(url);
    const legacy = { filename: `${key}.mp3`, size: 1234 };
    assert.equal(findCachedEpisode([legacy], key), legacy);
    const cached = { filename: await getCacheFilename(url, { show: 'Show', title: 'Old episode title' }), size: 2345 };
    assert.notEqual(cached.filename, await getCacheFilename(url, { show: 'Show', title: 'New episode title' }));
    assert.equal(findCachedEpisode([cached], key), cached);
    assert.equal(findCachedEpisode([legacy, cached], await getCacheKey(url + '?different=1')), undefined);
});

test('formats advertised and cached episode sizes, including unknown sizes', () => {
    assert.equal(formatFileSize(12500000), '12.5 MB');
    assert.equal(formatFileSize('2400000'), '2.4 MB');
    assert.equal(formatFileSize(500), '500 B');
    for (const value of [undefined, 0, -1, Infinity, 'unknown']) assert.equal(formatFileSize(value), 'Size unknown');
});

test('failed downloads clean up listeners and retry rather than opening partial files', async () => {
    let attempts = 0, listeners = 0, opens = 0, complete = false;
    const downloader = createEpisodeDownloader({
        getCachePath: async () => ({ filename: 'fixture.mp3', destPath: '/cache/fixture.mp3' }),
        exists: async () => complete,
        subscribe: async () => { listeners++; return () => listeners--; },
        download: async () => { if (++attempts === 1) throw 'connection interrupted'; complete = true; },
        open: async () => { opens++; }, reportStatus() {},
    });
    await assert.rejects(downloader({ enclosureUrl: 'https://example.org/audio.mp3' }));
    assert.equal(listeners, 0);
    assert.equal(opens, 0);
    await downloader({ enclosureUrl: 'https://example.org/audio.mp3' });
    assert.equal(attempts, 2);
    assert.equal(listeners, 0);
    assert.equal(opens, 1);
    await downloader({ enclosureUrl: 'https://example.org/audio.mp3' });
    assert.equal(attempts, 2);
    assert.equal(opens, 2);
});

test('opening cached audio keeps the show and episode metadata without downloading', async () => {
    const episode = { enclosureUrl: 'https://example.org/audio.mp3', podcast: { show: 'Show', title: 'Episode' } };
    const downloader = createEpisodeDownloader({
        getCachePath: async value => { assert.equal(value, episode); return { filename: 'legacy.mp3', destPath: '/cache/legacy.mp3' }; },
        exists: async () => true,
        download() { assert.fail('Cached audio must not download'); },
        subscribe() { assert.fail('Cached audio must not subscribe'); },
        open: async (path, value) => { assert.equal(path, '/cache/legacy.mp3'); assert.equal(value.podcast, episode.podcast); },
        reportStatus() {},
    });
    await downloader(episode);
});

test('cache and playback failures release the download state', async () => {
    let fail = true, opens = 0;
    const downloader = createEpisodeDownloader({
        getCachePath: async () => { if (fail) throw new Error('cache unavailable'); return { destPath: '/cache/audio.mp3' }; },
        exists: async () => true, download() { throw new Error('cached audio should not download'); },
        subscribe() { throw new Error('cached audio should not subscribe'); },
        open: async () => { opens++; }, reportStatus() {},
    });
    await assert.rejects(downloader({ enclosureUrl: 'https://example.org/audio.mp3' }), /cache unavailable/);
    fail = false;
    await downloader({ enclosureUrl: 'https://example.org/audio.mp3' });
    assert.equal(opens, 1);
});

test('ignores repeated play clicks while a download is active', async () => {
    let release, downloads = 0, opens = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const downloader = createEpisodeDownloader({
        getCachePath: async () => ({ filename: 'audio.mp3', destPath: '/cache/audio.mp3' }),
        exists: async () => false, subscribe: async () => () => {},
        download: async () => { downloads++; await pending; }, open: async () => { opens++; }, reportStatus() {},
    });
    const first = downloader({ enclosureUrl: 'https://example.org/audio.mp3' });
    await downloader({ enclosureUrl: 'https://example.org/audio.mp3' });
    release(); await first;
    assert.equal(downloads, 1);
    assert.equal(opens, 1);
});
