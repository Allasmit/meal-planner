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
  // ─── Enhanced fields ─────────────────────────────────────────────────────────
  cost: real('cost'),
  proteinType: text('protein_type', {
    enum: ['chicken', 'red_meat', 'pork', 'fish', 'vegetarian', 'vegan', 'other'],
  }),
  mealCategory: text('meal_category', {
    enum: ['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack'],
  }),
  leftoverBehaviour: text('leftover_behaviour', {
    enum: ['consumed_same', 'fridge_next_day', 'freezable'],
  }).notNull().default('consumed_same'),
  sourceUrl: text('source_url'),
  isFavourite: integer('is_favourite', { mode: 'boolean' }).notNull().default(false),
  isSpecialOccasion: integer('is_special_occasion', { mode: 'boolean' }).notNull().default(false),
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
    leftoversRequired: integer('leftovers_required', { mode: 'boolean' }).notNull().default(false),
    prepTimeLimitMinutes: integer('prep_time_limit_minutes'),
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

// ─── Family Members ───────────────────────────────────────────────────────────

export const familyMembers = sqliteTable('family_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role', { enum: ['Adult', 'Teen', 'Child'] }).notNull().default('Adult'),
  notes: text('notes'),
});

export const familyMemberDietaryTypes = sqliteTable(
  'family_member_dietary_types',
  {
    familyMemberId: integer('family_member_id').notNull().references(() => familyMembers.id, { onDelete: 'cascade' }),
    dietaryTypeId: integer('dietary_type_id').notNull().references(() => dietaryTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('family_member_dietary_unique').on(t.familyMemberId, t.dietaryTypeId)],
);

// ─── Meal ↔ Family Members (who can eat this meal) ────────────────────────────

export const mealSuitableFor = sqliteTable(
  'meal_suitable_for',
  {
    mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
    familyMemberId: integer('family_member_id').notNull().references(() => familyMembers.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('meal_suitable_unique').on(t.mealId, t.familyMemberId)],
);

// ─── Weekly Planner Rules ─────────────────────────────────────────────────────

export const weeklyRules = sqliteTable('weekly_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  ruleType: text('rule_type', {
    enum: ['max_protein_per_week', 'max_category_per_week', 'default_leftovers_days', 'batch_cooking_day'],
  }).notNull(),
  value: text('value').notNull(), // JSON: { protein?, category?, days?, maxCount?, dayOfWeek? }
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
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
  suitableFor: many(mealSuitableFor),
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

export const familyMembersRelations = relations(familyMembers, ({ many }) => ({
  dietaryTypes: many(familyMemberDietaryTypes),
  suitableForMeals: many(mealSuitableFor),
}));

export const familyMemberDietaryTypesRelations = relations(familyMemberDietaryTypes, ({ one }) => ({
  familyMember: one(familyMembers, { fields: [familyMemberDietaryTypes.familyMemberId], references: [familyMembers.id] }),
  dietaryType: one(dietaryTypes, { fields: [familyMemberDietaryTypes.dietaryTypeId], references: [dietaryTypes.id] }),
}));

export const mealSuitableForRelations = relations(mealSuitableFor, ({ one }) => ({
  meal: one(meals, { fields: [mealSuitableFor.mealId], references: [meals.id] }),
  familyMember: one(familyMembers, { fields: [mealSuitableFor.familyMemberId], references: [familyMembers.id] }),
}));
