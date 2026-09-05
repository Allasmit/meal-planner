// Proactively caches the full HTML document for the current route into the
// same Cache Storage cache ('pages-cache') that vite-plugin-pwa's NetworkFirst
// `runtimeCaching` rule (see vite.config.ts) falls back to when offline.
//
// This is necessary because SvelteKit's client-side router almost never
// issues a real `mode: 'navigate'` fetch when moving between routes (it just
// swaps components using already-loaded JS chunks) - so the service worker's
// own navigation-caching logic would otherwise only ever capture whichever
// single page happened to be the initial full-document load. Every other
// visited route would stay uncached and fail to load on a later offline
// reload. Calling this after every client-side navigation while online keeps
// every visited route's document available for offline reload.
//
// IMPORTANT: keep PAGES_CACHE_NAME in sync with the `pages-cache` cacheName in
// vite.config.ts's `workbox.runtimeCaching`.
const PAGES_CACHE_NAME = 'pages-cache';

/**
 * Fetches an arbitrary route's full HTML document and stores it in
 * `pages-cache`, keyed by `url`. Used both for the current route (see
 * `cacheCurrentPage`) and, from `offline/precache.ts`, for routes the user
 * hasn't actually visited yet - so a hard reload/deep-link into them still
 * works offline instead of only ever-visited routes being available.
 */
export async function cachePageUrl(url: string): Promise<void> {
	if (typeof window === 'undefined' || typeof caches === 'undefined') return;
	if (!navigator.onLine) return;

	try {
		const response = await fetch(url, { credentials: 'same-origin' });
		if (!response.ok) return;
		const cache = await caches.open(PAGES_CACHE_NAME);
		await cache.put(url, response.clone());
	} catch {
		// Offline, or the request failed for some other reason - nothing to
		// cache, safe to ignore.
	}
}

export async function cacheCurrentPage(): Promise<void> {
	return cachePageUrl(location.pathname + location.search);
}

/**
 * Wipes every cached page snapshot in `pages-cache`.
 *
 * MUST be called whenever a new service worker version takes control (see
 * the `controllerchange` listener in +layout.svelte). Each cached document
 * is a full HTML snapshot whose <script>/<link> tags point at that build's
 * hashed `_app/immutable/...` asset filenames. Workbox's own precache
 * (a *different* Cache Storage cache) deletes entries for a build's old
 * hashed assets the moment a new service worker activates - but it has no
 * knowledge of this app-managed `pages-cache`, so a stale snapshot cached
 * before a deploy keeps referencing JS files that no longer exist anywhere
 * (not in cache, not on the network while offline). Reloading such a page
 * offline serves the stale HTML shell fine, but hydration then silently
 * fails part-way through (its JS chunk 404s), leaving the user stuck on
 * whatever the server-rendered initial state was - in this app that's
 * always the auth-check loading spinner, since `loading: true` is the
 * default store state before onMount ever runs. Clearing the cache on every
 * SW update means a stale snapshot is never served across a deploy; at
 * worst an offline reload right after a fresh deploy (before the route has
 * been re-visited online even once) gets a normal "offline" failure instead
 * of a silently broken page.
 */
export async function clearPageCache(): Promise<void> {
	if (typeof caches === 'undefined') return;
	try {
		await caches.delete(PAGES_CACHE_NAME);
	} catch {
		// Cache Storage unavailable - nothing to clear.
	}
}
