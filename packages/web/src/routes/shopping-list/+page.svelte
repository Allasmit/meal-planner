<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { getWeekStart, toDateString, formatWeekRange } from '$lib/utils';
  import type { ShoppingListCategory } from '$lib/types';

  let weekStart = $state(getWeekStart());
  let list = $state<ShoppingListCategory[]>([]);
  let loading = $state(false);
  let checked = $state(new Set<string>());
  let shareError = $state('');

  let weekLabel = $derived(formatWeekRange(weekStart));

  onMount(() => loadList());

  async function loadList() {
    loading = true;
    checked = new Set();
    try {
      list = await api.getShoppingList(toDateString(weekStart)) as ShoppingListCategory[];
    } finally {
      loading = false;
    }
  }

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); weekStart = d; loadList(); }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); weekStart = d; loadList(); }

  function toggleItem(key: string) {
    const s = new Set(checked);
    s.has(key) ? s.delete(key) : s.add(key);
    checked = s;
  }

  function buildListText(): string {
    return list.map((cat) => {
      const items = cat.items
        .filter((i) => !checked.has(`${cat.categoryId}::${i.ingredientId}`))
        .map((i) => `  • ${i.quantity} ${i.unit} ${i.name}`)
        .join('\n');
      return items ? `${cat.categoryName}:\n${items}` : '';
    }).filter(Boolean).join('\n\n');
  }

  async function shareList() {
    shareError = '';
    const text = buildListText();
    if (!text) { shareError = 'Nothing left to share (all items checked off).'; return; }

    if (navigator.share) {
      try {
        await navigator.share({ title: `Grocery list — ${weekLabel}`, text });
      } catch (e: any) {
        if (e.name !== 'AbortError') shareError = 'Share failed: ' + e.message;
      }
    } else {
      await navigator.clipboard.writeText(text);
      shareError = '✅ Copied to clipboard!';
    }
  }

  const totalItems = $derived(list.reduce((sum, cat) => sum + cat.items.length, 0));
  const checkedCount = $derived(checked.size);
</script>

<div class="max-w-2xl mx-auto p-4 space-y-4">
  <!-- Week nav -->
  <div class="flex items-center justify-between">
    <button onclick={prevWeek} class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">◀</button>
    <div class="text-center">
      <div class="font-semibold text-gray-800 text-sm">{weekLabel}</div>
      <div class="text-xs text-gray-400">{totalItems} items · {checkedCount} ticked off</div>
    </div>
    <button onclick={nextWeek} class="p-2 rounded-lg hover:bg-gray-200">▶</button>
  </div>

  {#if loading}
    <div class="flex justify-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div></div>
  {:else if list.length === 0}
    <div class="text-center py-12" style="color: var(--color-text-muted)">
      <div class="text-5xl mb-3">🛒</div>
      <p class="font-medium">No meals planned this week</p>
      <p class="text-sm mt-1"><a href="/planner" class="underline" style="color: var(--color-accent)">Plan some meals</a> first</p>
    </div>
  {:else}
    <!-- Action bar -->
    <div class="flex gap-2">
      <button onclick={shareList}
        class="flex-1 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        style="background: var(--color-accent)">
        📤 Share / Copy List
      </button>
      <a href="https://www.checkers.co.za/sixty60" target="_blank" rel="noopener noreferrer"
        class="flex-1 font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-center text-sm border"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text)">
        🛍️ Open Sixty60
      </a>
    </div>

    {#if shareError}
      <p class="text-sm text-center" style="color: {shareError.startsWith('✅') ? 'var(--color-accent)' : 'var(--color-danger)'}">{shareError}</p>
    {/if}

    <!-- Categories -->
    {#each list as cat}
      <div class="rounded-xl shadow-sm overflow-hidden" style="background: var(--color-surface); border: 1px solid var(--color-border)">
        <div class="px-4 py-2.5 border-b font-semibold text-sm" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">{cat.categoryName}</div>
        <ul>
          {#each cat.items as item}
            {@const key = `${cat.categoryId}::${item.ingredientId}`}
            <li class="px-4 py-3 flex items-center gap-3 border-b" style="border-color: var(--color-border)">
              <button onclick={() => toggleItem(key)}
                class="w-5 h-5 rounded border-2 shrink-0 transition-colors flex items-center justify-center"
                style="{checked.has(key) ? 'background: var(--color-accent); border-color: var(--color-accent); color: white;' : 'border-color: var(--color-border);'}">
                {#if checked.has(key)}<span class="text-xs leading-none">✓</span>{/if}
              </button>
              <span class="flex-1 text-sm" style="color: {checked.has(key) ? 'var(--color-text-muted)' : 'var(--color-text)'}; text-decoration: {checked.has(key) ? 'line-through' : 'none'}">{item.name}</span>
              <span class="text-sm font-medium" style="color: {checked.has(key) ? 'var(--color-border)' : 'var(--color-text-muted)'}">{item.quantity} {item.unit}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</div>
