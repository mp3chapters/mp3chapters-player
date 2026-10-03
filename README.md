# MP3 Chapters Player

A simple desktop application to play MP3 files with chapters.

The app uses Tauri v2, with desktop menus, file associations, recent files, and a
Podcast Index browser. The web version shares its chapter parser and player.

## Development

Use Node.js 20 or later and a Rust toolchain with the
[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
Initial dependency installation (`npm ci` and Cargo's first build) downloads
packages; skip these commands on a metered connection unless the downloads are
acceptable.

Once dependencies are installed:

```sh
npm test
npm run build-app
npm run build-web
npm run tauri dev
```

`npm run tauri build` builds the frontend automatically before packaging. Only
`dist-app/` is embedded in the native app; source files and local credentials are
excluded. The desktop build uses production JavaScript and a content security
policy. `npm run web` starts the standalone web version.

The current Vidstack version evaluates its layout queries, so `script-src`
permits `unsafe-eval` for those expressions. Script files are restricted to app
assets, and Tauri generates hashes for the app's inline scripts.

## Podcast search

The app uses the deployed [Cloudflare proxy](https://mp3chapters-podcast-proxy.mp3chapters.workers.dev)
by default. Its search and episode endpoints were verified on October 3, 2026.
Deployment instructions are in [worker/README.md](worker/README.md). To use a
different deployment or a local Worker, override its public URL:

```sh
PODCAST_PROXY_URL=https://YOUR-WORKER.workers.dev npm run tauri dev
```

The same environment variable is used for release builds. The GitHub repository
variable `PODCAST_PROXY_URL` is set to the deployed URL for CI. Setting the
environment variable to an empty string disables podcast search while keeping
local audio playback available. API credentials stay in the Worker's encrypted
secret bindings; never include them in app builds.

The old credential file is ignored and no longer tracked or packaged. Its
previous values remain in Git history; revoke them with Podcast Index if you
have not already. The deployed Worker uses the replacement credentials.
No history rewrite is needed for local development, and no automatic rewrite is
performed.

Podcast downloads are published to the cache only after a complete download.
The new `podcast-cache-v2` uses SHA-256 filenames. Old cache files are left
untouched but are not trusted as complete, because the previous downloader could
leave partial files behind. Episodes may need downloading again when selected.

## Offline checks

```sh
npm test
npm run build-app
npm run build-web
npm run build-worker
cargo check --offline --locked --manifest-path src-tauri/Cargo.toml
```

Cargo's offline mode fails if a locked dependency is absent from the local cache;
it does not fetch it. The core download and startup-queue tests can be checked
without Cargo dependencies:

```sh
rustc --edition=2021 --test src-tauri/src/atomic_download.rs -o /tmp/mp3chapters-download-tests
/tmp/mp3chapters-download-tests
rustc --edition=2021 --test src-tauri/src/open_files.rs -o /tmp/mp3chapters-open-tests
/tmp/mp3chapters-open-tests
```

PR builds run the JavaScript tests, web build, Rust checks, and desktop packaging
on macOS, Linux, and Windows. The mobile entry point registers downloading and
startup commands without the desktop CLI plugin. iOS and Android packaging still
require their platform toolchains and generated platform projects.

## Open from the command line

The player can also be started from the command line, by passing a path to the desired MP3 file.

```sh
"MP3 Chapter Player.exe" "c:\path\to\file.mp3"
```
