import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROTEIN_TYPES, MEAL_CATEGORIES, LEFTOVER_BEHAVIOURS } from './types';
import { PROTEIN_LABELS, PROTEIN_COLORS, CATEGORY_LABELS, LEFTOVER_LABELS } from './constants';

// The API keeps its own copy of these lists (packages/api/src/lib/enums.ts). Both sides must agree or saves start failing
// with validation/CHECK errors (this is how "lamb" once got rejected), so any drift fails this test.
const apiEnums = readFileSync(resolve(__dirname, '../../../api/src/lib/enums.ts'), 'utf8');

function apiList(name: string): string[] {
	const match = apiEnums.match(new RegExp(`export const ${name} = \\[(.*?)\\] as const`, 's'));
	if (!match) throw new Error(`${name} not found in the API enums`);
	return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('web and API agree on enum values', () => {
	it('protein types', () => expect([...PROTEIN_TYPES]).toEqual(apiList('PROTEIN_TYPES')));
	it('meal categories', () => expect([...MEAL_CATEGORIES]).toEqual(apiList('MEAL_CATEGORIES')));
	it('leftover behaviours', () => expect([...LEFTOVER_BEHAVIOURS]).toEqual(apiList('LEFTOVER_BEHAVIOURS')));
});

describe('display labels cover every value', () => {
	it('has a label (and colour) for each protein type', () => {
		expect(Object.keys(PROTEIN_LABELS).sort()).toEqual([...PROTEIN_TYPES].sort());
		expect(Object.keys(PROTEIN_COLORS).sort()).toEqual([...PROTEIN_TYPES].sort());
	});
	it('has a label for each category and leftover behaviour', () => {
		expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...MEAL_CATEGORIES].sort());
		expect(Object.keys(LEFTOVER_LABELS).sort()).toEqual([...LEFTOVER_BEHAVIOURS].sort());
	});
});
