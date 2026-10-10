import { forEachCachedGet, findCachedGets, getCachedGet, setCachedGet, deleteCachedGet, isListPath } from './cache';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Find a previously-cached meal (from a detail or list fetch) by id, used to
 * fill in denormalized fields (name/difficulty/times) for optimistic planner updates. */
async function findCachedMeal(mealId: number): Promise<any | undefined> {
  const detail = await getCachedGet<any>(`/meals/${mealId}`);
  if (detail) return detail;
  for (const [, data] of await findCachedGets(isListPath('/meals'))) {
    const found = Array.isArray(data) ? data.find((m: any) => m?.id === mealId) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** Whether `date` (YYYY-MM-DD) falls in the week cached under `path` (`/planner?weekStart=YYYY-MM-DD`). */
function weekContains(path: string, date: string | undefined): boolean {
  const weekStart = new URLSearchParams(path.split('?')[1]).get('weekStart');
  if (!weekStart || !date) return false;
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  const day = Date.parse(`${date}T00:00:00Z`);
  return day >= start && day < start + 7 * DAY_MS;
}

const isWeekPlanPath = (path: string) => path.startsWith('/planner?');

/** Optimistic update of the cached week plans for the three planner mutations:
 * POST /planner/:date/:slot (add a dish), PUT /planner/entry/:id (move/edit) and DELETE /planner/entry/:id. */
async function patchPlannerEntries(method: string, target: { date?: string; slot?: string; id?: number }, body: any, tempId?: number) {
  const meal = body?.mealId ? await findCachedMeal(body.mealId) : undefined;
  const denormalize = (base: any) => ({
    ...base,
    ...(meal && {
      mealName: meal.name,
      mealPrepTime: meal.prepTimeMinutes ?? null,
      mealCookTime: meal.cookTimeMinutes ?? null,
      mealDifficulty: meal.difficulty ?? null,
    }),
  });

  if (method === 'POST') {
    const entry = denormalize({
      id: tempId ?? -Date.now(),
      planDate: target.date,
      mealSlot: target.slot,
      mealId: body?.mealId ?? null,
      servings: body?.servings ?? meal?.servings ?? 1,
      notes: body?.notes ?? null,
      customName: body?.customName ?? null,
      assignedByUserId: null,
      mealName: null,
      mealPrepTime: null,
      mealCookTime: null,
      mealDifficulty: null,
      assignedByDisplayName: null,
      _pendingSync: true,
    });
    // Only the week the new dish belongs to.
    await forEachCachedGet(isWeekPlanPath, (data, path) =>
      Array.isArray(data) && weekContains(path, target.date) ? [...data, entry] : undefined
    );
    return;
  }

  const weeks = await findCachedGets(isWeekPlanPath);
  const existing = weeks
    .flatMap(([, data]) => (Array.isArray(data) ? data : []))
    .find((p: any) => p?.id === target.id);
  if (!existing) return;
  // A move (PUT with a new planDate) can take the entry into a different cached week.
  const updated = method === 'DELETE' ? undefined : denormalize({ ...existing, ...body, _pendingSync: true });

  await forEachCachedGet(isWeekPlanPath, (data, path) => {
    if (!Array.isArray(data)) return undefined;
    const idx = data.findIndex((p: any) => p?.id === target.id);
    const belongsHere = updated !== undefined && weekContains(path, updated.planDate);
    if (idx === -1 && !belongsHere) return undefined;
    const next = data.slice();
    if (idx !== -1) next.splice(idx, 1, ...(belongsHere ? [updated] : []));
    else next.push(updated);
    return next;
  });
}

/** Generic optimistic patch for simple `/resource/:id` CRUD endpoints
 * (meals, family, users, meals/ingredients): keeps any cached list/detail
 * responses in sync with pending create/update/delete mutations. */
async function patchEntityCollections(basePath: string, method: string, id: number | undefined, body: any, tempId?: number) {
  const isList = isListPath(basePath);

  if (method === 'POST') {
    // Create: prepend an optimistic item (temp negative id) to the unfiltered list cache only.
    const existing = await getCachedGet<any[]>(basePath);
    if (Array.isArray(existing)) {
      const optimistic = { id: tempId ?? -Date.now(), ...body, _pendingSync: true };
      await setCachedGet(basePath, [optimistic, ...existing]);
    }
    return;
  }

  if (id === undefined) return;
  const itemPath = `${basePath}/${id}`;

  if (method === 'DELETE') {
    await deleteCachedGet(itemPath);
    await forEachCachedGet(isList, (data) => {
      if (!Array.isArray(data)) return undefined;
      const idx = data.findIndex((x: any) => x?.id === id);
      if (idx === -1) return undefined;
      const next = data.slice();
      next.splice(idx, 1);
      return next;
    });
    return;
  }

  // PUT / PATCH: merge the submitted fields into any cached copies.
  const detail = await getCachedGet<any>(itemPath);
  if (detail) {
    await setCachedGet(itemPath, { ...detail, ...body, _pendingSync: true });
  }
  await forEachCachedGet(isList, (data) => {
    if (!Array.isArray(data)) return undefined;
    const idx = data.findIndex((x: any) => x?.id === id);
    if (idx === -1) return undefined;
    const next = data.slice();
    next[idx] = { ...next[idx], ...body, _pendingSync: true };
    return next;
  });
}

/**
 * Best-effort optimistic update of the local read cache so that, while
 * offline, subsequent GETs reflect mutations that are queued for sync.
 * This intentionally only understands a handful of endpoint shapes; anything
 * else is simply queued without a local cache update.
 */
export function applyOptimisticPatch(method: string, path: string, bodyRaw?: string, tempId?: number): Promise<void> {
  // Each patch reads a cached list, changes it and writes it back, so patches made at the same time
  // (e.g. "Clear week" removing a dozen dishes at once) must run one after another - otherwise they
  // overwrite each other's result and only some of the changes show.
  const run = patchQueue.then(() => patchNow(method, path, bodyRaw, tempId));
  patchQueue = run.catch(() => {});
  return run;
}

let patchQueue: Promise<void> = Promise.resolve();

async function patchNow(method: string, path: string, bodyRaw?: string, tempId?: number): Promise<void> {
  const body = bodyRaw ? JSON.parse(bodyRaw) : undefined;

  const plannerAdd = path.match(/^\/planner\/(\d{4}-\d{2}-\d{2})\/(\w+)$/);
  if (plannerAdd && method === 'POST') {
    await patchPlannerEntries(method, { date: plannerAdd[1], slot: plannerAdd[2] }, body, tempId);
    return;
  }
  const plannerEntry = path.match(/^\/planner\/entry\/(-?\d+)$/);
  if (plannerEntry) {
    await patchPlannerEntries(method, { id: Number(plannerEntry[1]) }, body);
    return;
  }

  // Ids can be negative: records created offline keep a temporary id until they sync.
  const entityMatch = path.match(/^\/(meals\/ingredients|meals|family|users)(?:\/(-?\d+))?$/);
  if (entityMatch) {
    const [, basePath, idStr] = entityMatch;
    await patchEntityCollections(`/${basePath}`, method, idStr ? Number(idStr) : undefined, body, tempId);
  }
}
