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

  const navItems = [
    { href: '/planner', label: 'Planner', icon: '📅' },
    { href: '/meals', label: 'Meals', icon: '🍽️' },
    { href: '/family', label: 'Family', icon: '👨‍👩‍👧' },
    { href: '/shopping-list', label: 'Shopping', icon: '🛒' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
    { href: '/import', label: 'Import', icon: '📥' },
  ];
</script>

{#if $auth.loading}
  <div class="flex items-center justify-center min-h-screen" style="background: var(--color-bg)">
    <div class="animate-spin rounded-full h-10 w-10 border-4 border-green-600 border-t-transparent"></div>
  </div>
{:else if PUBLIC_ROUTES.includes($page.url.pathname)}
  {@render children()}
{:else if $isLoggedIn}
  <div class="flex flex-col min-h-screen" style="background: var(--color-bg)">
    <header class="text-white px-4 py-3 flex items-center justify-between shadow-md sticky top-0 z-40 print:hidden" style="background: var(--color-header-bg)">
      <span class="font-bold text-lg">🥘 Meal Planner</span>
      <div class="flex items-center gap-3">
        <OfflineIndicator />
        <span class="text-sm opacity-80">{$auth.user?.displayName}</span>
        <button
          onclick={toggleDarkMode}
          class="text-lg leading-none opacity-80 hover:opacity-100 transition-opacity"
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >{darkMode ? '☀️' : '🌙'}</button>
      </div>
    </header>
    <main class="flex-1 pb-20 print:pb-0">
      {@render children()}
    </main>
    <nav class="fixed bottom-0 left-0 right-0 border-t flex z-40 print:hidden" style="background: var(--color-nav-bg); border-color: var(--color-border)">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex-1 flex flex-col items-center py-2 text-xs gap-0.5 transition-colors"
          style="{$page.url.pathname.startsWith(item.href) ? 'color: var(--color-accent); font-weight: 600;' : 'color: var(--color-text-muted);'}"
        >
          <span class="text-xl">{item.icon}</span>
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
{/if}
