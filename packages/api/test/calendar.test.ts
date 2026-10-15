import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarParseError, feedUrlHint, normaliseFeedUrl, occurrencesBetween, parseCalendar } from '../src/lib/calendar';

const ics = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'X-WR-CALNAME:Family', body.trim(), 'END:VCALENDAR'].join('\r\n');

const JOHANNESBURG = `
BEGIN:VTIMEZONE
TZID:Africa/Johannesburg
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0200
TZNAME:SAST
DTSTART:19700101T000000
END:STANDARD
END:VTIMEZONE`;

// Week of Mon 12 Oct 2026, padded like the route does.
const FROM = new Date(Date.UTC(2026, 9, 11));
const TO = new Date(Date.UTC(2026, 9, 20));

test('reads the calendar name and refuses non-calendar responses', () => {
  assert.equal(parseCalendar(ics('')).name, 'Family');
  assert.throws(() => parseCalendar('<html>Sign in</html>'), CalendarParseError);
});

test('timed events in a named time zone come out as UTC instants', () => {
  const cal = parseCalendar(ics(`${JOHANNESBURG}
BEGIN:VEVENT
UID:a
SUMMARY:Dentist
LOCATION:Main Rd
DTSTART;TZID=Africa/Johannesburg:20261014T173000
DTEND;TZID=Africa/Johannesburg:20261014T183000
END:VEVENT`));
  const [ev] = occurrencesBetween(cal, FROM, TO);
  assert.deepEqual(ev, {
    uid: 'a', title: 'Dentist', location: 'Main Rd', allDay: false,
    start: '2026-10-14T15:30:00.000Z', end: '2026-10-14T16:30:00.000Z',
  });
});

test('weekly recurrences are expanded, with excluded dates, moved and cancelled occurrences applied', () => {
  const cal = parseCalendar(ics(`${JOHANNESBURG}
BEGIN:VEVENT
UID:swim
SUMMARY:Swimming
DTSTART;TZID=Africa/Johannesburg:20260901T170000
DTEND;TZID=Africa/Johannesburg:20260901T180000
RRULE:FREQ=WEEKLY;BYDAY=TU,TH
EXDATE;TZID=Africa/Johannesburg:20261015T170000
END:VEVENT
BEGIN:VEVENT
UID:swim
RECURRENCE-ID;TZID=Africa/Johannesburg:20261013T170000
SUMMARY:Swimming gala
DTSTART;TZID=Africa/Johannesburg:20261013T150000
DTEND;TZID=Africa/Johannesburg:20261013T190000
END:VEVENT
BEGIN:VEVENT
UID:swim
RECURRENCE-ID;TZID=Africa/Johannesburg:20261020T170000
STATUS:CANCELLED
DTSTART;TZID=Africa/Johannesburg:20261020T170000
DTEND;TZID=Africa/Johannesburg:20261020T180000
END:VEVENT`));
  const events = occurrencesBetween(cal, FROM, new Date(Date.UTC(2026, 9, 23)));
  assert.deepEqual(events.map((e) => [e.title, e.start]), [
    ['Swimming gala', '2026-10-13T13:00:00.000Z'],
    // 15 Oct excluded, 20 Oct cancelled
    ['Swimming', '2026-10-22T15:00:00.000Z'],
  ]);
});

test('all-day events keep their dates, single-day ones without an end get one day', () => {
  const cal = parseCalendar(ics(`
BEGIN:VEVENT
UID:hol
SUMMARY:Holiday
DTSTART;VALUE=DATE:20261016
DTEND;VALUE=DATE:20261019
END:VEVENT
BEGIN:VEVENT
UID:bday
SUMMARY:Birthday
DTSTART;VALUE=DATE:20261012
END:VEVENT
BEGIN:VEVENT
UID:old
SUMMARY:Last month
DTSTART;VALUE=DATE:20260912
END:VEVENT`));
  const events = occurrencesBetween(cal, FROM, TO);
  assert.deepEqual(events.map((e) => [e.title, e.allDay, e.start, e.end]), [
    ['Birthday', true, '2026-10-12', '2026-10-13'],
    ['Holiday', true, '2026-10-16', '2026-10-19'],
  ]);
});

test('webcal links become https and URL hints never include the secret path', () => {
  assert.equal(normaliseFeedUrl(' webcal://example.com/cal.ics '), 'https://example.com/cal.ics');
  assert.equal(
    feedUrlHint('https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics'),
    'calendar.google.com',
  );
});
