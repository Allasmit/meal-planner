<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { auth, isLoggedIn } from '$lib/stores/auth';
  import { api } from '$lib/api';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const PUBLIC_ROUTES = ['/login', '/setup'];

  // ─── Dark mode ───────────────────────────────────────────────────────────────
  let darkMode = $state(false);

  onMount(async () => {
    darkMode = localStorage.getItem('darkMode') === 'true';
    applyDarkMode(darkMode);

    try {
      const status = await api.setupStatus() as any;
      if (status.setupRequired) { goto('/setup'); return; }
      const user = await api.me() as any;
      auth.setUser(user);
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
