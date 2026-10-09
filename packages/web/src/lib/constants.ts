import type { LeftoverBehaviour, MealCategory, ProteinType } from './types';

// One copy of the display labels/colours used by the browser, detail page, form and planner.

export const PROTEIN_LABELS: Record<ProteinType, string> = {
  chicken: '🍗 Chicken',
  red_meat: '🥩 Red Meat',
  pork: '🐷 Pork',
  fish: '🐟 Fish',
  lamb: '🐑 Lamb',
  vegetarian: '🥦 Vegetarian',
  vegan: '🌱 Vegan',
  other: '🍲 Other',
};

export const PROTEIN_COLORS: Record<ProteinType, string> = {
  chicken: '#f59e0b',
  red_meat: '#ef4444',
  pork: '#f97316',
  fish: '#3b82f6',
  lamb: '#84cc16',
  vegetarian: '#22c55e',
  vegan: '#10b981',
  other: '#8b5cf6',
};

export const CATEGORY_LABELS: Record<MealCategory, string> = {
  dinner: '🌙 Dinner',
  breakfast: '☀️ Breakfast',
  lunch: '🥪 Lunch',
  baking: '🍞 Baking',
  treat: '🍰 Treat',
  snack: '🍎 Snack',
};

export const LEFTOVER_LABELS: Record<LeftoverBehaviour, string> = {
  consumed_same: '🍽️ Consumed same meal',
  fridge_next_day: '🥡 Fridge — next day',
  freezable: '❄️ Freezable',
};

/** Typed Object.entries for the label maps above. */
export function entriesOf<K extends string>(map: Record<K, string>): [K, string][] {
  return Object.entries(map) as [K, string][];
}
