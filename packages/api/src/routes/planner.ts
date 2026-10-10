import type { Response } from 'express';
import { createRouter } from '../lib/router';
import { parseId } from '../lib/params';
import { aggregateShoppingList } from '../lib/shopping';
import { sqliteNow } from '../lib/sqlite';
import { eq, and, between, inArray, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { mealPlans, meals, mealIngredients, ingredients, ingredientCategories, users, weeklyRules, userSettings, mealSuitableFor, mealPreferredBy } from '../db/schema';
import { requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth';
import { generatePlan } from '../lib/generator';
import { z } from 'zod';

export const plannerRouter = createRouter();

plannerRouter.use(requireAuth);

// GET /api/planner/shopping-list — must be before /:date/:slot to avoid param collision
plannerRouter.get('/shopping-list', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart as string | undefined;
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }

  const showHidden = req.query.showHidden === 'true';

  const [wsYear, wsMonth, wsDay] = weekStart.split('-').map(Number);
  const weekEnd = new Date(Date.UTC(wsYear, wsMonth - 1, wsDay + 6))
    .toISOString()
    .slice(0, 10);

  const plans = await db
    .select({ mealId: mealPlans.mealId, servings: mealPlans.servings })
    .from(mealPlans)
    .where(between(mealPlans.planDate, weekStart, weekEnd));

  const validPlans = plans.filter((p) => p.mealId !== null);
  if (validPlans.length === 0) {
    res.json([]);
    return;
  }

  // A meal planned several times in the week needs its ingredients several times.
  const mealCounts = new Map<number, number>();
  for (const plan of validPlans) mealCounts.set(plan.mealId!, (mealCounts.get(plan.mealId!) ?? 0) + 1);
  const mealIds = [...mealCounts.keys()];

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
      categoryHidden: ingredientCategories.hiddenFromShopping,
    })
    .from(mealIngredients)
    .innerJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
    .leftJoin(ingredientCategories, eq(ingredients.categoryId, ingredientCategories.id))
    .where(inArray(mealIngredients.mealId, mealIds));

  const result = aggregateShoppingList(rows, mealCounts, showHidden);

  res.json(result);
});

// GET /api/planner?weekStart=YYYY-MM-DD
plannerRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart as string | undefined;
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }

  const [wsYear, wsMonth, wsDay] = weekStart.split('-').map(Number);
  const weekEnd = new Date(Date.UTC(wsYear, wsMonth - 1, wsDay + 6))
    .toISOString()
    .slice(0, 10);

  const result = await db
    .select({
      id: mealPlans.id,
      planDate: mealPlans.planDate,
      mealSlot: mealPlans.mealSlot,
      mealId: mealPlans.mealId,
      servings: mealPlans.servings,
      notes: mealPlans.notes,
      customName: mealPlans.customName,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

// POST /api/planner/:date/:slot — add a dish to a slot (a slot can hold several)
plannerRouter.post('/:date/:slot', async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, slot } = req.params;

  if (!DATE_RE.test(date)) { res.status(400).json({ error: 'Invalid date format' }); return; }
  if (!(VALID_SLOTS as readonly string[]).includes(slot)) { res.status(400).json({ error: 'Invalid meal slot' }); return; }

  const schema = z
    .object({
      mealId: z.number().int().optional(),
      customName: z.string().trim().min(1).max(120).optional(),
      servings: z.number().int().min(1).default(2),
      notes: z.string().optional().nullable(),
    })
    .refine((v) => (v.mealId === undefined) !== (v.customName === undefined), {
      message: 'Provide either mealId or customName',
    });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  if (parsed.data.mealId !== undefined) {
    const [meal] = await db.select({ id: meals.id }).from(meals).where(eq(meals.id, parsed.data.mealId));
    if (!meal) { res.status(404).json({ error: 'Meal not found' }); return; }
  }

  const [saved] = await db
    .insert(mealPlans)
    .values({
      planDate: date,
      mealSlot: slot as (typeof VALID_SLOTS)[number],
      mealId: parsed.data.mealId ?? null,
      customName: parsed.data.customName ?? null,
      servings: parsed.data.servings,
      notes: parsed.data.notes,
      assignedByUserId: req.user!.userId,
    })
    .returning();
  res.status(201).json(saved);
});

// PUT /api/planner/entry/:id — change a planned dish: move it to another date/slot, swap the meal, or edit servings/notes
plannerRouter.put('/entry/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const schema = z.object({
    planDate: z.string().regex(DATE_RE).optional(),
    mealSlot: z.enum(VALID_SLOTS).optional(),
    mealId: z.number().int().optional(),
    customName: z.string().trim().min(1).max(120).optional(),
    servings: z.number().int().min(1).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const [updated] = await db
    .update(mealPlans)
    .set({ ...parsed.data, assignedByUserId: req.user!.userId, updatedAt: sqliteNow() })
    .where(eq(mealPlans.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: 'Planned meal not found' }); return; }
  res.json(updated);
});

// DELETE /api/planner/entry/:id — remove one dish from the plan
plannerRouter.delete('/entry/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const result = await db.delete(mealPlans).where(eq(mealPlans.id, id)).returning({ id: mealPlans.id });
  if (result.length === 0) { res.status(404).json({ error: 'Planned meal not found' }); return; }
  res.json({ ok: true });
});

// ─── GET /api/planner/rules ────────────────────────────────────────────────────

plannerRouter.get('/rules', async (_req: AuthRequest, res: Response): Promise<void> => {
  const rules = await db.select().from(weeklyRules);
  res.json(rules);
});

// ─── PATCH /api/planner/rules/:id (admin) ─────────────────────────────────────

plannerRouter.patch('/rules/:id', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const schema = z.object({
    label: z.string().min(1).optional(),
    value: z.string().optional(),
    isEnabled: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const [updated] = await db.update(weeklyRules).set(parsed.data).where(eq(weeklyRules.id, id)).returning();
  if (!updated) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json(updated);
});

// ─── GET /api/planner/settings ────────────────────────────────────────────────

async function readSettings(): Promise<{ monthlyBudget: number | null; batchCookingDay: number; weekStartDay: number }> {
  const rows = await db.select().from(userSettings);
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  const budget = settings['monthly_budget'] ? parseFloat(settings['monthly_budget']) : NaN;
  return {
    monthlyBudget: Number.isFinite(budget) ? budget : null,
    batchCookingDay: settings['batch_cooking_day'] ? parseInt(settings['batch_cooking_day'], 10) : 0,
    weekStartDay: settings['week_start_day'] ? parseInt(settings['week_start_day'], 10) : 1,
  };
}

plannerRouter.get('/settings', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await readSettings());
});

// ─── PATCH /api/planner/settings (admin) ──────────────────────────────────────

plannerRouter.patch('/settings', requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    monthlyBudget: z.number().min(0).nullable().optional(),
    batchCookingDay: z.number().int().min(0).max(6).optional(),
    weekStartDay: z.number().int().min(0).max(6).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const upsert = (key: string, value: string) =>
    db.insert(userSettings).values({ key, value }).onConflictDoUpdate({ target: userSettings.key, set: { value } });

  if (parsed.data.monthlyBudget !== undefined) {
    await upsert('monthly_budget', parsed.data.monthlyBudget === null ? '' : String(parsed.data.monthlyBudget));
  }
  if (parsed.data.batchCookingDay !== undefined) {
    await upsert('batch_cooking_day', String(parsed.data.batchCookingDay));
  }
  if (parsed.data.weekStartDay !== undefined) {
    await upsert('week_start_day', String(parsed.data.weekStartDay));
  }

  res.json({ ok: true });
});

// ─── GET /api/planner/cost-summary?weekStart=YYYY-MM-DD ───────────────────────
// Estimated spend for the week and for the calendar month the week starts in, against the monthly budget.

plannerRouter.get('/cost-summary', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart;
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }
  const [year, month, day] = weekStart.split('-').map(Number);
  const weekEnd = new Date(Date.UTC(year, month - 1, day + 6)).toISOString().slice(0, 10);
  const monthStart = `${weekStart.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const costBetween = async (from: string, to: string) => {
    const rows = await db
      .select({ cost: meals.cost })
      .from(mealPlans)
      .innerJoin(meals, eq(mealPlans.mealId, meals.id))
      .where(between(mealPlans.planDate, from, to));
    return {
      total: Math.round(rows.reduce((sum, r) => sum + (r.cost ?? 0), 0) * 100) / 100,
      mealsWithoutCost: rows.filter((r) => r.cost === null).length,
    };
  };

  const [week, monthTotals, settings] = await Promise.all([
    costBetween(weekStart, weekEnd),
    costBetween(monthStart, monthEnd),
    readSettings(),
  ]);

  res.json({
    weekCost: week.total,
    monthCost: monthTotals.total,
    monthlyBudget: settings.monthlyBudget,
    mealsWithoutCost: week.mealsWithoutCost,
  });
});

// ─── POST /api/planner/auto-generate ──────────────────────────────────────────
// Suggests meals for the requested slots from the recipe library (see lib/generator.ts for the rules).

plannerRouter.post('/auto-generate', async (req: AuthRequest, res: Response): Promise<void> => {
  const daySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    prepTimeLimitMinutes: z.number().int().optional().nullable(),
    leftoversRequired: z.boolean().optional(),
    familyMemberIds: z.array(z.number().int()).optional(),
  });

  const bodySchema = z.object({
    days: z.array(daySchema).min(1).max(100),
    overwriteExisting: z.boolean().default(false),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const [rules, allMeals, suitableRows, preferredRows, settings] = await Promise.all([
    db.select().from(weeklyRules).where(eq(weeklyRules.isEnabled, true)),
    db.select().from(meals),
    db.select().from(mealSuitableFor),
    db.select().from(mealPreferredBy),
    readSettings(),
  ]);
  if (allMeals.length === 0) { res.status(422).json({ error: 'No meals in library' }); return; }

  const proteinLimits: Record<string, number> = {};
  const categoryLimits: Record<string, number> = {};
  let defaultLeftoversDays: number[] = [0, 1, 2, 3, 4]; // Sun–Thu
  let ruleBatchDay: number | null = null;
  for (const rule of rules) {
    try {
      const val = JSON.parse(rule.value);
      if (rule.ruleType === 'max_protein_per_week' && val.protein) proteinLimits[val.protein] = val.maxCount ?? 1;
      if (rule.ruleType === 'max_category_per_week' && val.category) categoryLimits[val.category] = val.maxCount ?? 3;
      if (rule.ruleType === 'default_leftovers_days' && Array.isArray(val.days)) defaultLeftoversDays = val.days;
      if (rule.ruleType === 'batch_cooking_day' && Number.isInteger(val.dayOfWeek)) ruleBatchDay = val.dayOfWeek;
    } catch { /* skip malformed rule */ }
  }
  const batchRuleEnabled = rules.some((r) => r.ruleType === 'batch_cooking_day');

  const dates = parsed.data.days.map((d) => d.date).sort();
  const existing = await db
    .select({ date: mealPlans.planDate, slot: mealPlans.mealSlot, mealId: mealPlans.mealId, customName: mealPlans.customName })
    .from(mealPlans)
    .where(between(mealPlans.planDate, dates[0], dates[dates.length - 1]));

  // A slot holding a free-text dish counts as taken: auto-plan must not wipe it unless overwriting.
  const customSlots = new Set(existing.filter((p) => p.customName).map((p) => `${p.date}::${p.slot}`));
  const daysToFill = parsed.data.overwriteExisting
    ? parsed.data.days
    : parsed.data.days.filter((d) => !customSlots.has(`${d.date}::${d.slot}`));

  const generated = generatePlan({
    days: daysToFill,
    meals: allMeals.map((m) => ({
      id: m.id,
      prepTimeMinutes: m.prepTimeMinutes,
      cookTimeMinutes: m.cookTimeMinutes,
      proteinType: m.proteinType,
      mealCategory: m.mealCategory,
      leftoverBehaviour: m.leftoverBehaviour,
      isFavourite: m.isFavourite,
      isSpecialOccasion: m.isSpecialOccasion,
      suitableForMemberIds: suitableRows.filter((r) => r.mealId === m.id).map((r) => r.familyMemberId),
      preferredByMemberIds: preferredRows.filter((r) => r.mealId === m.id).map((r) => r.familyMemberId),
    })),
    rules: {
      proteinLimits,
      categoryLimits,
      defaultLeftoversDays,
      batchCookingDay: batchRuleEnabled ? (settings.batchCookingDay ?? ruleBatchDay) : null,
    },
    existing,
    overwriteExisting: parsed.data.overwriteExisting,
  });

  // Slots where nothing suitable was found are left as they were: a failed pick never wipes an existing meal.
  const toWrite = generated.filter((s) => s.mealId !== null);
  const servingsByMeal = new Map(allMeals.map((m) => [m.id, m.servings]));
  await db.transaction(async (tx) => {
    for (const s of toWrite) {
      const values = {
        mealId: s.mealId,
        servings: servingsByMeal.get(s.mealId!) ?? 2,
        leftoversRequired: s.leftoversRequired,
        prepTimeLimitMinutes: s.prepTimeLimitMinutes,
        assignedByUserId: req.user!.userId,
      };
      // Only empty slots (or slots being overwritten) reach here, so clear whatever is left before adding the pick.
      await tx.delete(mealPlans).where(and(eq(mealPlans.planDate, s.date), eq(mealPlans.mealSlot, s.slot)));
      await tx.insert(mealPlans).values({ planDate: s.date, mealSlot: s.slot, ...values });
    }
  });

  res.json({
    generated: toWrite.length,
    unfilled: generated.length - toWrite.length,
    suggestions: generated.map((s) => ({ date: s.date, slot: s.slot, mealId: s.mealId, notes: null })),
  });
});
