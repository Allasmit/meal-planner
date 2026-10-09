export interface ParsedIngredient {
  quantity: number;
  unit: string;
  name: string;
  notes: string | null;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

/** Spelling -> canonical unit. Anything not listed is treated as part of the ingredient name. */
const UNITS: Record<string, string> = {
  cup: 'cup', cups: 'cup', c: 'cup',
  tbsp: 'tbsp', tbs: 'tbsp', tbspn: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbl: 'tbsp',
  tsp: 'tsp', tspn: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  can: 'can', cans: 'can', tin: 'tin', tins: 'tin',
  pinch: 'pinch', pinches: 'pinch', handful: 'handful', handfuls: 'handful',
  bunch: 'bunch', bunches: 'bunch', sprig: 'sprig', sprigs: 'sprig',
  stick: 'stick', sticks: 'stick', packet: 'packet', packets: 'packet', pkt: 'packet',
  punnet: 'punnet', punnets: 'punnet', piece: 'piece', pieces: 'piece', head: 'head', heads: 'head',
};

function parseNumber(token: string): number | null {
  const mixed = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = token.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  const decimal = token.match(/^\d+(?:[.,]\d+)?$/);
  return decimal ? Number(token.replace(',', '.')) : null;
}

const NUMBER = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?`;
const QUANTITY_AT_START = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?`, 'i');

/**
 * Splits a recipe ingredient line ("1 1/2 cups flour, sifted", "½ tsp salt", "2 large eggs", "500g beef (lean)")
 * into quantity, unit, name and notes. A range ("1-2 tbsp") uses the larger amount so the shopping list never
 * comes up short. Lines without a quantity ("salt to taste") become 1 unit.
 */
export function parseIngredientLine(raw: string): ParsedIngredient {
  let text = raw.trim().replace(/\s+/g, ' ');
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    text = text.replace(new RegExp(`(\\d)\\s*${glyph}`, 'g'), `$1 ${ascii}`).replace(new RegExp(glyph, 'g'), ascii);
  }

  let quantity: number | null = null;
  let unit = 'unit';
  let rest = text;

  const quantityMatch = rest.match(QUANTITY_AT_START);
  if (quantityMatch) {
    const low = parseNumber(quantityMatch[1].trim());
    const high = quantityMatch[2] ? parseNumber(quantityMatch[2].trim()) : null;
    if (low !== null) {
      quantity = high !== null ? Math.max(low, high) : low;
      rest = rest.slice(quantityMatch[0].length).trim();
    }
  } else if (/^(a|an|one)\s+(pinch|handful|bunch|sprig|clove|slice|can|tin|packet|punnet|piece|head)\b/i.test(rest)) {
    quantity = 1;
    rest = rest.replace(/^(a|an|one)\s+/i, '');
  }

  if (quantity !== null) {
    // Unit attached to the number ("500g") or separate ("500 g", "2 cups").
    const attached = quantityMatch && text.slice(quantityMatch[0].length).match(/^([a-zA-Z]+)\.?(?=\s|$)/);
    const token = rest.match(/^([a-zA-Z]+)\.?(\s+|$)/);
    const candidate = (attached ? attached[1] : token ? token[1] : '').toLowerCase();
    if (candidate && UNITS[candidate]) {
      unit = UNITS[candidate];
      rest = rest.replace(/^[a-zA-Z]+\.?\s*/, '').trim();
    }
    rest = rest.replace(/^of\s+/i, '');
  }

  const notes: string[] = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });

  const commaAt = rest.indexOf(',');
  if (commaAt >= 0) {
    const tail = rest.slice(commaAt + 1).trim();
    if (tail) notes.push(tail);
    rest = rest.slice(0, commaAt);
  }

  const toTaste = rest.match(/^(.*?)\s+(to taste|as needed|for serving|for garnish|to serve)$/i);
  if (toTaste) {
    notes.push(toTaste[2].toLowerCase());
    rest = toTaste[1];
  }

  const name = rest.replace(/\s+/g, ' ').trim() || text;
  return {
    quantity: quantity !== null && quantity > 0 ? Math.round(quantity * 1000) / 1000 : 1,
    unit,
    name,
    notes: notes.length ? notes.join('; ') : null,
  };
}
