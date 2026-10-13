export interface User {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

export interface DietaryType {
  id: number;
  name: string;
  icon: string | null;
}

export interface Cuisine {
  id: number;
  name: string;
}

export interface IngredientCategory {
  id: number;
  name: string;
  sortOrder: number;
  hiddenFromShopping: boolean;
}

export interface Ingredient {
  id: number;
  name: string;
  categoryId: number | null;
  defaultUnit: string | null;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const PROTEIN_TYPES = ['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'vegetarian', 'vegan', 'other'] as const;
export type ProteinType = (typeof PROTEIN_TYPES)[number];
export const MEAL_CATEGORIES = ['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack'] as const;
export type MealCategory = (typeof MEAL_CATEGORIES)[number];
export const LEFTOVER_BEHAVIOURS = ['consumed_same', 'fridge_next_day', 'freezable'] as const;
export type LeftoverBehaviour = (typeof LEFTOVER_BEHAVIOURS)[number];

export interface MealIngredientEntry {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  notes?: string | null;
}

export interface Meal {
  id: number;
  name: string;
  description: string | null;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  servings: number;
  difficulty: Difficulty;
  cuisineId: number | null;
  instructions: string[];
  imageUrl: string | null;
  isTested: boolean;
  notes: string | null;
  cost: number | null;
  proteinType: ProteinType | null;
  mealCategory: MealCategory | null;
  leftoverBehaviour: LeftoverBehaviour;
  sourceUrl: string | null;
  isFavourite: boolean;
  isSpecialOccasion: boolean;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  dietaryTypes: DietaryType[];
  ingredients: MealIngredientEntry[];
  suitableForMemberIds: number[];
  preferredByMemberIds: number[];
}

export interface MealPlan {
  id: number;
  planDate: string;
  mealSlot: MealSlot;
  mealId: number | null;
  servings: number;
  notes: string | null;
  /** Free-text dish with no recipe (mealId is null). */
  customName: string | null;
  /** Portions left over after this dish was eaten (0 = none recorded). */
  leftoverPortions: number;
  /** Leftover portions not yet planned into another slot. */
  leftoverRemaining: number;
  /** Set when this entry is the leftovers of another planned dish (that dish's id). */
  leftoverFromId: number | null;
  assignedByUserId: number | null;
  mealName: string | null;
  mealPrepTime: number | null;
  mealCookTime: number | null;
  mealDifficulty: Difficulty | null;
  assignedByDisplayName: string | null;
  /** Present locally only: this entry is queued for sync and not yet confirmed by the server. */
  _pendingSync?: boolean;
}

export interface ShoppingListCategory {
  categoryId: number | null;
  categoryName: string;
  sortOrder: number;
  items: {
    ingredientId: number;
    name: string;
    quantity: number;
    unit: string;
    /** An own dish, listed exactly as entered (no amount). */
    custom?: boolean;
  }[];
}

export interface MealFormData {
  name: string;
  description: string;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  servings: number;
  difficulty: Difficulty;
  cuisineId: number | null;
  instructions: string[];
  imageUrl: string;
  isTested: boolean;
  cost: number | null;
  proteinType: ProteinType | null;
  mealCategory: MealCategory | null;
  leftoverBehaviour: LeftoverBehaviour;
  sourceUrl: string;
  isFavourite: boolean;
  isSpecialOccasion: boolean;
  notes: string;
  dietaryTypeIds: number[];
  suitableForMemberIds: number[];
  preferredByMemberIds: number[];
  ingredients: {
    ingredientId: number;
    quantity: number;
    unit: string;
    notes: string;
  }[];
}

export interface MealFilters {
  search: string;
  dietaryTypeIds: number[];
  cuisineId: number | null;
  difficulty: Difficulty | '';
  prepTimeMax: number | null;
  ingredientIds: number[];
  isTested: boolean | null;
  proteinType: ProteinType | '';
  mealCategory: MealCategory | '';
  leftoverBehaviour: LeftoverBehaviour | '';
  isFavourite: boolean | null;
  isSpecialOccasion: boolean | null;
  maxCost: number | null;
  suitableForMemberIds: number[];
  preferredByMemberIds: number[];
}

export interface FamilyMember {
  id: number;
  name: string;
  role: 'Adult' | 'Teen' | 'Child';
  notes: string | null;
  dietaryTypes: DietaryType[];
}

export interface PlannerRule {
  id: number;
  label: string;
  ruleType: 'max_protein_per_week' | 'max_category_per_week' | 'default_leftovers_days' | 'batch_cooking_day';
  value: string;
  isEnabled: boolean;
}

export interface PlannerSettings {
  monthlyBudget: number | null;
  batchCookingDay: number;
  weekStartDay: number;
}

export interface FamilyMemberInput {
  name: string;
  role: FamilyMember['role'];
  notes: string | null;
  dietaryTypeIds: number[];
}

export interface CostSummary {
  weekCost: number;
  monthCost: number;
  monthlyBudget: number | null;
  /** Planned meals this week that have no cost entered, so the totals are lower bounds. */
  mealsWithoutCost: number;
}

export interface AutoGenerateRequest {
  days: {
    date: string;
    slot: MealSlot;
    prepTimeLimitMinutes?: number | null;
    leftoversRequired?: boolean;
    familyMemberIds?: number[];
  }[];
  overwriteExisting: boolean;
}

export interface AutoGenerateResult {
  generated: number;
  unfilled: number;
  suggestions: { date: string; slot: MealSlot; mealId: number | null; notes: string | null }[];
}

export interface ImportedMeal {
  id: number;
  name: string;
  ingredientCount: number;
}

export interface CsvImportResult {
  created: number;
  errors: number;
  results: { row: number; name: string; status: 'created' | 'error'; error?: string; warnings?: string[] }[];
}
