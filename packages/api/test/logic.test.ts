import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateShoppingList, type ShoppingRow } from '../src/lib/shopping';
import { toBaseMeasure, formatMeasure } from '../src/lib/units';
import { parseCsv, normaliseName } from '../src/lib/csv';
import { splitSqlStatements } from '../src/lib/sql';
import { escapeLike, sqliteNow } from '../src/lib/sqlite';

const row = (over: Partial<ShoppingRow>): ShoppingRow => ({
  mealId: 1, ingredientId: 1, ingredientName: 'Onion', quantity: 1, unit: 'whole',
  categoryId: 1, categoryName: 'Produce', categorySortOrder: 1, ...over,
});

test('a meal planned twice needs its ingredients twice', () => {
  const list = aggregateShoppingList([row({ quantity: 2 })], new Map([[1, 2]]), false);
  assert.equal(list[0].items[0].quantity, 4);
});

test('different meals sharing an ingredient are summed', () => {
  const list = aggregateShoppingList(
    [row({ mealId: 1, quantity: 1 }), row({ mealId: 2, quantity: 3 })],
    new Map([[1, 1], [2, 1]]),
    false,
  );
  assert.equal(list[0].items.length, 1);
  assert.equal(list[0].items[0].quantity, 4);
});

test('g and kg are merged and shown in a readable unit', () => {
  const list = aggregateShoppingList(
    [row({ mealId: 1, quantity: 500, unit: 'g' }), row({ mealId: 2, quantity: 1, unit: 'kg' })],
    new Map([[1, 1], [2, 1]]),
    false,
  );
  assert.deepEqual(list[0].items[0], { ingredientId: 1, name: 'Onion', quantity: 1.5, unit: 'kg' });
});

test('small amounts stay in grams and ml/l merge', () => {
  assert.deepEqual(formatMeasure(toBaseMeasure(250, 'g')), { quantity: 250, unit: 'g' });
  assert.deepEqual(formatMeasure({ quantity: 750 + 500, unit: 'ml' }), { quantity: 1.25, unit: 'l' });
  assert.deepEqual(toBaseMeasure(2, 'Tablespoons'), { quantity: 2, unit: 'tbsp' });
});

test('unit spelling and case differences are merged', () => {
  const list = aggregateShoppingList(
    [row({ mealId: 1, unit: 'Tbsp' }), row({ mealId: 2, unit: 'tablespoons' })],
    new Map([[1, 1], [2, 1]]),
    false,
  );
  assert.equal(list[0].items.length, 1);
  assert.equal(list[0].items[0].quantity, 2);
});

test('incompatible units stay on separate lines', () => {
  const list = aggregateShoppingList(
    [row({ mealId: 1, unit: 'cup' }), row({ mealId: 2, unit: 'g' })],
    new Map([[1, 1], [2, 1]]),
    false,
  );
  assert.equal(list[0].items.length, 2);
});

test('pantry categories are hidden unless requested', () => {
  const spice = row({ ingredientId: 2, ingredientName: 'Cumin', categoryId: 9, categoryName: 'Spices & Herbs', categorySortOrder: 9 });
  assert.equal(aggregateShoppingList([spice], new Map([[1, 1]]), false).length, 0);
  assert.equal(aggregateShoppingList([spice], new Map([[1, 1]]), true).length, 1);
});

test('categories are sorted and items sorted by name', () => {
  const list = aggregateShoppingList(
    [
      row({ ingredientId: 2, ingredientName: 'Zucchini' }),
      row({ ingredientId: 3, ingredientName: 'Apple' }),
      row({ ingredientId: 4, ingredientName: 'Beef', categoryId: 2, categoryName: 'Meat & Poultry', categorySortOrder: 2 }),
    ],
    new Map([[1, 1]]),
    false,
  );
  assert.deepEqual(list.map((c) => c.categoryName), ['Produce', 'Meat & Poultry']);
  assert.deepEqual(list[0].items.map((i) => i.name), ['Apple', 'Zucchini']);
});

test('parseCsv handles quotes, commas, newlines, CRLF, BOM and blank lines', () => {
  const rows = parseCsv('\uFEFFname,notes\r\n"Soup, hot","line1\nline2"\r\n\r\n"He said ""hi""",x\r\n');
  assert.deepEqual(rows, [
    ['name', 'notes'],
    ['Soup, hot', 'line1\nline2'],
    ['He said "hi"', 'x'],
  ]);
});

test('parseCsv keeps empty cells and a final row without newline', () => {
  assert.deepEqual(parseCsv('a,,c\nd,e,'), [['a', '', 'c'], ['d', 'e', '']]);
});

test('normaliseName ignores case, spaces and hyphens', () => {
  assert.equal(normaliseName('Gluten Free'), normaliseName('gluten-FREE'));
});

test('splitSqlStatements ignores ; and -- inside strings and comments', () => {
  const out = splitSqlStatements(`-- c; x\nCREATE TABLE a (x TEXT DEFAULT 'a;b -- no'); -- t;\nINSERT INTO a VALUES ('it''s; ok')`);
  assert.equal(out.length, 2);
  assert.match(out[1], /it''s; ok/);
});

test('escapeLike escapes wildcards; sqliteNow matches datetime() format', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  assert.match(sqliteNow(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
