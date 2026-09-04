import { writable } from 'svelte/store';
import { getQueue, removeFromQueue } from './queue';

export interface SyncState {
  online: boolean;
  pending: number;
  syncing: boolean;
}

function createSyncStore() {
  const { subscribe, update } = writable<SyncState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    syncing: false,
  });
  return { subscribe, update };
}

export const syncStatus = createSyncStore();

let initialized = false;
let flushing = false;

export async function refreshPendingCount(): Promise<void> {
  const queue = await getQueue();
  syncStatus.update((s) => ({ ...s, pending: queue.length }));
}

/** Replays queued offline mutations against the real API, in order. Stops on
 * the first network failure (left queued for the next attempt); drops
 * mutations the server permanently rejects (4xx) so the queue can't jam. */
export async function flushQueue(): Promise<void> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return;
  flushing = true;
  syncStatus.update((s) => ({ ...s, syncing: true }));
  try {
    const queue = await getQueue();
    for (const item of queue) {
      try {
        const res = await fetch(`/api${item.path}`, {
          method: item.method,
          credentials: 'include',
          headers: item.body ? { 'Content-Type': 'application/json' } : undefined,
          body: item.body,
        });
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          if (!res.ok) {
            console.warn('Dropping offline mutation rejected by server', item, res.status);
          }
          await removeFromQueue(item.id);
        } else {
          // Server/network error - stop here, retry later.
          break;
        }
      } catch {
        // Still offline - stop processing, remaining items stay queued.
        break;
      }
    }
  } finally {
    flushing = false;
    await refreshPendingCount();
    syncStatus.update((s) => ({ ...s, syncing: false }));
  }
}

/** Wires up online/offline listeners and periodic retry. Safe to call multiple times. */
export function initSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  syncStatus.update((s) => ({ ...s, online: navigator.onLine }));
  refreshPendingCount();
  if (navigator.onLine) flushQueue();

  window.addEventListener('online', () => {
    syncStatus.update((s) => ({ ...s, online: true }));
    flushQueue();
  });
  window.addEventListener('offline', () => {
    syncStatus.update((s) => ({ ...s, online: false }));
  });

  // Fallback in case an 'online' event is missed.
  setInterval(() => {
    if (navigator.onLine) flushQueue();
  }, 30_000);
}
