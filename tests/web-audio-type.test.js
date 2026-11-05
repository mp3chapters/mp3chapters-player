import test from 'node:test';
import assert from 'node:assert/strict';
import { audioType, localCacheKey } from '../src-web/AudioType.js';

test('normalizes podcast host MIME parameters and aliases for the media provider', () => {
    assert.equal(audioType({ type: 'audio/mpeg; charset=UTF-8' }, 'episode.mp3'), 'audio/mpeg');
    assert.equal(audioType({ type: 'audio/mp3' }, 'episode.mp3'), 'audio/mpeg');
    assert.equal(audioType({ type: 'audio/x-m4a' }, 'episode.m4a'), 'audio/mp4');
    assert.equal(audioType({ type: 'audio/x-wav' }, 'episode.wav'), 'audio/wav');
});

test('uses the file extension when audio is served as generic binary data', () => {
    assert.equal(audioType({ type: 'application/octet-stream' }, 'episode.M4A'), 'audio/mp4');
    assert.equal(audioType({ type: '' }, 'episode.ogg'), 'audio/ogg');
    assert.equal(audioType({ type: '' }, 'episode.mp3'), 'audio/mpeg');
});

test('reopening the same local file reuses a cache identity, while changed files stay distinct', async () => {
    const file = { name: 'episode.mp3', size: 1200, lastModified: 100 };
    assert.equal(await localCacheKey(file), await localCacheKey({ ...file }));
    assert.notEqual(await localCacheKey(file), await localCacheKey({ ...file, size: 1201 }));
    assert.notEqual(await localCacheKey(file), await localCacheKey({ ...file, lastModified: 101 }));
    assert.notEqual(await localCacheKey(file), await localCacheKey({ ...file, name: 'other.mp3' }));
});
