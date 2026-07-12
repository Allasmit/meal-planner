import { Router, type Request, type Response } from 'express';
import { eq, and, lte, inArray, like } from 'drizzle-orm';
import { db } from '../db/client';
import {
  meals,
  mealDietaryTypes,
  mealIngredients,
  mealSuitableFor,
  mealPreferredBy,
  ingredients,
  ingredientCategories,
  dietaryTypes,
  cuisines,
} from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const mealsRouter = Router();

mealsRouter.use(requireAuth);

// Reference data

mealsRouter.get('/dietary-types', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(dietaryTypes));
});

mealsRouter.get('/cuisines', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(cuisines));
});

mealsRouter.get('/ingredient-categories', async (_req: Request, res: Response): Promise<void> => {
  res.json(await db.select().from(ingredientCategories).orderBy(ingredientCategories.sortOrder));
});

// Ingredients CRUD

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

mealsRouter.patch('/ingredients/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    categoryId: z.number().int().nullable().optional(),
    defaultUnit: z.string().max(32).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [updated] = await db
    .update(ingredients)
    .set(parsed.data)
    .where(eq(ingredients.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Ingredient not found' });
    return;
  }

  res.json(updated);
});

// Meals

mealsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const {
    search,
    dietaryTypeIds,
    cuisineId,
    difficulty,
    prepTimeMax,
    ingredientIds,
    isTested,
    proteinType,
    mealCategory,
    leftoverBehaviour,
    isFavourite,
    isSpecialOccasion,
    maxCost,
    suitableForMemberIds,
    preferredByMemberIds,
  } = req.query;

  const conditions: any[] = [];
  if (search) conditions.push(like(meals.name, `%${search}%`));
  if (cuisineId) conditions.push(eq(meals.cuisineId, parseInt(cuisineId as string, 10)));
  if (difficulty) conditions.push(eq(meals.difficulty, difficulty as string));
  if (prepTimeMax) conditions.push(lte(meals.prepTimeMinutes, parseInt(prepTimeMax as string, 10)));
  if (isTested !== undefined) conditions.push(eq(meals.isTested, isTested === 'true'));
  if (proteinType) conditions.push(eq(meals.proteinType, proteinType as string));
  if (mealCategory) conditions.push(eq(meals.mealCategory, mealCategory as string));
  if (leftoverBehaviour) conditions.push(eq(meals.leftoverBehaviour, leftoverBehaviour as string));
  if (isFavourite !== undefined) conditions.push(eq(meals.isFavourite, isFavourite === 'true'));
  if (isSpecialOccasion !== undefined) conditions.push(eq(meals.isSpecialOccasion, isSpecialOccasion === 'true'));
  if (maxCost) conditions.push(lte(meals.cost, parseFloat(maxCost as string)));

  const mealRows = conditions.length > 0
    ? await db.select().from(meals).where(and(...conditions))
    : await db.select().from(meals);

  const mealIds = mealRows.map((m) => m.id);
  if (mealIds.length === 0) {
    res.json([]);
    return;
  }

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

  if (suitableForMemberIds) {
    const memberIds = (suitableForMemberIds as string).split(',').map(Number);
    const suitableFilterRows = await db
      .select({ mealId: mealSuitableFor.mealId, familyMemberId: mealSuitableFor.familyMemberId })
      .from(mealSuitableFor)
      .where(inArray(mealSuitableFor.mealId, [...filteredIds]));

    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const suited = suitableFilterRows.filter((r) => r.mealId === id).map((r) => r.familyMemberId);
        if (suited.length === 0) return true;
        return memberIds.every((mid) => suited.includes(mid));
      }),
    );
  }

  if (preferredByMemberIds) {
    const memberIds = (preferredByMemberIds as string).split(',').map(Number);
    const preferredFilterRows = await db
      .select({ mealId: mealPreferredBy.mealId, familyMemberId: mealPreferredBy.familyMemberId })
      .from(mealPreferredBy)
      .where(inArray(mealPreferredBy.mealId, [...filteredIds]));

    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const preferred = preferredFilterRows.filter((r) => r.mealId === id).map((r) => r.familyMemberId);
        return memberIds.every((mid) => preferred.includes(mid));
      }),
    );
  }

  const [suitableRows, preferredRows] = await Promise.all([
    db.select({
      mealId: mealSuitableFor.mealId,
      familyMemberId: mealSuitableFor.familyMemberId,
    })
      .from(mealSuitableFor)
      .where(inArray(mealSuitableFor.mealId, mealIds)),
    db.select({
      mealId: mealPreferredBy.mealId,
      familyMemberId: mealPreferredBy.familyMemberId,
    })
      .from(mealPreferredBy)
      .where(inArray(mealPreferredBy.mealId, mealIds)),
  ]);

  const result = mealRows
    .filter((m) => filteredIds.has(m.id))
    .map((m) => ({
      ...m,
      instructions: JSON.parse(m.instructions || '[]'),
      dietaryTypes: dietaryRows
        .filter((r) => r.mealId === m.id)
        .map(({ dietaryTypeId, name, icon }) => ({ id: dietaryTypeId, name, icon })),
      ingredients: ingredientRows
        .filter((r) => r.mealId === m.id)
        .map(({ ingredientId, ingredientName, quantity, unit, notes }) => ({
          id: ingredientId,
          name: ingredientName,
          quantity,
          unit,
          notes,
        })),
      suitableForMemberIds: suitableRows.filter((r) => r.mealId === m.id).map((r) => r.familyMemberId),
      preferredByMemberIds: preferredRows.filter((r) => r.mealId === m.id).map((r) => r.familyMemberId),
    }));

  res.json(result);
});

mealsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [meal] = await db.select().from(meals).where(eq(meals.id, id)).limit(1);
  if (!meal) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }

  const [mealDietary, mealIngs, suitableRows, preferredRows] = await Promise.all([
    db.select({ id: dietaryTypes.id, name: dietaryTypes.name, icon: dietaryTypes.icon })
      .from(mealDietaryTypes)
      .innerJoin(dietaryTypes, eq(mealDietaryTypes.dietaryTypeId, dietaryTypes.id))
      .where(eq(mealDietaryTypes.mealId, id)),
    db.select({
      id: ingredients.id,
      name: ingredients.name,
      quantity: mealIngredients.quantity,
      unit: mealIngredients.unit,
      notes: mealIngredients.notes,
    })
      .from(mealIngredients)
      .innerJoin(ingredients, eq(mealIngredients.ingredientId, ingredients.id))
      .where(eq(mealIngredients.mealId, id)),
    db.select({ familyMemberId: mealSuitableFor.familyMemberId })
      .from(mealSuitableFor)
      .where(eq(mealSuitableFor.mealId, id)),
    db.select({ familyMemberId: mealPreferredBy.familyMemberId })
      .from(mealPreferredBy)
      .where(eq(mealPreferredBy.mealId, id)),
  ]);

  res.json({
    ...meal,
    instructions: JSON.parse(meal.instructions || '[]'),
    dietaryTypes: mealDietary,
    ingredients: mealIngs,
    suitableForMemberIds: suitableRows.map((r) => r.familyMemberId),
    preferredByMemberIds: preferredRows.map((r) => r.familyMemberId),
  });
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
  imageUrl: z.string().url().optional().nullable().or(z.literal('')).transform((v) => v === '' ? null : v),
  isTested: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  proteinType: z.enum(['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'other']).optional().nullable(),
  mealCategory: z.enum(['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack']).optional().nullable(),
  leftoverBehaviour: z.enum(['consumed_same', 'fridge_next_day', 'freezable']).default('consumed_same'),
  sourceUrl: z.string().url().optional().nullable().or(z.literal('')).transform((v) => v === '' ? null : v),
  isFavourite: z.boolean().default(false),
  isSpecialOccasion: z.boolean().default(false),
  dietaryTypeIds: z.array(z.number().int()).default([]),
  suitableForMemberIds: z.array(z.number().int()).default([]),
  preferredByMemberIds: z.array(z.number().int()).default([]),
  ingredients: z.array(z.object({
    ingredientId: z.number().int(),
    quantity: z.number().positive(),
    unit: z.string().min(1),
    notes: z.string().optional(),
  })).default([]),
});

mealsRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { dietaryTypeIds, suitableForMemberIds, preferredByMemberIds, ingredients: ingList, instructions, ...mealData } = parsed.data;
  const [meal] = await db
    .insert(meals)
    .values({
      ...mealData,
      instructions: JSON.stringify(instructions),
      createdByUserId: req.user!.userId,
      updatedByUserId: req.user!.userId,
    })
    .returning();

  if (dietaryTypeIds.length > 0) {
    await db.insert(mealDietaryTypes).values(dietaryTypeIds.map((dtId) => ({ mealId: meal.id, dietaryTypeId: dtId })));
  }
  if (suitableForMemberIds.length > 0) {
    await db.insert(mealSuitableFor).values(suitableForMemberIds.map((mid) => ({ mealId: meal.id, familyMemberId: mid })));
  }
  if (preferredByMemberIds.length > 0) {
    await db.insert(mealPreferredBy).values(preferredByMemberIds.map((mid) => ({ mealId: meal.id, familyMemberId: mid })));
  }
  if (ingList.length > 0) {
    await db.insert(mealIngredients).values(ingList.map((i) => ({ ...i, mealId: meal.id })));
  }

  res.status(201).json({
    ...meal,
    instructions,
    dietaryTypes: [],
    ingredients: [],
    suitableForMemberIds,
    preferredByMemberIds,
  });
});

mealsRouter.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { dietaryTypeIds, suitableForMemberIds, preferredByMemberIds, ingredients: ingList, instructions, ...mealData } = parsed.data;
  const [updated] = await db
    .update(meals)
    .set({
      ...mealData,
      instructions: JSON.stringify(instructions),
      updatedByUserId: req.user!.userId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meals.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }

  await db.delete(mealDietaryTypes).where(eq(mealDietaryTypes.mealId, id));
  if (dietaryTypeIds.length > 0) {
    await db.insert(mealDietaryTypes).values(dietaryTypeIds.map((dtId) => ({ mealId: id, dietaryTypeId: dtId })));
  }

  await db.delete(mealSuitableFor).where(eq(mealSuitableFor.mealId, id));
  if (suitableForMemberIds.length > 0) {
    await db.insert(mealSuitableFor).values(suitableForMemberIds.map((mid) => ({ mealId: id, familyMemberId: mid })));
  }

  await db.delete(mealPreferredBy).where(eq(mealPreferredBy.mealId, id));
  if (preferredByMemberIds.length > 0) {
    await db.insert(mealPreferredBy).values(preferredByMemberIds.map((mid) => ({ mealId: id, familyMemberId: mid })));
  }

  await db.delete(mealIngredients).where(eq(mealIngredients.mealId, id));
  if (ingList.length > 0) {
    await db.insert(mealIngredients).values(ingList.map((i) => ({ ...i, mealId: id })));
  }

  res.json({
    ...updated,
    instructions,
    suitableForMemberIds,
    preferredByMemberIds,
  });
});

mealsRouter.delete('/:id', async (_req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(_req.params.id, 10);
  const result = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (result.length === 0) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }
  res.json({ ok: true });
});
