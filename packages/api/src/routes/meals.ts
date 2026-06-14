import { Router, type Request, type Response } from 'express';
import { eq, and, lte, inArray, like } from 'drizzle-orm';
import { db } from '../db/client';
import {
  meals,
  mealDietaryTypes,
  mealIngredients,
  ingredients,
  ingredientCategories,
  dietaryTypes,
  cuisines,
} from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const mealsRouter = Router();

mealsRouter.use(requireAuth);

// â”€â”€â”€ Reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

mealsRouter.get('/dietary-types', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(dietaryTypes));
});

mealsRouter.get('/cuisines', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(cuisines));
});

mealsRouter.get('/ingredient-categories', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(ingredientCategories).orderBy(ingredientCategories.sortOrder));
});

// â”€â”€â”€ Ingredients CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

mealsRouter.get('/ingredients', async (req: Request, res: Response): Promise<void> => {
  const search = req.query.search as string | undefined;
  const rows = search
    ? await db.select().from(ingredients).where(like(ingredients.name, `%${search}%`))
    : await db.select().from(ingredients);
  res.json(rows);
});

mealsRouter.post('/ingredients', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    name: z.string().min(1).max(100),
    categoryId: z.number().int().optional(),
    defaultUnit: z.string().max(32).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const [ing] = await db.insert(ingredients).values(parsed.data).returning();
    res.status(201).json(ing);
  } catch (err: any) {
    const isUnique = err?.cause?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      err?.cause?.message?.includes('UNIQUE') || err?.message?.includes('UNIQUE');
    if (isUnique) {
      res.status(409).json({ error: 'Ingredient already exists' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Failed to create ingredient' });
    }
  }
});

// â”€â”€â”€ Meals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

mealsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const { search, dietaryTypeIds, cuisineId, difficulty, prepTimeMax, ingredientIds, isTested } = req.query;

  const conditions: any[] = [];
  if (search) conditions.push(like(meals.name, `%${search}%`));
  if (cuisineId) conditions.push(eq(meals.cuisineId, parseInt(cuisineId as string, 10)));
  if (difficulty) conditions.push(eq(meals.difficulty, difficulty as string));
  if (prepTimeMax) conditions.push(lte(meals.prepTimeMinutes, parseInt(prepTimeMax as string, 10)));
  if (isTested !== undefined) conditions.push(eq(meals.isTested, isTested === 'true'));

  const mealRows = conditions.length > 0
    ? await db.select().from(meals).where(and(...conditions))
    : await db.select().from(meals);

  const mealIds = mealRows.map((m) => m.id);
  if (mealIds.length === 0) { res.json([]); return; }

  const [dietaryRows, ingredientRows] = await Promise.all([
    db.select({
      mealId: mealDietaryTypes.mealId,
      dietaryTypeId: dietaryTypes.id,
      name: dietaryTypes.name,
      icon: dietaryTypes.icon,
    })
      .from(mealDietaryTypes)
      .innerJoin(dietaryTypes, eq(mealDietaryTypes.dietaryTypeId, dietaryTypes.id))
      .where(inArray(mealDietaryTypes.mealId, mealIds)),
    db.select({
      mealId: mealIngredients.mealId,
      ingredientId: ingredients.id,
      ingredientName: ingredients.name,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      notes: mealIngredients.notes,
    })
      .from(mealIngredients)
      .innerJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
      .where(inArray(mealIngredients.mealId, mealIds)),
  ]);

  let filteredIds = new Set(mealIds);

  if (dietaryTypeIds) {
    const ids = (dietaryTypeIds as string).split(',').map(Number);
    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const mealDietIds = dietaryRows.filter((r) => r.mealId === id).map((r) => r.dietaryTypeId);
        return ids.every((did) => mealDietIds.includes(did));
      }),
    );
  }

  if (ingredientIds) {
    const ids = (ingredientIds as string).split(',').map(Number);
    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const mealIngIds = ingredientRows.filter((r) => r.mealId === id).map((r) => r.ingredientId);
        return ids.some((iid) => mealIngIds.includes(iid));
      }),
    );
  }

  const result = mealRows
    .filter((m) => filteredIds.has(m.id))
    .map((m) => ({
      ...m,
      instructions: JSON.parse(m.instructions || '[]'),
      dietaryTypes: dietaryRows.filter((r) => r.mealId === m.id).map(({ dietaryTypeId, name, icon }) => ({ id: dietaryTypeId, name, icon })),
      ingredients: ingredientRows.filter((r) => r.mealId === m.id).map(({ ingredientId, ingredientName, quantity, unit, notes }) => ({ id: ingredientId, name: ingredientName, quantity, unit, notes })),
    }));

  res.json(result);
});

mealsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [meal] = await db.select().from(meals).where(eq(meals.id, id)).limit(1);
  if (!meal) { res.status(404).json({ error: 'Meal not found' }); return; }

  const [mealDietary, mealIngs] = await Promise.all([
    db.select({ id: dietaryTypes.id, name: dietaryTypes.name, icon: dietaryTypes.icon })
      .from(mealDietaryTypes)
      .innerJoin(dietaryTypes, eq(mealDietaryTypes.dietaryTypeId, dietaryTypes.id))
      .where(eq(mealDietaryTypes.mealId, id)),
    db.select({ id: ingredients.id, name: ingredients.name, quantity: mealIngredients.quantity, unit: mealIngredients.unit, notes: mealIngredients.notes })
      .from(mealIngredients)
      .innerJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
      .where(eq(mealIngredients.mealId, id)),
  ]);

  res.json({ ...meal, instructions: JSON.parse(meal.instructions || '[]'), dietaryTypes: mealDietary, ingredients: mealIngs });
});

const mealSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  prepTimeMinutes: z.number().int().min(0),
  cookTimeMinutes: z.number().int().min(0),
  servings: z.number().int().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  cuisineId: z.number().int().optional().nullable(),
  instructions: z.array(z.string()),
  imageUrl: z.string().url().optional().nullable().or(z.literal('')).transform(v => v === '' ? null : v),
  isTested: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  dietaryTypeIds: z.array(z.number().int()).default([]),
  ingredients: z.array(z.object({
    ingredientId: z.number().int(),
    quantity: z.number().positive(),
    unit: z.string().min(1),
    notes: z.string().optional(),
  })).default([]),
});

mealsRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ingredients: ingList, instructions, ...mealData } = parsed.data;
  const [meal] = await db.insert(meals).values({ ...mealData, instructions: JSON.stringify(instructions), createdByUserId: req.user!.userId, updatedByUserId: req.user!.userId }).returning();

  if (dietaryTypeIds.length > 0) {
    await db.insert(mealDietaryTypes).values(dietaryTypeIds.map((dtId) => ({ mealId: meal.id, dietaryTypeId: dtId })));
  }
  if (ingList.length > 0) {
    await db.insert(mealIngredients).values(ingList.map((i) => ({ ...i, mealId: meal.id })));
  }

  res.status(201).json({ ...meal, instructions, dietaryTypes: [], ingredients: [] });
});

mealsRouter.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ingredients: ingList, instructions, ...mealData } = parsed.data;
  const [updated] = await db.update(meals).set({ ...mealData, instructions: JSON.stringify(instructions), updatedByUserId: req.user!.userId, updatedAt: new Date().toISOString() }).where(eq(meals.id, id)).returning();

  if (!updated) { res.status(404).json({ error: 'Meal not found' }); return; }

  await db.delete(mealDietaryTypes).where(eq(mealDietaryTypes.mealId, id));
  if (dietaryTypeIds.length > 0) {
    await db.insert(mealDietaryTypes).values(dietaryTypeIds.map((dtId) => ({ mealId: id, dietaryTypeId: dtId })));
  }

  await db.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
  if (ingList.length > 0) {
    await db.insert(mealIngredients).values(ingList.map((i) => ({ ...i, mealId: id })));
  }

  res.json({ ...updated, instructions });
});

mealsRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const result = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (result.length === 0) { res.status(404).json({ error: 'Meal not found' }); return; }
  res.json({ ok: true });
});
