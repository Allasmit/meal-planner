import { db } from './client';
import { ingredients, ingredientCategories } from '../db/schema';
import { isNull, eq } from 'drizzle-orm';

function guessCategoryFromName(name: string): string {
  const n = name.toLowerCase();
  if (/\b(chicken|beef|pork|lamb|mince|steak|sausage|bacon|ham|turkey|veal|duck|wors|boerewors|biltong)\b/.test(n)) return 'Meat & Poultry';
  if (/\b(salmon|tuna|cod|hake|prawn|shrimp|fish|mussel|anchovy|sardine|calamari|crayfish)\b/.test(n)) return 'Seafood';
  if (/\b(milk|cream|butter|cheese|yoghurt|yogurt|egg|cheddar|mozzarella|parmesan|feta|ricotta|cream cheese)\b/.test(n)) return 'Dairy & Eggs';
  if (/\b(bread|roll|bun|tortilla|pita|naan|croissant|wrap)\b/.test(n)) return 'Bakery';
  if (/\b(cumin|paprika|turmeric|coriander seed|cinnamon|oregano|thyme|rosemary|bay leaf|chilli flakes|nutmeg|cardamom|clove|cayenne|star anise|allspice)\b/.test(n)) return 'Spices & Herbs';
  if (/\b(sauce|ketchup|mustard|mayonnaise|vinegar|soy sauce|oyster sauce|fish sauce|hot sauce|worcestershire|pesto|sriracha|hoisin)\b/.test(n)) return 'Condiments & Sauces';
  if (/\b(canned|tinned|passata|coconut milk|chickpeas|lentils|kidney beans|black beans|baked beans)\b/.test(n)) return 'Canned & Jarred';
  if (/\b(frozen)\b/.test(n)) return 'Frozen';
  if (/\b(juice|wine|beer|stock|broth|coffee|tea|cooldrink|cola)\b/.test(n)) return 'Beverages';
  if (/\b(flour|sugar|rice|pasta|noodle|oil|salt|pepper|baking powder|yeast|oats|breadcrumb|cornstarch|cornflour|honey|syrup|coconut cream)\b/.test(n)) return 'Pantry & Dry Goods';
  if (/\b(onion|garlic|carrot|potato|tomato|lettuce|spinach|kale|broccoli|pepper|celery|cucumber|mushroom|zucchini|courgette|leek|avocado|lemon|lime|apple|banana|ginger|parsley|coriander|basil|mint|spring onion|butternut|sweet potato|beetroot|cabbage|cauliflower|aubergine|eggplant|chilli|herb)\b/.test(n)) return 'Produce';
  return 'Other';
}

async function run() {
  const allCategories = await db.select().from(ingredientCategories);
  const catMap = new Map(allCategories.map((c) => [c.name, c.id]));

  const uncategorized = await db.select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(isNull(ingredients.categoryId));

  console.log(`Found ${uncategorized.length} uncategorized ingredients`);

  for (const ing of uncategorized) {
    const catName = guessCategoryFromName(ing.name);
    const catId = catMap.get(catName) ?? catMap.get('Other')!;
    await db.update(ingredients).set({ categoryId: catId }).where(eq(ingredients.id, ing.id));
    console.log(`  ${ing.name} → ${catName}`);
  }

  console.log('Done.');
}

run().catch((err) => { console.error(err); process.exit(1); });