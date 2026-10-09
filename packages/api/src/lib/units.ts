type Dimension = 'mass' | 'volume';

interface UnitInfo {
  dimension: Dimension;
  /** Multiplier to the base unit (g for mass, ml for volume). */
  factor: number;
}

const UNIT_ALIASES: Record<string, UnitInfo> = {
  g: { dimension: 'mass', factor: 1 },
  gram: { dimension: 'mass', factor: 1 },
  grams: { dimension: 'mass', factor: 1 },
  gr: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  kgs: { dimension: 'mass', factor: 1000 },
  kilogram: { dimension: 'mass', factor: 1000 },
  kilograms: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  millilitre: { dimension: 'volume', factor: 1 },
  millilitres: { dimension: 'volume', factor: 1 },
  milliliter: { dimension: 'volume', factor: 1 },
  milliliters: { dimension: 'volume', factor: 1 },
  l: { dimension: 'volume', factor: 1000 },
  litre: { dimension: 'volume', factor: 1000 },
  litres: { dimension: 'volume', factor: 1000 },
  liter: { dimension: 'volume', factor: 1000 },
  liters: { dimension: 'volume', factor: 1000 },
};

/** Spelling variants of count-style units that should be summed together. */
const UNIT_SYNONYMS: Record<string, string> = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can', tin: 'tin', tins: 'tin',
  piece: 'piece', pieces: 'piece',
  whole: 'whole', unit: 'unit', units: 'unit',
};

export interface Measure {
  quantity: number;
  unit: string;
}

/** Maps a quantity/unit to a base unit (g, ml) or a canonical lowercase unit, so amounts can be summed. */
export function toBaseMeasure(quantity: number, unit: string): Measure {
  const key = unit.trim().toLowerCase();
  const info = UNIT_ALIASES[key];
  if (info) return { quantity: quantity * info.factor, unit: info.dimension === 'mass' ? 'g' : 'ml' };
  return { quantity, unit: UNIT_SYNONYMS[key] ?? key };
}

function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Turns a summed base measure into something readable: 1500 g -> 1.5 kg, 250 g stays 250 g. */
export function formatMeasure(measure: Measure): Measure {
  if (measure.unit === 'g' && measure.quantity >= 1000) return { quantity: roundTo(measure.quantity / 1000, 2), unit: 'kg' };
  if (measure.unit === 'ml' && measure.quantity >= 1000) return { quantity: roundTo(measure.quantity / 1000, 2), unit: 'l' };
  return { quantity: roundTo(measure.quantity, 2), unit: measure.unit };
}
