import ICAL from 'ical.js';

/** One occurrence of a calendar event. Timed events carry UTC ISO instants; all-day events carry dates (end exclusive). */
export interface CalendarOccurrence {
  uid: string;
  title: string;
  location: string | null;
  allDay: boolean;
  start: string;
  end: string;
}

/** A parsed calendar, ready to be expanded for any date range. */
export interface ParsedCalendar {
  name: string | null;
  events: ICAL.Event[];
}

// A daily event that started years ago still has to be stepped through from its first date.
const MAX_ITERATIONS = 20_000;

export class CalendarParseError extends Error {}

/** Normalises what people paste: webcal:// links are plain https feeds. */
export function normaliseFeedUrl(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, 'https://');
}

/** A short, non-secret description of a feed URL (secret iCal addresses carry their key in the path). */
export function feedUrlHint(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'calendar';
  }
}

export function parseCalendar(text: string): ParsedCalendar {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new CalendarParseError('That link did not return a calendar (iCal) file.');
  let vcal: ICAL.Component;
  try {
    vcal = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new CalendarParseError('That calendar file could not be read.');
  }

  for (const tz of vcal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  const events: ICAL.Event[] = [];
  for (const comp of vcal.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(comp);
    if (!event.startDate) continue;
    if (event.isRecurrenceException()) exceptions.push(event);
    else if (event.uid) masters.set(event.uid, event);
    else events.push(event);
  }
  // A changed occurrence of a recurring event replaces that occurrence; one without its series stands alone.
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else events.push(ex);
  }

  const name = vcal.getFirstPropertyValue('x-wr-calname');
  return { name: typeof name === 'string' && name.trim() ? name.trim() : null, events: [...masters.values(), ...events] };
}

function toOccurrence(item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null): CalendarOccurrence {
  const allDay = start.isDate;
  let endTime = end ?? start;
  if (allDay && endTime.compare(start) <= 0) {
    endTime = start.clone();
    endTime.day += 1;
  }
  return {
    uid: item.uid ?? '',
    title: item.summary?.trim() || '(No title)',
    location: item.location?.trim() || null,
    allDay,
    start: allDay ? start.toString() : start.toJSDate().toISOString(),
    end: allDay ? endTime.toString() : endTime.toJSDate().toISOString(),
  };
}

const isCancelled = (item: ICAL.Event) =>
  String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

/** Every occurrence overlapping [from, to), recurring events expanded, cancelled ones left out. Sorted by start. */
export function occurrencesBetween(calendar: ParsedCalendar, from: Date, to: Date): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = [];
  const overlaps = (start: ICAL.Time, end: ICAL.Time | null) => {
    const s = start.toJSDate();
    const e = (end ?? start).toJSDate();
    // Zero-length events (a reminder at 08:00) count when they fall inside the range.
    return s < to && (e > from || s >= from);
  };

  for (const event of calendar.events) {
    if (!event.isRecurring()) {
      if (!isCancelled(event) && overlaps(event.startDate, event.endDate)) {
        out.push(toOccurrence(event, event.startDate, event.endDate));
      }
      continue;
    }

    const it = event.iterator();
    let next: ICAL.Time | null;
    for (let i = 0; i < MAX_ITERATIONS && (next = it.next()); i++) {
      if (next.toJSDate() >= to) break;
      const details = event.getOccurrenceDetails(next);
      if (isCancelled(details.item) || !overlaps(details.startDate, details.endDate)) continue;
      out.push(toOccurrence(details.item, details.startDate, details.endDate));
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
