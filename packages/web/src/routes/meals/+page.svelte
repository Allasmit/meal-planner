<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { DIFFICULTY_COLORS } from '$lib/utils';
  import type { Meal, DietaryType, Cuisine, MealFilters, FamilyMember, ProteinType, MealCategory, LeftoverBehaviour } from '$lib/types';

  let meals = $state<Meal[]>([]);
  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);
  let familyMembers = $state<FamilyMember[]>([]);
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
    proteinType: '',
    mealCategory: '',
    leftoverBehaviour: '',
    isFavourite: null,
    isSpecialOccasion: null,
    maxCost: null,
    suitableForMemberIds: [],
  });

  onMount(async () => {
    [dietaryTypes, cuisines, familyMembers] = await Promise.all([
      api.getDietaryTypes() as Promise<DietaryType[]>,
      api.getCuisines() as Promise<Cuisine[]>,
      api.getFamilyMembers() as Promise<FamilyMember[]>,
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
      if (filters.proteinType) params.proteinType = filters.proteinType;
      if (filters.mealCategory) params.mealCategory = filters.mealCategory;
      if (filters.leftoverBehaviour) params.leftoverBehaviour = filters.leftoverBehaviour;
      if (filters.isFavourite !== null) params.isFavourite = String(filters.isFavourite);
      if (filters.isSpecialOccasion !== null) params.isSpecialOccasion = String(filters.isSpecialOccasion);
      if (filters.maxCost !== null) params.maxCost = String(filters.maxCost);
      if (filters.suitableForMemberIds.length) params.suitableForMemberIds = filters.suitableForMemberIds.join(',');
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

  function toggleMember(id: number) {
    filters.suitableForMemberIds = filters.suitableForMemberIds.includes(id)
      ? filters.suitableForMemberIds.filter((m) => m !== id)
      : [...filters.suitableForMemberIds, id];
  }

  function clearFilters() {
    filters = { search: '', dietaryTypeIds: [], cuisineId: null, difficulty: '', prepTimeMax: null, ingredientIds: [], isTested: null,
      proteinType: '', mealCategory: '', leftoverBehaviour: '', isFavourite: null, isSpecialOccasion: null, maxCost: null, suitableForMemberIds: [] };
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
    (filters.isTested !== null ? 1 : 0) +
    (filters.proteinType ? 1 : 0) +
    (filters.mealCategory ? 1 : 0) +
    (filters.leftoverBehaviour ? 1 : 0) +
    (filters.isFavourite !== null ? 1 : 0) +
    (filters.isSpecialOccasion !== null ? 1 : 0) +
    (filters.suitableForMemberIds.length > 0 ? 1 : 0)
  );

  const PROTEIN_LABELS: Record<string, string> = {
    chicken: '🍗 Chicken', red_meat: '🥩 Red Meat', pork: '🐷 Pork',
    fish: '🐟 Fish', vegetarian: '🥦 Vegetarian', vegan: '🌱 Vegan', other: '🍲 Other'
  };
  const PROTEIN_COLORS: Record<string, string> = {
    chicken: '#f59e0b', red_meat: '#ef4444', pork: '#f97316',
    fish: '#3b82f6', vegetarian: '#22c55e', vegan: '#10b981', other: '#8b5cf6'
  };
  const CATEGORY_LABELS: Record<string, string> = {
    dinner: '🌙 Dinner', breakfast: '☀️ Breakfast', lunch: '🥪 Lunch',
    baking: '🍞 Baking', treat: '🍰 Treat', snack: '🍎 Snack'
  };
  const LEFTOVER_LABELS: Record<string, string> = {
    consumed_same: '🍽️ Same meal', fridge_next_day: '🥡 Fridge next day', freezable: '❄️ Freezable'
  };
</script>

<div class="p-4 max-w-4xl mx-auto">
  <!-- Header -->
  <div class="flex items-center gap-2 mb-4">
    <div class="flex-1 relative">
      <input type="search" bind:value={filters.search} oninput={onSearchInput}
        placeholder="Search meals…"
        class="w-full border rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-green-500 shadow-sm"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text)" />
      <span class="absolute right-3 top-3" style="color: var(--color-text-muted)">🔍</span>
    </div>
    <button onclick={() => filterOpen = !filterOpen}
      class="relative p-2.5 rounded-xl border shadow-sm transition-colors"
      style="background: var(--color-surface); border-color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-border)'}; color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)'}">
      ⚙️
      {#if activeFilterCount > 0}
        <span class="absolute -top-1 -right-1 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center" style="background: var(--color-accent)">{activeFilterCount}</span>
      {/if}
    </button>
    <a href="/meals/new" class="text-white px-4 py-2.5 rounded-xl font-semibold transition-colors shadow-sm" style="background: var(--color-accent)">+ Add</a>
  </div>

  <!-- Filter panel -->
  {#if filterOpen}
    <div class="rounded-xl shadow-sm p-4 mb-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">

      <!-- Quick toggles row -->
      <div class="flex flex-wrap gap-2">
        <button onclick={() => { filters.isFavourite = filters.isFavourite === true ? null : true; loadMeals(); }}
          class="text-xs px-3 py-1.5 rounded-full border transition-colors"
          style="{filters.isFavourite === true ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
          ⭐ Favourites
        </button>
        <button onclick={() => { filters.isSpecialOccasion = filters.isSpecialOccasion === true ? null : true; loadMeals(); }}
          class="text-xs px-3 py-1.5 rounded-full border transition-colors"
          style="{filters.isSpecialOccasion === true ? 'background: #7c3aed; color: white; border-color: #7c3aed;' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
          🎉 Special Occasion
        </button>
        <button onclick={() => { filters.isTested = filters.isTested === true ? null : true; loadMeals(); }}
          class="text-xs px-3 py-1.5 rounded-full border transition-colors"
          style="{filters.isTested === true ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
          ✅ Tested
        </button>
      </div>

      <!-- Protein type -->
      <div>
        <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Protein</div>
        <div class="flex flex-wrap gap-2">
          {#each Object.entries(PROTEIN_LABELS) as [val, label]}
            <button onclick={() => { filters.proteinType = filters.proteinType === val ? '' : val as any; loadMeals(); }}
              class="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style="{filters.proteinType === val ? `background: ${PROTEIN_COLORS[val]}; color: white; border-color: ${PROTEIN_COLORS[val]};` : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
              {label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Category -->
      <div>
        <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Category</div>
        <div class="flex flex-wrap gap-2">
          {#each Object.entries(CATEGORY_LABELS) as [val, label]}
            <button onclick={() => { filters.mealCategory = filters.mealCategory === val ? '' : val as any; loadMeals(); }}
              class="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style="{filters.mealCategory === val ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
              {label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Leftovers -->
      <div>
        <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Leftovers</div>
        <div class="flex flex-wrap gap-2">
          {#each Object.entries(LEFTOVER_LABELS) as [val, label]}
            <button onclick={() => { filters.leftoverBehaviour = filters.leftoverBehaviour === val ? '' : val as any; loadMeals(); }}
              class="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style="{filters.leftoverBehaviour === val ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
              {label}
            </button>
          {/each}
        </div>
      </div>

      <!-- Family members -->
      {#if familyMembers.length > 0}
        <div>
          <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Suitable For</div>
          <div class="flex flex-wrap gap-2">
            {#each familyMembers as m}
              <button onclick={() => { toggleMember(m.id); loadMeals(); }}
                class="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style="{filters.suitableForMemberIds.includes(m.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
                {m.name}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Dietary types -->
      <div>
        <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Dietary</div>
        <div class="flex flex-wrap gap-2">
          {#each dietaryTypes as dt}
            <button onclick={() => { toggleDietary(dt.id); loadMeals(); }}
              class="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style="{filters.dietaryTypeIds.includes(dt.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
              {dt.icon ?? ''} {dt.name}
            </button>
          {/each}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Difficulty -->
        <div>
          <label class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">Difficulty</label>
          <select bind:value={filters.difficulty} onchange={loadMeals}
            class="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <!-- Cuisine -->
        <div>
          <label class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">Cuisine</label>
          <select bind:value={filters.cuisineId} onchange={loadMeals}
            class="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
            <option value={null}>Any</option>
            {#each cuisines as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Max prep time -->
      <div>
        <label class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">
          Max Total Time {filters.prepTimeMax ? `· ${filters.prepTimeMax} min` : ''}
        </label>
        <input type="range" min="5" max="120" step="5" bind:value={filters.prepTimeMax} onchange={loadMeals}
          class="w-full accent-green-600" />
      </div>

      <button onclick={clearFilters} class="text-xs hover:underline" style="color: var(--color-text-muted)">Clear all filters</button>
    </div>
  {/if}

  <!-- Results -->
  {#if loading}
    <div class="flex justify-center py-10">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else if meals.length === 0}
    <div class="text-center py-12" style="color: var(--color-text-muted)">
      <div class="text-5xl mb-3">🍽️</div>
      <p class="text-lg font-medium">No meals found</p>
      <p class="text-sm mt-1">Try adjusting filters or <a href="/meals/new" class="underline" style="color: var(--color-accent)">add a new meal</a></p>
    </div>
  {:else}
    <div class="text-xs mb-3" style="color: var(--color-text-muted)">{meals.length} meal{meals.length === 1 ? '' : 's'}</div>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each meals as meal}
        <a href="/meals/{meal.id}"
          class="rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow block relative overflow-hidden"
          style="background: var(--color-surface); border: 1px solid var(--color-border)">

          <!-- Protein type colour strip -->
          {#if meal.proteinType}
            <div class="absolute top-0 left-0 w-1 h-full rounded-l-xl" style="background: {PROTEIN_COLORS[meal.proteinType]}"></div>
          {/if}

          <div class="flex items-start justify-between gap-2" class:pl-2={!!meal.proteinType}>
            <h3 class="font-semibold leading-tight" style="color: var(--color-text)">{meal.name}</h3>
            <div class="flex items-center gap-1 shrink-0">
              {#if meal.isFavourite}<span title="Favourite">⭐</span>{/if}
              {#if meal.isSpecialOccasion}<span title="Special Occasion">🎉</span>{/if}
              {#if !meal.isTested}<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">🧪</span>{/if}
            </div>
          </div>

          {#if meal.description}
            <p class="text-sm mt-1 line-clamp-2" style="color: var(--color-text-muted)" class:pl-2={!!meal.proteinType}>{meal.description}</p>
          {/if}

          <div class="flex items-center gap-2 mt-2 flex-wrap" class:pl-2={!!meal.proteinType}>
            <span class="text-xs" style="color: var(--color-text-muted)">⏱ {meal.prepTimeMinutes + meal.cookTimeMinutes}m</span>
            <span class="text-xs px-2 py-0.5 rounded {DIFFICULTY_COLORS[meal.difficulty]}">{meal.difficulty}</span>
            {#if meal.leftoverBehaviour !== 'consumed_same'}
              <span class="text-xs" title={LEFTOVER_LABELS[meal.leftoverBehaviour]}>{meal.leftoverBehaviour === 'freezable' ? '❄️' : '🥡'}</span>
            {/if}
            {#if meal.cost != null}
              <span class="text-xs" style="color: var(--color-text-muted)">R{meal.cost.toFixed(0)}</span>
            {/if}
            {#each (meal.dietaryTypes || []).slice(0, 3) as dt}
              <span class="text-xs" style="color: var(--color-text-muted)">{dt.icon ?? ''}</span>
            {/each}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
