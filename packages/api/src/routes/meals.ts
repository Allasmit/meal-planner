import type { Request, Response } from 'express';
import { createRouter } from '../lib/router';
import { parseId, parseIdList, parseOptionalNumber } from '../lib/params';
import { sqliteNow, escapeLike } from '../lib/sqlite';
import { PROTEIN_TYPES, MEAL_CATEGORIES, LEFTOVER_BEHAVIOURS } from '../lib/enums';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';
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

export const mealsRouter = createRouter();

type MealRow = typeof meals.$inferSelect;

/** Case-insensitive "contains" match that treats % and _ in the search text literally. */
function containsText(column: Parameters<typeof eq>[0], text: string) {
  return sql`${column} LIKE ${'%' + escapeLike(text) + '%'} ESCAPE '\\'`;
}

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
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const rows = search
    ? await db.select().from(ingredients).where(containsText(ingredients.name, search))
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
  const id = parseId(req.params.id, res);
  if (id === null) return;
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
  const cuisineIdNum = parseOptionalNumber(cuisineId);
  const prepTimeMaxNum = parseOptionalNumber(prepTimeMax);
  const maxCostNum = parseOptionalNumber(maxCost);
  const dietaryIdList = dietaryTypeIds ? parseIdList(dietaryTypeIds) : undefined;
  const ingredientIdList = ingredientIds ? parseIdList(ingredientIds) : undefined;
  const suitableIdList = suitableForMemberIds ? parseIdList(suitableForMemberIds) : undefined;
  const preferredIdList = preferredByMemberIds ? parseIdList(preferredByMemberIds) : undefined;

  if (
    cuisineIdNum === null || prepTimeMaxNum === null || maxCostNum === null ||
    dietaryIdList === null || ingredientIdList === null || suitableIdList === null || preferredIdList === null
  ) {
    res.status(400).json({ error: 'Invalid filter value' });
    return;
  }

  if (typeof search === 'string' && search) conditions.push(containsText(meals.name, search));
  if (cuisineIdNum !== undefined) conditions.push(eq(meals.cuisineId, cuisineIdNum));
  if (difficulty) conditions.push(eq(meals.difficulty, difficulty as MealRow['difficulty']));
  if (prepTimeMaxNum !== undefined) conditions.push(lte(meals.prepTimeMinutes, prepTimeMaxNum));
  if (isTested !== undefined) conditions.push(eq(meals.isTested, isTested === 'true'));
  if (proteinType) conditions.push(eq(meals.proteinType, proteinType as MealRow['proteinType'] & string));
  if (mealCategory) conditions.push(eq(meals.mealCategory, mealCategory as MealRow['mealCategory'] & string));
  if (leftoverBehaviour) conditions.push(eq(meals.leftoverBehaviour, leftoverBehaviour as MealRow['leftoverBehaviour']));
  if (isFavourite !== undefined) conditions.push(eq(meals.isFavourite, isFavourite === 'true'));
  if (isSpecialOccasion !== undefined) conditions.push(eq(meals.isSpecialOccasion, isSpecialOccasion === 'true'));
  if (maxCostNum !== undefined) conditions.push(lte(meals.cost, maxCostNum));

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

  if (dietaryIdList) {
    const ids = dietaryIdList;
    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const mealDietIds = dietaryRows.filter((r) => r.mealId === id).map((r) => r.dietaryTypeId);
        return ids.every((did) => mealDietIds.includes(did));
      }),
    );
  }

  if (ingredientIdList) {
    const ids = ingredientIdList;
    filteredIds = new Set(
      [...filteredIds].filter((id) => {
        const mealIngIds = ingredientRows.filter((r) => r.mealId === id).map((r) => r.ingredientId);
        return ids.some((iid) => mealIngIds.includes(iid));
      }),
    );
  }

  if (suitableIdList) {
    const memberIds = suitableIdList;
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

  if (preferredIdList) {
    const memberIds = preferredIdList;
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

/** Loads one meal with its dietary types, ingredients and family links. Shared by GET/POST/PUT so they all return the same shape. */
async function getMealById(id: number) {
  const [meal] = await db.select().from(meals).where(eq(meals.id, id)).limit(1);
  if (!meal) return null;

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

  return {
    ...meal,
    instructions: JSON.parse(meal.instructions || '[]'),
    dietaryTypes: mealDietary,
    ingredients: mealIngs,
    suitableForMemberIds: suitableRows.map((r) => r.familyMemberId),
    preferredByMemberIds: preferredRows.map((r) => r.familyMemberId),
  };
}

mealsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const meal = await getMealById(id);
  if (!meal) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }
  res.json(meal);
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
  proteinType: z.enum(PROTEIN_TYPES).optional().nullable(),
  mealCategory: z.enum(MEAL_CATEGORIES).optional().nullable(),
  leftoverBehaviour: z.enum(LEFTOVER_BEHAVIOURS).default('consumed_same'),
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

type MealInput = z.infer<typeof mealSchema>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replaces all junction rows and ingredients of a meal. Duplicate ids are collapsed so they can't hit unique indexes. */
async function replaceMealLinks(tx: Tx, mealId: number, input: MealInput): Promise<void> {
  const unique = (ids: number[]) => [...new Set(ids)];

  await tx.delete(mealDietaryTypes).where(eq(mealDietaryTypes.mealId, mealId));
  await tx.delete(mealSuitableFor).where(eq(mealSuitableFor.mealId, mealId));
  await tx.delete(mealPreferredBy).where(eq(mealPreferredBy.mealId, mealId));
  await tx.delete(mealIngredients).where(eq(mealIngredients.mealId, mealId));

  const dietary = unique(input.dietaryTypeIds);
  if (dietary.length > 0) {
    await tx.insert(mealDietaryTypes).values(dietary.map((dietaryTypeId) => ({ mealId, dietaryTypeId })));
  }
  const suitable = unique(input.suitableForMemberIds);
  if (suitable.length > 0) {
    await tx.insert(mealSuitableFor).values(suitable.map((familyMemberId) => ({ mealId, familyMemberId })));
  }
  const preferred = unique(input.preferredByMemberIds);
  if (preferred.length > 0) {
    await tx.insert(mealPreferredBy).values(preferred.map((familyMemberId) => ({ mealId, familyMemberId })));
  }
  if (input.ingredients.length > 0) {
    await tx.insert(mealIngredients).values(input.ingredients.map((i) => ({ ...i, mealId })));
  }
}

function splitMealInput(input: MealInput) {
  const { dietaryTypeIds, suitableForMemberIds, preferredByMemberIds, ingredients: ingList, instructions, ...mealData } = input;
  return { mealData: { ...mealData, instructions: JSON.stringify(instructions) } };
}

mealsRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { mealData } = splitMealInput(parsed.data);
  // One transaction: a failure part-way (e.g. an unknown ingredient id) leaves nothing behind.
  const mealId = await db.transaction(async (tx) => {
    const [meal] = await tx
      .insert(meals)
      .values({ ...mealData, createdByUserId: req.user!.userId, updatedByUserId: req.user!.userId })
      .returning({ id: meals.id });
    await replaceMealLinks(tx, meal.id, parsed.data);
    return meal.id;
  });

  res.status(201).json(await getMealById(mealId));
});

mealsRouter.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = mealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { mealData } = splitMealInput(parsed.data);
  const found = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(meals)
      .set({ ...mealData, updatedByUserId: req.user!.userId, updatedAt: sqliteNow() })
      .where(eq(meals.id, id))
      .returning({ id: meals.id });
    if (!updated) return false;
    await replaceMealLinks(tx, id, parsed.data);
    return true;
  });

  if (!found) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }
  res.json(await getMealById(id));
});

mealsRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const result = await db.delete(meals).where(eq(meals.id, id)).returning({ id: meals.id });
  if (result.length === 0) {
    res.status(404).json({ error: 'Meal not found' });
    return;
  }
  res.json({ ok: true });
});
