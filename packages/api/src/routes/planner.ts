import { Router, type Response } from 'express';
import { eq, and, between, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { mealPlans, meals, mealIngredients, ingredients, ingredientCategories, users } from '../db/schema';
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
import { db } from '../db/client';
