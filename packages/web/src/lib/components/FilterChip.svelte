<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    active: boolean;
    onclick: () => void;
    /** Background colour used when active; defaults to the theme accent. */
    color?: string;
    children: Snippet;
  };

  let { active, onclick, color = 'var(--color-accent)', children }: Props = $props();
</script>

<button
  type="button"
  {onclick}
  aria-pressed={active}
  class="text-xs px-3 py-1.5 rounded-full border transition-colors"
  style={active ? `background: ${color}; color: white; border-color: ${color};` : 'border-color: var(--color-border); color: var(--color-text-muted);'}
>
  {@render children()}
</button>
