import { writable, get } from 'svelte/store';
import { getQueue, removeFromQueue } from './queue';

const LAST_SYNCED_KEY = 'menu-plan-last-synced-at';
const HEALTH_CHECK_TIMEOUT_MS = 4_000;

function readLastSyncedAt(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  return raw ? Number(raw) : null;
}

export interface SyncState {
  /** Best-effort guess at whether the API server is reachable right now:
   * updated from real request outcomes (see markSynced/markOffline in
   * api.ts), the browser's online/offline events, and manual "Sync now"
   * clicks - there is no background polling. */
  online: boolean;
  pending: number;
  syncing: boolean;
  /** Epoch ms of the last confirmed successful round trip to the server. */
  lastSyncedAt: number | null;
}

function createSyncStore() {
  const { subscribe, update } = writable<SyncState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    syncing: false,
    lastSyncedAt: readLastSyncedAt(),
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

/** Call after any confirmed successful request to the API - marks the app as
 * online and records "last synced" time (persisted so it survives reloads). */
export function markSynced(): void {
  const now = Date.now();
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(now));
  } catch {
    /* localStorage unavailable (private mode, etc.) - non-fatal */
  }
  syncStatus.update((s) => ({ ...s, online: true, lastSyncedAt: now }));
}

/** Call immediately when a request fails due to a network error, so the UI
 * reflects reality without waiting for the next periodic health check. */
export function markOffline(): void {
  lastOfflineAt = Date.now();
  syncStatus.update((s) => (s.online ? { ...s, online: false } : s));
}

// How long isOnline() trusts a "we're offline" verdict before letting a real
// request through again to re-check for itself (see isOnline() below).
const RECHECK_AFTER_MS = 8_000;
let lastOfflineAt: number | null = null;

/** Synchronous best-effort reachability check for api.ts's request(): once
 * ANY request has failed and called markOffline(), this returns false
 * immediately (no network round trip) for up to RECHECK_AFTER_MS, so
 * requests fall back to cache fast instead of each paying the full timeout.
 * This is distinct from (and more reliable than) `navigator.onLine`, which
 * stays `true` on a real device that's merely *associated* with wifi/
 * cellular but has no actual route to the server.
 *
 * IMPORTANT: this deliberately does NOT latch "offline" forever. A single
 * transient failure (e.g. a slow response caused by unrelated background
 * traffic like the full-app precache, or a brief server hiccup) would
 * otherwise mark the app offline and keep it stuck there until a browser
 * `online` event fires (it won't - the browser never actually went offline)
 * or the user notices and clicks "Sync now" - during which every GET with
 * nothing cached yet would incorrectly be treated as offline. Instead, once
 * RECHECK_AFTER_MS has passed since the last failure, this returns `true`
 * again so the next request attempts the network for real; if the server is
 * genuinely still unreachable it will fail again (and re-arm the window via
 * markOffline()), but if it was just a transient blip the very next request
 * succeeds and calls markSynced(), self-healing without any explicit user
 * action or timer-based polling. */
export function isOnline(): boolean {
  const state = get(syncStatus);
  if (state.online) return true;
  return lastOfflineAt !== null && Date.now() - lastOfflineAt > RECHECK_AFTER_MS;
}

/** Pings the lightweight /api/health endpoint to verify the server is truly
 * reachable (distinct from the browser merely having a network interface
 * up). Updates `syncStatus.online` and triggers a queue flush on success. */
export async function pingServer(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    markOffline();
    return false;
  }
  try {
    const res = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (res.ok) {
      markSynced();
      flushQueue();
      return true;
    }
  } catch {
    /* fall through to markOffline below */
  }
  markOffline();
  return false;
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
          markSynced();
        } else {
          // Server/network error - stop here, retry later.
          markOffline();
          break;
        }
      } catch {
        // Still offline - stop processing, remaining items stay queued.
        markOffline();
        break;
      }
    }
  } finally {
    flushing = false;
    await refreshPendingCount();
    syncStatus.update((s) => ({ ...s, syncing: false }));
  }
}

/** Wires up online/offline browser event listeners (no polling - just reacts
 * to real connectivity changes and lets the user trigger a manual sync via
 * the "Sync now" button, which calls pingServer()/flushQueue() directly).
 * Safe to call multiple times. */
export function initSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  refreshPendingCount();
  pingServer();

  window.addEventListener('online', () => pingServer());
  window.addEventListener('offline', () => markOffline());
}

