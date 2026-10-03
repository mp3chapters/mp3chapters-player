export function safeExternalUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

export async function openExternalUrl(value) {
    const url = safeExternalUrl(value);
    if (!url) return;
    if (window.__TAURI__?.shell) {
        await window.__TAURI__.shell.open(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

export function updateChapterLink(element, value) {
    if (!element) return;
    const url = safeExternalUrl(value);
    if (url) {
        element.href = url;
        element.textContent = url.replace(/^https?:\/\//, '') + ' ↗';
        element.classList.add('visible');
    } else {
        element.removeAttribute('href');
        element.textContent = '';
        element.classList.remove('visible');
    }
}
