import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createWorker } from '../src/index.js';

const env = {
    PODCAST_API_KEY: 'test-key', PODCAST_API_SECRET: 'test-secret',
    PODCAST_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const request = (path, options) => new Request('https://proxy.example' + path, options);
const worker = options => createWorker({ cryptoImpl: webcrypto, logger: { warn() {} }, ...options });

test('signs the fixed upstream request and returns public JSON', async () => {
    let upstream;
    const proxy = worker({ now: () => 1700000000000, fetchImpl: async (url, options) => {
        upstream = { url, options };
        return Response.json({ feeds: [{ id: 42, title: 'Offline Fixture' }] });
    } });
    const response = await proxy.fetch(request('/search/byterm?q=hello'), env);
    assert.equal(response.status, 200);
    assert.equal(upstream.url, 'https://api.podcastindex.org/api/1.0/search/byterm?q=hello&max=20');
    assert.equal(upstream.options.headers.Authorization, createHash('sha1').update('test-keytest-secret1700000000').digest('hex'));
    assert.equal(upstream.options.redirect, 'manual');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    const body = await response.text();
    assert.ok(body.includes('Offline Fixture'));
    assert.ok(!body.includes('test-secret'));
    assert.ok(!body.includes('test-key'));
});

test('validates episode IDs and bounds episode counts', async () => {
    let called;
    const proxy = worker({ fetchImpl: async url => { called = url; return Response.json({ items: [] }); } });
    assert.equal((await proxy.fetch(request('/episodes/byfeedid?id=42&max=10'), env)).status, 200);
    assert.ok(called.endsWith('/episodes/byfeedid?id=42&max=10'));
});

test('rejects invalid, duplicate, and arbitrary proxy parameters before fetching', async () => {
    let calls = 0;
    const proxy = worker({ fetchImpl: async () => { calls++; return Response.json({}); } });
    for (const path of [
        '/search/byterm?q=a', '/search/byterm?q=hello&max=21', '/search/byterm?q=hello&max=-1',
        '/search/byterm?q=hello&q=world', '/search/byterm?q=hello&url=https://evil.example',
        '/episodes/byfeedid?id=0', '/episodes/byfeedid?id=42&max=51', '/episodes/byfeedid?id=../other',
    ]) assert.equal((await proxy.fetch(request(path), env)).status, 400, path);
    assert.equal((await proxy.fetch(request('/add/byfeedurl?url=https://evil.example'), env)).status, 404);
    assert.equal(calls, 0);
});

test('handles preflight and rejects write methods', async () => {
    const proxy = worker();
    assert.equal((await proxy.fetch(request('/search/byterm', { method: 'OPTIONS' }), {})).status, 204);
    assert.equal((await proxy.fetch(request('/search/byterm?q=hello', { method: 'POST' }), env)).status, 405);
});

test('requires secret and rate limit bindings', async () => {
    const proxy = worker();
    for (const missing of Object.keys(env)) {
        const incomplete = { ...env }; delete incomplete[missing];
        assert.equal((await proxy.fetch(request('/search/byterm?q=hello'), incomplete)).status, 503);
    }
});

test('rate-limits before contacting upstream or serving cache', async () => {
    let key;
    const proxy = worker({ fetchImpl: () => { throw new Error('must not fetch'); }, cache: { match() { throw new Error('must not consult cache'); } } });
    const response = await proxy.fetch(request('/search/byterm?q=hello', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), {
        ...env, PODCAST_RATE_LIMITER: { limit: async options => { key = options.key; return { success: false }; } },
    });
    assert.equal(key, '192.0.2.1');
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
});

test('caches canonical validated results without storing credentials', async () => {
    const entries = new Map(); let calls = 0;
    const cache = {
        match: async key => entries.get(key.url)?.clone(),
        put: async (key, value) => entries.set(key.url, value),
    };
    const proxy = worker({ cache, fetchImpl: async () => { calls++; return Response.json({ feeds: [] }); } });
    await proxy.fetch(request('/search/byterm?max=20&q=hello'), env);
    const response = await proxy.fetch(request('/search/byterm?q=hello'), env);
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(entries.size, 1);
    assert.equal([...entries.keys()][0], 'https://proxy.example/search/byterm?q=hello&max=20');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300');
});

test('does not cache upstream errors, redirects, malformed JSON, or network failures', async () => {
    let puts = 0;
    for (const fetchImpl of [
        async () => new Response('failure', { status: 401 }),
        async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
        async () => new Response('not JSON'),
        async () => { throw new Error('private upstream detail'); },
    ]) {
        const proxy = worker({ fetchImpl, cache: { match: async () => null, put: async () => { puts++; } } });
        const response = await proxy.fetch(request('/search/byterm?q=hello'), env);
        assert.equal(response.status, 502);
        assert.ok(!(await response.text()).includes('private upstream detail'));
    }
    assert.equal(puts, 0);
});

test('diagnostics do not reveal credentials, search terms, or exception messages', async () => {
    const logs = [];
    const proxy = worker({
        logger: { warn: (...args) => logs.push(args) },
        fetchImpl: async () => { throw new Error('test-key test-secret private-search-term'); },
    });
    const response = await proxy.fetch(request('/search/byterm?q=private-search-term'), env);
    assert.equal(response.status, 502);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][1].stage, 'upstream-fetch');
    const output = JSON.stringify(logs) + await response.text() + JSON.stringify([...response.headers]);
    for (const privateValue of ['test-key', 'test-secret', 'private-search-term']) assert.ok(!output.includes(privateValue));
});
