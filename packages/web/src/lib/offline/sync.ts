import { writable, get } from 'svelte/store';
import { getQueue, getFailed, removeFromQueue, markFailed, rewriteTempId, mentionsTempId } from './queue';

const LAST_SYNCED_KEY = 'menu-plan-last-synced-at';
// When the server was last found unreachable. A reload shortly after starts out offline (and
// re-checks at once) instead of making the first requests wait to discover it all over again.
const OFFLINE_AT_KEY = 'menu-plan-offline-at';
const REMEMBER_OFFLINE_MS = 2 * 60 * 1000;
const HEALTH_CHECK_TIMEOUT_MS = 4_000;
// Sending one queued change. Generous, but bounded: without a timeout a request to an unreachable
// server can hang for minutes, leaving the indicator stuck on "Syncing…" and blocking every later sync.
const FLUSH_REQUEST_TIMEOUT_MS = 15_000;
// While offline, re-check the server in the background - quickly at first, then backing off.
const PROBE_MIN_DELAY_MS = 5_000;
const PROBE_MAX_DELAY_MS = 60_000;

function readLastSyncedAt(): number | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  return raw ? Number(raw) : null;
}

export interface SyncState {
  /** Whether the API server is reachable right now: updated from real request
   * outcomes (see markSynced/markOffline in api.ts), the browser's online/offline
   * events, and health checks (manual "Sync now", and background re-checks that
   * run only while offline). */
  online: boolean;
  pending: number;
  /** Changes the server rejected; they stay listed until the user retries or dismisses them. */
  failed: number;
  syncing: boolean;
  /** Epoch ms of the last confirmed successful round trip to the server. */
  lastSyncedAt: number | null;
}

function wasRecentlyOffline(): boolean {
  try {
    const at = Number(localStorage.getItem(OFFLINE_AT_KEY));
    return at > 0 && Date.now() - at < REMEMBER_OFFLINE_MS;
  } catch {
    return false;
  }
}

function createSyncStore() {
  const { subscribe, update } = writable<SyncState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine && !wasRecentlyOffline() : true,
    pending: 0,
    failed: 0,
    syncing: false,
    lastSyncedAt: readLastSyncedAt(),
  });
  return { subscribe, update };
}

export const syncStatus = createSyncStore();

let initialized = false;
let flushing = false;

export async function refreshPendingCount(): Promise<void> {
  const [queue, failed] = await Promise.all([getQueue(), getFailed()]);
  syncStatus.update((s) => ({ ...s, pending: queue.length, failed: failed.length }));
}

/** Call after any confirmed successful request to the API - marks the app as
 * online and records "last synced" time (persisted so it survives reloads). */
export function markSynced(): void {
  const now = Date.now();
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(now));
    localStorage.removeItem(OFFLINE_AT_KEY);
  } catch {
    /* localStorage unavailable (private mode, etc.) - non-fatal */
  }
  stopProbing();
  const wasOffline = !get(syncStatus).online;
  syncStatus.update((s) => ({ ...s, online: true, lastSyncedAt: now }));
  // Back online: send whatever was changed while offline without waiting for the user.
  if (wasOffline) flushQueue();
}

/** Call immediately when a request fails due to a network error, so the UI
 * reflects reality and later requests go straight to the cache. */
export function markOffline(): void {
  try {
    localStorage.setItem(OFFLINE_AT_KEY, String(Date.now()));
  } catch {
    /* localStorage unavailable - non-fatal */
  }
  syncStatus.update((s) => (s.online ? { ...s, online: false } : s));
  scheduleProbe();
}

/** Synchronous reachability check for api.ts's request(). Once any request has
 * failed (markOffline), this stays false - so every request is answered from the
 * cache straight away instead of each one waiting for its own timeout - until a
 * background health check (or any other request) reaches the server again.
 * `navigator.onLine` alone is not enough: it stays `true` on a phone that's on
 * wifi/cellular but can't reach the (home) server. */
export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  return get(syncStatus).online;
}

// ─── Background re-checks while offline ──────────────────────────────────────
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let probeDelay = PROBE_MIN_DELAY_MS;

function scheduleProbe(): void {
  // Only in the running app (initSync), never in unit tests or during SSR.
  if (!initialized || probeTimer !== undefined) return;
  probeTimer = setTimeout(() => {
    probeTimer = undefined;
    probeDelay = Math.min(probeDelay * 2, PROBE_MAX_DELAY_MS);
    pingServer(); // on failure, markOffline() schedules the next check
  }, probeDelay);
}

function stopProbing(): void {
  if (probeTimer !== undefined) clearTimeout(probeTimer);
  probeTimer = undefined;
  probeDelay = PROBE_MIN_DELAY_MS;
}

let pingInFlight: Promise<boolean> | null = null;
let lastFailedCheckAt = 0;
// A failed health check is trusted for this long by checkServer().
const TRUST_FAILED_CHECK_MS = 15_000;

/** For a request that has nothing cached to fall back on while offline: is the server back?
 * Answers at once if a health check failed only moments ago (rather than making every such
 * request wait for another one); otherwise runs - or joins - a health check. */
export function checkServer(): Promise<boolean> {
  if (Date.now() - lastFailedCheckAt < TRUST_FAILED_CHECK_MS) return Promise.resolve(false);
  return pingServer();
}

/** Pings the lightweight /api/health endpoint to verify the server is truly
 * reachable (distinct from the browser merely having a network interface
 * up). Updates `syncStatus.online` (and so flushes the queue on reconnect).
 * Concurrent callers share one request. */
export function pingServer(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    markOffline();
    return Promise.resolve(false);
  }
  pingInFlight ??= (async () => {
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
    lastFailedCheckAt = Date.now();
    markOffline();
    return false;
  })().finally(() => {
    pingInFlight = null;
  });
  return pingInFlight;
}

/** Replays queued offline mutations against the real API, in order.
 * - Success: removed; if it created a record, later changes that used its temporary id are rewritten to the real id.
 * - 401 (session expired) or a network/server error: stop and keep everything queued for the next attempt.
 * - Any other 4xx: the server permanently refuses it, so it is moved to the "failed" list (not silently dropped),
 *   and later changes that depended on it are failed too. */
export async function flushQueue(): Promise<void> {
  if (flushing || !isOnline()) return;
  flushing = true;
  syncStatus.update((s) => ({ ...s, syncing: true }));
  try {
    const brokenTempIds: number[] = [];
    const seen = new Set<string>();
    for (;;) {
      // Re-read every time: sending a create rewrites temporary ids in the changes still waiting behind it.
      const item = (await getQueue()).find((i) => !seen.has(i.id));
      if (!item) break;
      seen.add(item.id);

      const dependsOnBroken = brokenTempIds.find((t) => mentionsTempId(item, t));
      if (dependsOnBroken !== undefined) {
        await markFailed(item.id, 'Depends on an earlier change that could not be saved.');
        if (item.tempId !== undefined) brokenTempIds.push(item.tempId);
        continue;
      }

      try {
        const res = await fetch(`/api${item.path}`, {
          method: item.method,
          credentials: 'include',
          headers: item.body ? { 'Content-Type': 'application/json' } : undefined,
          body: item.body,
          signal: AbortSignal.timeout(FLUSH_REQUEST_TIMEOUT_MS),
        });

        if (res.status === 401) break; // signed out: keep the change so it can be sent after signing back in

        if (res.ok) {
          if (item.tempId !== undefined) {
            const created = await res.json().catch(() => null);
            if (created && typeof created.id === 'number') await rewriteTempId(item.tempId, created.id);
          }
          await removeFromQueue(item.id);
          markSynced();
        } else if (res.status >= 400 && res.status < 500) {
          const body = await res.json().catch(() => null);
          const detail = typeof body?.error === 'string' ? body.error : `The server refused this change (HTTP ${res.status}).`;
          console.warn('Offline change rejected by server', item, res.status);
          await markFailed(item.id, detail);
          if (item.tempId !== undefined) brokenTempIds.push(item.tempId);
          markSynced();
        } else {
          markOffline(); // server/network error - retry later
          break;
        }
      } catch {
        markOffline(); // still offline - remaining items stay queued
        break;
      }
    }
  } finally {
    flushing = false;
    await refreshPendingCount();
    syncStatus.update((s) => ({ ...s, syncing: false }));
  }
}

/** Wires up connectivity listeners. While the server is unreachable it is
 * re-checked in the background (backing off to once a minute); while online
 * there is no polling. Safe to call multiple times. */
export function initSync(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  refreshPendingCount();
  pingServer();

  window.addEventListener('online', () => pingServer());
  window.addEventListener('offline', () => markOffline());
  // Phones suspend timers in the background; check straight away when the app is reopened.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !get(syncStatus).online) pingServer();
  });
}
