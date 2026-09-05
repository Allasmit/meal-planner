import { getCachedGet, setCachedGet } from './offline/cache';
import { enqueueMutation } from './offline/queue';
import { applyOptimisticPatch } from './offline/patch';
import { refreshPendingCount, flushQueue, markSynced, markOffline, isOnline } from './offline/sync';

const BASE = '/api';

// Bounds how long any single request is allowed to hang before we treat it as
// a network failure and fall back to cache (or fail fast for mutations).
// WITHOUT this, a fetch() has no timeout of its own: on a real device that's
// "offline" in the sense of being connected to wifi/cellular with no actual
// route to the server (rather than Playwright/DevTools' instant
// ERR_INTERNET_DISCONNECTED simulation), the underlying TCP connection just
// hangs until the OS's own connect timeout - which can be 30-100+ seconds.
// Every request on the page (the auth check, page data, etc.) would each
// hang that long with nothing falling back to cache, which looks exactly
// like "the page never loads past the spinner".
const FETCH_TIMEOUT_MS = 6_000;

type MealImportBody = {
  sourceUrl?: string;
  cost?: number | null;
  proteinType?: 'chicken' | 'red_meat' | 'pork' | 'fish' | 'lamb' | 'other' | null;
  mealCategory?: 'dinner' | 'breakfast' | 'lunch' | 'baking' | 'treat' | 'snack' | null;
  leftoverBehaviour?: 'consumed_same' | 'fridge_next_day' | 'freezable';
  isFavourite?: boolean;
  isSpecialOccasion?: boolean;
};

type UrlImportBody = MealImportBody & {
  url: string;
};

type HtmlImportBody = MealImportBody & {
  html: string;
};

type TextImportBody = MealImportBody & {
  text: string;
};

type SocialImportBody = MealImportBody & {
  url?: string;
  caption?: string;
  comments?: string;
};

/** Queues a mutation for later sync and optimistically patches the local
 * read cache so offline UI reflects the pending change. Returns a stand-in
 * value; callers only ever `await` mutations without using the result. */
async function queueOfflineMutation<T>(path: string, method: string, body?: string): Promise<T> {
  await enqueueMutation(method, path, body);
  await applyOptimisticPatch(method, path, body);
  refreshPendingCount();
  return { _offlinePending: true } as unknown as T;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET';
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {};

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Auth and recipe-import endpoints require a live round trip (you can't log
  // in, or scrape/OCR a recipe, offline) and their responses are used
  // directly by the caller, so they're never queued - only cacheable GETs
  // and simple resource mutations (meals/planner/family/users) are deferred.
  const isQueueable = isMutation && !isFormData && !path.startsWith('/auth') && !path.startsWith('/import');

  // Known offline: skip straight to queueing/cache instead of waiting on a
  // doomed fetch. Checks BOTH `navigator.onLine` (the browser has no network
  // interface at all) AND `isOnline()` (our own tracked reachability state,
  // updated whenever a real request has failed) - `navigator.onLine` alone
  // stays `true` on a device that's associated with wifi/cellular but can't
  // actually reach the server, which otherwise meant every request paid the
  // full FETCH_TIMEOUT_MS before falling back to cache, making the app feel
  // slow instead of behaving like it knows it's offline.
  if (typeof navigator !== 'undefined' && (!navigator.onLine || !isOnline())) {
    if (isMutation) {
      if (isQueueable) return queueOfflineMutation<T>(path, method, options?.body as string | undefined);
      throw new Error('You are offline. This action requires an internet connection.');
    }
    const cached = await getCachedGet<T>(path);
    if (cached !== undefined) return cached;
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
      ...options,
      // NOTE: spread after `...options` so a caller-supplied signal (none
      // currently pass one) would win; this is our own safety-net timeout.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const errVal = body?.error;
      const message =
        typeof errVal === 'string'
          ? errVal
          : typeof errVal === 'object' && errVal !== null
            ? Object.entries(errVal.fieldErrors ?? {})
                .map(([f, msgs]) => `${f}: ${(msgs as string[]).join(', ')}`)
                .join('; ') || JSON.stringify(errVal)
            : `Request failed: ${res.status}`;
      throw new Error(message);
    }

    const data = (await res.json()) as T;
    markSynced();
    if (!isMutation) {
      setCachedGet(path, data).catch(() => {});
    } else {
      // A mutation just succeeded online; opportunistically flush anything queued.
      flushQueue();
    }
    return data;
  } catch (err) {
    // A real network failure surfaces as a TypeError from fetch(); our own
    // FETCH_TIMEOUT_MS safety net surfaces as an AbortError/TimeoutError
    // DOMException (from AbortSignal.timeout) when the request hangs instead
    // of failing outright. Both mean "couldn't reach the server" and should
    // be treated the same as being offline.
    const isNetworkFailure =
      err instanceof TypeError ||
      (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError'));
    if (isNetworkFailure) {
      markOffline();
      if (isMutation) {
        if (isQueueable) return queueOfflineMutation<T>(path, method, options?.body as string | undefined);
        throw new Error('You are offline. This action requires an internet connection.');
      }
      const cached = await getCachedGet<T>(path);
      if (cached !== undefined) return cached;
      throw new Error('You are offline and this data is not available yet.');
    }
    throw err;
  }
}

export const api = {
  setupStatus: () => request<{ setupRequired: boolean }>('/auth/setup-status'),
  setup: (body: { username: string; displayName: string; password: string }) =>
    request('/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  getUsers: () => request('/users'),
  createUser: (body: object) =>
    request('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: number, body: object) =>
    request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteUser: (id: number) => request(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id: number, password: string) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),

  getDietaryTypes: () => request('/meals/dietary-types'),
  getCuisines: () => request('/meals/cuisines'),
  getIngredientCategories: () => request('/meals/ingredient-categories'),

  getIngredients: (search?: string) =>
    request(`/meals/ingredients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createIngredient: (body: object) =>
    request('/meals/ingredients', { method: 'POST', body: JSON.stringify(body) }),
  updateIngredient: (id: number, body: object) =>
    request(`/meals/ingredients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getMeals: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/meals${qs}`);
  },
  getMeal: (id: number) => request(`/meals/${id}`),
  createMeal: (body: object) =>
    request('/meals', { method: 'POST', body: JSON.stringify(body) }),
  updateMeal: (id: number, body: object) =>
    request(`/meals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMeal: (id: number) => request(`/meals/${id}`, { method: 'DELETE' }),

  getWeekPlan: (weekStart: string) => request(`/planner?weekStart=${weekStart}`),
  setPlanSlot: (date: string, slot: string, body: object) =>
    request(`/planner/${date}/${slot}`, { method: 'PUT', body: JSON.stringify(body) }),
  clearPlanSlot: (date: string, slot: string) =>
    request(`/planner/${date}/${slot}`, { method: 'DELETE' }),
  getShoppingList: (weekStart: string, showHidden = false) =>
    request(`/planner/shopping-list?weekStart=${weekStart}${showHidden ? '&showHidden=true' : ''}`),

  importUrl: (body: UrlImportBody) =>
    request('/import/url', { method: 'POST', body: JSON.stringify(body) }),
  importCsv: (csvText: string) =>
    request('/import/csv', { method: 'POST', body: JSON.stringify({ csvText }) }),
  importParseHtml: (body: HtmlImportBody) =>
    request('/import/parse-html', { method: 'POST', body: JSON.stringify(body) }),
  importParseText: (body: TextImportBody) =>
    request('/import/text', { method: 'POST', body: JSON.stringify(body) }),
  importSocial: (body: SocialImportBody) =>
    request('/import/social', { method: 'POST', body: JSON.stringify(body) }),
  importMedia: (formData: FormData) =>
    request('/import/media', { method: 'POST', body: formData }),

  getFamilyMembers: () => request('/family'),
  createFamilyMember: (body: object) =>
    request('/family', { method: 'POST', body: JSON.stringify(body) }),
  updateFamilyMember: (id: number, body: object) =>
    request(`/family/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFamilyMember: (id: number) => request(`/family/${id}`, { method: 'DELETE' }),

  getPlannerRules: () => request('/planner/rules'),
  updatePlannerRule: (id: number, body: object) =>
    request(`/planner/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getPlannerSettings: () => request('/planner/settings'),
  updatePlannerSettings: (body: object) =>
    request('/planner/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  autoGenerateWeek: (body: object) =>
    request('/planner/auto-generate', { method: 'POST', body: JSON.stringify(body) }),
};