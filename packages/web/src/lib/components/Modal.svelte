<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';

  type Props = {
    /** Accessible name announced by screen readers. */
    label: string;
    onclose: () => void;
    /** 'sheet' slides up from the bottom (mobile pickers); 'center' is a normal dialog. */
    variant?: 'sheet' | 'center';
    panelClass?: string;
    panelStyle?: string;
    children: Snippet;
  };

  let { label, onclose, variant = 'center', panelClass = '', panelStyle = '', children }: Props = $props();

  let panel: HTMLDivElement;
  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  onMount(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    tick().then(() => {
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus();
    });
    // Restore focus to whatever opened the dialog.
    return () => previouslyFocused?.focus?.();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose();
      return;
    }
    if (event.key !== 'Tab') return;

    // Keep keyboard focus inside the dialog.
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<style>
  .modal-backdrop { animation: fade-in 0.18s ease-out both; }
  .modal-backdrop > :global([role='dialog']) { animation: pop-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1) both; }
  @keyframes fade-in { from { opacity: 0; } }
  @keyframes pop-in { from { opacity: 0; transform: translateY(16px) scale(0.98); } }
</style>

<div
  class="fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm print:hidden modal-backdrop {variant === 'sheet' ? 'flex-col justify-end' : 'items-end sm:items-center justify-center p-4'}"
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
  onkeydown={onkeydown}
  role="presentation"
>
  <div bind:this={panel} role="dialog" aria-modal="true" aria-label={label} tabindex="-1" class={panelClass} style={panelStyle}>
    {@render children()}
  </div>
</div>
