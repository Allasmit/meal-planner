import { get, set, del, entries, setMany } from './db';

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

/** Every cached GET response whose path satisfies `match`, read in a single transaction. */
export async function findCachedGets(match: (path: string) => boolean): Promise<[path: string, data: any][]> {
  const result: [string, any][] = [];
  for (const [key, data] of await entries()) {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) continue;
    const path = key.slice(PREFIX.length);
    if (match(path)) result.push([path, data]);
  }
  return result;
}

/**
 * Visit every cached GET entry whose path satisfies `match`, letting `mutator`
 * return a replacement value to persist, or `undefined` to leave it untouched.
 */
export async function forEachCachedGet(
  match: (path: string) => boolean,
  mutator: (data: any, path: string) => any
): Promise<void> {
  const updates: [string, unknown][] = [];
  for (const [path, data] of await findCachedGets(match)) {
    const updated = mutator(data, path);
    if (updated !== undefined) updates.push([cacheKey(path), updated]);
  }
  if (updates.length) await setMany(updates);
}

/** Matches a collection's list responses (`/meals`, `/meals?search=...`) but not its
 * detail responses or other endpoints nested under it (`/meals/5`, `/meals/cuisines`). */
export function isListPath(basePath: string): (path: string) => boolean {
  return (path) => path === basePath || path.startsWith(basePath + '?');
}
