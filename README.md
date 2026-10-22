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

## Releases and website updates

Pushing to `release` builds installers into a draft GitHub release. Bump the app
version before a new release; the workflow refuses to replace an already
published version. Both macOS architectures are built explicitly, signed with a
Developer ID Application certificate, and notarized with App Store Connect. The workflow uses these
existing repository secrets:

- `APPLE_CERTIFICATE`: base64-encoded signing certificate and private key (`.p12`).
- `APPLE_CERTIFICATE_PASSWORD`: password for the exported certificate.
- `APPLE_SIGNING_IDENTITY`: full `Developer ID Application: ...` identity.
- `KEYCHAIN_PASSWORD`: password for the temporary build keychain.
- `APPLE_API_ISSUER` and `APPLE_API_KEY`: App Store Connect issuer and key ID.
- `APPLE_API_PRIVATE_KEY`: the complete PEM contents of the `.p8` private key.

The private key is written to a temporary file for Tauri's `APPLE_API_KEY_PATH`.
The workflow checks the signature and stapled notarization ticket, and removes
the temporary certificate, key, and keychain even if the build fails. Apple
credentials are exposed only to macOS steps. Their contents cannot be verified
locally; the signed build and verification steps must pass in GitHub Actions.

After all builds succeed, publish the draft to trigger `Update player website`.
This dispatches `update-player-release.yml` on `master` in
`mp3chapters/mp3chapters.github.io`. The receiver updates the landing page's
download links, version, installer sizes, and date from the published release,
then explicitly requests a GitHub Pages build. Screenshots and descriptive text
remain manually maintained.

Add `WEBSITE_DISPATCH_TOKEN` to this repo's Actions secrets: a fine-grained token
scoped to `mp3chapters/mp3chapters.github.io` with **Actions: write**. The normal
`GITHUB_TOKEN` cannot dispatch workflows in another repo. Both notification and
receiver workflows must be merged into their default branches before use.
The website receiver rejects drafts, prereleases, older release tags, and
missing installers. A failed handoff can be retried from `Update player website`
using its manual `release_tag` input.

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

Podcast audio is cached in the app's `podcast-cache-v2` folder after a complete
download and reused on subsequent plays. New filenames include a shortened show
and episode title plus a 24-character SHA-256 suffix. Existing downloads with
64-character hash names are still reused, including when an episode title changes.
The episode list shows file size and a green checkmark for downloaded audio.
Pre-v2 cache files remain untouched but are not trusted as complete, because the
old downloader could leave partial files behind.

Open Recent retains podcast labels as `Show › Episode`, including after restart.
The startup screen offers the three most recently opened files or episodes;
clearing Open Recent also clears this list.
Old recent-file records still load; older cached episodes gain labels from their
embedded tags when reopened, or from the directory when selected there. Up and
Down move through recent podcasts and search results, and Enter opens the focused
item. Chapter images take priority over embedded cover art, followed by episode
or show artwork from the directory. Directory artwork may need a connection even
when the audio is cached.

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
