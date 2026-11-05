export function audioType(blob, name) {
    const type = blob.type?.split(';')[0].trim().toLowerCase();
    const aliases = {
        'audio/mp3': 'audio/mpeg', 'audio/x-mpeg': 'audio/mpeg',
        'audio/x-m4a': 'audio/mp4', 'audio/x-wav': 'audio/wav', 'audio/x-flac': 'audio/flac',
    };
    if (aliases[type]) return aliases[type];
    if (type?.startsWith('audio/')) return type;
    return ({ ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac' })[name.split('.').pop().toLowerCase()] || 'audio/mpeg';
}

export async function localCacheKey(file) {
    const identity = JSON.stringify([file.name, file.size, file.lastModified]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return 'local-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
