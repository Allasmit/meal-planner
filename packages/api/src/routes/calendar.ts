import type { Response } from 'express';
import { createRouter } from '../lib/router';
import { parseId } from '../lib/params';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { calendarFeeds } from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { safeFetchText, SafeFetchError } from '../lib/safe-fetch';
import {
  CalendarParseError, feedUrlHint, normaliseFeedUrl, occurrencesBetween, parseCalendar, type ParsedCalendar,
} from '../lib/calendar';
import { z } from 'zod';

export const calendarRouter = createRouter();

calendarRouter.use(requireAuth);

export const FEED_COLORS = ['#2563eb', '#db2777', '#7c3aed', '#ea580c', '#0d9488', '#ca8a04'] as const;

const CACHE_TTL_MS = 10 * 60 * 1000;
// Calendars with years of history are large; the feed is only ever read, never stored.
const MAX_FEED_BYTES = 20 * 1024 * 1024;

const cache = new Map<number, { url: string; fetchedAt: number; calendar: ParsedCalendar }>();

async function fetchCalendar(url: string): Promise<ParsedCalendar> {
  const res = await safeFetchText(url, { maxBytes: MAX_FEED_BYTES, timeoutMs: 15_000, headers: { Accept: 'text/calendar, */*' } });
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    throw new SafeFetchError('The calendar link was refused. If you reset the secret address, add the new one.');
  }
  if (res.status >= 400) throw new SafeFetchError(`The calendar server answered with an error (${res.status}).`);
  return parseCalendar(res.body);
}

/** The feed's calendar, from the cache while fresh. A failed refresh falls back to the last good copy. */
async function loadFeed(feed: { id: number; url: string }): Promise<{ calendar: ParsedCalendar; stale: boolean }> {
  const hit = cache.get(feed.id);
  if (hit && hit.url === feed.url && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return { calendar: hit.calendar, stale: false };
  try {
    const calendar = await fetchCalendar(feed.url);
    cache.set(feed.id, { url: feed.url, fetchedAt: Date.now(), calendar });
    return { calendar, stale: false };
  } catch (err) {
    if (hit && hit.url === feed.url) return { calendar: hit.calendar, stale: true };
    throw err;
  }
}

const userMessage = (err: unknown) =>
  err instanceof SafeFetchError || err instanceof CalendarParseError ? err.message : 'Could not load this calendar.';

type FeedRow = typeof calendarFeeds.$inferSelect;

function publicFeed(feed: FeedRow) {
  return {
    id: feed.id,
    name: feed.name,
    color: feed.color,
    showDetails: feed.showDetails,
    urlHint: feedUrlHint(feed.url),
    createdByUserId: feed.createdByUserId,
  };
}

const canManage = (req: AuthRequest, feed: FeedRow) => req.user!.role === 'admin' || feed.createdByUserId === req.user!.userId;

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

// GET /api/calendar/feeds
calendarRouter.get('/feeds', async (_req: AuthRequest, res: Response): Promise<void> => {
  const feeds = await db.select().from(calendarFeeds).orderBy(asc(calendarFeeds.id));
  res.json(feeds.map(publicFeed));
});

// POST /api/calendar/feeds — checks the link really is a calendar before saving it
calendarRouter.post('/feeds', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    url: z.string().trim().min(1).max(2000),
    name: z.string().trim().max(60).optional(),
    color: colorSchema.optional(),
    showDetails: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const url = normaliseFeedUrl(parsed.data.url);
  let calendar: ParsedCalendar;
  try {
    calendar = await fetchCalendar(url);
  } catch (err) {
    res.status(422).json({ error: userMessage(err) });
    return;
  }

  const existing = await db.select({ id: calendarFeeds.id }).from(calendarFeeds);
  const [feed] = await db
    .insert(calendarFeeds)
    .values({
      name: parsed.data.name || calendar.name || 'Calendar',
      url,
      color: parsed.data.color ?? FEED_COLORS[existing.length % FEED_COLORS.length],
      showDetails: parsed.data.showDetails ?? true,
      createdByUserId: req.user!.userId,
    })
    .returning();
  cache.set(feed.id, { url, fetchedAt: Date.now(), calendar });
  res.status(201).json(publicFeed(feed));
});

// PATCH /api/calendar/feeds/:id — creator or admin
calendarRouter.patch('/feeds/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const schema = z.object({
    name: z.string().trim().min(1).max(60).optional(),
    color: colorSchema.optional(),
    showDetails: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  if (Object.keys(parsed.data).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  const [feed] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id));
  if (!feed) { res.status(404).json({ error: 'Calendar not found' }); return; }
  if (!canManage(req, feed)) { res.status(403).json({ error: 'Only the person who added this calendar or an admin can change it' }); return; }

  const [updated] = await db.update(calendarFeeds).set(parsed.data).where(eq(calendarFeeds.id, id)).returning();
  res.json(publicFeed(updated));
});

// DELETE /api/calendar/feeds/:id — creator or admin
calendarRouter.delete('/feeds/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [feed] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.id, id));
  if (!feed) { res.status(404).json({ error: 'Calendar not found' }); return; }
  if (!canManage(req, feed)) { res.status(403).json({ error: 'Only the person who added this calendar or an admin can remove it' }); return; }
  await db.delete(calendarFeeds).where(eq(calendarFeeds.id, id));
  cache.delete(id);
  res.json({ ok: true });
});

// GET /api/calendar/events?weekStart=YYYY-MM-DD — every feed's events for that week
calendarRouter.get('/events', async (req: AuthRequest, res: Response): Promise<void> => {
  const weekStart = req.query.weekStart;
  if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    res.status(400).json({ error: 'weekStart query param required (YYYY-MM-DD)' });
    return;
  }
  const [y, m, d] = weekStart.split('-').map(Number);
  // A day either side covers every time zone; the browser places events on its own local days.
  const from = new Date(Date.UTC(y, m - 1, d - 1));
  const to = new Date(Date.UTC(y, m - 1, d + 8));

  const feeds = await db.select().from(calendarFeeds).orderBy(asc(calendarFeeds.id));
  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const { calendar, stale } = await loadFeed(feed);
        const events = occurrencesBetween(calendar, from, to).map((o) => ({
          feedId: feed.id,
          title: feed.showDetails ? o.title : 'Busy',
          location: feed.showDetails ? o.location : null,
          allDay: o.allDay,
          start: o.start,
          end: o.end,
        }));
        return { events, error: stale ? { feedId: feed.id, message: 'Showing the last copy; the calendar could not be refreshed.' } : null };
      } catch (err) {
        return { events: [], error: { feedId: feed.id, message: userMessage(err) } };
      }
    }),
  );

  res.json({
    feeds: feeds.map(publicFeed),
    events: results.flatMap((r) => r.events),
    errors: results.flatMap((r) => (r.error ? [r.error] : [])),
  });
});
