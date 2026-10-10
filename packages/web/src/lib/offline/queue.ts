import { get, set, del, keys } from './db';

const ITEM_PREFIX = 'outbox:';
const LEGACY_KEY = 'outbox-queue';

export interface QueuedMutation {
  id: string;
  method: string;
  path: string;
  body?: string;
  createdAt: number;
  /** Negative placeholder id handed to the UI for a record created offline (POST); replaced once the server assigns the real id. */
  tempId?: number;
  status: 'pending' | 'failed';
  /** Why the server rejected the change (only for status 'failed'). */
  error?: string;
}

/** Random unique id. `crypto.randomUUID()` only exists on secure (HTTPS/localhost) pages in recent
 * browsers - on a plain-HTTP home-server address or an older phone it is missing and every offline
 * change failed with "crypto.randomUUID is not a function" - so fall back to getRandomValues,
 * which is available everywhere. */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every change is its own IndexedDB record, so two changes made at the same moment can never
// overwrite each other the way a read-modify-write of one shared array could.
let counter = 0;
function newKey(): string {
  counter = (counter + 1) % 1_000_000;
  return `${ITEM_PREFIX}${Date.now().toString().padStart(15, '0')}-${counter.toString().padStart(6, '0')}-${randomId()}`;
}

/** Converts the single-array queue used by older versions into per-item records (once). */
async function migrateLegacyQueue(): Promise<void> {
  const legacy = await get<Omit<QueuedMutation, 'status'>[]>(LEGACY_KEY);
  if (!legacy) return;
  for (const item of legacy) {
    const key = `${ITEM_PREFIX}${String(item.createdAt).padStart(15, '0')}-${(counter++).toString().padStart(6, '0')}-${item.id}`;
    await set(key, { ...item, status: 'pending' } satisfies QueuedMutation);
  }
  await del(LEGACY_KEY);
}

async function loadAll(): Promise<{ key: string; item: QueuedMutation }[]> {
  await migrateLegacyQueue();
  const all = (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith(ITEM_PREFIX)).sort();
  const result: { key: string; item: QueuedMutation }[] = [];
  for (const key of all) {
    const item = await get<QueuedMutation>(key);
    if (item) result.push({ key, item });
  }
  return result;
}

async function keyFor(id: string): Promise<string | undefined> {
  return (await loadAll()).find((e) => e.item.id === id)?.key;
}

/** Changes still waiting to be sent, oldest first. */
export async function getQueue(): Promise<QueuedMutation[]> {
  return (await loadAll()).map((e) => e.item).filter((i) => i.status === 'pending');
}

/** Changes the server refused; kept so the user can see what was lost instead of it silently disappearing. */
export async function getFailed(): Promise<QueuedMutation[]> {
  return (await loadAll()).map((e) => e.item).filter((i) => i.status === 'failed');
}

export async function enqueueMutation(method: string, path: string, body?: string, tempId?: number): Promise<QueuedMutation> {
  const item: QueuedMutation = { id: randomId(), method, path, body, createdAt: Date.now(), tempId, status: 'pending' };
  await set(newKey(), item);
  return item;
}

export async function removeFromQueue(id: string): Promise<void> {
  const key = await keyFor(id);
  if (key) await del(key);
}

export async function markFailed(id: string, error: string): Promise<void> {
  const key = await keyFor(id);
  if (!key) return;
  const item = await get<QueuedMutation>(key);
  if (item) await set(key, { ...item, status: 'failed', error });
}

/** Puts a failed change back in the queue (it keeps its original position). */
export async function retryFailed(id: string): Promise<void> {
  const key = await keyFor(id);
  if (!key) return;
  const item = await get<QueuedMutation>(key);
  if (item) await set(key, { ...item, status: 'pending', error: undefined });
}

export async function queueLength(): Promise<number> {
  return (await getQueue()).length;
}

function tempIdPattern(tempId: number, flags = ''): RegExp {
  const escaped = String(tempId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\d.])${escaped}(?!\\d)`, flags);
}

/** Replaces a temporary id with the real one in the path and body of every change that is still waiting. */
export function replaceTempId(text: string, tempId: number, realId: number): string {
  return text.replace(tempIdPattern(tempId, 'g'), String(realId));
}

export function mentionsTempId(item: Pick<QueuedMutation, 'path' | 'body'>, tempId: number): boolean {
  const re = tempIdPattern(tempId);
  return re.test(item.path) || (item.body !== undefined && re.test(item.body));
}

export async function rewriteTempId(tempId: number, realId: number): Promise<void> {
  for (const { key, item } of await loadAll()) {
    if (item.status !== 'pending') continue;
    const path = replaceTempId(item.path, tempId, realId);
    const body = item.body === undefined ? undefined : replaceTempId(item.body, tempId, realId);
    if (path !== item.path || body !== item.body) await set(key, { ...item, path, body });
  }
}
