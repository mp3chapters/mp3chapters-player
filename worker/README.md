# Podcast directory proxy

This Cloudflare Worker holds the Podcast Index credentials and exposes only
`GET /search/byterm?q=...&max=20` and `GET /episodes/byfeedid?id=...&max=50`.
Audio downloads stay directly between the app and the podcast host.

The deployed URL is
<https://mp3chapters-podcast-proxy.mp3chapters.workers.dev>. Search and episode
listing were verified on October 3, 2026. The app uses this URL by default, and
the GitHub Actions repository variable `PODCAST_PROXY_URL` points to it.

## Offline preparation

Run `npm test` from the repository root. The Worker tests use Node's built-in test
runner, Web Crypto, and simulated HTTP responses. They never contact Podcast
Index or Cloudflare and need no Wrangler installation.

## Prepare with the installed cf CLI

`cf` v1.0.0-beta.12 is installed locally. It uses Cloudflare Build Output rather
than reading `wrangler.jsonc` directly. Prepare and validate that output without
installing a bundler or contacting the deployment API:

```sh
npm run build-worker
cd worker
cf deploy --prebuilt --dry-run
```

The dependency-free build script copies only the Worker module and declares its
bindings in ignored `.cloudflare/output/v0/`. It never reads credential files.
The output format is currently a beta; rerun the dry run after upgrading `cf`.

## Deploy updates

The `mp3chapters-podcast-proxy` Worker is already deployed, with encrypted secret
bindings named `PODCAST_API_KEY` and `PODCAST_API_SECRET`. The previous credential
pair was committed to this repository; revoke that pair with Podcast Index if
you have not already.

The deployment includes the `PODCAST_RATE_LIMITER` binding, with namespace ID
`935774`, a limit of 60, and a period of 60 seconds. Do not reuse that namespace
for an unrelated limiter on your account. The Worker returns 503 if any required
binding is missing. `wrangler.jsonc` describes the same deployment for use with
Wrangler; it contains no credentials.

With `cf` already authenticated, deploy the prepared output using a local secret
file. The populated `.dev.vars` file is ignored by Git. On a new machine, copy
`.dev.vars.example` to `.dev.vars` and enter the credentials there. Keep values
quoted: an unquoted `#` starts a comment and truncates the secret. From `worker/`,
run:

```sh
cf deploy --prebuilt --secrets-file .dev.vars
```

This is the step that uploads credentials and publishes the Worker. Rebuild with
`npm run build-worker` from the repository root after changing the module or
configuration. The Wrangler configuration remains available as an alternative
if Wrangler is installed later.

The app's default URL already points to this deployment. To build against a
different deployment, override it:

```sh
PODCAST_PROXY_URL=https://mp3chapters-podcast-proxy.YOUR-SUBDOMAIN.workers.dev npm run tauri build
```

For later local Wrangler development, use the same ignored `.dev.vars` file
and `PODCAST_PROXY_URL=http://127.0.0.1:8787` for the app.
No deployment or account access is needed for the offline tests.

Errors log only their stage, exception type, or upstream HTTP status. Credentials,
headers, search terms, exception messages, and upstream bodies are excluded.

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
