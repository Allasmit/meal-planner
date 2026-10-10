import { goto } from '$app/navigation';
import { api } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { flushQueue } from '$lib/offline/sync';
import { queueLength } from '$lib/offline/queue';
import { clearOfflineData } from '$lib/offline/clear';

/** Sign the user out, warning first if offline changes would be lost. */
export async function logout(): Promise<void> {
  // Push any offline changes first; they would be lost along with the local cache.
  await flushQueue();
  const pending = await queueLength();
  if (pending > 0 && !confirm(`${pending} change(s) haven't synced to the server yet and will be lost if you sign out. Sign out anyway?`)) {
    return;
  }

  try {
    await api.logout();
  } catch {
    /* Offline: the server session simply expires on its own. */
  }
  await clearOfflineData();
  auth.clear();
  goto('/login');
}
