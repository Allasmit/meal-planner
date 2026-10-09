import type { Request, Response } from 'express';
import { createRouter } from '../lib/router';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { libsqlClient } from '../db/client';
import { users } from '../db/schema';
import { signToken } from '../lib/jwt';
import { COOKIE_SECURE } from '../config';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const authRouter = createRouter();

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: COOKIE_SECURE,
};
const COOKIE_OPTS = { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 };

// Brute-force protection. Only failed attempts count, so normal use is never throttled.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Try again in a few minutes.' },
});

// Compared against when the username does not exist, so response time doesn't reveal which usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// POST /api/auth/setup — first-run admin creation
authRouter.post('/setup', async (req: Request, res: Response): Promise<void> => {
  const schema = z.object({
    username: z.string().min(2).max(32),
    displayName: z.string().min(1).max(64),
    password: z.string().min(8),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { username, displayName, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);

  // One atomic statement: the row is only inserted when no user exists, so two simultaneous
  // setup requests cannot both create an admin.
  const result = await libsqlClient.execute({
    sql: `INSERT INTO users (username, display_name, password_hash, role)
          SELECT ?, ?, ?, 'admin' WHERE NOT EXISTS (SELECT 1 FROM users)
          RETURNING id, username, role`,
    args: [username, displayName, passwordHash],
  });

  if (result.rows.length === 0) {
    res.status(403).json({ error: 'Setup already complete' });
    return;
  }

  const user = result.rows[0] as unknown as { id: number; username: string; role: 'admin' | 'member' };
  const token = signToken({ userId: Number(user.id), username: user.username, role: user.role, tokenVersion: 0 });
  res.cookie('token', token, COOKIE_OPTS);
  res.status(201).json({ id: Number(user.id), username: user.username, displayName, role: user.role });
});

// POST /api/auth/login
authRouter.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const schema = z.object({
    username: z.string(),
    password: z.string(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const { username, password } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion });
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role });
});

// POST /api/auth/logout
authRouter.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', COOKIE_BASE);
  res.json({ ok: true });
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// GET /api/auth/setup-status — used by frontend to know whether to show /setup
authRouter.get('/setup-status', async (_req: Request, res: Response): Promise<void> => {
  const existing = await db.select().from(users).limit(1);
  res.json({ setupRequired: existing.length === 0 });
});
