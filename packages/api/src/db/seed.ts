import { db } from './client';
import { dietaryTypes, cuisines, ingredientCategories } from './schema';

async function seed() {
  console.log('Seeding reference data...');

  // Dietary types
  await db
    .insert(dietaryTypes)
    .values([
      { name: 'Vegetarian', icon: '🥦' },
      { name: 'Vegan', icon: '🌱' },
      { name: 'Gluten-Free', icon: '🌾' },
      { name: 'Dairy-Free', icon: '🥛' },
      { name: 'Halal', icon: '☪️' },
      { name: 'Low-Carb', icon: '🥩' },
      { name: 'High-Protein', icon: '💪' },
      { name: 'Nut-Free', icon: '🥜' },
      { name: 'Kidney Safe', icon: '🩺' },
      { name: 'Anti-Inflammatory', icon: '🌿' },
    ])
    .onConflictDoNothing();

  // Cuisines
  await db
    .insert(cuisines)
    .values([
      { name: 'South African' },
      { name: 'Italian' },
      { name: 'Asian' },
      { name: 'Mexican' },
      { name: 'Mediterranean' },
      { name: 'American' },
      { name: 'Indian' },
      { name: 'French' },
      { name: 'Middle Eastern' },
      { name: 'Other' },
    ])
    .onConflictDoNothing();

  // Ingredient categories (sorted for shopping list display)
  await db
    .insert(ingredientCategories)
    .values([
      { name: 'Produce', sortOrder: 1 },
      { name: 'Meat & Poultry', sortOrder: 2 },
      { name: 'Seafood', sortOrder: 3 },
      { name: 'Dairy & Eggs', sortOrder: 4 },
      { name: 'Bakery', sortOrder: 5 },
      // Pantry-style categories are hidden from the shopping list by default (see migration 0008).
      { name: 'Pantry & Dry Goods', sortOrder: 6, hiddenFromShopping: true },
      { name: 'Canned & Jarred', sortOrder: 7, hiddenFromShopping: true },
      { name: 'Condiments & Sauces', sortOrder: 8, hiddenFromShopping: true },
      { name: 'Spices & Herbs', sortOrder: 9, hiddenFromShopping: true },
      { name: 'Frozen', sortOrder: 10, hiddenFromShopping: true },
      { name: 'Beverages', sortOrder: 11, hiddenFromShopping: true },
      { name: 'Other', sortOrder: 99, hiddenFromShopping: true },
    ])
    .onConflictDoNothing();

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
