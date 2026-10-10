const WEEK_START_KEY = 'weekStartDay';

function readStoredWeekStartDay(): number {
  try {
    const v = Number(localStorage.getItem(WEEK_START_KEY));
    if (Number.isInteger(v) && v >= 0 && v <= 6) return v;
  } catch { /* no storage (SSR / private mode) */ }
  return 1; // Monday
}

/** First day of the planner week: 0=Sunday ... 6=Saturday. Kept in localStorage so it works offline. */
let weekStartDay = readStoredWeekStartDay();

export function getWeekStartDay(): number {
  return weekStartDay;
}

export function setWeekStartDay(day: number): void {
  if (!Number.isInteger(day) || day < 0 || day > 6) return;
  weekStartDay = day;
  try { localStorage.setItem(WEEK_START_KEY, String(day)); } catch { /* ignore */ }
}

/**
 * Returns the first day of the week (per the week-start setting) containing the given date.
 */
export function getWeekStart(date: Date = new Date(), startDay: number = weekStartDay): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - ((d.getDay() - startDay + 7) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns an array of 7 Date objects starting from the given week start.
 */
export function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/**
 * Formats a Date as YYYY-MM-DD.
 */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date as a short display string, e.g. "Mon 13".
 */
export function formatDayShort(date: Date): string {
  return date.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' });
}

/**
 * Formats a Date range as "13–19 Jun 2026".
 */
export function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  return `${fmt(weekStart)} – ${fmt(weekEnd)} ${weekEnd.getFullYear()}`;
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

export const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  hard: 'bg-red-100 text-red-800',
};
