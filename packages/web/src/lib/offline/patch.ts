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

async function patchPlannerSlot(method: string, planDate: string, mealSlot: string, body: any) {
  await forEachCachedGet('/planner?', async (data) => {
    if (!Array.isArray(data)) return undefined;
    const idx = data.findIndex((p: any) => p.planDate === planDate && p.mealSlot === mealSlot);

    if (method === 'DELETE') {
      if (idx === -1) return undefined;
      const next = data.slice();
      next.splice(idx, 1);
      return next;
    }

    const existing = idx >= 0 ? data[idx] : undefined;
    const meal = body?.mealId ? await findCachedMeal(body.mealId) : undefined;
    const entry = {
      id: existing?.id ?? -Date.now(),
      planDate,
      mealSlot,
      mealId: body?.mealId ?? null,
      servings: body?.servings ?? meal?.servings ?? existing?.servings ?? 1,
      notes: body?.notes ?? existing?.notes ?? null,
      assignedByUserId: existing?.assignedByUserId ?? null,
      mealName: meal?.name ?? existing?.mealName ?? null,
      mealPrepTime: meal?.prepTimeMinutes ?? existing?.mealPrepTime ?? null,
      mealCookTime: meal?.cookTimeMinutes ?? existing?.mealCookTime ?? null,
      mealDifficulty: meal?.difficulty ?? existing?.mealDifficulty ?? null,
      assignedByDisplayName: existing?.assignedByDisplayName ?? null,
      _pendingSync: true,
    };
    const next = data.slice();
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    return next;
  });
}

/** Generic optimistic patch for simple `/resource/:id` CRUD endpoints
 * (meals, family, users, meals/ingredients): keeps any cached list/detail
 * responses in sync with pending create/update/delete mutations. */
async function patchEntityCollections(basePath: string, method: string, id: number | undefined, body: any) {
  if (method === 'POST') {
    // Create: prepend an optimistic item (temp negative id) to the unfiltered list cache only.
    const listPath = basePath;
    const existing = await getCachedGet<any[]>(listPath);
    if (Array.isArray(existing)) {
      const optimistic = { id: -Date.now(), ...body, _pendingSync: true };
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
export async function applyOptimisticPatch(method: string, path: string, bodyRaw?: string): Promise<void> {
  const body = bodyRaw ? JSON.parse(bodyRaw) : undefined;

  const plannerMatch = path.match(/^\/planner\/(\d{4}-\d{2}-\d{2})\/(\w+)$/);
  if (plannerMatch) {
    await patchPlannerSlot(method, plannerMatch[1], plannerMatch[2], body);
    return;
  }

  const entityMatch = path.match(/^\/(meals|family|users|meals\/ingredients)(?:\/(\d+))?$/);
  if (entityMatch) {
    const [, basePath, idStr] = entityMatch;
    await patchEntityCollections(`/${basePath}`, method, idStr ? Number(idStr) : undefined, body);
  }
}
