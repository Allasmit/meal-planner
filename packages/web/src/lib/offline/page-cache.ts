// Older versions kept a per-URL snapshot of every page's HTML in this Cache Storage cache. Pages
// are now served from the service worker's precached app shell (see vite.config.ts), so the cache
// is only deleted: on startup (to free the space and drop snapshots that point at old builds) and
// on sign-out.
const LEGACY_PAGES_CACHE_NAME = 'pages-cache';

export async function clearPageCache(): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		await caches.delete(LEGACY_PAGES_CACHE_NAME);
	} catch {
		// Cache Storage unavailable - nothing to clear.
	}
}
