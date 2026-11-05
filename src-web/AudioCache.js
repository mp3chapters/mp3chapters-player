const DATABASE = 'mp3-chapter-player-audio-v1';
const METADATA = 'metadata';
const BLOBS = 'audio';

// Metadata stays separate so browsing saved episodes never reads their audio blobs.
export function createAudioCache(options = {}) {
    const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    const maxEntries = options.maxEntries ?? 8;
    const now = options.now ?? Date.now;
    let database;

    function openDatabase() {
        if (database) return database;
        database = new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (!settled) { settled = true; resolve(value); }
                else value?.close();
            };
            try {
                const indexedDB = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : globalThis.indexedDB;
                if (!indexedDB) { finish(null); return; }
                const request = indexedDB.open(DATABASE, 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(METADATA)) db.createObjectStore(METADATA, { keyPath: 'filename' });
                    if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
                };
                request.onerror = request.onblocked = () => finish(null);
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => { db.close(); database = null; };
                    finish(db);
                };
            } catch { finish(null); }
        });
        return database;
    }

    async function read(store, filename, fallback) {
        const db = await openDatabase();
        if (!db) return fallback;
        return new Promise(resolve => {
            try {
                const transaction = db.transaction(store, 'readonly');
                const request = filename === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(filename);
                let result = fallback;
                request.onsuccess = () => { result = request.result ?? fallback; };
                transaction.oncomplete = () => resolve(result);
                transaction.onerror = transaction.onabort = () => resolve(fallback);
            } catch { resolve(fallback); }
        });
    }

    return {
        async list() {
            const entries = await read(METADATA, undefined, []);
            return entries.sort((a, b) => b.savedAt - a.savedAt);
        },
        async get(filename) {
            const value = await read(BLOBS, filename, null);
            return value instanceof Blob ? value : null;
        },
        async save(filename, blob) {
            if (typeof filename !== 'string' || !filename || !(blob instanceof Blob) || blob.size === 0 ||
                blob.size > maxBytes || maxEntries < 1) return false;
            const db = await openDatabase();
            if (!db) return false;
            return new Promise(resolve => {
                let transaction;
                try {
                    transaction = db.transaction([METADATA, BLOBS], 'readwrite');
                    transaction.oncomplete = () => resolve(true);
                    transaction.onabort = () => resolve(false);
                    transaction.onerror = () => {
                        try { transaction.abort(); } catch { /* Already aborted. */ }
                        resolve(false);
                    };
                    const metadata = transaction.objectStore(METADATA);
                    const audio = transaction.objectStore(BLOBS);
                    const request = metadata.getAll();
                    request.onsuccess = () => {
                        try {
                            const all = request.result;
                            const entries = all.filter(entry => entry.filename !== filename).sort((a, b) => a.savedAt - b.savedAt);
                            let bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
                            while (entries.length >= maxEntries || bytes + blob.size > maxBytes) {
                                const oldest = entries.shift();
                                bytes -= oldest.size;
                                metadata.delete(oldest.filename);
                                audio.delete(oldest.filename);
                            }
                            const savedAt = Math.max(now(), ...all.map(entry => entry.savedAt + 1));
                            metadata.put({ filename, size: blob.size, savedAt });
                            audio.put(blob, filename);
                        } catch { transaction.abort(); }
                    };
                } catch {
                    try { transaction?.abort(); } catch { /* Already aborted. */ }
                    resolve(false);
                }
            });
        },
    };
}
