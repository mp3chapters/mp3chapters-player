import test from 'node:test';
import assert from 'node:assert/strict';
import { createPodcastApi } from '../src-app/PodcastApi.js';

test('builds public proxy requests with no embedded auth', async () => {
    const api = createPodcastApi('https://proxy.example/', async (url, options) => {
        assert.equal(url.href, 'https://proxy.example/search/byterm?q=two+words&max=20');
        assert.equal(options.headers, undefined);
        return Response.json({ feeds: [] });
    });
    assert.deepEqual(await api('/search/byterm', { q: 'two words', max: 20 }), { feeds: [] });
});

test('reports a missing deployment and proxy errors to the user', async () => {
    await assert.rejects(createPodcastApi('')('/search/byterm'), /not available in this build/);
    const api = createPodcastApi('https://proxy.example', async () => Response.json({ error: 'Too many requests.' }, { status: 429 }));
    await assert.rejects(api('/search/byterm', { q: 'hello' }), /Too many requests/);
});
