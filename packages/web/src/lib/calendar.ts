import { toDateString } from './utils';
import type { CalendarEvent } from './types';

/** Rough meal times (local, minutes since midnight). An event overlapping one makes that meal "busy". */
export const SLOT_WINDOWS: Record<string, [number, number]> = {
  breakfast: [6 * 60, 9 * 60],
  lunch: [11 * 60 + 30, 14 * 60],
  dinner: [17 * 60, 19 * 60 + 30],
};

const localDate = (date: string) => new Date(`${date}T00:00:00`);

/** Local start and (exclusive) end of an event as Dates. */
function bounds(ev: CalendarEvent): [Date, Date] {
  return ev.allDay ? [localDate(ev.start), localDate(ev.end)] : [new Date(ev.start), new Date(ev.end)];
}

/** The events on each of the given local days (YYYY-MM-DD); events spanning several days appear on each. All-day first, then by start. */
export function eventsByDay(events: CalendarEvent[], days: string[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>(days.map((d) => [d, []]));
  for (const ev of events) {
    const [start, end] = bounds(ev);
    for (const day of days) {
      const dayStart = localDate(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      // A zero-length event (a reminder) belongs to the day it falls on.
      if (start < dayEnd && (end > dayStart || (start >= dayStart && end <= start))) out.get(day)!.push(ev);
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || bounds(a)[0].getTime() - bounds(b)[0].getTime());
  }
  return out;
}

const hhmm = (d: Date) => d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "17:30–18:30", "All day", "until 10:00" or "from 22:00", as seen on the given day. */
export function formatEventTime(ev: CalendarEvent, day: string): string {
  if (ev.allDay) return 'All day';
  const [start, end] = bounds(ev);
  const startsToday = toDateString(start) === day;
  const endsToday = toDateString(end) === day || (end.getTime() === start.getTime() && startsToday);
  if (startsToday && endsToday) return end.getTime() === start.getTime() ? hhmm(start) : `${hhmm(start)}–${hhmm(end)}`;
  if (startsToday) return `from ${hhmm(start)}`;
  if (endsToday) return `until ${hhmm(end)}`;
  return 'All day';
}

/** Timed events on `day` that overlap the given meal's usual time. All-day events (birthdays, holidays) don't count. */
export function busyDuring(dayEvents: CalendarEvent[], day: string, slot: string): CalendarEvent[] {
  const window = SLOT_WINDOWS[slot];
  if (!window) return [];
  const base = localDate(day).getTime();
  const from = base + window[0] * 60_000;
  const to = base + window[1] * 60_000;
  return dayEvents.filter((ev) => {
    if (ev.allDay) return false;
    const [start, end] = bounds(ev);
    return start.getTime() < to && end.getTime() > from;
  });
}
