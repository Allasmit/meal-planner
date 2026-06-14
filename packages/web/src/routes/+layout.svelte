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

  onMount(async () => {
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

  $effect(() => {
    if (!$auth.loading && !$isLoggedIn && !PUBLIC_ROUTES.includes($page.url.pathname)) {
      goto('/login');
    }
  });

  const navItems = [
    { href: '/planner', label: 'Planner', icon: '📅' },
    { href: '/meals', label: 'Meals', icon: '🍽️' },
    { href: '/shopping-list', label: 'Shopping', icon: '🛒' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
    { href: '/import', label: 'Import', icon: '📥' },
  ];
</script>

{#if $auth.loading}
  <div class="flex items-center justify-center min-h-screen">
    <div class="animate-spin rounded-full h-10 w-10 border-4 border-green-600 border-t-transparent"></div>
  </div>
{:else if PUBLIC_ROUTES.includes($page.url.pathname)}
  {@render children()}
{:else if $isLoggedIn}
  <div class="flex flex-col min-h-screen">
    <header class="bg-green-700 text-white px-4 py-3 flex items-center justify-between shadow-md sticky top-0 z-40">
      <span class="font-bold text-lg">🥘 Meal Planner</span>
      <span class="text-sm opacity-80">{$auth.user?.displayName}</span>
    </header>
    <main class="flex-1 pb-20">
      {@render children()}
    </main>
    <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex-1 flex flex-col items-center py-2 text-xs gap-1 transition-colors
            {$page.url.pathname.startsWith(item.href) ? 'text-green-700 font-semibold' : 'text-gray-500 hover:text-green-700'}"
        >
          <span class="text-xl">{item.icon}</span>
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
{/if}
