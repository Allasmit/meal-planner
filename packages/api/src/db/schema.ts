import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Reference / lookup tables ────────────────────────────────────────────────

export const dietaryTypes = sqliteTable('dietary_types', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  icon: text('icon'),
});

export const cuisines = sqliteTable('cuisines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const ingredientCategories = sqliteTable('ingredient_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// ─── Ingredients ──────────────────────────────────────────────────────────────

export const ingredients = sqliteTable('ingredients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  categoryId: integer('category_id').references(() => ingredientCategories.id),
  defaultUnit: text('default_unit'),
});

// ─── Meals ────────────────────────────────────────────────────────────────────

export const meals = sqliteTable('meals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  prepTimeMinutes: integer('prep_time_minutes').notNull().default(0),
  cookTimeMinutes: integer('cook_time_minutes').notNull().default(0),
  servings: integer('servings').notNull().default(2),
  difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).notNull().default('easy'),
  cuisineId: integer('cuisine_id').references(() => cuisines.id),
  // JSON array of instruction step strings
  instructions: text('instructions').notNull().default('[]'),
  imageUrl: text('image_url'),
  isTested: integer('is_tested', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Meal ↔ Dietary Types (junction) ─────────────────────────────────────────

export const mealDietaryTypes = sqliteTable(
  'meal_dietary_types',
  {
    mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
    dietaryTypeId: integer('dietary_type_id').notNull().references(() => dietaryTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('meal_dietary_unique').on(t.mealId, t.dietaryTypeId)],
);

// ─── Meal Ingredients ─────────────────────────────────────────────────────────

export const mealIngredients = sqliteTable('meal_ingredients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
  ingredientId: integer('ingredient_id').notNull().references(() => ingredients.id),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull(),
  notes: text('notes'),
});

// ─── Meal Plans ───────────────────────────────────────────────────────────────

export const mealPlans = sqliteTable(
  'meal_plans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    planDate: text('plan_date').notNull(), // YYYY-MM-DD
    mealSlot: text('meal_slot', {
      enum: ['breakfast', 'lunch', 'dinner', 'snack'],
    }).notNull(),
    mealId: integer('meal_id').references(() => meals.id, { onDelete: 'set null' }),
    servings: integer('servings').notNull().default(2),
    notes: text('notes'),
    assignedByUserId: integer('assigned_by_user_id').references(() => users.id),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex('meal_plan_slot_unique').on(t.planDate, t.mealSlot)],
);

// ─── User / Household Settings ────────────────────────────────────────────────

export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  createdMeals: many(meals, { relationName: 'createdBy' }),
  mealPlans: many(mealPlans),
}));

export const mealsRelations = relations(meals, ({ one, many }) => ({
  cuisine: one(cuisines, { fields: [meals.cuisineId], references: [cuisines.id] }),
  createdBy: one(users, {
    fields: [meals.createdByUserId],
    references: [users.id],
    relationName: 'createdBy',
  }),
  updatedBy: one(users, {
    fields: [meals.updatedByUserId],
    references: [users.id],
    relationName: 'updatedBy',
  }),
  mealDietaryTypes: many(mealDietaryTypes),
  mealIngredients: many(mealIngredients),
  mealPlans: many(mealPlans),
}));

export const mealDietaryTypesRelations = relations(mealDietaryTypes, ({ one }) => ({
  meal: one(meals, { fields: [mealDietaryTypes.mealId], references: [meals.id] }),
  dietaryType: one(dietaryTypes, { fields: [mealDietaryTypes.dietaryTypeId], references: [dietaryTypes.id] }),
}));

export const mealIngredientsRelations = relations(mealIngredients, ({ one }) => ({
  meal: one(meals, { fields: [mealIngredients.mealId], references: [meals.id] }),
  ingredient: one(ingredients, { fields: [mealIngredients.ingredientId], references: [ingredients.id] }),
}));

export const ingredientsRelations = relations(ingredients, ({ one, many }) => ({
  category: one(ingredientCategories, { fields: [ingredients.categoryId], references: [ingredientCategories.id] }),
  mealIngredients: many(mealIngredients),
}));

export const mealPlansRelations = relations(mealPlans, ({ one }) => ({
  meal: one(meals, { fields: [mealPlans.mealId], references: [meals.id] }),
  assignedBy: one(users, { fields: [mealPlans.assignedByUserId], references: [users.id] }),
}));
