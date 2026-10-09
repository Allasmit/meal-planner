import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { verifyToken, type JwtPayload } from '../lib/jwt';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * Verifies the session cookie AND checks it against the database on every request, so a deleted
 * user, a changed role or a reset password takes effect immediately instead of when the token expires.
 * The role used downstream always comes from the database, never from the token.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token: string | undefined = req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'Unauthorised' });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  try {
    const [user] = await db
      .select({ id: users.id, username: users.username, role: users.role, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!user || user.tokenVersion !== (payload.tokenVersion ?? 0)) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    req.user = { userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion };
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}
