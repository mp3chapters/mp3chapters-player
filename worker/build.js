import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

// cf beta.12 accepts Build Output v0. This module has no imports to bundle,
// so prepare that output directly without installing a framework or bundler.
const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
const output = new URL('./.cloudflare/output/v0/', import.meta.url);
const worker = new URL('workers/default/', output);
await mkdir(new URL('bundle/', worker), { recursive: true });
await copyFile(new URL(config.main, import.meta.url), new URL('bundle/index.js', worker));

const env = {
    PODCAST_API_KEY: { type: 'secret' },
    PODCAST_API_SECRET: { type: 'secret' },
};
for (const limiter of config.ratelimits) {
    env[limiter.name] = {
        type: 'rate-limit',
        namespace: limiter.namespace_id,
        simple: limiter.simple,
    };
}
await writeFile(new URL('config.json', output), JSON.stringify({ buildContext: { isPreview: false } }, null, 2));
await writeFile(new URL('worker.config.json', worker), JSON.stringify({
    name: config.name,
    compatibilityDate: config.compatibility_date,
    workersDev: config.workers_dev,
    env,
    manifest: { type: 'complete', mainModule: 'index.js', modules: { 'index.js': { type: 'esm' } } },
}, null, 2));
console.log('Prepared local cf Build Output v0; no credentials or network access used.');
