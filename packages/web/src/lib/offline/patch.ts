import { forEachCachedGet, getCachedGet, setCachedGet, deleteCachedGet } from './cache';

/** Find a previously-cached meal (from a list or detail fetch) by id, used to
 * fill in denormalized fields (name/difficulty/times) for optimistic planner updates. */
async function findCachedMeal(mealId: number): Promise<any | undefined> {
  let found: any;
  await forEachCachedGet('/meals', (data) => {
    if (found) return undefined;
    if (Array.isArray(data)) {
      found = data.find((m: any) => m?.id === mealId);
    } else if (data && data.id === mealId) {
      found = data;
    }
    return undefined;
  });
  return found;
}

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

  await forEachCachedGet('/planner?', async (data) => {
    if (!Array.isArray(data)) return undefined;

    if (method === 'POST') {
      return [
        ...data,
        denormalize({
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
        }),
      ];
    }

    const idx = data.findIndex((p: any) => p.id === target.id);
    if (idx === -1) return undefined;
    const next = data.slice();
    if (method === 'DELETE') next.splice(idx, 1);
    else next[idx] = denormalize({ ...next[idx], ...body, _pendingSync: true });
    return next;
  });
}

/** Generic optimistic patch for simple `/resource/:id` CRUD endpoints
 * (meals, family, users, meals/ingredients): keeps any cached list/detail
 * responses in sync with pending create/update/delete mutations. */
async function patchEntityCollections(basePath: string, method: string, id: number | undefined, body: any, tempId?: number) {
  if (method === 'POST') {
    // Create: prepend an optimistic item (temp negative id) to the unfiltered list cache only.
    const listPath = basePath;
    const existing = await getCachedGet<any[]>(listPath);
    if (Array.isArray(existing)) {
      const optimistic = { id: tempId ?? -Date.now(), ...body, _pendingSync: true };
      await setCachedGet(listPath, [optimistic, ...existing]);
    }
    return;
  }

  if (id === undefined) return;
  const itemPath = `${basePath}/${id}`;

  if (method === 'DELETE') {
    await deleteCachedGet(itemPath);
    await forEachCachedGet(basePath, (data) => {
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
  await forEachCachedGet(basePath, (data) => {
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
export async function applyOptimisticPatch(method: string, path: string, bodyRaw?: string, tempId?: number): Promise<void> {
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

  const entityMatch = path.match(/^\/(meals|family|users|meals\/ingredients)(?:\/(\d+))?$/);
  if (entityMatch) {
    const [, basePath, idStr] = entityMatch;
    await patchEntityCollections(`/${basePath}`, method, idStr ? Number(idStr) : undefined, body, tempId);
  }
}
