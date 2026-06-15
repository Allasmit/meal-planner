<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { DIFFICULTY_COLORS, DIFFICULTY_LABELS } from '$lib/utils';
  import type { Meal } from '$lib/types';

  let meal = $state<Meal | null>(null);
  let loading = $state(true);
  let deleting = $state(false);

  let id = $derived(parseInt($page.params.id, 10));

  const PROTEIN_LABELS: Record<string, string> = {
    chicken: '🍗 Chicken', red_meat: '🥩 Red Meat', pork: '🐷 Pork',
    fish: '🐟 Fish', vegetarian: '🥦 Vegetarian', vegan: '🌱 Vegan', other: '🍲 Other',
  };
  const CATEGORY_LABELS: Record<string, string> = {
    dinner: '🌙 Dinner', breakfast: '☀️ Breakfast', lunch: '🥪 Lunch',
    baking: '🍞 Baking', treat: '🍰 Treat', snack: '🍎 Snack',
  };
  const LEFTOVER_LABELS: Record<string, string> = {
    consumed_same: '🍽️ Consumed same meal',
    fridge_next_day: '🥡 Fridge — next day',
    freezable: '❄️ Freezable',
  };

  onMount(async () => {
    try {
      meal = await api.getMeal(id) as Meal;
    } catch {
      goto('/meals');
    } finally {
      loading = false;
    }
  });

  async function deleteMeal() {
    if (!confirm(`Delete "${meal?.name}"?`)) return;
    deleting = true;
    await api.deleteMeal(id);
    goto('/meals');
  }
</script>

{#if loading}
  <div class="flex justify-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div></div>
{:else if meal}
  <div class="max-w-2xl mx-auto p-4 space-y-6" style="color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-bold" style="color: var(--color-text)">{meal.name}</h1>
          {#if meal.isFavourite}<span title="Favourite">⭐</span>{/if}
          {#if meal.isSpecialOccasion}<span title="Special Occasion">🎉</span>{/if}
          {#if !meal.isTested}<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">🧪 Untested</span>{/if}
        </div>
        {#if meal.description}<p class="mt-1" style="color: var(--color-text-muted)">{meal.description}</p>{/if}
      </div>
      <div class="flex gap-2 shrink-0">
        <a href="/meals/{id}/edit" class="text-sm px-3 py-1.5 rounded-lg transition-colors" style="background: var(--color-bg); color: var(--color-text)">Edit</a>
        <button onclick={deleteMeal} disabled={deleting} class="text-sm px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60" style="background: var(--color-danger-light); color: var(--color-danger)">
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </div>

    <!-- Meta badges -->
    <div class="flex gap-2 flex-wrap">
      <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">⏱ Prep: {meal.prepTimeMinutes} min</span>
      <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">🔥 Cook: {meal.cookTimeMinutes} min</span>
      <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">👥 Serves: {meal.servings}</span>
      <span class="text-sm px-3 py-1 rounded-full {DIFFICULTY_COLORS[meal.difficulty]}">{DIFFICULTY_LABELS[meal.difficulty]}</span>
      {#if (meal as any).mealCategory}
        <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-accent-light); color: var(--color-accent-text)">{CATEGORY_LABELS[(meal as any).mealCategory]}</span>
      {/if}
      {#if (meal as any).proteinType}
        <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">{PROTEIN_LABELS[(meal as any).proteinType]}</span>
      {/if}
      {#if (meal as any).leftoverBehaviour}
        <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">{LEFTOVER_LABELS[(meal as any).leftoverBehaviour]}</span>
      {/if}
      {#if (meal as any).cost != null}
        <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-bg); color: var(--color-text-muted)">💰 R{(meal as any).cost}</span>
      {/if}
      {#each (meal.dietaryTypes || []) as dt}
        <span class="text-sm px-3 py-1 rounded-full" style="background: var(--color-accent-light); color: var(--color-accent-text)">{dt.icon ?? ''} {dt.name}</span>
      {/each}
    </div>

    <!-- Ingredients -->
    {#if meal.ingredients?.length}
      <div class="rounded-xl shadow-sm overflow-hidden" style="background: var(--color-surface); border: 1px solid var(--color-border)">
        <div class="px-4 py-3 border-b font-semibold" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">🛒 Ingredients</div>
        <ul class="divide-y" style="border-color: var(--color-border)">
          {#each meal.ingredients as ing}
            <li class="px-4 py-2.5 flex items-center justify-between text-sm">
              <span style="color: var(--color-text)">{ing.name}{ing.notes ? ` (${ing.notes})` : ''}</span>
              <span class="font-medium" style="color: var(--color-text-muted)">{ing.quantity} {ing.unit}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Instructions -->
    {#if meal.instructions?.length}
      <div class="rounded-xl shadow-sm overflow-hidden" style="background: var(--color-surface); border: 1px solid var(--color-border)">
        <div class="px-4 py-3 border-b font-semibold" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">👨‍🍳 Instructions</div>
        <ol class="p-4 space-y-4">
          {#each meal.instructions as step, i}
            <li class="flex gap-3">
              <span class="text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5" style="background: var(--color-accent)">{i + 1}</span>
              <p class="text-sm leading-relaxed" style="color: var(--color-text)">{step}</p>
            </li>
          {/each}
        </ol>
      </div>
    {/if}

    {#if meal.notes}
      <div class="rounded-xl p-4" style="background: var(--color-accent-light); border: 1px solid var(--color-accent)">
        <div class="text-sm font-semibold mb-1" style="color: var(--color-accent-text)">📝 Notes</div>
        <p class="text-sm" style="color: var(--color-text)">{meal.notes}</p>
      </div>
    {/if}

    {#if (meal as any).sourceUrl}
      <div>
        <a href={(meal as any).sourceUrl} target="_blank" rel="noopener noreferrer"
          class="text-sm underline" style="color: var(--color-accent)">🔗 View original recipe →</a>
      </div>
    {/if}
  </div>
{/if}
