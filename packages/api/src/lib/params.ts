import type { Response } from 'express';

/** Parses a positive integer route/query id; sends a 400 and returns null when it is invalid. */
export function parseId(raw: unknown, res: Response, label = 'id'): number | null {
  const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    res.status(400).json({ error: `Invalid ${label}` });
    return null;
  }
  return value;
}

/** Parses an optional numeric query value. Returns undefined when absent and null when invalid. */
export function parseOptionalNumber(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Parses a comma separated list of ids ("1,2,3"). Returns null when any entry is not a positive integer. */
export function parseIdList(raw: unknown): number[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const ids = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return ids.every((n) => Number.isSafeInteger(n) && n > 0) ? ids : null;
}
