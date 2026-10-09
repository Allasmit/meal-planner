import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { eq, like } from 'drizzle-orm';
import { DATA_DIR, db } from '../db/client';
import { meals } from '../db/schema';

export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const IMAGE_URL_PREFIX = '/api/images/';
const IMAGE_NAME = /^[a-f0-9]{64}\.jpg$/;
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const DATA_URL = /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,([A-Za-z0-9+/=\s]+)$/i;

export function isValidImageName(name: string): boolean {
  return IMAGE_NAME.test(name);
}

export function isInlineImage(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

/** True for values the API accepts as a meal image: an inline data URL, one of our stored files, or an http(s) URL. */
export function isAcceptableImageUrl(value: string): boolean {
  if (value.startsWith('data:image/')) return true;
  if (value.startsWith(IMAGE_URL_PREFIX)) return isValidImageName(value.slice(IMAGE_URL_PREFIX.length));
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Stores image bytes as a re-encoded JPEG (max 1200px, metadata stripped) named after its content hash,
 * so identical images share one file. Re-encoding also proves the bytes really are an image.
 */
export async function saveImageBuffer(input: Buffer): Promise<string> {
  const jpeg = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  const name = `${crypto.createHash('sha256').update(jpeg).digest('hex')}.jpg`;
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const target = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, jpeg);
  return IMAGE_URL_PREFIX + name;
}

export class ImageError extends Error {
  readonly status = 400;
}

/**
 * Normalises an incoming imageUrl: inline `data:image/...` payloads are saved as files and replaced by
 * their `/api/images/<hash>.jpg` URL; anything else (http URLs, existing /api/images paths, null) passes through.
 */
export async function resolveImageUrl(value: string | null | undefined): Promise<string | null | undefined> {
  if (!isInlineImage(value)) return value;
  const match = DATA_URL.exec(value);
  if (!match) throw new ImageError('Unsupported image format');
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length === 0 || bytes.length > MAX_DECODED_BYTES) throw new ImageError('Image is empty or too large');
  try {
    return await saveImageBuffer(bytes);
  } catch {
    throw new ImageError('That file is not a valid image');
  }
}

/** One-time conversion of images stored inline in the database (older versions) to files. Returns how many were moved. */
export async function migrateInlineImages(beforeFirstWrite?: () => Promise<void>): Promise<number> {
  // Only real base64 photos are converted. Other inline values (e.g. the tiny URL-encoded SVG placeholders some
  // recipe sites use for lazy-loaded images) are small, harmless, and left exactly as they are.
  const candidates = await db.select({ id: meals.id, imageUrl: meals.imageUrl }).from(meals).where(like(meals.imageUrl, 'data:%'));
  const rows = candidates.filter((r) => r.imageUrl !== null && DATA_URL.test(r.imageUrl));
  if (rows.length === 0) return 0;
  await beforeFirstWrite?.();

  let moved = 0;
  for (const row of rows) {
    try {
      const url = await resolveImageUrl(row.imageUrl);
      await db.update(meals).set({ imageUrl: url ?? null }).where(eq(meals.id, row.id));
      moved++;
    } catch (err) {
      console.warn(`Could not convert the inline image of meal ${row.id}:`, (err as Error).message);
    }
  }
  return moved;
}

/** Deletes image files no meal references any more (e.g. after a meal was deleted or its image replaced). */
export async function removeOrphanedImages(): Promise<number> {
  if (!fs.existsSync(IMAGES_DIR)) return 0;
  const rows = await db.select({ imageUrl: meals.imageUrl }).from(meals).where(like(meals.imageUrl, `${IMAGE_URL_PREFIX}%`));
  const used = new Set(rows.map((r) => r.imageUrl!.slice(IMAGE_URL_PREFIX.length)));
  let removed = 0;
  for (const file of fs.readdirSync(IMAGES_DIR)) {
    if (IMAGE_NAME.test(file) && !used.has(file)) {
      fs.unlinkSync(path.join(IMAGES_DIR, file));
      removed++;
    }
  }
  return removed;
}
