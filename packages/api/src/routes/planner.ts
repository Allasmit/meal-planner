import { Router, type Response } from 'express';
import { eq, and, between, inArray, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { mealPlans, meals, mealIngredients, ingredients, ingredientCategories, users, weeklyRules, userSettings, familyMembers, familyMemberDietaryTypes } from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const plannerRouter = Router();

plannerRouter.use(requireAuth);

// GET /api/planner/shopping-list â€” must be before /:date/:slot to avoid param collision
plannerRouter.get('/shopping-list', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart as string | undefined;
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }

  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekEnd = end.toISOString().split('T')[0];

  const plans = await db
    .select({ mealId: mealPlans.mealId, servings: mealPlans.servings })
    .from(mealPlans)
    .where(between(mealPlans.planDate, weekStart, weekEnd));

  const validPlans = plans.filter((p) => p.mealId !== null);
  if (validPlans.length === 0) { res.json([]); return; }

  const mealIds = validPlans.map((p) => p.mealId!);

  const rows = await db
    .select({
      mealId: mealIngredients.mealId,
      ingredientId: ingredients.id,
      ingredientName: ingredients.name,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      categoryId: ingredientCategories.id,
      categoryName: ingredientCategories.name,
      categorySortOrder: ingredientCategories.sortOrder,
    })
    .from(mealIngredients)
    .innerJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .leftJoin(ingredientCategories, eq(ingredients.categoryId, ingredientCategories.id))
    .where(inArray(mealIngredients.mealId, mealIds));

  type AggKey = string;
  const agg = new Map<AggKey, { ingredientId: number; ingredientName: string; quantity: number; unit: string; categoryId: number | null; categoryName: string | null; categorySortOrder: number }>();

  for (const row of rows) {
    const key: AggKey = `${row.ingredientId}::${row.unit}`;
    if (agg.has(key)) {
      agg.get(key)!.quantity += row.quantity;
    } else {
      agg.set(key, { ingredientId: row.ingredientId, ingredientName: row.ingredientName, quantity: row.quantity, unit: row.unit, categoryId: row.categoryId ?? null, categoryName: row.categoryName ?? 'Other', categorySortOrder: row.categorySortOrder ?? 99 });
    }
  }

  type CategoryGroup = { categoryId: number | null; categoryName: string; sortOrder: number; items: { ingredientId: number; name: string; quantity: number; unit: string }[] };
  const categoryMap = new Map<string, CategoryGroup>();

  for (const item of agg.values()) {
    const catKey = String(item.categoryId ?? 'null');
    if (!categoryMap.has(catKey)) {
      categoryMap.set(catKey, { categoryId: item.categoryId, categoryName: item.categoryName ?? 'Other', sortOrder: item.categorySortOrder, items: [] });
    }
    categoryMap.get(catKey)!.items.push({ ingredientId: item.ingredientId, name: item.ingredientName, quantity: Math.round(item.quantity * 100) / 100, unit: item.unit });
  }

  const result = [...categoryMap.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cat) => ({ ...cat, items: cat.items.sort((a, b) => a.name.localeCompare(b.name)) }));

  res.json(result);
});

// GET /api/planner?weekStart=YYYY-MM-DD
plannerRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart as string | undefined;
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }

  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekEnd = end.toISOString().split('T')[0];

  const result = await db
    .select({
      id: mealPlans.id,
      planDate: mealPlans.planDate,
      mealSlot: mealPlans.mealSlot,
      mealId: mealPlans.mealId,
      servings: mealPlans.servings,
      notes: mealPlans.notes,
      assignedByUserId: mealPlans.assignedByUserId,
      mealName: meals.name,
      mealPrepTime: meals.prepTimeMinutes,
      mealCookTime: meals.cookTimeMinutes,
      mealDifficulty: meals.difficulty,
      assignedByDisplayName: users.displayName,
    })
    .from(mealPlans)
    .leftJoin(meals, eq(mealPlans.mealId, meals.id))
    .leftJoin(users, eq(mealPlans.assignedByUserId, users.id))
    .where(between(mealPlans.planDate, weekStart, weekEnd));

  res.json(result);
});

// PUT /api/planner/:date/:slot
plannerRouter.put('/:date/:slot', async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, slot } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'Invalid date format' }); return; }
  const VALID_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  if (!VALID_SLOTS.includes(slot)) { res.status(400).json({ error: 'Invalid meal slot' }); return; }

  const schema = z.object({
    mealId: z.number().int().nullable(),
    servings: z.number().int().min(1).default(2),
    notes: z.string().optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [existing] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.planDate, date), eq(mealPlans.mealSlot, slot as any)))
    .limit(1);

  if (existing) {
    const [updated] = await db.update(mealPlans).set({ mealId: parsed.data.mealId, servings: parsed.data.servings, notes: parsed.data.notes, assignedByUserId: req.user!.userId, updatedAt: new Date().toISOString() }).where(eq(mealPlans.id, existing.id)).returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(mealPlans).values({ planDate: date, mealSlot: slot as any, mealId: parsed.data.mealId, servings: parsed.data.servings, notes: parsed.data.notes, assignedByUserId: req.user!.userId }).returning();
    res.status(201).json(created);
  }
});

// DELETE /api/planner/:date/:slot
plannerRouter.delete('/:date/:slot', async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, slot } = req.params;
  const result = await db
    .delete(mealPlans)
    .where(and(eq(mealPlans.planDate, date), eq(mealPlans.mealSlot, slot as any)))
    .returning({ id: mealPlans.id });

  if (result.length === 0) { res.status(404).json({ error: 'No plan found for that date/slot' }); return; }
  res.json({ ok: true });
});

// ─── GET /api/planner/rules ────────────────────────────────────────────────────

plannerRouter.get('/rules', async (_req: AuthRequest, res: Response): Promise<void> => {
  const rules = await db.select().from(weeklyRules);
  res.json(rules);
});

// ─── PATCH /api/planner/rules/:id ─────────────────────────────────────────────

plannerRouter.patch('/rules/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    label: z.string().min(1).optional(),
    value: z.string().optional(),
    isEnabled: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [updated] = await db.update(weeklyRules).set(parsed.data).where(eq(weeklyRules.id, id)).returning();
  if (!updated) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json(updated);
});

// ─── GET /api/planner/settings ────────────────────────────────────────────────

plannerRouter.get('/settings', async (_req: AuthRequest, res: Response): Promise<void> => {
  const rows = await db.select().from(userSettings);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  res.json({
    monthlyBudget: settings['monthly_budget'] ? parseFloat(settings['monthly_budget']) : null,
    batchCookingDay: settings['batch_cooking_day'] ? parseInt(settings['batch_cooking_day']) : 0,
  });
});

// ─── PATCH /api/planner/settings ──────────────────────────────────────────────

plannerRouter.patch('/settings', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    monthlyBudget: z.number().min(0).nullable().optional(),
    batchCookingDay: z.number().int().min(0).max(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const upsert = async (key: string, value: string) => {
    const existing = await db.select().from(userSettings).where(eq(userSettings.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(userSettings).set({ value }).where(eq(userSettings.key, key));
    } else {
      await db.insert(userSettings).values({ key, value });
    }
  };

  if (parsed.data.monthlyBudget !== undefined) {
    await upsert('monthly_budget', parsed.data.monthlyBudget === null ? '' : String(parsed.data.monthlyBudget));
  }
  if (parsed.data.batchCookingDay !== undefined) {
    await upsert('batch_cooking_day', String(parsed.data.batchCookingDay));
  }

  res.json({ ok: true });
});

// ─── POST /api/planner/auto-generate ──────────────────────────────────────────
// Suggests meals for the week based on rules, constraints, and the recipe library

plannerRouter.post('/auto-generate', async (req: AuthRequest, res: Response): Promise<void> => {
  const daySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    prepTimeLimitMinutes: z.number().int().optional().nullable(),
    leftoversRequired: z.boolean().optional(),
    familyMemberIds: z.array(z.number().int()).optional(),
  });

  const bodySchema = z.object({
    days: z.array(daySchema).min(1),
    overwriteExisting: z.boolean().default(false),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Load enabled rules
  const rules = await db.select().from(weeklyRules).where(eq(weeklyRules.isEnabled, true));

  // Load all meals
  const allMeals = await db.select().from(meals);
  if (allMeals.length === 0) { res.status(422).json({ error: 'No meals in library' }); return; }

  // Build rule maps
  const proteinLimits: Record<string, number> = {};
  const categoryLimits: Record<string, number> = {};
  let defaultLeftoversDays: number[] = [0, 1, 2, 3, 4]; // Sun–Thu

  for (const rule of rules) {
    try {
      const val = JSON.parse(rule.value);
      if (rule.ruleType === 'max_protein_per_week' && val.protein) proteinLimits[val.protein] = val.maxCount ?? 1;
      if (rule.ruleType === 'max_category_per_week' && val.category) categoryLimits[val.category] = val.maxCount ?? 3;
      if (rule.ruleType === 'default_leftovers_days' && Array.isArray(val.days)) defaultLeftoversDays = val.days;
    } catch { /* skip malformed rule */ }
  }

  // Track weekly usage for variety scoring (soft, not hard constraint)
  const proteinUsed: Record<string, number> = {};
  const categoryUsed: Record<string, number> = {};
  const suggestions: { date: string; slot: string; mealId: number | null; notes: string | null }[] = [];

  for (const day of parsed.data.days) {
    const dayOfWeek = new Date(day.date).getDay();
    const leftoversNeeded = day.leftoversRequired ?? defaultLeftoversDays.includes(dayOfWeek);

    // Base candidates: filter on hard constraints only (prep time limit, protein/category weekly caps)
    let candidates = allMeals.filter((m) => {
      // Prep time limit (hard constraint)
      if (day.prepTimeLimitMinutes && (m.prepTimeMinutes + m.cookTimeMinutes) > day.prepTimeLimitMinutes) return false;
      // Protein limit (hard constraint)
      if (m.proteinType && proteinLimits[m.proteinType] !== undefined) {
        if ((proteinUsed[m.proteinType] ?? 0) >= proteinLimits[m.proteinType]) return false;
      }
      // Category limit (hard constraint)
      if (m.mealCategory && categoryLimits[m.mealCategory] !== undefined) {
        if ((categoryUsed[m.mealCategory] ?? 0) >= categoryLimits[m.mealCategory]) return false;
      }
      return true;
    });

    // Soft preference: prefer meals matching the slot's category
    const slotCategoryMap: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack' };
    const slotCategory = slotCategoryMap[day.slot];
    const slotMatched = candidates.filter((m) => m.mealCategory === slotCategory);
    if (slotMatched.length > 0) candidates = slotMatched;

    // Soft preference: prefer meals with leftovers if needed; fall back to all if none available
    if (leftoversNeeded) {
      const withLeftovers = candidates.filter((m) => m.leftoverBehaviour !== 'consumed_same');
      if (withLeftovers.length > 0) candidates = withLeftovers;
    }

    // Shuffle for variety and pick
    candidates.sort(() => Math.random() - 0.5);
    const pick = candidates[0] ?? null;

    if (pick) {
      if (pick.proteinType) proteinUsed[pick.proteinType] = (proteinUsed[pick.proteinType] ?? 0) + 1;
      if (pick.mealCategory) categoryUsed[pick.mealCategory] = (categoryUsed[pick.mealCategory] ?? 0) + 1;
    }

    suggestions.push({ date: day.date, slot: day.slot, mealId: pick?.id ?? null, notes: null });
  }

  // Write to planner
  for (const s of suggestions) {
    const existing = await db.select({ id: mealPlans.id })
      .from(mealPlans)
      .where(and(eq(mealPlans.planDate, s.date), eq(mealPlans.mealSlot, s.slot as any)))
      .limit(1);

    if (existing.length > 0) {
      if (parsed.data.overwriteExisting) {
        await db.update(mealPlans).set({ mealId: s.mealId, assignedByUserId: req.user!.userId, updatedAt: new Date().toISOString() }).where(eq(mealPlans.id, existing[0].id));
      }
    } else {
      await db.insert(mealPlans).values({ planDate: s.date, mealSlot: s.slot as any, mealId: s.mealId, assignedByUserId: req.user!.userId });
    }
  }

  res.json({ generated: suggestions.length, suggestions });
});
