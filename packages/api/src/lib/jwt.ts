import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';

const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: number;
  username: string;
  role: 'admin' | 'member';
  /** Matches users.token_version; tokens issued before a password reset/role change no longer match. */
  tokenVersion?: number;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}
