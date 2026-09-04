import { get, set, del, keys } from './db';

const PREFIX = 'get:';

function cacheKey(path: string): string {
  return PREFIX + path;
}

/** Read a cached GET response for `path` (the path passed to api.ts's request()). */
export function getCachedGet<T>(path: string): Promise<T | undefined> {
  return get<T>(cacheKey(path));
}

/** Store a successful GET response so it can be served while offline. */
export function setCachedGet(path: string, data: unknown): Promise<void> {
  return set(cacheKey(path), data);
}

export function deleteCachedGet(path: string): Promise<void> {
  return del(cacheKey(path));
}

/**
 * Visit every cached GET entry whose path starts with `basePathPrefix`
 * (e.g. '/planner?' or '/meals'), letting `mutator` return a replacement
 * value to persist, or `undefined` to leave it untouched.
 */
export async function forEachCachedGet(
  basePathPrefix: string,
  mutator: (data: any, path: string) => any | Promise<any>
): Promise<void> {
  const allKeys = await keys();
  for (const key of allKeys) {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) continue;
    const path = key.slice(PREFIX.length);
    if (!path.startsWith(basePathPrefix)) continue;
    const data = await get<any>(key);
    const updated = await mutator(data, path);
    if (updated !== undefined) {
      await set(key, updated);
    }
  }
}
