import { toBaseMeasure, formatMeasure } from './units';

export interface ShoppingRow {
  mealId: number;
  ingredientId: number;
  ingredientName: string;
  quantity: number;
  unit: string;
  categoryId: number | null;
  categoryName: string | null;
  categorySortOrder: number | null;
}

export interface ShoppingCategory {
  categoryId: number | null;
  categoryName: string;
  sortOrder: number;
  items: { ingredientId: number; name: string; quantity: number; unit: string }[];
}

export const HIDDEN_CATEGORY_NAMES = new Set([
  'Spices & Herbs',
  'Condiments & Sauces',
  'Pantry & Dry Goods',
  'Canned & Jarred',
  'Beverages',
  'Frozen',
  'Other',
]);

/**
 * Builds the grouped shopping list. `mealCounts` is how many times each meal is planned in the
 * week: a meal cooked twice needs its ingredients twice. Amounts in compatible units (g/kg,
 * ml/l, "tbsp"/"tablespoons") are summed together.
 */
export function aggregateShoppingList(
  rows: ShoppingRow[],
  mealCounts: Map<number, number>,
  showHidden: boolean,
): ShoppingCategory[] {
  const agg = new Map<
    string,
    { ingredientId: number; name: string; quantity: number; unit: string; categoryId: number | null; categoryName: string; sortOrder: number }
  >();

  for (const row of rows) {
    if (!showHidden && row.categoryName && HIDDEN_CATEGORY_NAMES.has(row.categoryName)) continue;

    const count = mealCounts.get(row.mealId) ?? 0;
    if (count === 0) continue;

    const base = toBaseMeasure(row.quantity * count, row.unit);
    const key = `${row.ingredientId}::${base.unit}`;
    const existing = agg.get(key);
    if (existing) {
      existing.quantity += base.quantity;
    } else {
      agg.set(key, {
        ingredientId: row.ingredientId,
        name: row.ingredientName,
        quantity: base.quantity,
        unit: base.unit,
        categoryId: row.categoryId ?? null,
        categoryName: row.categoryName ?? 'Other',
        sortOrder: row.categorySortOrder ?? 99,
      });
    }
  }

  const categories = new Map<string, ShoppingCategory>();
  for (const item of agg.values()) {
    const catKey = String(item.categoryId ?? 'null');
    let category = categories.get(catKey);
    if (!category) {
      category = { categoryId: item.categoryId, categoryName: item.categoryName, sortOrder: item.sortOrder, items: [] };
      categories.set(catKey, category);
    }
    const shown = formatMeasure({ quantity: item.quantity, unit: item.unit });
    category.items.push({ ingredientId: item.ingredientId, name: item.name, quantity: shown.quantity, unit: shown.unit });
  }

  return [...categories.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cat) => ({
      ...cat,
      items: cat.items.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit)),
    }));
}
