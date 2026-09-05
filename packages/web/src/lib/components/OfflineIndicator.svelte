<script lang="ts">
  import { onMount } from 'svelte';
  import { syncStatus, flushQueue, pingServer } from '$lib/offline/sync';

  let now = $state(Date.now());

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  function formatAgo(ts: number | null): string {
    if (!ts) return 'never';
    const seconds = Math.max(0, Math.floor((now - ts) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  let lastSyncedLabel = $derived(formatAgo($syncStatus.lastSyncedAt));

  function syncNow() {
    pingServer();
    flushQueue();
  }
</script>

<div class="flex items-center gap-1 shrink-0">
  <span
    class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
    style="background: {$syncStatus.online ? 'rgba(255,255,255,0.16)' : '#f59e0b'}; color: white;"
    title="Last synced {lastSyncedLabel}"
  >
    <span
      class="w-2 h-2 rounded-full shrink-0"
      style="background: {$syncStatus.online ? '#4ade80' : '#fff'}"
    ></span>
    {#if !$syncStatus.online}
      Offline{#if $syncStatus.pending > 0}<span class="hidden sm:inline">&nbsp;· {$syncStatus.pending} pending</span>{/if}
    {:else if $syncStatus.pending > 0}
      Online<span class="hidden sm:inline">&nbsp;· {$syncStatus.pending} pending</span>
    {:else}
      Online<span class="hidden sm:inline">&nbsp;· synced {lastSyncedLabel}</span>
    {/if}
  </span>
  <button
    onclick={syncNow}
    disabled={$syncStatus.syncing}
    class="text-xs px-2 py-1 rounded-full transition-opacity disabled:opacity-60"
    style="background: rgba(255,255,255,0.16); color: white;"
    title="Sync now"
    aria-label="Sync now"
  >
    {$syncStatus.syncing ? '🔄' : '↻'}
  </button>
</div>
