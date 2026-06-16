import { Router, type Response } from 'express';
import * as cheerio from 'cheerio';
import { db } from '../db/client';
import {
  meals,
  mealIngredients,
  ingredients,
  dietaryTypes,
  mealDietaryTypes,
  cuisines,
  mealSuitableFor,
  familyMembers,
} from '../db/schema';
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

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: '-',
  mdash: '-',
  frac12: '1/2',
  frac14: '1/4',
  frac34: '3/4',
};

function decodeHtmlEntities(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return HTML_ENTITY_MAP[entity] ?? match;
  });
}

function normalizeMealCategory(value: string | null | undefined): 'dinner' | 'breakfast' | 'lunch' | 'baking' | 'treat' | 'snack' | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();

  if (['dinner', 'dinners', 'main course', 'main courses', 'entree', 'entrees', 'supper'].includes(normalized)) return 'dinner';
  if (['breakfast', 'breakfasts', 'brunch'].includes(normalized)) return 'breakfast';
  if (['lunch', 'lunches'].includes(normalized)) return 'lunch';
  if (['baking', 'bake', 'bakes', 'baked goods'].includes(normalized)) return 'baking';
  if (['treat', 'treats', 'dessert', 'desserts', 'sweet', 'sweets', 'pudding', 'puddings'].includes(normalized)) return 'treat';
  if (['snack', 'snacks'].includes(normalized)) return 'snack';

  return null;
}

type CsvCell = string | number | boolean | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsvRow(values: CsvCell[]): string {
  return values.map(escapeCsvCell).join(',');
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
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
  cuisine: string | null;
  mealCategory: string | null;
  dietaryTypeNames: string[];
  estimatedCost: number | null;
}

function extractRecipeImage($: cheerio.CheerioAPI, recipe: any): string | null {
  const jsonLdImage =
    typeof recipe.image === 'string'
      ? recipe.image
      : recipe.image?.url ?? recipe.image?.[0]?.url ?? null;

  if (jsonLdImage) return jsonLdImage;

  return firstNonEmpty([
    $('meta[property="og:image"]').attr('content'),
    $('meta[property="og:image:secure_url"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('meta[name="twitter:image:src"]').attr('content'),
    $('link[rel="image_src"]').attr('href'),
  ]);
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normalizeExtractedText(value: string | null | undefined): string {
  return decodeHtmlEntities((value ?? '').replace(/\s+/g, ' ').trim());
}

function findRecipeContainer($: cheerio.CheerioAPI) {
  const selectors = [
    '.wprm-recipe-container',
    '.wprm-recipe',
    '.tasty-recipes',
    '.mv-recipe-card',
    '.mv-create',
    '.recipe-card',
    '.easyrecipe',
    '.zrdn-recipe-container',
    '[itemtype*="Recipe"]',
    '[itemscope][itemtype*="Recipe"]',
    'article',
    'main',
  ];

  for (const selector of selectors) {
    const match = $(selector).first();
    if (match.length) return match;
  }

  return $.root();
}

function readFirstText(root: any, selectors: string[]): string | null {
  for (const selector of selectors) {
    const match = root.find(selector).first();
    if (!match.length) continue;

    const text = normalizeExtractedText(match.text());
    if (text) return text;
  }

  return null;
}

function readFirstAttr(root: any, selectors: string[], attr: string): string | null {
  for (const selector of selectors) {
    const match = root.find(selector).first();
    if (!match.length) continue;

    const value = match.attr(attr)?.trim();
    if (value) return value;
  }

  return null;
}

function collectTexts($: cheerio.CheerioAPI, root: any, selectors: string[]): string[] {
  const values: string[] = [];

  for (const selector of selectors) {
    root.find(selector).each((_, el) => {
      const text = normalizeExtractedText($(el).text());
      if (text) values.push(text);
    });
  }

  return values;
}

function collectSectionTexts(
  $: cheerio.CheerioAPI,
  root: any,
  headingPattern: RegExp,
  itemSelectors: string[]
): string[] {
  const values: string[] = [];

  root.find('h1,h2,h3,h4,h5,h6,strong,b').each((_, el) => {
    const heading = normalizeExtractedText($(el).text());
    if (!headingPattern.test(heading)) return;

    let current = $(el).next();
    let safety = 0;

    while (current.length && safety < 20) {
      const tagName = String((current[0] as any)?.tagName ?? '').toLowerCase();
      if (/^h[1-6]$/.test(tagName)) break;

      if (current.is('ul,ol')) {
        current.find('li').each((__, item) => {
          const text = normalizeExtractedText($(item).text());
          if (text) values.push(text);
        });
      } else {
        const text = normalizeExtractedText(current.text());
        if (text && !/^(ingredients?|instructions?|directions?|method)$/i.test(text)) {
          values.push(text);
        }
      }

      current = current.next();
      safety++;
    }
  });

  const directMatches = collectTexts($, root, itemSelectors);
  return Array.from(new Set([...values, ...directMatches])).filter(Boolean);
}
function parseRecipeObject($: cheerio.CheerioAPI, recipe: any): ParsedRecipe {
  const name = normalizeExtractedText(recipe.name) || 'Imported Recipe';
  const description = normalizeExtractedText(
    typeof recipe.description === 'string' ? recipe.description : '',
  );

  const prepTimeMinutes = parseISODuration(recipe.prepTime);
  const cookTimeMinutes = parseISODuration(recipe.cookTime ?? recipe.totalTime);

  let servings = 2;
  const yieldRaw = recipe.recipeYield;
  if (yieldRaw) {
    const yieldStr = Array.isArray(yieldRaw) ? yieldRaw[0] : yieldRaw;
    const yieldNum = parseInt(String(yieldStr), 10);
    if (yieldNum > 0) servings = yieldNum;
  }

  const rawInstructions = recipe.recipeInstructions;
  const instructions: string[] = [];
  if (Array.isArray(rawInstructions)) {
    for (const step of rawInstructions) {
      if (typeof step === 'string') {
        const text = normalizeExtractedText(step);
        if (text) instructions.push(text);
      } else if (step?.['@type'] === 'HowToSection' && Array.isArray(step.itemListElement)) {
        for (const sub of step.itemListElement) {
          const text = normalizeExtractedText(sub.text ?? sub.name);
          if (text) instructions.push(text);
        }
      } else if (step) {
        const text = normalizeExtractedText(step.text ?? step.name ?? String(step));
        if (text) instructions.push(text);
      }
    }
  } else if (typeof rawInstructions === 'string') {
    const text = normalizeExtractedText(rawInstructions);
    if (text) instructions.push(text);
  }

  const ingredientStrings = toStringArray(recipe.recipeIngredient)
    .map(normalizeExtractedText)
    .filter(Boolean);

  const imageUrl = extractRecipeImage($, recipe);

  const cuisineRaw = Array.isArray(recipe.recipeCuisine)
    ? recipe.recipeCuisine[0]
    : recipe.recipeCuisine;
  const cuisine = cuisineRaw ? normalizeExtractedText(String(cuisineRaw)) : null;

  const categoryRaw = Array.isArray(recipe.recipeCategory)
    ? recipe.recipeCategory[0]
    : (recipe.recipeCategory ?? recipe.recipeType);
  const mealCategory = normalizeMealCategory(categoryRaw);

  const dietaryTypeNames: string[] = [];
  for (const diet of toStringArray(recipe.suitableForDiet)) {
    const lower = diet.toLowerCase().replace(/https?:\/\/schema\.org\//i, '');
    if (lower.includes('glutenfree') || lower.includes('gluten-free')) dietaryTypeNames.push('Gluten Free');
    if (lower.includes('dairyfree') || lower.includes('dairy-free')) dietaryTypeNames.push('Dairy Free');
    if (lower.includes('vegan')) dietaryTypeNames.push('Vegan');
    if (lower.includes('vegetarian')) dietaryTypeNames.push('Vegetarian');
  }

  let estimatedCost: number | null = null;
  if (recipe.estimatedCost != null) {
    const costVal =
      typeof recipe.estimatedCost === 'object'
        ? recipe.estimatedCost.value
        : recipe.estimatedCost;
    const parsed = parseFloat(String(costVal));
    if (Number.isFinite(parsed)) estimatedCost = parsed;
  }

  return {
    name,
    description,
    prepTimeMinutes,
    cookTimeMinutes,
    servings,
    instructions,
    ingredientStrings,
    imageUrl,
    cuisine,
    mealCategory,
    dietaryTypeNames,
    estimatedCost,
  };
}

function findRecipeInLd(data: any): any {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
    return null;
  }
  const type = data['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
    return data;
  }
  if (Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      const found = findRecipeInLd(item);
      if (found) return found;
    }
  }
  return null;
}

function extractRecipeFromJsonLd(html: string): ParsedRecipe | null {
  const $ = cheerio.load(html);
  let result: ParsedRecipe | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return; // already found one
    const content = $(el).html();
    if (!content) return;
    try {
      const data = JSON.parse(content);
      const recipe = findRecipeInLd(data);
      if (recipe) result = parseRecipeObject($, recipe);
    } catch {
      // malformed JSON — skip
    }
  });

  return result;
}

function extractRecipeFromMicrodata(html: string): ParsedRecipe | null {
  const $ = cheerio.load(html);
  const recipeEl = $('[itemtype*="schema.org/Recipe"]').first();
  if (!recipeEl.length) return null;

  const getProp = (prop: string): string =>
    normalizeExtractedText(
      recipeEl.find(`[itemprop="${prop}"]`).first().attr('content') ??
      recipeEl.find(`[itemprop="${prop}"]`).first().text(),
    );

  const getAllProp = (prop: string): string[] => {
    const results: string[] = [];
    recipeEl.find(`[itemprop="${prop}"]`).each((_, el) => {
      const text = normalizeExtractedText($(el).attr('content') ?? $(el).text());
      if (text) results.push(text);
    });
    return results;
  };

  const name = getProp('name');
  if (!name) return null;

  const prepTimeEl = recipeEl.find('[itemprop="prepTime"]').first();
  const cookTimeEl = recipeEl.find('[itemprop="cookTime"]').first();

  const recipe = {
    name,
    description: getProp('description'),
    prepTime: prepTimeEl.attr('datetime') ?? prepTimeEl.attr('content'),
    cookTime: cookTimeEl.attr('datetime') ?? cookTimeEl.attr('content'),
    recipeYield: getProp('recipeYield'),
    recipeIngredient: getAllProp('recipeIngredient'),
    recipeInstructions: getAllProp('recipeInstructions'),
    recipeCuisine: getProp('recipeCuisine'),
    recipeCategory: getProp('recipeCategory'),
    image:
      recipeEl.find('[itemprop="image"]').first().attr('src') ??
      recipeEl.find('[itemprop="image"]').first().attr('content'),
    suitableForDiet: getAllProp('suitableForDiet'),
    estimatedCost: undefined,
  };

  if (!recipe.recipeIngredient.length && !recipe.recipeInstructions.length) return null;

  return parseRecipeObject($, recipe);
}

function extractRecipeFromDomFallback(html: string): ParsedRecipe | null {
  const $ = cheerio.load(html);
  const container = findRecipeContainer($);

  const title =
    readFirstText(container, [
      '.wprm-recipe-name',
      '.tasty-recipes-title',
      '.mv-create-title',
      '.recipe-title',
      '.entry-title',
      '.post-title',
      '[class*="recipe"] h1',
      'h1',
    ]) ??
    readFirstText($.root(), ['title']) ??
    'Imported Recipe';

  const description =
    readFirstAttr(container, ['meta[property="og:description"]', 'meta[name="description"]'], 'content') ??
    readFirstText(container, [
      '.wprm-recipe-summary',
      '.tasty-recipes-description',
      '.recipe-summary',
      '.recipe-description',
      '.summary',
      '.description',
      'article p',
      'main p',
    ]) ??
    '';

  const imageUrl = firstNonEmpty([
    readFirstAttr(container, ['meta[property="og:image"]', 'meta[property="og:image:secure_url"]', 'meta[name="twitter:image"]'], 'content'),
    readFirstAttr(container, ['.wprm-recipe-image img', '.tasty-recipes-image img', '.recipe-image img', '.entry-content img', 'article img'], 'src'),
    readFirstAttr(container, ['.wprm-recipe-image img', '.tasty-recipes-image img', '.recipe-image img', '.entry-content img', 'article img'], 'data-src'),
  ]);

  const ingredientStrings = Array.from(
    new Set([
      ...collectTexts($, container, [
        '[itemprop="recipeIngredient"]',
        '.wprm-recipe-ingredient',
        '.wprm-recipe-ingredient-group li',
        '.tasty-recipes-ingredients li',
        '.mv-ingredient',
        '.mv-create-ingredients li',
        '.easyrecipe-ingredient',
        '.zrdn-ingredient',
        '.ingredients li',
        '.recipe-ingredients li',
        '[class*="ingredient"] li',
      ]),
      ...collectSectionTexts($, container, /ingredients?/i, [
        '.wprm-recipe-ingredient',
        '.wprm-recipe-ingredient-group li',
        '.tasty-recipes-ingredients li',
        '.mv-create-ingredients li',
        '.ingredients li',
        '.recipe-ingredients li',
        '[class*="ingredient"] li',
      ]),
    ])
  )
    .map((value) => normalizeExtractedText(value))
    .filter((value) => value.length > 2)
    .filter((value) => !/^(print|share|save|jump to recipe|ingredients?)$/i.test(value))
    .slice(0, 100);

  const instructions = Array.from(
    new Set([
      ...collectTexts($, container, [
        '[itemprop="recipeInstructions"]',
        '.wprm-recipe-instruction',
        '.wprm-recipe-instruction-group li',
        '.tasty-recipes-instructions li',
        '.mv-instruction',
        '.mv-create-directions li',
        '.easyrecipe-instruction',
        '.zrdn-instruction',
        '.instructions li',
        '.method li',
        '.directions li',
        '.direction li',
        '[class*="instruction"] li',
        '[class*="direction"] li',
      ]),
      ...collectSectionTexts($, container, /instructions?|directions?|method|how to make/i, [
        '.wprm-recipe-instruction',
        '.wprm-recipe-instruction-group li',
        '.tasty-recipes-instructions li',
        '.mv-create-directions li',
        '.instructions li',
        '.method li',
        '.directions li',
        '.direction li',
        '[class*="instruction"] li',
        '[class*="direction"] li',
      ]),
    ])
  )
    .map((value) => normalizeExtractedText(value))
    .filter(Boolean)
    .slice(0, 50);

  if (ingredientStrings.length === 0 && instructions.length === 0) return null;

  return parseRecipeObject($, {
    name: title,
    description,
    prepTime: undefined,
    cookTime: undefined,
    recipeYield: '2',
    recipeCuisine: undefined,
    recipeCategory: undefined,
    recipeType: undefined,
    suitableForDiet: [],
    recipeInstructions: instructions,
    recipeIngredient: ingredientStrings,
    image: imageUrl ?? undefined,
    estimatedCost: undefined,
  });
}

function extractRecipeFromHtml(html: string): ParsedRecipe | null {
  return extractRecipeFromJsonLd(html) ?? extractRecipeFromMicrodata(html) ?? extractRecipeFromDomFallback(html);
}

// ─── POST /api/import/url ─────────────────────────────────────────────────────

importRouter.post('/url', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    url: z.string().url(),
    sourceUrl: z.string().url().optional(),
    cost: z.number().min(0).optional().nullable(),
    proteinType: z.enum(['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'other']).optional().nullable(),
    mealCategory: z.enum(['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack']).optional().nullable(),
    leftoverBehaviour: z.enum(['consumed_same', 'fridge_next_day', 'freezable']).optional(),
    isFavourite: z.boolean().optional(),
    isSpecialOccasion: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  let html: string;
  try {
    const response = await fetch(parsed.data.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if ([402, 403, 429].includes(response.status)) {
        res.status(422).json({
          error: `This site blocked the import (HTTP ${response.status}). Open the recipe page in your browser, copy the page HTML (Ctrl+U or right-click → View Page Source), then use the "Paste Page HTML" import method instead.`,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
      return;
    }
    html = await response.text();
  } catch (e: any) {
    res.status(422).json({ error: `Could not fetch URL: ${e.message}` });
    return;
  }

  const recipe = extractRecipeFromHtml(html);
  if (!recipe) {
    res.status(422).json({ error: 'No supported recipe data found on that page. The site may not expose JSON-LD, microdata, or usable recipe markup.' });
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

  try {
    const [meal] = await db.insert(meals).values({
      name: recipe.name,
      description: recipe.description,
      prepTimeMinutes: recipe.prepTimeMinutes,
      cookTimeMinutes: recipe.cookTimeMinutes,
      servings: recipe.servings,
      instructions: JSON.stringify(recipe.instructions),
      imageUrl: recipe.imageUrl,
      isTested: false,
      sourceUrl: parsed.data.sourceUrl ?? parsed.data.url,
      cost: parsed.data.cost ?? recipe.estimatedCost ?? null,
      mealCategory: parsed.data.mealCategory ?? recipe.mealCategory ?? null,
      proteinType: parsed.data.proteinType ?? null,
      leftoverBehaviour: parsed.data.leftoverBehaviour ?? 'consumed_same',
      isFavourite: parsed.data.isFavourite ?? false,
      isSpecialOccasion: parsed.data.isSpecialOccasion ?? false,
      notes: `Imported from ${parsed.data.url}`,
      createdByUserId: req.user!.userId,
      updatedByUserId: req.user!.userId,
    }).returning();

    if (ingredientIds.length > 0) {
      await db.insert(mealIngredients).values(
        ingredientIds.map((i) => ({ mealId: meal.id, ingredientId: i.id, quantity: i.quantity, unit: i.unit }))
      );
    }

    if (recipe.cuisine) {
      const [cuisine] = await db
        .select({ id: cuisines.id })
        .from(cuisines)
        .where(eq(cuisines.name, recipe.cuisine))
        .limit(1);

      if (cuisine) {
        await db.update(meals).set({ cuisineId: cuisine.id }).where(eq(meals.id, meal.id));
      }
    }

    if (recipe.dietaryTypeNames.length > 0) {
      for (const dietaryTypeName of recipe.dietaryTypeNames) {
        const [dietaryType] = await db
          .select({ id: dietaryTypes.id })
          .from(dietaryTypes)
          .where(eq(dietaryTypes.name, dietaryTypeName))
          .limit(1);

        if (dietaryType) {
          await db.insert(mealDietaryTypes).values({
            mealId: meal.id,
            dietaryTypeId: dietaryType.id,
          });
        }
      }
    }

    res.status(201).json({ id: meal.id, name: meal.name, ingredientCount: ingredientIds.length });
  } catch (error: any) {
    console.error(error);
    res.status(422).json({
      error: error?.cause?.message ?? error?.message ?? 'Failed to import recipe',
    });
  }
});

// ─── GET /api/import/csv-template ─────────────────────────────────────────────

importRouter.get('/csv-template', (_req: AuthRequest, res: Response): void => {
  const header = toCsvRow([
    'name',
    'description',
    'prep_time_minutes',
    'cook_time_minutes',
    'servings',
    'difficulty',
    'cuisine',
    'cost',
    'protein_type',
    'meal_category',
    'leftover_behaviour',
    'source_url',
    'image_url',
    'is_tested',
    'is_favourite',
    'is_special_occasion',
    'notes',
    'dietary_types (pipe-separated names)',
    'suitable_for (pipe-separated family member names)',
    'instructions (pipe-separated)',
    'ingredients (name:quantity:unit[:notes] separated by |)',
  ]);

  const example = toCsvRow([
    'Spaghetti Bolognese',
    'Classic Italian pasta',
    15,
    45,
    4,
    'medium',
    'Italian',
    120,
    'red_meat',
    'dinner',
    'fridge_next_day',
    'https://example.com/spaghetti',
    'https://example.com/spaghetti.jpg',
    true,
    true,
    false,
    'Great for batch cooking',
    'Gluten Free|Dairy Free',
    'Mom|Dad',
    'Brown the mince|Add tomatoes and simmer|Cook pasta al dente|Combine and serve',
    'Minced beef:500:g|Spaghetti:400:g|Tinned tomatoes:400:g|Onion:1:whole|Garlic:3:cloves',
  ]);

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

  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    res.status(400).json({ error: 'CSV has no data rows' });
    return;
  }

  const parseBool = (value: string | undefined): boolean => {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  };

  const parseOptionalNumber = (value: string | undefined): number | null => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const splitPipe = (value: string | undefined): string[] => {
    return (value ?? '')
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
  };

  const normalizeOrNull = (value: string | undefined): string | null => {
    const trimmed = (value ?? '').trim();
    return trimmed ? trimmed : null;
  };

  const dataLines = lines.slice(1);
  const results: { row: number; name: string; status: 'created' | 'error'; error?: string }[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const cols = parseCsvLine(line);

    const [
      name,
      description,
      prepStr,
      cookStr,
      servingsStr,
      difficulty,
      cuisineName,
      costStr,
      proteinType,
      mealCategory,
      leftoverBehaviour,
      sourceUrl,
      imageUrl,
      isTestedStr,
      isFavouriteStr,
      isSpecialOccasionStr,
      notes,
      dietaryTypesRaw,
      suitableForRaw,
      instructionsRaw,
      ingredientsRaw,
    ] = cols;

    if (!name?.trim()) continue;

    try {
      let cuisineId: number | null = null;
      if (cuisineName?.trim()) {
        const [c] = await db
          .select({ id: cuisines.id })
          .from(cuisines)
          .where(eq(cuisines.name, cuisineName.trim()))
          .limit(1);
        if (c) cuisineId = c.id;
      }

      const instructions = splitPipe(instructionsRaw);
      const ingredientParts = splitPipe(ingredientsRaw);
      const dietaryTypeNames = splitPipe(dietaryTypesRaw);
      const suitableForNames = splitPipe(suitableForRaw);

      const allowedProteinTypes = new Set(['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'other']);
      const allowedMealCategories = new Set(['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack']);
      const allowedLeftoverBehaviours = new Set(['consumed_same', 'fridge_next_day', 'freezable']);

      const proteinTypeValue = normalizeOrNull(proteinType);
      const mealCategoryValue = normalizeMealCategory(normalizeOrNull(mealCategory));
      const leftoverBehaviourValue = normalizeOrNull(leftoverBehaviour);

      const [meal] = await db.insert(meals).values({
        name: name.trim(),
        description: normalizeOrNull(description),
        prepTimeMinutes: parseInt(prepStr ?? '0', 10) || 0,
        cookTimeMinutes: parseInt(cookStr ?? '0', 10) || 0,
        servings: parseInt(servingsStr ?? '2', 10) || 2,
        difficulty: (['easy', 'medium', 'hard'].includes(difficulty?.trim() ?? '') ? difficulty.trim() : 'easy') as 'easy' | 'medium' | 'hard',
        cuisineId,
        instructions: JSON.stringify(instructions),
        cost: parseOptionalNumber(costStr),
        proteinType: proteinTypeValue && allowedProteinTypes.has(proteinTypeValue)
          ? proteinTypeValue as 'chicken' | 'red_meat' | 'pork' | 'fish' | 'lamb' | 'other'
          : null,
        mealCategory: mealCategoryValue && allowedMealCategories.has(mealCategoryValue) ? mealCategoryValue : null,
        leftoverBehaviour: leftoverBehaviourValue && allowedLeftoverBehaviours.has(leftoverBehaviourValue)
          ? leftoverBehaviourValue as 'consumed_same' | 'fridge_next_day' | 'freezable'
          : 'consumed_same',
        sourceUrl: normalizeOrNull(sourceUrl),
        imageUrl: normalizeOrNull(imageUrl),
        isTested: parseBool(isTestedStr),
        isFavourite: parseBool(isFavouriteStr),
        isSpecialOccasion: parseBool(isSpecialOccasionStr),
        notes: normalizeOrNull(notes),
        createdByUserId: req.user!.userId,
        updatedByUserId: req.user!.userId,
      }).returning();

      for (const part of ingredientParts) {
        const [ingName, qtyStr, unit, ...noteParts] = part.split(':');
        if (!ingName?.trim()) continue;

        let [existing] = await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(eq(ingredients.name, ingName.trim()))
          .limit(1);

        if (!existing) {
          [existing] = await db
            .insert(ingredients)
            .values({
              name: ingName.trim(),
              defaultUnit: unit?.trim() ?? 'unit',
            })
            .returning({ id: ingredients.id });
        }

        await db.insert(mealIngredients).values({
          mealId: meal.id,
          ingredientId: existing.id,
          quantity: parseFloat(qtyStr ?? '1') || 1,
          unit: unit?.trim() ?? 'unit',
          notes: noteParts.length > 0 ? noteParts.join(':').trim() : undefined,
        });
      }

      for (const dietaryTypeName of dietaryTypeNames) {
        const [dietaryType] = await db
          .select({ id: dietaryTypes.id })
          .from(dietaryTypes)
          .where(eq(dietaryTypes.name, dietaryTypeName))
          .limit(1);

        if (dietaryType) {
          await db.insert(mealDietaryTypes).values({
            mealId: meal.id,
            dietaryTypeId: dietaryType.id,
          });
        }
      }

      for (const memberName of suitableForNames) {
        const [member] = await db
          .select({ id: familyMembers.id })
          .from(familyMembers)
          .where(eq(familyMembers.name, memberName))
          .limit(1);

        if (member) {
          await db.insert(mealSuitableFor).values({
            mealId: meal.id,
            familyMemberId: member.id,
          });
        }
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
  const schema = z.object({
    html: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    cost: z.number().min(0).optional().nullable(),
    proteinType: z.enum(['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'other']).optional().nullable(),
    mealCategory: z.enum(['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack']).optional().nullable(),
    leftoverBehaviour: z.enum(['consumed_same', 'fridge_next_day', 'freezable']).optional(),
    isFavourite: z.boolean().optional(),
    isSpecialOccasion: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'html field required' });
    return;
  }

  const { html, sourceUrl } = parsed.data;

  const recipe = extractRecipeFromHtml(html);
  if (!recipe) {
    res.status(422).json({ error: 'No supported recipe data found on that page. The site may not expose JSON-LD, microdata, or usable recipe markup.' });
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

  try {
    const [meal] = await db.insert(meals).values({
      name: recipe.name,
      description: recipe.description,
      prepTimeMinutes: recipe.prepTimeMinutes,
      cookTimeMinutes: recipe.cookTimeMinutes,
      servings: recipe.servings,
      instructions: JSON.stringify(recipe.instructions),
      imageUrl: recipe.imageUrl,
      isTested: false,
      sourceUrl: sourceUrl ?? null,
      cuisineId: null,
      cost: parsed.data.cost ?? recipe.estimatedCost ?? null,
      mealCategory: parsed.data.mealCategory ?? recipe.mealCategory ?? null,
      proteinType: parsed.data.proteinType ?? null,
      leftoverBehaviour: parsed.data.leftoverBehaviour ?? 'consumed_same',
      isFavourite: parsed.data.isFavourite ?? false,
      isSpecialOccasion: parsed.data.isSpecialOccasion ?? false,
      notes: sourceUrl ? `Imported from ${sourceUrl}` : 'Imported from URL',
      createdByUserId: req.user!.userId,
      updatedByUserId: req.user!.userId,
    }).returning();

    if (ingredientIds.length > 0) {
      await db.insert(mealIngredients).values(
        ingredientIds.map((i) => ({ mealId: meal.id, ingredientId: i.id, quantity: i.quantity, unit: i.unit }))
      );
    }

    if (recipe.cuisine) {
      const [cuisine] = await db
        .select({ id: cuisines.id })
        .from(cuisines)
        .where(eq(cuisines.name, recipe.cuisine))
        .limit(1);

      if (cuisine) {
        await db.update(meals).set({ cuisineId: cuisine.id }).where(eq(meals.id, meal.id));
      }
    }

    if (recipe.dietaryTypeNames.length > 0) {
      for (const dietaryTypeName of recipe.dietaryTypeNames) {
        const [dietaryType] = await db
          .select({ id: dietaryTypes.id })
          .from(dietaryTypes)
          .where(eq(dietaryTypes.name, dietaryTypeName))
          .limit(1);

        if (dietaryType) {
          await db.insert(mealDietaryTypes).values({
            mealId: meal.id,
            dietaryTypeId: dietaryType.id,
          });
        }
      }
    }

    res.status(201).json({ id: meal.id, name: meal.name, ingredientCount: ingredientIds.length });
  } catch (error: any) {
    console.error(error);
    res.status(422).json({
      error: error?.cause?.message ?? error?.message ?? 'Failed to import recipe',
    });
  }
});