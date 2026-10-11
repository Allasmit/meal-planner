<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { auth, isLoggedIn } from '$lib/stores/auth';
  import { api } from '$lib/api';
  import { initSync, syncStatus } from '$lib/offline/sync';
  import { clearPageCache } from '$lib/offline/page-cache';
  import { getCachedGet } from '$lib/offline/cache';
  import type { User } from '$lib/types';
  import { runFullPrecache } from '$lib/offline/precache';
  import { initInstall } from '$lib/pwa-install';
  import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const PUBLIC_ROUTES = ['/login', '/setup'];

  // ─── Dark mode ───────────────────────────────────────────────────────────────
  let darkMode = $state(false);

  onMount(async () => {
    initInstall();
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
    }
    // Snapshots from older versions are no longer used (the service worker serves the app shell).
    clearPageCache();

    // Re-run the full offline precache whenever the server becomes reachable
    // again, so data added/changed while offline (by this device or others)
    // eventually makes it into the offline cache too. Throttled internally.
    let wasOnline = true;
    syncStatus.subscribe(({ online }) => {
      if (online && !wasOnline) runFullPrecache();
      wasOnline = online;
    });

    // A user who was signed in on this device last time sees the app straight away (from the
    // offline cache) instead of a spinner while the server is asked - which, on a connection that
    // hangs, would take seconds. The checks below still run and sign them out if the session ended.
    const [cachedStatus, cachedUser] = await Promise.all([
      getCachedGet<{ setupRequired: boolean }>('/auth/setup-status'),
      getCachedGet<User>('/auth/me'),
    ]).catch(() => [undefined, undefined]);
    if (cachedUser && cachedStatus?.setupRequired === false) auth.setUser(cachedUser);

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
    // Colour the phone's status bar like the header, as a native app would.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#0c1311' : '#ffffff');
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
    { href: '/shopping-list', label: 'Shopping', icon: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
    { href: '/import', label: 'Import', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' },
  ];

  // ─── Header: page title, back button, hide-on-scroll ───────────────────────
  const TITLES: [string, string][] = [
    ['/planner', 'Planner'],
    ['/meals', 'Meals'],
    ['/shopping-list', 'Shopping'],
    ['/import', 'Import'],
    ['/settings', 'Settings'],
  ];
  const pathname = $derived($page.url.pathname);
  const pageTitle = $derived(TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Meal Planner');
  // Detail pages (/meals/new, /meals/12, /meals/12/edit) get a back arrow.
  const isDetail = $derived(/^\/meals\/.+/.test(pathname));

  function goBack() {
    if (history.length > 1) history.back();
    else goto('/meals');
  }

  let scrolled = $state(false);
  let hidden = $state(false);
  let lastY = 0;

  function onScroll() {
    const y = window.scrollY;
    scrolled = y > 4;
    // Only auto-hide on phones; on wider screens the bar stays put.
    const mobile = window.matchMedia('(max-width: 639px)').matches;
    if (!mobile || y < 56) hidden = false;
    else if (Math.abs(y - lastY) > 8) hidden = y > lastY;
    lastY = y;
  }
</script>

<svelte:window onscroll={onScroll} />

{#if $auth.loading}
  <div class="flex items-center justify-center min-h-screen" style="background: var(--color-bg)">
    <div class="animate-spin rounded-full h-10 w-10 border-4 border-t-transparent" style="border-color: var(--color-accent); border-top-color: transparent"></div>
  </div>
{:else if PUBLIC_ROUTES.includes($page.url.pathname)}
  {@render children()}
{:else if $isLoggedIn}
  <div class="flex flex-col min-h-screen" style="background: var(--color-bg)">
    <header
      class="px-3 sm:px-4 flex items-center justify-between gap-2 sticky top-0 z-40 backdrop-blur-xl print:hidden transition-[transform,box-shadow] duration-200"
      style="background: var(--color-header-bg); color: var(--color-header-text); padding-top: max(0.5rem, env(safe-area-inset-top)); padding-bottom: 0.5rem; transform: translateY({hidden ? '-100%' : '0'}); box-shadow: {scrolled ? '0 1px 0 var(--color-border), 0 4px 12px -6px rgb(16 24 40 / 0.12)' : 'none'}"
    >
      <div class="flex items-center gap-2 min-w-0">
        {#if isDetail}
          <button
            onclick={goBack}
            class="w-10 h-10 -ml-1 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        {:else}
          <a href="/planner" class="hidden sm:flex items-center gap-2.5 font-bold text-lg tracking-tight shrink-0">
            <span class="w-8 h-8 rounded-xl flex items-center justify-center text-base text-white shadow-sm" style="background: linear-gradient(135deg, var(--color-accent), #0f6c4b)">🥘</span>
            <span>Meal Planner</span>
          </a>
        {/if}
        <!-- Phones show the current page; wider screens already have the brand. -->
        <span class="text-lg font-bold tracking-tight truncate {isDetail ? '' : 'sm:hidden'}">
          {isDetail ? 'Meals' : pageTitle}
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <OfflineIndicator />
        <UserMenu {darkMode} ontoggledark={toggleDarkMode} />
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
