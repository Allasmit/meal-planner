import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, type GeneratorMeal, type GeneratorDay, type GeneratorRules } from '../src/lib/generator';
import { parseIngredientLine } from '../src/lib/ingredient-parser';

// Small seeded generator so results are repeatable.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const meal = (id: number, over: Partial<GeneratorMeal> = {}): GeneratorMeal => ({
  id, prepTimeMinutes: 10, cookTimeMinutes: 20, proteinType: null, mealCategory: 'dinner', leftoverBehaviour: 'consumed_same',
  isFavourite: false, isSpecialOccasion: false, suitableForMemberIds: [], preferredByMemberIds: [], ...over,
});
const rules: GeneratorRules = { proteinLimits: {}, categoryLimits: {}, defaultLeftoversDays: [], batchCookingDay: null };
const dinner = (date: string, over: Partial<GeneratorDay> = {}): GeneratorDay => ({ date, slot: 'dinner', ...over });
const run = (over: Partial<Parameters<typeof generatePlan>[0]>) =>
  generatePlan({ days: [], meals: [], rules, existing: [], overwriteExisting: false, random: seeded(), ...over });

test('does not repeat a meal while the library has enough variety', () => {
  const out = run({
    meals: [meal(1), meal(2), meal(3), meal(4)],
    days: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => dinner(d)),
  });
  assert.equal(new Set(out.map((s) => s.mealId)).size, 4);
});

test('weekly protein cap is a hard rule and counts meals already on the plan', () => {
  const meals = [meal(1, { proteinType: 'red_meat' }), meal(2, { proteinType: 'red_meat' }), meal(3, { proteinType: 'chicken' }), meal(4, { proteinType: 'chicken' })];
  const out = run({
    meals,
    rules: { ...rules, proteinLimits: { red_meat: 1 } },
    existing: [{ date: '2026-10-05', slot: 'dinner', mealId: 1 }],
    days: ['2026-10-06', '2026-10-07', '2026-10-08'].map((d) => dinner(d)),
  });
  assert.ok(out.every((s) => s.mealId !== 1 && s.mealId !== 2), 'red meat is already used up this week');
});

test('category cap is respected', () => {
  const meals = [meal(1, { mealCategory: 'baking' }), meal(2, { mealCategory: 'baking' }), meal(3), meal(4)];
  const out = run({ meals, rules: { ...rules, categoryLimits: { baking: 0 } }, days: [dinner('2026-10-05'), dinner('2026-10-06')] });
  assert.ok(out.every((s) => s.mealId === 3 || s.mealId === 4));
});

test('time limit and member suitability exclude meals', () => {
  const meals = [meal(1, { prepTimeMinutes: 60, cookTimeMinutes: 60 }), meal(2, { suitableForMemberIds: [9] }), meal(3, { suitableForMemberIds: [5, 6] }), meal(4)];
  const out = run({ meals, days: [dinner('2026-10-05', { prepTimeLimitMinutes: 45, familyMemberIds: [5, 6] })] });
  assert.ok(out[0].mealId === 3 || out[0].mealId === 4, `got ${out[0].mealId}`);
});

test('returns null when nothing qualifies, and never overwrites an existing meal with null', () => {
  const out = run({
    meals: [meal(1, { prepTimeMinutes: 90 })],
    existing: [{ date: '2026-10-05', slot: 'dinner', mealId: 1 }],
    overwriteExisting: true,
    days: [dinner('2026-10-05', { prepTimeLimitMinutes: 30 })],
  });
  assert.equal(out[0].mealId, null); // the route skips null suggestions, so the old meal stays
});

test('filled slots are left alone unless overwrite is on; empty (null) slots are filled', () => {
  const base = { meals: [meal(1), meal(2)], existing: [{ date: '2026-10-05', slot: 'dinner' as const, mealId: 1 }, { date: '2026-10-06', slot: 'dinner' as const, mealId: null }] };
  const days = [dinner('2026-10-05'), dinner('2026-10-06')];
  const keep = run({ ...base, days });
  assert.deepEqual(keep.map((s) => s.date), ['2026-10-06']);
  assert.equal(run({ ...base, days, overwriteExisting: true }).length, 2);
});

test('slots prefer matching categories but still get filled when none match', () => {
  const breakfastFirst = run({ meals: [meal(1, { mealCategory: 'dinner' }), meal(2, { mealCategory: 'breakfast' })], days: [{ date: '2026-10-05', slot: 'breakfast' }] });
  assert.equal(breakfastFirst[0].mealId, 2);
  const onlyDinners = run({ meals: [meal(1)], days: [{ date: '2026-10-05', slot: 'snack' }] });
  assert.equal(onlyDinners[0].mealId, 1);
});

test('leftover days prefer meals that keep; favourites are preferred', () => {
  const keeps = run({ meals: [meal(1), meal(2, { leftoverBehaviour: 'fridge_next_day' })], days: [dinner('2026-10-05', { leftoversRequired: true })] });
  assert.equal(keeps[0].mealId, 2);
  const fav = run({ meals: [meal(1), meal(2, { isFavourite: true })], days: [dinner('2026-10-05')] });
  assert.equal(fav[0].mealId, 2);
});

test('batch cooking day favours freezable meals', () => {
  // 2026-10-04 is a Sunday
  const out = run({ meals: [meal(1), meal(2, { leftoverBehaviour: 'freezable' })], rules: { ...rules, batchCookingDay: 0 }, days: [dinner('2026-10-04')] });
  assert.equal(out[0].mealId, 2);
});

test('adjacent days avoid the same protein when possible', () => {
  const meals = [meal(1, { proteinType: 'chicken' }), meal(2, { proteinType: 'chicken' }), meal(3, { proteinType: 'fish' })];
  for (let seed = 1; seed <= 20; seed++) {
    const out = run({ meals, random: seeded(seed), days: [dinner('2026-10-05'), dinner('2026-10-06')] });
    const proteins = out.map((s) => meals.find((m) => m.id === s.mealId)!.proteinType);
    assert.notEqual(proteins[0], proteins[1], `seed ${seed}`);
  }
});

test('ingredient lines: quantities, fractions, units, names and notes', () => {
  const cases: [string, { quantity: number; unit: string; name: string; notes: string | null }][] = [
    ['2 cups flour', { quantity: 2, unit: 'cup', name: 'flour', notes: null }],
    ['1 1/2 cups flour, sifted', { quantity: 1.5, unit: 'cup', name: 'flour', notes: 'sifted' }],
    ['½ tsp salt', { quantity: 0.5, unit: 'tsp', name: 'salt', notes: null }],
    ['1½ tablespoons olive oil', { quantity: 1.5, unit: 'tbsp', name: 'olive oil', notes: null }],
    ['500g minced beef', { quantity: 500, unit: 'g', name: 'minced beef', notes: null }],
    ['2 large eggs', { quantity: 2, unit: 'unit', name: 'large eggs', notes: null }],
    ['3 cloves garlic, crushed', { quantity: 3, unit: 'clove', name: 'garlic', notes: 'crushed' }],
    ['1-2 tbsp honey', { quantity: 2, unit: 'tbsp', name: 'honey', notes: null }],
    ['250 ml cream (full fat)', { quantity: 250, unit: 'ml', name: 'cream', notes: 'full fat' }],
    ['Salt to taste', { quantity: 1, unit: 'unit', name: 'Salt', notes: 'to taste' }],
    ['a pinch of nutmeg', { quantity: 1, unit: 'pinch', name: 'nutmeg', notes: null }],
    ['2 tomatoes', { quantity: 2, unit: 'unit', name: 'tomatoes', notes: null }],
    ['1 can (400g) chopped tomatoes', { quantity: 1, unit: 'can', name: 'chopped tomatoes', notes: '400g' }],
    ['Fresh parsley', { quantity: 1, unit: 'unit', name: 'Fresh parsley', notes: null }],
    ['1.5 kg potatoes', { quantity: 1.5, unit: 'kg', name: 'potatoes', notes: null }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseIngredientLine(input), expected, input);
});
