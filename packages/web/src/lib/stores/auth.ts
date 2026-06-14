import { writable, derived } from 'svelte/store';
import type { User } from './types';

function createAuthStore() {
  const { subscribe, set, update } = writable<{
    user: User | null;
    loading: boolean;
  }>({ user: null, loading: true });

  return {
    subscribe,
    setUser: (user: User | null) => update((s) => ({ ...s, user, loading: false })),
    setLoading: (loading: boolean) => update((s) => ({ ...s, loading })),
    clear: () => set({ user: null, loading: false }),
  };
}

export const auth = createAuthStore();
export const isAdmin = derived(auth, ($auth) => $auth.user?.role === 'admin');
export const isLoggedIn = derived(auth, ($auth) => $auth.user !== null);
