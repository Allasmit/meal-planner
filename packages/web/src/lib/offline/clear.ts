import { clear } from './db';
import { clearPageCache } from './page-cache';
import { refreshPendingCount } from './sync';

const LOCAL_STORAGE_KEYS = ['menu-plan-last-synced-at', 'menu-plan-last-full-precache-at', 'menu-plan-last-full-precache-v2-at', 'menu-plan-offline-at'];

/**
 * Removes everything the offline layer stored on this device (cached API responses, the
 * unsynced-changes outbox, cached page HTML and sync bookkeeping). Call on sign-out so the
 * next person using the device cannot see the previous user's data.
 */
export async function clearOfflineData(): Promise<void> {
  await clear().catch(() => {});
  await clearPageCache();
  if (typeof caches !== 'undefined') await caches.delete('images-cache').catch(() => {});
  try {
    for (const key of LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('menu-plan-shopping-ticks:')) localStorage.removeItem(key);
    }
  } catch {
    /* localStorage unavailable - nothing to clear */
  }
  await refreshPendingCount();
}
