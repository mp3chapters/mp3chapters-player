const API_ROOT = 'https://api.podcastindex.org/api/1.0';
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
};

function json(value, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
    });
}

function validatedQuery(url) {
    let allowed, defaultMax, ceiling;
    const query = new URLSearchParams();
    if (url.pathname === '/search/byterm') {
        allowed = ['q', 'max'];
        defaultMax = ceiling = 20;
        const term = (url.searchParams.get('q') || '').trim();
        if (term.length < 2 || term.length > 200) throw new Error('Search must contain 2–200 characters.');
        query.set('q', term);
    } else if (url.pathname === '/episodes/byfeedid') {
        allowed = ['id', 'max'];
        defaultMax = ceiling = 50;
        const id = url.searchParams.get('id');
        if (!/^[1-9]\d{0,14}$/.test(id || '')) throw new Error('Invalid podcast ID.');
        query.set('id', id);
    } else {
        return null;
    }
    for (const key of url.searchParams.keys()) {
        if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
            throw new Error('Unsupported or duplicate query parameter.');
        }
    }
    const max = url.searchParams.get('max') ?? String(defaultMax);
    if (!/^\d+$/.test(max) || Number(max) < 1 || Number(max) > ceiling) throw new Error('Invalid result limit.');
    query.set('max', String(Number(max)));
    return query;
}

export function createWorker({ fetchImpl = fetch, cryptoImpl = crypto, now = Date.now, cache = globalThis.caches?.default, logger = console } = {}) {
    return {
        async fetch(request, env, context) {
            const url = new URL(request.url);
            if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
            if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, OPTIONS' });
            let query;
            try { query = validatedQuery(url); }
            catch (error) { return json({ error: error.message }, 400); }
            if (!query) return json({ error: 'Not found.' }, 404);
            if (!env.PODCAST_API_KEY || !env.PODCAST_API_SECRET || !env.PODCAST_RATE_LIMITER) {
                return json({ error: 'Podcast search is not configured.' }, 503);
            }

            let stage = 'rate-limit';
            try {
                const { success } = await env.PODCAST_RATE_LIMITER.limit({
                    key: request.headers.get('CF-Connecting-IP') || 'unknown',
                });
                if (!success) return json({ error: 'Too many requests. Please try again shortly.' }, 429, { 'Retry-After': '60' });

                // Canonical public cache keys contain only the validated query, never auth headers.
                url.search = query.toString();
                const cacheKey = new Request(url, { method: 'GET' });
                stage = 'cache-read';
                const cached = await cache?.match(cacheKey);
                if (cached) return cached;

                stage = 'sign';
                const timestamp = Math.floor(now() / 1000).toString();
                const bytes = new TextEncoder().encode(env.PODCAST_API_KEY + env.PODCAST_API_SECRET + timestamp);
                const digest = await cryptoImpl.subtle.digest('SHA-1', bytes);
                const authorization = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                stage = 'upstream-fetch';
                const upstream = await fetchImpl(`${API_ROOT}${url.pathname}?${query}`, {
                    headers: {
                        'X-Auth-Key': env.PODCAST_API_KEY,
                        'X-Auth-Date': timestamp,
                        Authorization: authorization,
                        'User-Agent': 'MP3ChapterPlayer/0.4.0',
                    },
                    // Return redirects as responses and reject them below; never forward auth.
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000),
                });
                if (!upstream.ok) {
                    logger.warn('Podcast directory upstream HTTP error', { status: upstream.status });
                    return json({ error: 'Podcast directory is temporarily unavailable.' }, 502);
                }
                stage = 'upstream-json';
                const response = json(await upstream.json(), 200, { 'Cache-Control': 'public, max-age=300' });
                if (cache) {
                    const put = cache.put(cacheKey, response.clone()).catch(() => {});
                    if (context?.waitUntil) context.waitUntil(put); else await put;
                }
                return response;
            } catch (error) {
                // Keep credentials, request headers, search terms, and upstream bodies out of logs.
                logger.warn('Podcast directory request failed', { stage, errorType: ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error' });
                return json({ error: 'Podcast directory is temporarily unavailable.' }, 502);
            }
        },
    };
}

export default createWorker();
