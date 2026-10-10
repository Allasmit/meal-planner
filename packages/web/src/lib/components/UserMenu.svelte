<script lang="ts">
  import { page } from '$app/stores';
  import { auth, isAdmin } from '$lib/stores/auth';
  import { syncStatus, flushQueue, pingServer } from '$lib/offline/sync';
  import { logout } from '$lib/session';

  type Props = { darkMode: boolean; ontoggledark: () => void };
  let { darkMode, ontoggledark }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement;
  let now = $state(Date.now());

  $effect(() => {
    if (!open) return;
    now = Date.now();
    const onDown = (e: PointerEvent) => { if (!root.contains(e.target as Node)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false; };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  // Close whenever the route changes.
  $effect(() => { $page.url.pathname; open = false; });

  const initials = $derived(
    ($auth.user?.displayName ?? '?').trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
  );

  function ago(ts: number | null): string {
    if (!ts) return 'never synced';
    const s = Math.max(0, Math.floor((now - ts) / 1000));
    if (s < 5) return 'synced just now';
    if (s < 60) return `synced ${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `synced ${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `synced ${h}h ago` : `synced ${Math.floor(h / 24)}d ago`;
  }

  function syncNow() { pingServer(); flushQueue(); }

  const attention = $derived(!$syncStatus.online || $syncStatus.failed > 0);

  const GEAR = 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';
  const SYNC = 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 16h5v5';
  const OUT = 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9';
  const MOON = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';
  const SUN = 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42';
</script>

<div class="relative" bind:this={root}>
  <button
    onclick={() => (open = !open)}
    class="relative w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold"
    style="background: var(--color-accent-light); color: var(--color-accent-text)"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Account menu"
  >
    {initials}
    {#if attention}
      <span class="absolute top-0 right-0 w-3 h-3 rounded-full border-2" style="background: {$syncStatus.failed > 0 ? '#dc2626' : '#f59e0b'}; border-color: var(--color-surface)"></span>
    {/if}
  </button>

  {#if open}
    <div
      role="menu"
      class="menu absolute right-0 mt-2 w-64 rounded-2xl shadow-lg p-1.5 z-50"
      style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
    >
      <div class="px-3 py-2.5">
        <div class="font-semibold leading-tight">{$auth.user?.displayName}</div>
        <div class="text-xs" style="color: var(--color-text-muted)">{$isAdmin ? 'Administrator' : 'Member'}</div>
      </div>

      <div class="h-px my-1" style="background: var(--color-border)"></div>

      <button role="menuitem" onclick={syncNow} disabled={$syncStatus.syncing} class="item">
        <svg class="ico {$syncStatus.syncing ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={SYNC} /></svg>
        <span class="flex-1 text-left">
          Sync now
          <span class="block text-xs" style="color: var(--color-text-muted)">
            {$syncStatus.online ? 'Online' : 'Offline'} · {$syncStatus.pending > 0 ? `${$syncStatus.pending} pending` : ago($syncStatus.lastSyncedAt)}{#if $syncStatus.failed > 0} · {$syncStatus.failed} failed{/if}
          </span>
        </span>
        <span class="w-2 h-2 rounded-full" style="background: {$syncStatus.online ? 'var(--color-accent)' : '#f59e0b'}"></span>
      </button>

      <button role="menuitem" onclick={ontoggledark} class="item">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={darkMode ? SUN : MOON} /></svg>
        <span class="flex-1 text-left">Dark mode</span>
        <span class="relative inline-flex h-5 w-9 rounded-full transition-colors" style="background: {darkMode ? 'var(--color-accent)' : 'var(--color-border)'}">
          <span class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style="left: {darkMode ? '1.125rem' : '0.125rem'}"></span>
        </span>
      </button>

      <a role="menuitem" href="/settings" class="item">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GEAR} /></svg>
        <span class="flex-1 text-left">Settings</span>
      </a>

      <div class="h-px my-1" style="background: var(--color-border)"></div>

      <button role="menuitem" onclick={logout} class="item" style="color: var(--color-danger)">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={OUT} /></svg>
        <span class="flex-1 text-left">Sign out</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .menu { animation: menu-in 0.14s ease-out both; transform-origin: top right; }
  @keyframes menu-in { from { opacity: 0; transform: scale(0.96) translateY(-4px); } }
  .item {
    display: flex; align-items: center; gap: 0.75rem; width: 100%;
    padding: 0.6rem 0.75rem; border-radius: 0.7rem; font-size: 0.875rem; text-decoration: none;
  }
  .item:hover:not(:disabled) { background: var(--color-bg); }
  .ico { width: 1.15rem; height: 1.15rem; flex-shrink: 0; }
</style>
