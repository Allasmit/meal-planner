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
      { name: 'Pantry & Dry Goods', sortOrder: 6 },
      { name: 'Canned & Jarred', sortOrder: 7 },
      { name: 'Condiments & Sauces', sortOrder: 8 },
      { name: 'Spices & Herbs', sortOrder: 9 },
      { name: 'Frozen', sortOrder: 10 },
      { name: 'Beverages', sortOrder: 11 },
      { name: 'Other', sortOrder: 99 },
    ])
    .onConflictDoNothing();

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
