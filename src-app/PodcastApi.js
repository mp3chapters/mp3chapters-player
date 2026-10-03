export function createPodcastApi(baseUrl, fetchImpl = fetch) {
    return async (endpoint, params = {}) => {
        if (!baseUrl) throw new Error('Podcast search is not available in this build.');
        const url = new URL(baseUrl.replace(/\/$/, '') + endpoint);
        url.search = new URLSearchParams(params).toString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetchImpl(url, { signal: controller.signal });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Podcast search failed.');
            return result;
        } finally {
            clearTimeout(timeout);
        }
    };
}
