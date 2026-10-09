export const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Slot = (typeof SLOT_ORDER)[number];

export interface GeneratorMeal {
  id: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  proteinType: string | null;
  mealCategory: string | null;
  leftoverBehaviour: string;
  isFavourite: boolean;
  isSpecialOccasion: boolean;
  /** Empty means "no restriction recorded", i.e. suitable for everyone. */
  suitableForMemberIds: number[];
  preferredByMemberIds: number[];
}

export interface GeneratorDay {
  date: string; // YYYY-MM-DD
  slot: Slot;
  prepTimeLimitMinutes?: number | null;
  leftoversRequired?: boolean;
  familyMemberIds?: number[];
}

export interface GeneratorRules {
  proteinLimits: Record<string, number>;
  categoryLimits: Record<string, number>;
  defaultLeftoversDays: number[];
  /** 0 = Sunday ... 6 = Saturday */
  batchCookingDay: number | null;
}

export interface ExistingPlan {
  date: string;
  slot: Slot;
  mealId: number | null;
}

export interface Suggestion {
  date: string;
  slot: Slot;
  mealId: number | null;
  leftoversRequired: boolean;
  prepTimeLimitMinutes: number | null;
}

export interface GenerateInput {
  days: GeneratorDay[];
  meals: GeneratorMeal[];
  rules: GeneratorRules;
  existing: ExistingPlan[];
  overwriteExisting: boolean;
  random?: () => number;
}

const SLOT_CATEGORIES: Record<Slot, string[]> = {
  breakfast: ['breakfast'],
  lunch: ['lunch', 'dinner'],
  dinner: ['dinner'],
  snack: ['snack', 'treat', 'baking'],
};

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Picks a meal for each requested day/slot.
 *
 * Hard rules (a meal that breaks one is never chosen): the slot's time limit, weekly protein and category caps
 * (counting meals already planned and kept), and suitability for the family members eating that meal.
 * Everything else is a score, so a slot is still filled when the library is small: slot/category fit, favourites,
 * variety (no repeats, different protein from the previous day), members' preferences, leftovers on days that
 * need them, and batch-cooking friendliness on the batch day.
 */
export function generatePlan(input: GenerateInput): Suggestion[] {
  const random = input.random ?? Math.random;
  const { rules } = input;
  const mealById = new Map(input.meals.map((m) => [m.id, m]));

  const existingBySlot = new Map(input.existing.filter((p) => p.mealId !== null).map((p) => [`${p.date}::${p.slot}`, p]));
  const days = [...input.days].sort(
    (a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );

  const targetKeys = new Set(days.map((d) => `${d.date}::${d.slot}`));
  const proteinUsed: Record<string, number> = {};
  const categoryUsed: Record<string, number> = {};
  const timesUsed = new Map<number, number>();
  const lastProteinForSlot = new Map<Slot, string | null>();

  const count = (meal: GeneratorMeal) => {
    if (meal.proteinType) proteinUsed[meal.proteinType] = (proteinUsed[meal.proteinType] ?? 0) + 1;
    if (meal.mealCategory) categoryUsed[meal.mealCategory] = (categoryUsed[meal.mealCategory] ?? 0) + 1;
    timesUsed.set(meal.id, (timesUsed.get(meal.id) ?? 0) + 1);
  };

  // Everything already on the plan that we are NOT replacing still counts towards the weekly caps.
  for (const plan of input.existing) {
    const replacing = targetKeys.has(`${plan.date}::${plan.slot}`) && (input.overwriteExisting || plan.mealId === null);
    const meal = plan.mealId !== null ? mealById.get(plan.mealId) : undefined;
    if (meal && !replacing) count(meal);
  }

  const suggestions: Suggestion[] = [];

  for (const day of days) {
    const existing = existingBySlot.get(`${day.date}::${day.slot}`);
    if (existing && existing.mealId !== null && !input.overwriteExisting) continue;

    const dow = dayOfWeek(day.date);
    const leftoversNeeded = day.leftoversRequired ?? rules.defaultLeftoversDays.includes(dow);
    const members = day.familyMemberIds ?? [];

    const candidates = input.meals.filter((m) => {
      if (day.prepTimeLimitMinutes && m.prepTimeMinutes + m.cookTimeMinutes > day.prepTimeLimitMinutes) return false;
      if (m.proteinType && rules.proteinLimits[m.proteinType] !== undefined && (proteinUsed[m.proteinType] ?? 0) >= rules.proteinLimits[m.proteinType]) return false;
      if (m.mealCategory && rules.categoryLimits[m.mealCategory] !== undefined && (categoryUsed[m.mealCategory] ?? 0) >= rules.categoryLimits[m.mealCategory]) return false;
      if (members.length > 0 && m.suitableForMemberIds.length > 0 && !members.every((id) => m.suitableForMemberIds.includes(id))) return false;
      return true;
    });

    let best: GeneratorMeal | null = null;
    let bestScore = -Infinity;
    for (const meal of candidates) {
      let score = random() * 1.5;
      const slotCategories = SLOT_CATEGORIES[day.slot];
      if (meal.mealCategory) score += slotCategories.includes(meal.mealCategory) ? 3 : -3;
      if (meal.isFavourite) score += 1.5;
      if (meal.isSpecialOccasion) score -= 2;
      score -= 4 * (timesUsed.get(meal.id) ?? 0);
      if (meal.proteinType && meal.proteinType === lastProteinForSlot.get(day.slot)) score -= 2;
      score += members.filter((id) => meal.preferredByMemberIds.includes(id)).length;
      if (day.slot === 'dinner' && leftoversNeeded) score += meal.leftoverBehaviour === 'consumed_same' ? -1 : 2;
      if (day.slot === 'dinner' && rules.batchCookingDay === dow && meal.leftoverBehaviour !== 'consumed_same') score += 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = meal;
      }
    }

    if (best) count(best);
    lastProteinForSlot.set(day.slot, best?.proteinType ?? null);
    suggestions.push({
      date: day.date,
      slot: day.slot,
      mealId: best?.id ?? null,
      leftoversRequired: leftoversNeeded,
      prepTimeLimitMinutes: day.prepTimeLimitMinutes ?? null,
    });
  }

  return suggestions;
}
