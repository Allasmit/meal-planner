import { describe, expect, it } from 'vitest';
import { busyDuring, eventsByDay, formatEventTime } from './calendar';
import type { CalendarEvent } from './types';

// Local times, so the tests hold in any time zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const timed = (title: string, start: string, end: string): CalendarEvent => ({ feedId: 1, title, location: null, allDay: false, start, end });
const allDay = (title: string, start: string, end: string): CalendarEvent => ({ feedId: 1, title, location: null, allDay: true, start, end });

const DAYS = ['2026-10-12', '2026-10-13', '2026-10-14'];

describe('eventsByDay', () => {
  it('puts events on every local day they cover, all-day first then by time', () => {
    const swim = timed('Swim', at(13, 17), at(13, 18));
    const flight = timed('Night flight', at(12, 22), at(13, 6));
    const trip = allDay('Trip', '2026-10-13', '2026-10-15');
    const reminder = timed('Pills', at(14, 8), at(14, 8));
    const map = eventsByDay([swim, flight, trip, reminder], DAYS);
    expect(map.get('2026-10-12')!.map((e) => e.title)).toEqual(['Night flight']);
    expect(map.get('2026-10-13')!.map((e) => e.title)).toEqual(['Trip', 'Night flight', 'Swim']);
    expect(map.get('2026-10-14')!.map((e) => e.title)).toEqual(['Trip', 'Pills']);
  });

  it('an event ending at midnight stays on its own day', () => {
    const map = eventsByDay([timed('Party', at(12, 19), at(13, 0))], DAYS);
    expect(map.get('2026-10-13')).toEqual([]);
  });
});

describe('formatEventTime', () => {
  it('shows the part of the event that falls on the day', () => {
    const flight = timed('Flight', at(12, 22), at(13, 6, 30));
    expect(formatEventTime(timed('Swim', at(13, 17), at(13, 18, 15)), '2026-10-13')).toBe('17:00–18:15');
    expect(formatEventTime(flight, '2026-10-12')).toBe('from 22:00');
    expect(formatEventTime(flight, '2026-10-13')).toBe('until 06:30');
    expect(formatEventTime(timed('Pills', at(14, 8), at(14, 8)), '2026-10-14')).toBe('08:00');
    expect(formatEventTime(allDay('Trip', '2026-10-13', '2026-10-15'), '2026-10-13')).toBe('All day');
  });
});

describe('busyDuring', () => {
  it('finds timed events that overlap a meal time, ignoring all-day ones', () => {
    const swim = timed('Swim', at(13, 17, 30), at(13, 18, 30));
    const meeting = timed('Meeting', at(13, 9), at(13, 11, 30));
    const events = [swim, meeting, allDay('Birthday', '2026-10-13', '2026-10-14')];
    expect(busyDuring(events, '2026-10-13', 'dinner')).toEqual([swim]);
    expect(busyDuring(events, '2026-10-13', 'lunch')).toEqual([]);
    expect(busyDuring(events, '2026-10-13', 'breakfast')).toEqual([]);
    expect(busyDuring(events, '2026-10-13', 'snack')).toEqual([]);
  });
});
