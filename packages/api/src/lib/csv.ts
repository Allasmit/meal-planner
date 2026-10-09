/**
 * Parses CSV text into rows of cells. Handles quoted cells containing commas, doubled quotes
 * ("") and line breaks, CRLF/LF line endings and a leading BOM. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');

  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ',') endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }

  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** Lowercases and strips spaces/hyphens/underscores so "Gluten Free" matches "Gluten-Free". */
export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[\s\-_]+/g, '');
}
