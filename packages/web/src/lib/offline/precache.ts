// Proactively caches every meal's data and photo plus the lookup lists and current weeks' plans,
// instead of only what the user happened to open, so the whole app is available offline. Pages themselves need no precaching: the
// service worker serves the precached app shell for every route (see vite.config.ts).
//
// This runs after a successful login/auth check while online (see +layout.svelte) and when the
// browser comes back online. It's throttled via localStorage so a normal page reload doesn't
// re-download every meal every time.
import { api } from '$lib/api';
import { getWeekStart, toDateString } from '$lib/utils';
import { isOnline } from './sync';
import type { Meal } from '$lib/types';

// "v2": the precache now covers more than meals, so devices that ran the old one recently redo it.
const LAST_PRECACHE_KEY = 'menu-plan-last-full-precache-v2-at';
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // don't redo this more than every 6h unless forced
const IMAGE_TIMEOUT_MS = 15_000;

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
 * Caches the lookup lists pages need besides meals (the meal form, for instance, can't open
 * without ingredients, categories and cuisines), plus this week's and next week's plan and
 * shopping list, so those pages work offline even if they were never opened online.
 */
async function precacheReferenceData(): Promise<void> {
	const thisWeek = getWeekStart();
	const nextWeek = new Date(thisWeek);
	nextWeek.setDate(nextWeek.getDate() + 7);
	const weeks = [thisWeek, nextWeek].map(toDateString);

	await Promise.allSettled([
		api.getDietaryTypes(),
		api.getCuisines(),
		api.getIngredients(),
		api.getIngredientCategories(),
		api.getFamilyMembers(),
		api.getPlannerRules(),
		api.getPlannerSettings(),
		api.getLeftovers(),
		...weeks.flatMap((week) => [api.getWeekPlan(week), api.getShoppingList(week), api.getCostSummary(week)]),
	]);
}

/**
 * Fetches every meal (unfiltered list) and, for each one, caches its API
 * detail response (via api.getMeal, which stores it in the same IndexedDB
 * `get:` cache api.ts's request() checks when offline) so meal data is
 * available offline even if that specific meal was never opened before.
 */
async function precacheAllMeals(): Promise<void> {
	let meals: Meal[];
	try {
		meals = await api.getMeals();
	} catch {
		return; // offline, or not logged in - nothing more we can do right now
	}

	// Low concurrency + a small stagger delay between requests: this loop runs in the background
	// while the user may be browsing, and a burst of requests competing for a modest home server
	// can slow down the requests the user is actually waiting for.
	await mapWithConcurrency(meals, 2, async (meal) => {
		// Stop early if the server became unreachable part-way through, rather than letting every
		// remaining meal fall back to the cache one by one.
		if (!isOnline()) return;
		try {
			await api.getMeal(meal.id);
			// Photos are served from /api/images/...; fetching them once lets the service worker cache them for offline use.
			if (meal.imageUrl?.startsWith('/api/images/')) {
				await fetch(meal.imageUrl, { credentials: 'same-origin', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
			}
		} catch {
			/* ignore individual meal failures, keep going with the rest */
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	});
}

/**
 * Precaches every meal's data and photo. Safe to call often - it's a no-op
 * while offline, while already running, and (unless `force`) if it already
 * ran within the last `MIN_INTERVAL_MS`.
 */
export async function runFullPrecache(options?: { force?: boolean }): Promise<void> {
	if (typeof window === 'undefined' || !isOnline()) return;
	if (running) return;

	if (!options?.force) {
		const last = readLastPrecacheAt();
		if (last && Date.now() - last < MIN_INTERVAL_MS) return;
	}

	running = true;
	try {
		// Give the page a moment to finish its own initial data fetches first, so the
		// precache doesn't compete with them right at login/startup.
		await new Promise((resolve) => setTimeout(resolve, 2000));
		await precacheReferenceData();
		await precacheAllMeals();
		if (isOnline()) writeLastPrecacheAt(Date.now());
	} finally {
		running = false;
	}
}
