export const PROTEIN_TYPES = ['chicken', 'red_meat', 'pork', 'fish', 'lamb', 'vegetarian', 'vegan', 'other'] as const;
export const MEAL_CATEGORIES = ['dinner', 'breakfast', 'lunch', 'baking', 'treat', 'snack'] as const;
export const LEFTOVER_BEHAVIOURS = ['consumed_same', 'fridge_next_day', 'freezable'] as const;

export type ProteinType = (typeof PROTEIN_TYPES)[number];
export type MealCategory = (typeof MEAL_CATEGORIES)[number];
export type LeftoverBehaviour = (typeof LEFTOVER_BEHAVIOURS)[number];
