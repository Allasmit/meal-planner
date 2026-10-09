import fs from 'fs';
import path from 'path';

// Load packages/api/.env (when present) without adding a dependency. Variables that are
// already set in the environment always win.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const DEV_JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';
const MIN_SECRET_LENGTH = 32;

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;

  if (IS_PRODUCTION) {
    throw new Error(
      `JWT_SECRET must be set to a random string of at least ${MIN_SECRET_LENGTH} characters in production. ` +
        'Add it to packages/api/.env (see .env.example) or the process environment.',
    );
  }

  console.warn('JWT_SECRET is not set (or is too short) — using an insecure development secret.');
  return secret || DEV_JWT_SECRET;
}

export const JWT_SECRET = resolveJwtSecret();

/**
 * Session cookies are only marked Secure when the app is actually served over HTTPS. Browsers
 * discard Secure cookies received over plain http (other than localhost), which would make
 * login silently fail on a plain-HTTP home-server install. Override with COOKIE_SECURE=true|false.
 */
function resolveCookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE?.toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return IS_PRODUCTION && (process.env.CLIENT_ORIGIN ?? '').toLowerCase().startsWith('https://');
}

export const COOKIE_SECURE = resolveCookieSecure();
