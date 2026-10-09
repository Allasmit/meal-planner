<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto, afterNavigate } from '$app/navigation';
  import { auth, isLoggedIn } from '$lib/stores/auth';
  import { api } from '$lib/api';
  import { initSync } from '$lib/offline/sync';
  import { cacheCurrentPage, clearPageCache } from '$lib/offline/page-cache';
  import { runFullPrecache } from '$lib/offline/precache';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const PUBLIC_ROUTES = ['/login', '/setup'];

  // ─── Dark mode ───────────────────────────────────────────────────────────────
  let darkMode = $state(false);

  onMount(async () => {
    darkMode = localStorage.getItem('darkMode') === 'true';
    applyDarkMode(darkMode);
    initSync();

    // Actually register the service worker. vite-plugin-pwa's automatic
    // <script> injection never runs for SvelteKit's server-rendered HTML, so
    // without this call the app never installs a service worker and offline
    // support silently does nothing.
    if ('serviceWorker' in navigator) {
      import('virtual:pwa-register').then(({ registerSW }) => {
        registerSW({ immediate: true });
      });

      // A new service worker version has just taken control (i.e. a fresh
      // deploy was picked up). Wipe the cached page-snapshot cache - it may
      // hold HTML from the previous build referencing hashed asset files
      // Workbox's precache has already discarded, which otherwise breaks
      // hydration on a later offline reload (see clearPageCache() for
      // details). Re-cache the current route immediately so it stays
      // available offline right away.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearPageCache().then(() => {
          cacheCurrentPage();
          // A fresh deploy may have added/changed routes or meals - redo the
          // full precache (ignoring the usual throttle) so every page and
          // meal is available offline again under the new build.
          runFullPrecache({ force: true });
        });
      });
    }

    // Re-run the full offline precache whenever the browser regains
    // connectivity, so data added/changed while offline (by this device or
    // others) eventually makes it into the offline cache too. Throttled
    // internally - this is just reacting to a real connectivity change, not
    // new background polling.
    window.addEventListener('online', () => runFullPrecache());

    try {
      // Run both auth checks in parallel rather than sequentially awaiting
      // one then the other: each is bounded by FETCH_TIMEOUT_MS on its own,
      // so awaiting them one at a time could stack up to two full timeouts
      // (12s) before the spinner clears on a device that's "offline" in the
      // silently-unreachable sense (see api.ts). Running them together
      // bounds the wait to a single timeout. `api.me()` is expected to
      // reject with 401 during first-time setup (no admin account exists
      // yet) - catch it to `null` so that rejection doesn't short-circuit
      // Promise.all before `status.setupRequired` can be checked below.
      const [status, user] = await Promise.all([
        api.setupStatus() as Promise<any>,
        api.me().catch(() => null) as Promise<any>,
      ]);
      if (status.setupRequired) { goto('/setup'); return; }
      if (!user) throw new Error('Not authenticated');
      auth.setUser(user);
      // Logged in and online: proactively cache every page and every meal
      // so the app works fully offline (like a native app) even for
      // pages/meals that were never actually opened.
      runFullPrecache();
    } catch {
      auth.setUser(null);
    }
    auth.setLoading(false);
  });

  // Cache the current route's full HTML document (for offline reloads) after
  // every navigation, including the initial one. See page-cache.ts for why
  // this is needed instead of relying on the service worker alone.
  afterNavigate(() => {
    cacheCurrentPage();
  });

  function toggleDarkMode() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', String(darkMode));
    applyDarkMode(darkMode);
  }

  function applyDarkMode(on: boolean) {
    if (on) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  $effect(() => {
    if (!$auth.loading && !$isLoggedIn && !PUBLIC_ROUTES.includes($page.url.pathname)) {
      goto('/login');
    }
  });

  // Stroke-based 24px icons (Lucide-style paths) so the nav looks crisp and
  // inherits the active/inactive colour instead of relying on emoji rendering.
  const navItems = [
    { href: '/planner', label: 'Planner', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
    { href: '/meals', label: 'Meals', icon: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7' },
    { href: '/family', label: 'Family', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { href: '/shopping-list', label: 'Shopping', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
    { href: '/import', label: 'Import', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' },
    { href: '/settings', label: 'Settings', icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  ];

  const initials = $derived(
    ($auth.user?.displayName ?? '?').trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  );
</script>

{#if $auth.loading}
  <div class="flex items-center justify-center min-h-screen" style="background: var(--color-bg)">
    <div class="animate-spin rounded-full h-10 w-10 border-4 border-t-transparent" style="border-color: var(--color-accent); border-top-color: transparent"></div>
  </div>
{:else if PUBLIC_ROUTES.includes($page.url.pathname)}
  {@render children()}
{:else if $isLoggedIn}
  <div class="flex flex-col min-h-screen" style="background: var(--color-bg)">
    <header
      class="px-4 py-2.5 flex items-center justify-between sticky top-0 z-40 border-b backdrop-blur-xl print:hidden"
      style="background: var(--color-header-bg); color: var(--color-header-text); border-color: var(--color-border); padding-top: max(0.625rem, env(safe-area-inset-top))"
    >
      <a href="/planner" class="flex items-center gap-2.5 font-bold text-lg tracking-tight">
        <span class="w-8 h-8 rounded-xl flex items-center justify-center text-base text-white shadow-sm" style="background: linear-gradient(135deg, var(--color-accent), #0f6c4b)">🥘</span>
        <span>Meal Planner</span>
      </a>
      <div class="flex items-center gap-2">
        <OfflineIndicator />
        <button
          onclick={toggleDarkMode}
          class="w-9 h-9 rounded-full flex items-center justify-center text-base hover:bg-black/5 dark:hover:bg-white/10"
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >{darkMode ? '☀️' : '🌙'}</button>
        <span
          class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold"
          style="background: var(--color-accent-light); color: var(--color-accent-text)"
          title={$auth.user?.displayName}
          aria-label={$auth.user?.displayName}
        >{initials}</span>
      </div>
    </header>
    <main class="flex-1 pb-24 print:pb-0">
      {@render children()}
    </main>
    <nav
      class="fixed bottom-0 left-0 right-0 border-t flex justify-center z-40 backdrop-blur-xl print:hidden"
      style="background: var(--color-nav-bg); border-color: var(--color-border); padding-bottom: env(safe-area-inset-bottom)"
      aria-label="Main"
    >
      <div class="flex w-full max-w-3xl px-1">
        {#each navItems as item}
          {@const active = $page.url.pathname.startsWith(item.href)}
          <a
            href={item.href}
            aria-current={active ? 'page' : undefined}
            class="flex-1 flex flex-col items-center pt-2 pb-1.5 text-[11px] gap-1 transition-colors"
            style="color: {active ? 'var(--color-accent)' : 'var(--color-text-muted)'}; font-weight: {active ? 600 : 500}"
          >
            <span
              class="h-7 w-12 rounded-full flex items-center justify-center transition-colors"
              style="background: {active ? 'var(--color-accent-light)' : 'transparent'}"
            >
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width={active ? 2.2 : 1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.icon} /></svg>
            </span>
            {item.label}
          </a>
        {/each}
      </div>
    </nav>
  </div>
{/if}
