import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { signToken } from '../lib/jwt';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const authRouter = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// POST /api/auth/setup — first-run admin creation
authRouter.post('/setup', async (req: Request, res: Response): Promise<void> => {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    res.status(403).json({ error: 'Setup already complete' });
    return;
  }

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

  const [user] = await db
    .insert(users)
    .values({ username, displayName, passwordHash, role: 'admin' })
    .returning({ id: users.id, username: users.username, role: users.role });

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie('token', token, COOKIE_OPTS);
  res.status(201).json({ id: user.id, username: user.username, displayName, role: user.role });
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
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

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ id: user.id, username: user.username, displayName: user.displayName, role: user.role });
});

// POST /api/auth/logout
authRouter.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token');
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
