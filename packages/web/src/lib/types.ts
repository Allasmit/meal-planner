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
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  dietaryTypes: DietaryType[];
  ingredients: MealIngredientEntry[];
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
  notes: string;
  dietaryTypeIds: number[];
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
}
