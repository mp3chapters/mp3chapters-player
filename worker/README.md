# Podcast directory proxy

This Cloudflare Worker holds the Podcast Index credentials and exposes only
`GET /search/byterm?q=...&max=20` and `GET /episodes/byfeedid?id=...&max=50`.
Audio downloads stay directly between the app and the podcast host.

## Offline preparation

Run `npm test` from the repository root. The Worker tests use Node's built-in test
runner, Web Crypto, and simulated HTTP responses. They never contact Podcast
Index or Cloudflare and need no Wrangler installation.

## Deploy later

Use the Cloudflare dashboard to create the `mp3chapters-podcast-proxy` Worker and
upload the module in `src/index.js`. Add encrypted secret bindings named
`PODCAST_API_KEY` and `PODCAST_API_SECRET`. Use **new credentials**: the previous
pair was committed to this repository and must be rotated with Podcast Index.

Add a rate limiting binding named `PODCAST_RATE_LIMITER`, with namespace ID
`935774`, a limit of 60, and a period of 60 seconds. Do not reuse that namespace
for an unrelated limiter on your account. The Worker returns 503 if any required
binding is missing. `wrangler.jsonc` describes the same deployment for use with
Wrangler when downloading it is convenient; it contains no credentials.

The corresponding CLI steps, **only after installing Wrangler**, are:

```sh
cd worker
wrangler login
wrangler secret put PODCAST_API_KEY
wrangler secret put PODCAST_API_SECRET
wrangler deploy
```

Then build the app with its public URL:

```sh
PODCAST_PROXY_URL=https://mp3chapters-podcast-proxy.YOUR-SUBDOMAIN.workers.dev npm run tauri build
```

For later local Wrangler development, copy `.dev.vars.example` to `.dev.vars`
(ignored by Git) and use `PODCAST_PROXY_URL=http://127.0.0.1:8787` for the app.
No deployment or account access is needed for the offline tests.

## Behavior and limits

Queries and result counts are validated; clients cannot choose the upstream URL,
forward credentials, or access Podcast Index write endpoints. Successful metadata
responses are cached for five minutes. Upstream errors, redirects, and timeouts
are not cached. CORS allows public clients without cookies or shared app tokens.

The per-IP limiter runs before cache lookup. Cloudflare's limiter is approximate
and scoped to a data center; it is not a strict global quota. The proxy remains
public, so this limits ordinary abuse rather than proving that a caller is the
app. Stay on the Workers Free plan for a daily request cap without overage bills.
No database or additional Cloudflare storage is required.
