<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { DIFFICULTY_COLORS } from '$lib/utils';
  import type { Meal, DietaryType, Cuisine, MealFilters } from '$lib/types';

  let meals = $state<Meal[]>([]);
  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);
  let loading = $state(false);
  let filterOpen = $state(false);

  let filters = $state<MealFilters>({
    search: '',
    dietaryTypeIds: [],
    cuisineId: null,
    difficulty: '',
    prepTimeMax: null,
    ingredientIds: [],
    isTested: null,
  });

  onMount(async () => {
    [dietaryTypes, cuisines] = await Promise.all([
      api.getDietaryTypes() as Promise<DietaryType[]>,
      api.getCuisines() as Promise<Cuisine[]>,
    ]);
    await loadMeals();
  });

  async function loadMeals() {
    loading = true;
    try {
      const params: Record<string, string> = {};
      if (filters.search) params.search = filters.search;
      if (filters.dietaryTypeIds.length) params.dietaryTypeIds = filters.dietaryTypeIds.join(',');
      if (filters.cuisineId) params.cuisineId = String(filters.cuisineId);
      if (filters.difficulty) params.difficulty = filters.difficulty;
      if (filters.prepTimeMax) params.prepTimeMax = String(filters.prepTimeMax);
      if (filters.isTested !== null) params.isTested = String(filters.isTested);
      meals = await api.getMeals(params) as Meal[];
    } finally {
      loading = false;
    }
  }

  function toggleDietary(id: number) {
    filters.dietaryTypeIds = filters.dietaryTypeIds.includes(id)
      ? filters.dietaryTypeIds.filter((d) => d !== id)
      : [...filters.dietaryTypeIds, id];
  }

  function clearFilters() {
    filters = { search: '', dietaryTypeIds: [], cuisineId: null, difficulty: '', prepTimeMax: null, ingredientIds: [], isTested: null };
    loadMeals();
  }

  let searchTimeout: ReturnType<typeof setTimeout>;
  function onSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadMeals, 300);
  }

  const activeFilterCount = $derived(
    (filters.dietaryTypeIds.length > 0 ? 1 : 0) +
    (filters.cuisineId ? 1 : 0) +
    (filters.difficulty ? 1 : 0) +
    (filters.prepTimeMax ? 1 : 0) +
    (filters.isTested !== null ? 1 : 0)
  );
</script>

<div class="p-4 max-w-4xl mx-auto">
  <!-- Header -->
  <div class="flex items-center gap-2 mb-4">
    <div class="flex-1 relative">
      <input type="search" bind:value={filters.search} oninput={onSearchInput}
        placeholder="Search meals…"
        class="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white shadow-sm" />
      <span class="absolute right-3 top-3 text-gray-400">🔍</span>
    </div>
    <button onclick={() => filterOpen = !filterOpen}
      class="relative p-2.5 rounded-xl border bg-white shadow-sm {activeFilterCount > 0 ? 'border-green-500 text-green-700' : 'border-gray-200 text-gray-600'} hover:bg-gray-50">
      ⚙️
      {#if activeFilterCount > 0}
        <span class="absolute -top-1 -right-1 bg-green-600 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
      {/if}
    </button>
    <a href="/meals/new" class="bg-green-600 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-green-700 transition-colors shadow-sm">+ Add</a>
  </div>

  <!-- Filter panel -->
  {#if filterOpen}
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4 space-y-4">
      <!-- Dietary types -->
      <div>
        <div class="text-xs font-semibold text-gray-500 uppercase mb-2">Dietary</div>
        <div class="flex flex-wrap gap-2">
          {#each dietaryTypes as dt}
            <button onclick={() => { toggleDietary(dt.id); loadMeals(); }}
              class="text-xs px-3 py-1.5 rounded-full border transition-colors
                {filters.dietaryTypeIds.includes(dt.id) ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-green-400'}">
              {dt.icon ?? ''} {dt.name}
            </button>
          {/each}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Difficulty -->
        <div>
          <label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Difficulty</label>
          <select bind:value={filters.difficulty} onchange={loadMeals}
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <!-- Cuisine -->
        <div>
          <label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Cuisine</label>
          <select bind:value={filters.cuisineId} onchange={loadMeals}
            class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value={null}>Any</option>
            {#each cuisines as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Max prep time -->
      <div>
        <label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">
          Max Prep Time {filters.prepTimeMax ? `· ${filters.prepTimeMax} min` : ''}
        </label>
        <input type="range" min="5" max="120" step="5" bind:value={filters.prepTimeMax} onchange={loadMeals}
          class="w-full accent-green-600" />
      </div>

      <!-- Tested toggle -->
      <div class="flex items-center gap-2">
        <button onclick={() => { filters.isTested = filters.isTested === true ? null : true; loadMeals(); }}
          class="text-xs px-3 py-1.5 rounded-full border {filters.isTested === true ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600'}">
          ✅ Tested only
        </button>
        <button onclick={() => { filters.isTested = filters.isTested === false ? null : false; loadMeals(); }}
          class="text-xs px-3 py-1.5 rounded-full border {filters.isTested === false ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-200 text-gray-600'}">
          🧪 Untested only
        </button>
      </div>

      <button onclick={clearFilters} class="text-xs text-gray-500 hover:text-red-600 underline">Clear all filters</button>
    </div>
  {/if}

  <!-- Results -->
  {#if loading}
    <div class="flex justify-center py-10">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else if meals.length === 0}
    <div class="text-center py-12 text-gray-400">
      <div class="text-5xl mb-3">🍽️</div>
      <p class="text-lg font-medium">No meals found</p>
      <p class="text-sm mt-1">Try adjusting filters or <a href="/meals/new" class="text-green-700 underline">add a new meal</a></p>
    </div>
  {:else}
    <div class="text-xs text-gray-400 mb-3">{meals.length} meal{meals.length === 1 ? '' : 's'}</div>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each meals as meal}
        <a href="/meals/{meal.id}" class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow block">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold text-gray-800 leading-tight">{meal.name}</h3>
            {#if !meal.isTested}
              <span class="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">🧪 Untested</span>
            {/if}
          </div>
          {#if meal.description}
            <p class="text-sm text-gray-500 mt-1 line-clamp-2">{meal.description}</p>
          {/if}
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            <span class="text-xs text-gray-400">⏱ {meal.prepTimeMinutes + meal.cookTimeMinutes}m</span>
            <span class="text-xs px-2 py-0.5 rounded {DIFFICULTY_COLORS[meal.difficulty]}">{meal.difficulty}</span>
            {#each (meal.dietaryTypes || []).slice(0, 2) as dt}
              <span class="text-xs text-gray-400">{dt.icon ?? ''}</span>
            {/each}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
