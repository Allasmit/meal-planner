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
}

export interface Ingredient {
  id: number;
  name: string;
  categoryId: number | null;
  defaultUnit: string | null;
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type ProteinType = 'chicken' | 'red_meat' | 'pork' | 'fish' | 'lamb' | 'other';
export type MealCategory = 'dinner' | 'breakfast' | 'lunch' | 'baking' | 'treat' | 'snack';
export type LeftoverBehaviour = 'consumed_same' | 'fridge_next_day' | 'freezable';

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
  assignedByUserId: number | null;
  mealName: string | null;
  mealPrepTime: number | null;
  mealCookTime: number | null;
  mealDifficulty: Difficulty | null;
  assignedByDisplayName: string | null;
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
}
