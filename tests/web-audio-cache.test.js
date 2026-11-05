import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioCache } from '../src-web/AudioCache.js';

// A transactional IndexedDB fixture: writes commit together, or all roll back on error.
function indexedDBFixture() {
    const stores = new Map();
    const reads = [];
    let quota = Infinity;
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { stores.set(name, new Map()); },
        close() {},
        transaction(names, mode) {
            names = typeof names === 'string' ? [names] : names;
            const snapshots = new Map(names.map(name => [name, new Map(stores.get(name))]));
            let pending = 0, aborted = false, finished = false;
            const transaction = {
                abort() {
                    if (finished || aborted) return;
                    aborted = true;
                    queueMicrotask(() => transaction.onabort?.());
                },
                objectStore(name) {
                    const data = snapshots.get(name);
                    const request = operation => {
                        const result = {};
                        pending++;
                        queueMicrotask(() => {
                            if (aborted) return;
                            try { result.result = operation(); result.onsuccess?.(); }
                            catch {
                                result.onerror?.();
                                transaction.onerror?.();
                                transaction.abort();
                            } finally { pending--; complete(); }
                        });
                        return result;
                    };
                    return {
                        getAll: () => request(() => { reads.push(`${name}:all`); return [...data.values()]; }),
                        get: key => request(() => { reads.push(`${name}:${key}`); return data.get(key); }),
                        put: (value, key = value.filename) => request(() => {
                            if (name === 'audio' && value.size > quota) throw new DOMException('Full', 'QuotaExceededError');
                            data.set(key, value);
                        }),
                        delete: key => request(() => data.delete(key)),
                    };
                },
            };
            function complete() {
                queueMicrotask(() => {
                    if (pending || aborted || finished) return;
                    finished = true;
                    if (mode === 'readwrite') for (const [name, values] of snapshots) stores.set(name, values);
                    transaction.oncomplete?.();
                });
            }
            complete();
            return transaction;
        },
    };
    return {
        indexedDB: { open() {
            const request = { result: db };
            queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
            return request;
        } },
        reads,
        setQuota(bytes) { quota = bytes; },
    };
}

test('unavailable or blocked IndexedDB is a nonfatal cache miss', async () => {
    for (const indexedDB of [null, { open() { throw new DOMException('Disabled', 'SecurityError'); } }, {
        open() { const request = {}; queueMicrotask(() => request.onblocked?.()); return request; },
    }]) {
        const cache = createAudioCache({ indexedDB });
        assert.deepEqual(await cache.list(), []);
        assert.equal(await cache.get('episode.mp3'), null);
        assert.equal(await cache.save('episode.mp3', new Blob(['audio'])), false);
    }
});

test('listing saved metadata does not read audio blobs, and get returns the complete blob', async () => {
    const fixture = indexedDBFixture();
    const cache = createAudioCache({ indexedDB: fixture.indexedDB, now: () => 100 });
    const blob = new Blob(['complete audio'], { type: 'audio/mpeg' });
    assert.equal(await cache.save('episode.mp3', blob), true);
    fixture.reads.length = 0;
    assert.deepEqual(await cache.list(), [{ filename: 'episode.mp3', size: blob.size, savedAt: 100 }]);
    assert.deepEqual(fixture.reads, ['metadata:all']);
    assert.equal(await cache.get('episode.mp3'), blob);
    assert.equal(await cache.get('missing.mp3'), null);
});

test('entry and byte limits evict the oldest complete episode from both stores', async () => {
    for (const limits of [{ maxEntries: 2, maxBytes: 9 }, { maxEntries: 8, maxBytes: 6 }]) {
        const fixture = indexedDBFixture();
        const cache = createAudioCache({ indexedDB: fixture.indexedDB, now: () => 100, ...limits });
        for (const filename of ['first.mp3', 'second.mp3', 'third.mp3']) assert.equal(await cache.save(filename, new Blob(['123'])), true);
        assert.deepEqual((await cache.list()).map(entry => entry.filename), ['third.mp3', 'second.mp3']);
        assert.equal(await cache.get('first.mp3'), null);
        assert.equal(await (await cache.get('third.mp3')).text(), '123');
        assert.equal(await cache.save('oversized.mp3', new Blob(['1234567890'])), false);
        assert.equal((await cache.list()).length, 2);
    }
});

test('a quota failure rolls back eviction and never leaves a metadata-only saved episode', async () => {
    const fixture = indexedDBFixture();
    const cache = createAudioCache({ indexedDB: fixture.indexedDB, maxBytes: 6, now: () => 100 });
    assert.equal(await cache.save('existing.mp3', new Blob(['123'])), true);
    fixture.setQuota(4);
    assert.equal(await cache.save('too-large-for-browser.mp3', new Blob(['12345'])), false);
    assert.deepEqual((await cache.list()).map(entry => entry.filename), ['existing.mp3']);
    assert.equal(await (await cache.get('existing.mp3')).text(), '123');
    assert.equal(await cache.get('too-large-for-browser.mp3'), null);
});
