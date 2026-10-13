import { getCachedGet, setCachedGet } from './offline/cache';
import { enqueueMutation } from './offline/queue';
import { applyOptimisticPatch } from './offline/patch';
import { refreshPendingCount, flushQueue, markSynced, markOffline, isOnline, checkServer } from './offline/sync';
import type {
  AutoGenerateRequest, AutoGenerateResult, CostSummary, CsvImportResult, Cuisine, DietaryType, FamilyMember,
  FamilyMemberInput, ImportedMeal, Ingredient, IngredientCategory, Meal, MealCategory, MealFormData, MealPlan,
  PlannerRule, PlannerSettings, ProteinType, LeftoverBehaviour, ShoppingListCategory, User,
} from './types';
import { auth } from './stores/auth';

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

// Imports do real server-side work (fetching a page, OCR, PDF parsing) and can
// legitimately take far longer than a normal API call. Aborting them early would
// make the UI report "offline" while the server still creates the recipe.
const IMPORT_TIMEOUT_MS = 120_000;

// How long a GET waits for the server before showing the cached copy (when there is one).
const SLOW_RESPONSE_MS = 2_500;

type MealImportBody = {
  sourceUrl?: string;
  cost?: number | null;
  proteinType?: ProteinType | null;
  mealCategory?: MealCategory | null;
  leftoverBehaviour?: LeftoverBehaviour;
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

/** Queues a mutation for later sync and optimistically patches the local read cache so offline UI reflects the
 * pending change. For creates (POST) it returns `{ id: <temporary negative id>, _offlinePending: true }`; the queue
 * swaps that id for the real one in later queued changes once the server has created the record. */
async function queueOfflineMutation<T>(path: string, method: string, body?: string): Promise<T> {
  const tempId = method === 'POST' ? -Date.now() : undefined;
  await enqueueMutation(method, path, body, tempId);
  await applyOptimisticPatch(method, path, body, tempId);
  refreshPendingCount();
  return { id: tempId, _offlinePending: true } as unknown as T;
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

  // Known offline (see isOnline() in offline/sync.ts - it also covers a phone
  // that's on wifi/cellular but can't reach the server): answer from the
  // outbox/cache straight away instead of waiting on a doomed fetch.
  if (typeof navigator !== 'undefined' && !isOnline()) {
    if (isMutation) {
      if (isQueueable) return queueOfflineMutation<T>(path, method, options?.body as string | undefined);
      throw new Error('You are offline. This action requires an internet connection.');
    }
    const cached = await getCachedGet<T>(path);
    if (cached !== undefined) return cached;
    // Nothing cached: check whether the server is back (one health check shared by every
    // request waiting here, or the answer of one that just failed) rather than each request
    // waiting for its own full timeout.
    if (!(await checkServer())) throw new Error('You are offline and this data is not available yet.');
  }

  const network = send<T>(path, method, isQueueable, headers, options);
  if (isMutation) return network;

  // A GET we already have data for: if the server is slow to answer (weak signal, or a
  // connection that hangs instead of failing), show the cached copy instead of leaving the
  // page waiting for the full timeout. The request carries on in the background and
  // refreshes the cache (or marks the app offline) when it finishes.
  const cached = await getCachedGet<T>(path).catch(() => undefined);
  if (cached === undefined) return network;
  network.catch(() => {});
  return Promise.race([
    network,
    new Promise<T>((resolve) => setTimeout(() => resolve(cached), SLOW_RESPONSE_MS)),
  ]);
}

/** Performs the request; on a network failure falls back to the cache (GET) or the outbox (mutations). */
async function send<T>(
  path: string,
  method: string,
  isQueueable: boolean,
  headers: Record<string, string>,
  options?: RequestInit,
): Promise<T> {
  const isMutation = method !== 'GET';
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
      ...options,
      // NOTE: spread after `...options` so a caller-supplied signal (none
      // currently pass one) would win; this is our own safety-net timeout.
      signal: AbortSignal.timeout(path.startsWith('/import') ? IMPORT_TIMEOUT_MS : FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      // The session ended (expired, user removed, password reset): drop to the login screen
      // instead of showing a confusing error on every page. Auth endpoints handle their own 401s.
      if (res.status === 401 && !path.startsWith('/auth')) {
        auth.clear();
        throw new Error('Your session has expired. Please sign in again.');
      }
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
      // An import that outlives even the long import timeout is slow, not offline,
      // and the server may still finish it - don't flip the whole app to offline.
      if (path.startsWith('/import') && err instanceof DOMException) {
        throw new Error('The import is taking longer than expected. Check the Meals list before trying again.');
      }
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

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  setupStatus: () => request<{ setupRequired: boolean }>('/auth/setup-status'),
  setup: (body: { username: string; displayName: string; password: string }) =>
    request<User>('/auth/setup', { method: 'POST', body: json(body) }),
  login: (body: { username: string; password: string }) =>
    request<User>('/auth/login', { method: 'POST', body: json(body) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),

  getUsers: () => request<User[]>('/users'),
  createUser: (body: { username: string; displayName: string; password: string; role: User['role'] }) =>
    request<User>('/users', { method: 'POST', body: json(body) }),
  updateUser: (id: number, body: Partial<Pick<User, 'displayName' | 'role'>>) =>
    request<User>(`/users/${id}`, { method: 'PUT', body: json(body) }),
  deleteUser: (id: number) => request<{ ok: true }>(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id: number, password: string) =>
    request<{ ok: true }>(`/users/${id}/reset-password`, { method: 'POST', body: json({ password }) }),

  getDietaryTypes: () => request<DietaryType[]>('/meals/dietary-types'),
  getCuisines: () => request<Cuisine[]>('/meals/cuisines'),
  getIngredientCategories: () => request<IngredientCategory[]>('/meals/ingredient-categories'),
  setCategoryHiddenFromShopping: (id: number, hiddenFromShopping: boolean) =>
    request<IngredientCategory>(`/meals/ingredient-categories/${id}`, { method: 'PATCH', body: json({ hiddenFromShopping }) }),

  getIngredients: (search?: string) =>
    request<Ingredient[]>(`/meals/ingredients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createIngredient: (body: { name: string; categoryId?: number; defaultUnit?: string }) =>
    request<Ingredient>('/meals/ingredients', { method: 'POST', body: json(body) }),
  updateIngredient: (id: number, body: Partial<Pick<Ingredient, 'name' | 'categoryId' | 'defaultUnit'>>) =>
    request<Ingredient>(`/meals/ingredients/${id}`, { method: 'PATCH', body: json(body) }),

  getMeals: (params?: Record<string, string>) => {
    // No trailing "?" without filters: the offline cache is keyed by the exact path, and the
    // precached full list is stored under "/meals".
    const query = new URLSearchParams(params).toString();
    const qs = query ? `?${query}` : '';
    return request<Meal[]>(`/meals${qs}`);
  },
  getMeal: (id: number) => request<Meal>(`/meals/${id}`),
  createMeal: (body: MealFormData) => request<Meal>('/meals', { method: 'POST', body: json(body) }),
  updateMeal: (id: number, body: MealFormData) => request<Meal>(`/meals/${id}`, { method: 'PUT', body: json(body) }),
  deleteMeal: (id: number) => request<{ ok: true }>(`/meals/${id}`, { method: 'DELETE' }),

  getWeekPlan: (weekStart: string) => request<MealPlan[]>(`/planner?weekStart=${weekStart}`),
  addPlanEntry: (
    date: string,
    slot: string,
    body: ({ mealId: number } | { customName: string }) & { servings?: number; notes?: string | null; leftoverFromId?: number },
  ) => request<MealPlan>(`/planner/${date}/${slot}`, { method: 'POST', body: json(body) }),
  updatePlanEntry: (id: number, body: { planDate?: string; mealSlot?: string; mealId?: number; customName?: string; servings?: number; notes?: string | null; leftoverPortions?: number }) =>
    request<MealPlan>(`/planner/entry/${id}`, { method: 'PUT', body: json(body) }),
  removePlanEntry: (id: number) =>
    request<{ ok: true }>(`/planner/entry/${id}`, { method: 'DELETE' }),
  getLeftovers: () => request<MealPlan[]>('/planner/leftovers'),
  getShoppingList: (weekStart: string, showHidden = false) =>
    request<ShoppingListCategory[]>(`/planner/shopping-list?weekStart=${weekStart}${showHidden ? '&showHidden=true' : ''}`),
  getCostSummary: (weekStart: string) => request<CostSummary>(`/planner/cost-summary?weekStart=${weekStart}`),

  importUrl: (body: UrlImportBody) => request<ImportedMeal>('/import/url', { method: 'POST', body: json(body) }),
  importCsv: (csvText: string) => request<CsvImportResult>('/import/csv', { method: 'POST', body: json({ csvText }) }),
  importParseHtml: (body: HtmlImportBody) => request<ImportedMeal>('/import/parse-html', { method: 'POST', body: json(body) }),
  importParseText: (body: TextImportBody) => request<ImportedMeal>('/import/text', { method: 'POST', body: json(body) }),
  importSocial: (body: SocialImportBody) => request<ImportedMeal>('/import/social', { method: 'POST', body: json(body) }),
  importMedia: (formData: FormData) => request<ImportedMeal>('/import/media', { method: 'POST', body: formData }),

  getFamilyMembers: () => request<FamilyMember[]>('/family'),
  createFamilyMember: (body: FamilyMemberInput) => request<FamilyMember>('/family', { method: 'POST', body: json(body) }),
  updateFamilyMember: (id: number, body: FamilyMemberInput) =>
    request<FamilyMember>(`/family/${id}`, { method: 'PATCH', body: json(body) }),
  deleteFamilyMember: (id: number) => request<{ ok: true }>(`/family/${id}`, { method: 'DELETE' }),

  getPlannerRules: () => request<PlannerRule[]>('/planner/rules'),
  updatePlannerRule: (id: number, body: Partial<Pick<PlannerRule, 'label' | 'value' | 'isEnabled'>>) =>
    request<PlannerRule>(`/planner/rules/${id}`, { method: 'PATCH', body: json(body) }),
  getPlannerSettings: () => request<PlannerSettings>('/planner/settings'),
  updatePlannerSettings: (body: Partial<PlannerSettings>) =>
    request<{ ok: true }>('/planner/settings', { method: 'PATCH', body: json(body) }),
  autoGenerateWeek: (body: AutoGenerateRequest) =>
    request<AutoGenerateResult>('/planner/auto-generate', { method: 'POST', body: json(body) }),
};
