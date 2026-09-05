// Proactively caches the WHOLE app - every top-level route's HTML document
// plus every meal's data and detail page - instead of only whatever the user
// happened to visit. Without this, offline support only ever covered pages
// that had already been opened at least once (page-cache.ts) and meals whose
// detail page had actually been viewed (api.ts's per-request IndexedDB
// cache), which doesn't feel like a real offline-capable native app.
//
// This runs once after a successful login/auth check while online (see
// +layout.svelte), and again whenever a new service worker version takes
// control. It's throttled via localStorage so a normal page reload while
// online doesn't re-download every route + every meal every single time.
import { api } from '$lib/api';
import { cachePageUrl } from './page-cache';

const LAST_PRECACHE_KEY = 'menu-plan-last-full-precache-at';
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // don't redo this more than every 6h unless forced

// Routes that render the same shell regardless of which meal/day is being
// viewed - safe to precache unconditionally. Dynamic meal detail routes are
// handled separately in precacheAllMeals() once we know which meal IDs exist.
const STATIC_ROUTES = [
	'/',
	'/planner',
	'/meals',
	'/meals/new',
	'/family',
	'/shopping-list',
	'/settings',
	'/import',
];

let running = false;

function readLastPrecacheAt(): number {
	if (typeof localStorage === 'undefined') return 0;
	const raw = localStorage.getItem(LAST_PRECACHE_KEY);
	return raw ? Number(raw) : 0;
}

function writeLastPrecacheAt(now: number): void {
	try {
		localStorage.setItem(LAST_PRECACHE_KEY, String(now));
	} catch {
		/* localStorage unavailable (private mode, etc.) - non-fatal */
	}
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once, so we
 * don't fire off hundreds of simultaneous requests for a large meal library. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let index = 0;
	async function worker(): Promise<void> {
		while (index < items.length) {
			const item = items[index++];
			await fn(item);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Fetches every meal (unfiltered list) and, for each one, caches its API
 * detail response (via api.getMeal, which stores it in the same IndexedDB
 * `get:` cache api.ts's request() checks when offline) so meal data is
 * available offline even if that specific meal was never opened before.
 *
 * The `/meals/{id}` detail PAGE (HTML/JS shell) is identical for every meal
 * id - there's no per-meal server `load` function, all meal-specific content
 * is fetched client-side via api.getMeal() above. So instead of doing a full
 * SSR page render per meal (which, for a library of dozens/hundreds of
 * meals, seriously bogs down the single-threaded Node SSR renderer and made
 * the whole app feel slow/unresponsive while precaching ran), we render that
 * shell ONCE and clone the same cached Response into `pages-cache` under
 * every individual meal's URL. Cache Storage lookups are exact-URL matches,
 * so each meal id still gets its own real cache entry and hard offline
 * reloads of any meal work, without paying for N-1 redundant SSR renders.
 */
async function precacheAllMeals(): Promise<void> {
	let meals: { id: number }[];
	try {
		meals = (await api.getMeals()) as { id: number }[];
	} catch {
		return; // offline, or not logged in - nothing more we can do right now
	}

	// Low concurrency + a small stagger delay between requests: this whole
	// loop runs in the background while the user may be interactively
	// browsing at the same time, and a burst of many simultaneous requests
	// competing for the same (often modest, single "home server") API/DB
	// process can slow down or even time out a live, user-initiated request
	// (e.g. clicking a meal that hasn't been precached yet) - which looked
	// exactly like "the meal page sometimes doesn't want to open". Favor
	// finishing slower over competing with interactive traffic.
	await mapWithConcurrency(meals, 2, async (meal) => {
		try {
			await api.getMeal(meal.id);
		} catch {
			/* ignore individual meal failures, keep going with the rest */
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	});

	if (meals.length === 0 || typeof caches === 'undefined') return;
	try {
		const shellResponse = await fetch(`/meals/${meals[0].id}`, { credentials: 'same-origin' });
		if (!shellResponse.ok) return;
		const cache = await caches.open('pages-cache');
		await Promise.all(meals.map((meal) => cache.put(`/meals/${meal.id}`, shellResponse.clone())));
	} catch {
		// Offline or request failed - nothing more we can do right now.
	}
}

/**
 * Precaches every static route's HTML document plus every meal's data and
 * detail page. Safe to call often - it's a no-op while offline, while
 * already running, and (unless `force`) if it already ran within the last
 * `MIN_INTERVAL_MS`.
 */
export async function runFullPrecache(options?: { force?: boolean }): Promise<void> {
	if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.onLine) return;
	if (running) return;

	if (!options?.force) {
		const last = readLastPrecacheAt();
		if (last && Date.now() - last < MIN_INTERVAL_MS) return;
	}

	running = true;
	try {
		await Promise.all(STATIC_ROUTES.map((route) => cachePageUrl(route)));
		// Give the page a moment to settle (finish its own initial data fetches)
		// before starting the much heavier per-meal loop below, so precache
		// doesn't compete with the page's own just-in-time requests right at
		// login/startup.
		await new Promise((resolve) => setTimeout(resolve, 2000));
		await precacheAllMeals();
		writeLastPrecacheAt(Date.now());
	} finally {
		running = false;
	}
}
