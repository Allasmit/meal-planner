<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Family profiles now live in Settings; keep old links/bookmarks working.
  onMount(() => goto('/settings', { replaceState: true }));
</script>
