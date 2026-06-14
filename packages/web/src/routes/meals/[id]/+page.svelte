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
  <div class="max-w-2xl mx-auto p-4 space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-2xl font-bold text-gray-800">{meal.name}</h1>
          {#if !meal.isTested}<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">🧪 Untested</span>{/if}
        </div>
        {#if meal.description}<p class="text-gray-500 mt-1">{meal.description}</p>{/if}
      </div>
      <div class="flex gap-2 shrink-0">
        <a href="/meals/{id}/edit" class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">Edit</a>
        <button onclick={deleteMeal} disabled={deleting} class="text-sm bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
          {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </div>

    <!-- Meta badges -->
    <div class="flex gap-2 flex-wrap">
      <span class="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">⏱ Prep: {meal.prepTimeMinutes} min</span>
      <span class="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">🔥 Cook: {meal.cookTimeMinutes} min</span>
      <span class="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">👥 Serves: {meal.servings}</span>
      <span class="text-sm px-3 py-1 rounded-full {DIFFICULTY_COLORS[meal.difficulty]}">{DIFFICULTY_LABELS[meal.difficulty]}</span>
      {#each (meal.dietaryTypes || []) as dt}
        <span class="bg-green-50 text-green-800 text-sm px-3 py-1 rounded-full">{dt.icon ?? ''} {dt.name}</span>
      {/each}
    </div>

    <!-- Ingredients -->
    {#if meal.ingredients?.length}
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-700">🛒 Ingredients</div>
        <ul class="divide-y divide-gray-50">
          {#each meal.ingredients as ing}
            <li class="px-4 py-2.5 flex items-center justify-between text-sm">
              <span class="text-gray-800">{ing.name}{ing.notes ? ` (${ing.notes})` : ''}</span>
              <span class="text-gray-500 font-medium">{ing.quantity} {ing.unit}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Instructions -->
    {#if meal.instructions?.length}
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-700">👨‍🍳 Instructions</div>
        <ol class="p-4 space-y-4">
          {#each meal.instructions as step, i}
            <li class="flex gap-3">
              <span class="bg-green-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <p class="text-gray-700 text-sm leading-relaxed">{step}</p>
            </li>
          {/each}
        </ol>
      </div>
    {/if}

    {#if meal.notes}
      <div class="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div class="text-sm font-semibold text-amber-800 mb-1">📝 Notes</div>
        <p class="text-sm text-amber-700">{meal.notes}</p>
      </div>
    {/if}
  </div>
{/if}
