import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { requireAdmin, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const usersRouter = Router();

// All routes require admin
usersRouter.use(requireAdmin);

// GET /api/users
usersRouter.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const result = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users);
  res.json(result);
});

// POST /api/users
usersRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const schema = z.object({
    username: z.string().min(2).max(32),
    displayName: z.string().min(1).max(64),
    password: z.string().min(8),
    role: z.enum(['admin', 'member']).default('member'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { username, displayName, password, role } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [user] = await db
      .insert(users)
      .values({ username, displayName, passwordHash, role })
      .returning({ id: users.id, username: users.username, displayName: users.displayName, role: users.role });
    res.status(201).json(user);
  } catch (err: any) {
    const isUnique = err?.cause?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      err?.cause?.message?.includes('UNIQUE') || err?.message?.includes('UNIQUE');
    if (isUnique) {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

// PUT /api/users/:id
usersRouter.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    displayName: z.string().min(1).max(64).optional(),
    role: z.enum(['admin', 'member']).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const [updated] = await db
    .update(users)
    .set(parsed.data)
    .where(eq(users.id, id))
    .returning({ id: users.id, username: users.username, displayName: users.displayName, role: users.role });

  if (!updated) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(updated);
});

// POST /api/users/:id/reset-password
usersRouter.post('/:id/reset-password', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({ password: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const [updated] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (!updated) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ ok: true });
});

// DELETE /api/users/:id
usersRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (req.user!.userId === id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }
  const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (result.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ ok: true });
});
