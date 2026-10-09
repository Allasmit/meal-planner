import { clear } from './db';
import { clearPageCache } from './page-cache';
import { refreshPendingCount } from './sync';

const LOCAL_STORAGE_KEYS = ['menu-plan-last-synced-at', 'menu-plan-last-full-precache-at'];

/**
 * Removes everything the offline layer stored on this device (cached API responses, the
 * unsynced-changes outbox, cached page HTML and sync bookkeeping). Call on sign-out so the
 * next person using the device cannot see the previous user's data.
 */
export async function clearOfflineData(): Promise<void> {
  await clear().catch(() => {});
  await clearPageCache();
  try {
    for (const key of LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable - nothing to clear */
  }
  await refreshPendingCount();
}
