<script lang="ts">
  import { syncStatus, flushQueue } from '$lib/offline/sync';
</script>

{#if !$syncStatus.online || $syncStatus.pending > 0}
  <button
    onclick={() => flushQueue()}
    class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-colors shrink-0"
    style="background: {$syncStatus.online ? 'rgba(255,255,255,0.2)' : '#f59e0b'}; color: white;"
    title={$syncStatus.online
      ? `${$syncStatus.pending} change(s) waiting to sync`
      : 'Offline - changes will sync automatically when reconnected'}
  >
    {#if !$syncStatus.online}
      📴 Offline{#if $syncStatus.pending > 0}&nbsp;({$syncStatus.pending}){/if}
    {:else if $syncStatus.syncing}
      🔄 Syncing…
    {:else}
      ⏳ {$syncStatus.pending} pending
    {/if}
  </button>
{/if}
