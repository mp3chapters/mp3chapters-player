import test from 'node:test';
import assert from 'node:assert/strict';
import { getCacheFilename, createEpisodeDownloader } from '../src-app/PodcastDownloads.js';

test('cache names are stable, collision-resistant, and never contain URL paths', async () => {
    const url = 'https://example.org/audio.MP3?token=first';
    const name = await getCacheFilename(url);
    assert.match(name, /^[a-f0-9]{64}\.mp3$/);
    assert.equal(await getCacheFilename(url), name);
    assert.notEqual(await getCacheFilename(url.replace('first', 'second')), name);
    assert.match(await getCacheFilename('https://example.org/download'), /^[a-f0-9]{64}\.mp3$/);
    await assert.rejects(getCacheFilename('file:///private/audio.mp3'), /Invalid audio URL/);
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
