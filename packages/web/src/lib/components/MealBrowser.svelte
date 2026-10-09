<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { PROTEIN_LABELS, PROTEIN_COLORS, CATEGORY_LABELS, LEFTOVER_LABELS, entriesOf } from '$lib/constants';
  import FilterChip from './FilterChip.svelte';
  import MealCard from './MealCard.svelte';
  import type { Meal, DietaryType, Cuisine, MealFilters, FamilyMember } from '$lib/types';

  type Props = {
    selectable?: boolean;
    showAddButton?: boolean;
    embedded?: boolean;
    onSelect?: (meal: Meal) => void | Promise<void>;
  };

  let {
    selectable = false,
    showAddButton = true,
    embedded = false,
    onSelect,
  }: Props = $props();

  let meals = $state<Meal[]>([]);
  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);
  let familyMembers = $state<FamilyMember[]>([]);
  let loading = $state(false);
  let filterOpen = $state(false);
  let loadSeq = 0;
  let loadError = $state('');

  const emptyFilters = (): MealFilters => ({
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
    preferredByMemberIds: [],
  });

  let filters = $state<MealFilters>(emptyFilters());

  onMount(async () => {
    // Reference data only feeds the filter chips; a failure there shouldn't stop the meal list loading.
    try {
      [dietaryTypes, cuisines, familyMembers] = await Promise.all([
        api.getDietaryTypes(),
        api.getCuisines(),
        api.getFamilyMembers(),
      ]);
    } catch { /* filters just stay empty */ }
    await loadMeals();
  });

  async function loadMeals() {
    // Typing in the search box fires several requests; only the newest one may update the list.
    const seq = ++loadSeq;
    loading = true;
    loadError = '';
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
      if (filters.preferredByMemberIds.length) params.preferredByMemberIds = filters.preferredByMemberIds.join(',');
      const result = await api.getMeals(params);
      if (seq === loadSeq) meals = result;
    } catch (e: any) {
      if (seq === loadSeq) loadError = e?.message ?? 'Could not load meals';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function toggleIn(list: number[], id: number): number[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function toggleFlag(key: 'isFavourite' | 'isSpecialOccasion' | 'isTested') {
    filters[key] = filters[key] === true ? null : true;
    loadMeals();
  }

  function clearFilters() {
    filters = emptyFilters();
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
    (filters.suitableForMemberIds.length > 0 ? 1 : 0) +
    (filters.preferredByMemberIds.length > 0 ? 1 : 0)
  );

  const selectStyle = 'background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)';
</script>

<div class={embedded ? 'p-4 h-full min-h-0 flex flex-col' : 'p-4 max-w-4xl mx-auto'}>
  <div class="flex items-center gap-2 mb-4 shrink-0">
    <div class="flex-1 relative">
      <input
        type="search"
        bind:value={filters.search}
        oninput={onSearchInput}
        placeholder="Search meals…"
        aria-label="Search meals"
        class="w-full border rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-green-500 shadow-sm"
        style="background: var(--color-surface); border-color: var(--color-border); color: var(--color-text)"
      />
      <span class="absolute right-3 top-3" style="color: var(--color-text-muted)" aria-hidden="true">🔍</span>
    </div>

    <button
      onclick={() => filterOpen = !filterOpen}
      aria-expanded={filterOpen}
      aria-label="Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}"
      class="relative p-2.5 rounded-xl border shadow-sm transition-colors"
      style="background: var(--color-surface); border-color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-border)'}; color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)'}"
    >
      <span aria-hidden="true">⚙️</span>
      {#if activeFilterCount > 0}
        <span
          class="absolute -top-1 -right-1 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center"
          style="background: var(--color-accent)"
          aria-hidden="true"
        >
          {activeFilterCount}
        </span>
      {/if}
    </button>

    {#if showAddButton && !selectable}
      <a
        href="/meals/new"
        class="text-white px-4 py-2.5 rounded-xl font-semibold transition-colors shadow-sm"
        style="background: var(--color-accent)"
      >
        + Add
      </a>
    {/if}
  </div>

  <div class={embedded ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
    {#if filterOpen}
      <div class="rounded-xl shadow-sm p-4 mb-4 space-y-4 shrink-0" style="background: var(--color-surface); border: 1px solid var(--color-border)">
        <div class="flex flex-wrap gap-2">
          <FilterChip active={filters.isFavourite === true} onclick={() => toggleFlag('isFavourite')}>⭐ Favourites</FilterChip>
          <FilterChip active={filters.isSpecialOccasion === true} onclick={() => toggleFlag('isSpecialOccasion')} color="#7c3aed">🎉 Special Occasion</FilterChip>
          <FilterChip active={filters.isTested === true} onclick={() => toggleFlag('isTested')}>✅ Tested</FilterChip>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Protein</div>
          <div class="flex flex-wrap gap-2">
            {#each entriesOf(PROTEIN_LABELS) as [val, label]}
              <FilterChip
                active={filters.proteinType === val}
                color={PROTEIN_COLORS[val]}
                onclick={() => { filters.proteinType = filters.proteinType === val ? '' : val; loadMeals(); }}
              >{label}</FilterChip>
            {/each}
          </div>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Category</div>
          <div class="flex flex-wrap gap-2">
            {#each entriesOf(CATEGORY_LABELS) as [val, label]}
              <FilterChip
                active={filters.mealCategory === val}
                onclick={() => { filters.mealCategory = filters.mealCategory === val ? '' : val; loadMeals(); }}
              >{label}</FilterChip>
            {/each}
          </div>
        </div>

        <div>
          <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Leftovers</div>
          <div class="flex flex-wrap gap-2">
            {#each entriesOf(LEFTOVER_LABELS) as [val, label]}
              <FilterChip
                active={filters.leftoverBehaviour === val}
                onclick={() => { filters.leftoverBehaviour = filters.leftoverBehaviour === val ? '' : val; loadMeals(); }}
              >{label}</FilterChip>
            {/each}
          </div>
        </div>

        {#if familyMembers.length > 0}
          <div>
            <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Suitable For</div>
            <div class="flex flex-wrap gap-2">
              {#each familyMembers as m}
                <FilterChip
                  active={filters.suitableForMemberIds.includes(m.id)}
                  onclick={() => { filters.suitableForMemberIds = toggleIn(filters.suitableForMemberIds, m.id); loadMeals(); }}
                >{m.name}</FilterChip>
              {/each}
            </div>
          </div>

          <div>
            <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Preference</div>
            <div class="flex flex-wrap gap-2">
              {#each familyMembers as m}
                <FilterChip
                  active={filters.preferredByMemberIds.includes(m.id)}
                  onclick={() => { filters.preferredByMemberIds = toggleIn(filters.preferredByMemberIds, m.id); loadMeals(); }}
                >{m.name}</FilterChip>
              {/each}
            </div>
          </div>
        {/if}

        <div>
          <div class="text-xs font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Dietary</div>
          <div class="flex flex-wrap gap-2">
            {#each dietaryTypes as dt}
              <FilterChip
                active={filters.dietaryTypeIds.includes(dt.id)}
                onclick={() => { filters.dietaryTypeIds = toggleIn(filters.dietaryTypeIds, dt.id); loadMeals(); }}
              >{dt.icon ?? ''} {dt.name}</FilterChip>
            {/each}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="filter-difficulty" class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">Difficulty</label>
            <select
              id="filter-difficulty"
              bind:value={filters.difficulty}
              onchange={loadMeals}
              class="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              style={selectStyle}
            >
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div>
            <label for="filter-cuisine" class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">Cuisine</label>
            <select
              id="filter-cuisine"
              bind:value={filters.cuisineId}
              onchange={loadMeals}
              class="w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              style={selectStyle}
            >
              <option value={null}>Any</option>
              {#each cuisines as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div>
          <label for="filter-time" class="text-xs font-semibold uppercase mb-1 block" style="color: var(--color-text-muted)">
            Max Total Time {filters.prepTimeMax ? `· ${filters.prepTimeMax} min` : ''}
          </label>
          <input
            id="filter-time"
            type="range"
            min="5"
            max="120"
            step="5"
            bind:value={filters.prepTimeMax}
            onchange={loadMeals}
            class="w-full accent-green-600"
          />
        </div>

        <button onclick={clearFilters} class="text-xs hover:underline" style="color: var(--color-text-muted)">
          Clear all filters
        </button>
      </div>
    {/if}

    {#if loading}
      <div class="flex justify-center py-10" role="status" aria-label="Loading meals">
        <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
      </div>
    {:else if loadError}
      <div class="text-center py-10 space-y-3">
        <p class="text-sm" style="color: var(--color-danger)">{loadError}</p>
        <button onclick={loadMeals} class="text-sm font-semibold px-4 py-2 rounded-xl text-white" style="background: var(--color-accent)">Try again</button>
      </div>
    {:else if meals.length === 0}
      <div class="text-center py-12" style="color: var(--color-text-muted)">
        <div class="text-5xl mb-3">🍽️</div>
        <p class="text-lg font-medium">No meals found</p>
        <p class="text-sm mt-1">
          Try adjusting filters or
          {#if showAddButton && !selectable}
            <a href="/meals/new" class="underline" style="color: var(--color-accent)">add a new meal</a>
          {:else}
            add a new meal
          {/if}
        </p>
      </div>
    {:else}
      <div class="text-xs mb-3" style="color: var(--color-text-muted)">{meals.length} meal{meals.length === 1 ? '' : 's'}</div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each meals as meal (meal.id)}
          {#if selectable}
            <MealCard {meal} onselect={(m) => onSelect?.(m)} />
          {:else}
            <MealCard {meal} href="/meals/{meal.id}" />
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>
