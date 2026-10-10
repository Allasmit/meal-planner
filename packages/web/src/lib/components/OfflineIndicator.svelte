<script lang="ts">
  import { onMount } from 'svelte';
  import { syncStatus, flushQueue, pingServer, refreshPendingCount } from '$lib/offline/sync';
  import { getFailed, retryFailed, removeFromQueue, type QueuedMutation } from '$lib/offline/queue';
  import Modal from './Modal.svelte';

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

  let showFailed = $state(false);
  let failedItems = $state<QueuedMutation[]>([]);

  async function openFailed() {
    failedItems = await getFailed();
    showFailed = true;
  }

  function describe(item: QueuedMutation): string {
    const what = item.path.startsWith('/planner') ? 'Planner change'
      : item.path.startsWith('/meals') ? 'Meal change'
      : item.path.startsWith('/family') ? 'Family change'
      : item.path.startsWith('/users') ? 'User change'
      : 'Change';
    const verb = item.method === 'POST' ? 'create' : item.method === 'DELETE' ? 'delete' : 'update';
    return `${what} (${verb})`;
  }

  async function retry(item: QueuedMutation) {
    await retryFailed(item.id);
    await refreshPendingCount();
    failedItems = await getFailed();
    if (failedItems.length === 0) showFailed = false;
    flushQueue();
  }

  async function dismiss(item: QueuedMutation) {
    await removeFromQueue(item.id);
    await refreshPendingCount();
    failedItems = await getFailed();
    if (failedItems.length === 0) showFailed = false;
  }

  function syncNow() {
    pingServer();
    flushQueue();
  }
</script>

<!-- Header chip: hidden while everything is healthy; shown only when offline,
     syncing pending changes, or when the server rejected something. Full status
     and a manual "Sync now" live in the avatar menu. -->
{#if $syncStatus.failed > 0}
  <button
    onclick={openFailed}
    class="text-xs font-medium px-2.5 py-1 rounded-full shrink-0"
    style="background: #dc2626; color: white;"
    aria-label="{$syncStatus.failed} change{$syncStatus.failed === 1 ? '' : 's'} could not be saved"
    title="Some offline changes were rejected by the server"
  >⚠ {$syncStatus.failed}</button>
{:else if !$syncStatus.online || $syncStatus.pending > 0 || $syncStatus.syncing}
  <button
    onclick={syncNow}
    disabled={$syncStatus.syncing}
    class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 disabled:opacity-80"
    style="background: {$syncStatus.online ? 'var(--color-accent-light)' : '#f59e0b'}; color: {$syncStatus.online ? 'var(--color-accent-text)' : 'white'};"
    title="Last synced {lastSyncedLabel} - tap to sync now"
  >
    <span class="w-2 h-2 rounded-full shrink-0 {$syncStatus.syncing ? 'animate-pulse' : ''}" style="background: {$syncStatus.online ? 'var(--color-accent)' : '#fff'}"></span>
    {#if !$syncStatus.online}Offline{#if $syncStatus.pending > 0}<span class="hidden sm:inline">&nbsp;· {$syncStatus.pending} pending</span>{/if}{:else if $syncStatus.syncing}Syncing…{:else}{$syncStatus.pending} pending{/if}
  </button>
{/if}

{#if showFailed}
  <Modal
    label="Changes that could not be saved"
    onclose={() => showFailed = false}
    panelClass="w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
    panelStyle="background: var(--color-surface); color: var(--color-text)"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-bold text-base">Changes that could not be saved</h2>
      <button onclick={() => showFailed = false} class="text-xl leading-none p-1" style="color: var(--color-text-muted)" aria-label="Close">✕</button>
    </div>
    <p class="text-sm" style="color: var(--color-text-muted)">
      These were made while offline, but the server refused them. Retry to send them again, or dismiss them.
    </p>
    <ul class="space-y-3">
      {#each failedItems as item (item.id)}
        <li class="rounded-lg p-3 text-sm space-y-2" style="border: 1px solid var(--color-border)">
          <div class="font-medium">{describe(item)}</div>
          <div style="color: var(--color-danger)">{item.error}</div>
          <div class="flex gap-3">
            <button onclick={() => retry(item)} class="text-xs font-semibold underline" style="color: var(--color-accent)">Retry</button>
            <button onclick={() => dismiss(item)} class="text-xs underline" style="color: var(--color-text-muted)">Dismiss</button>
          </div>
        </li>
      {/each}
    </ul>
  </Modal>
{/if}
