import { createStore, get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';

// Dedicated IndexedDB store for offline caching of GET responses and the
// outbox of mutations made while offline.
const store = createStore('menu-plan-offline-db', 'kv-store');

export function get<T>(key: string): Promise<T | undefined> {
  return idbGet<T>(key, store);
}

export function set(key: string, value: unknown): Promise<void> {
  return idbSet(key, value, store);
}

export function del(key: string): Promise<void> {
  return idbDel(key, store);
}

export function keys(): Promise<IDBValidKey[]> {
  return idbKeys(store);
}
