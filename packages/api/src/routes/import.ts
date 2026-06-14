import { Router, type Response } from 'express';
import * as cheerio from 'cheerio';
import { db } from '../db/client';
import { meals, mealIngredients, ingredients, dietaryTypes, mealDietaryTypes, cuisines } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const importRouter = Router();
importRouter.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseISODuration(iso: string | undefined): number {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  return (parseInt(match[1] ?? '0') * 60) + parseInt(match[2] ?? '0');
}

function toStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((v) => typeof v === 'string' ? v : v?.text ?? v?.name ?? String(v));
  if (typeof val === 'string') return [val];
  return [];
}

interface ParsedRecipe {
  name: string;
  description: string;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  servings: number;
  instructions: string[];
  ingredientStrings: string[];
  imageUrl: string | null;
}

function extractRecipeFromJsonLd(html: string): ParsedRecipe | null {
  const $ = cheerio.load(html);
  let recipe: any = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (recipe) return;
    try {
      const data = JSON.parse($(el).html() ?? '');
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      const found = items.find((item: any) => item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe')));
      if (found) recipe = found;
    } catch { /* skip malformed JSON-LD */ }
  });

  if (!recipe) return null;

  const rawServings = recipe.recipeYield;
  const servings = Array.isArray(rawServings)
    ? parseInt(rawServings[0]) || 2
    : parseInt(rawServings) || 2;

  const steps = toStringArray(
    Array.isArray(recipe.recipeInstructions)
      ? recipe.recipeInstructions.map((s: any) => typeof s === 'string' ? s : s?.text ?? '')
      : recipe.recipeInstructions
  ).filter(Boolean);

  return {
    name: recipe.name ?? 'Imported Recipe',
    description: recipe.description ?? '',
    prepTimeMinutes: parseISODuration(recipe.prepTime),
    cookTimeMinutes: parseISODuration(recipe.cookTime),
    servings,
    instructions: steps,
    ingredientStrings: toStringArray(recipe.recipeIngredient),
    imageUrl: typeof recipe.image === 'string'
      ? recipe.image
      : recipe.image?.url ?? recipe.image?.[0]?.url ?? null,
  };
}

// ─── POST /api/import/url ─────────────────────────────────────────────────────

importRouter.post('/url', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({ url: z.string().url() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid URL' }); return; }

  let html: string;
  try {
    const response = await fetch(parsed.data.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MealPlannerBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  } catch (e: any) {
    res.status(422).json({ error: `Could not fetch URL: ${e.message}` });
    return;
  }

  const recipe = extractRecipeFromJsonLd(html);
  if (!recipe) {
    res.status(422).json({ error: 'No recipe data found on that page. The site may not support structured recipe data.' });
    return;
  }

  // Create ingredient records for any that don't exist yet
  const ingredientIds: { name: string; id: number; quantity: number; unit: string }[] = [];
  for (const raw of recipe.ingredientStrings) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Parse "2 cups flour" → quantity=2, unit=cups, name=flour (best-effort)
    const match = trimmed.match(/^([\d./½⅓⅔¼¾]+)?\s*([a-zA-Z]+)?\s+(.+)$/);
    const quantity = match?.[1] ? parseFloat(match[1]) || 1 : 1;
    const unit = match?.[2] ?? 'unit';
    const name = match?.[3] ?? trimmed;

    let [existing] = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, name)).limit(1);
    if (!existing) {
      [existing] = await db.insert(ingredients).values({ name, defaultUnit: unit }).returning({ id: ingredients.id });
    }
    ingredientIds.push({ name, id: existing.id, quantity, unit });
  }

  // Save the meal
  const [meal] = await db.insert(meals).values({
    name: recipe.name,
    description: recipe.description,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    instructions: JSON.stringify(recipe.instructions),
    imageUrl: recipe.imageUrl,
    isTested: false,
    notes: `Imported from ${parsed.data.url}`,
    createdByUserId: req.user!.userId,
    updatedByUserId: req.user!.userId,
  }).returning();

  if (ingredientIds.length > 0) {
    await db.insert(mealIngredients).values(
      ingredientIds.map((i) => ({ mealId: meal.id, ingredientId: i.id, quantity: i.quantity, unit: i.unit }))
    );
  }

  res.status(201).json({ id: meal.id, name: meal.name, ingredientCount: ingredientIds.length });
});

// ─── GET /api/import/csv-template ─────────────────────────────────────────────

importRouter.get('/csv-template', (_req: AuthRequest, res: Response): void => {
  const header = 'name,description,prep_time_minutes,cook_time_minutes,servings,difficulty,cuisine,is_tested,notes,instructions (pipe-separated),ingredients (name:quantity:unit separated by |)';
  const example = 'Spaghetti Bolognese,Classic Italian pasta,15,45,4,medium,Italian,true,Great for batch cooking,Brown the mince|Add tomatoes and simmer|Cook pasta al dente|Combine and serve,Minced beef:500:g|Spaghetti:400:g|Tinned tomatoes:400:g|Onion:1:whole|Garlic:3:cloves';
  const csv = header + '\n' + example + '\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="meal-import-template.csv"');
  res.send(csv);
});

// ─── POST /api/import/csv ──────────────────────────────────────────────────────

importRouter.post('/csv', async (req: AuthRequest, res: Response): Promise<void> => {
  const { csvText } = req.body;
  if (!csvText || typeof csvText !== 'string') {
    res.status(400).json({ error: 'csvText field required' });
    return;
  }

  const lines = csvText.split('\n').map((l: string) => l.trim()).filter(Boolean);
  if (lines.length < 2) { res.status(400).json({ error: 'CSV has no data rows' }); return; }

  // Skip header row
  const dataLines = lines.slice(1);
  const results: { row: number; name: string; status: 'created' | 'error'; error?: string }[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    // Simple CSV split (doesn't handle quoted commas — good enough for this template)
    const cols = line.split(',');
    const [
      name, description, prepStr, cookStr, servingsStr,
      difficulty, cuisineName, isTestedStr, notes,
      instructionsRaw, ingredientsRaw
    ] = cols;

    if (!name?.trim()) continue;

    try {
      // Resolve cuisine
      let cuisineId: number | null = null;
      if (cuisineName?.trim()) {
        let [c] = await db.select({ id: cuisines.id }).from(cuisines).where(eq(cuisines.name, cuisineName.trim())).limit(1);
        if (c) cuisineId = c.id;
      }

      const instructions = (instructionsRaw ?? '').split('|').map((s: string) => s.trim()).filter(Boolean);
      const ingredientParts = (ingredientsRaw ?? '').split('|').map((s: string) => s.trim()).filter(Boolean);

      const [meal] = await db.insert(meals).values({
        name: name.trim(),
        description: (description ?? '').trim(),
        prepTimeMinutes: parseInt(prepStr ?? '0') || 0,
        cookTimeMinutes: parseInt(cookStr ?? '0') || 0,
        servings: parseInt(servingsStr ?? '2') || 2,
        difficulty: (['easy', 'medium', 'hard'].includes(difficulty?.trim() ?? '') ? difficulty.trim() : 'easy') as 'easy' | 'medium' | 'hard',
        cuisineId,
        instructions: JSON.stringify(instructions),
        isTested: isTestedStr?.trim().toLowerCase() === 'true',
        notes: (notes ?? '').trim(),
        createdByUserId: req.user!.userId,
        updatedByUserId: req.user!.userId,
      }).returning();

      // Ingredients: name:quantity:unit
      for (const part of ingredientParts) {
        const [ingName, qtyStr, unit] = part.split(':');
        if (!ingName?.trim()) continue;
        let [existing] = await db.select({ id: ingredients.id }).from(ingredients)
          .where(eq(ingredients.name, ingName.trim())).limit(1);
        if (!existing) {
          [existing] = await db.insert(ingredients).values({ name: ingName.trim(), defaultUnit: unit?.trim() ?? 'unit' })
            .returning({ id: ingredients.id });
        }
        await db.insert(mealIngredients).values({
          mealId: meal.id,
          ingredientId: existing.id,
          quantity: parseFloat(qtyStr ?? '1') || 1,
          unit: unit?.trim() ?? 'unit',
        });
      }

      results.push({ row: i + 2, name: name.trim(), status: 'created' });
    } catch (e: any) {
      results.push({ row: i + 2, name: name?.trim() ?? '?', status: 'error', error: e.message });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const errors = results.filter((r) => r.status === 'error').length;
  res.json({ created, errors, results });
});

// POST /api/import/parse-html  (browser fetched the HTML, server just parses it)
importRouter.post('/parse-html', async (req: AuthRequest, res: Response): Promise<void> => {
  const { html, sourceUrl } = req.body;
  if (!html || typeof html !== 'string') {
    res.status(400).json({ error: 'html field required' });
    return;
  }

  const recipe = extractRecipeFromJsonLd(html);
  if (!recipe) {
    res.status(422).json({ error: 'No recipe data found on that page. The site may not support structured recipe data.' });
    return;
  }

  const ingredientIds: { name: string; id: number; quantity: number; unit: string }[] = [];
  for (const raw of recipe.ingredientStrings) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([\d./½⅓⅔¼¾]+)?\s*([a-zA-Z]+)?\s+(.+)$/);
    const quantity = match?.[1] ? parseFloat(match[1]) || 1 : 1;
    const unit = match?.[2] ?? 'unit';
    const name = match?.[3] ?? trimmed;
    let [existing] = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, name)).limit(1);
    if (!existing) {
      [existing] = await db.insert(ingredients).values({ name, defaultUnit: unit }).returning({ id: ingredients.id });
    }
    ingredientIds.push({ name, id: existing.id, quantity, unit });
  }

  const [meal] = await db.insert(meals).values({
    name: recipe.name,
    description: recipe.description,
    prepTimeMinutes: recipe.prepTimeMinutes,
    cookTimeMinutes: recipe.cookTimeMinutes,
    servings: recipe.servings,
    instructions: JSON.stringify(recipe.instructions),
    imageUrl: recipe.imageUrl,
    isTested: false,
    notes: sourceUrl ? `Imported from ${sourceUrl}` : 'Imported from URL',
    createdByUserId: req.user!.userId,
    updatedByUserId: req.user!.userId,
  }).returning();

  if (ingredientIds.length > 0) {
    await db.insert(mealIngredients).values(
      ingredientIds.map((i) => ({ mealId: meal.id, ingredientId: i.id, quantity: i.quantity, unit: i.unit }))
    );
  }

  res.status(201).json({ id: meal.id, name: meal.name, ingredientCount: ingredientIds.length });
});