<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { getWeekStart, getWeekDays, toDateString, formatDayShort, formatWeekRange, MEAL_SLOTS, SLOT_LABELS, DIFFICULTY_COLORS } from '$lib/utils';
  import type { MealPlan, Meal, DietaryType, Cuisine } from '$lib/types';

  let weekStart = $state(getWeekStart());
  let planMap = $state(new Map<string, MealPlan>());
  let loading = $state(false);

  // Meal picker state
  let pickerOpen = $state(false);
  let pickerDate = $state('');
  let pickerSlot = $state('');
  let allMeals = $state<Meal[]>([]);
  let pickerLoading = $state(false);
  let filterOpen = $state(false);

  // Picker filter state
  let mealSearch = $state('');
  let filterDietaryIds = $state<number[]>([]);
  let filterCuisineId = $state<number | null>(null);
  let filterDifficulty = $state('');
  let filterPrepTimeMax = $state<number | null>(null);
  let filterIsTested = $state<boolean | null>(null);

  // Reference data for filters
  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);

  let weekDays = $derived(getWeekDays(weekStart));
  let weekLabel = $derived(formatWeekRange(weekStart));

  let activeFilterCount = $derived(
    (filterDietaryIds.length > 0 ? 1 : 0) +
    (filterCuisineId ? 1 : 0) +
    (filterDifficulty ? 1 : 0) +
    (filterPrepTimeMax ? 1 : 0) +
    (filterIsTested !== null ? 1 : 0)
  );

  onMount(() => loadWeek());

  async function loadWeek() {
    loading = true;
    try {
      const plans = await api.getWeekPlan(toDateString(weekStart)) as MealPlan[];
      planMap = new Map(plans.map((p) => [`${p.planDate}::${p.mealSlot}`, p]));
    } finally {
      loading = false;
    }
  }

  function prevWeek() { const d = new Date(weekStart); d.setDate(d.getDate() - 7); weekStart = d; loadWeek(); }
  function nextWeek() { const d = new Date(weekStart); d.setDate(d.getDate() + 7); weekStart = d; loadWeek(); }
  function goToday() { weekStart = getWeekStart(); loadWeek(); }

  async function loadPickerMeals() {
    pickerLoading = true;
    try {
      const params: Record<string, string> = {};
      if (mealSearch) params.search = mealSearch;
      if (filterDietaryIds.length) params.dietaryTypeIds = filterDietaryIds.join(',');
      if (filterCuisineId) params.cuisineId = String(filterCuisineId);
      if (filterDifficulty) params.difficulty = filterDifficulty;
      if (filterPrepTimeMax) params.prepTimeMax = String(filterPrepTimeMax);
      if (filterIsTested !== null) params.isTested = String(filterIsTested);
      allMeals = await api.getMeals(params) as Meal[];
    } finally {
      pickerLoading = false;
    }
  }

  async function openPicker(date: string, slot: string) {
    pickerDate = date;
    pickerSlot = slot;
    pickerOpen = true;
    filterOpen = false;
    mealSearch = '';
    filterDietaryIds = [];
    filterCuisineId = null;
    filterDifficulty = '';
    filterPrepTimeMax = null;
    filterIsTested = null;
    if (dietaryTypes.length === 0) {
      [dietaryTypes, cuisines] = await Promise.all([
        api.getDietaryTypes() as Promise<DietaryType[]>,
        api.getCuisines() as Promise<Cuisine[]>,
      ]);
    }
    await loadPickerMeals();
  }

  function toggleDietary(id: number) {
    filterDietaryIds = filterDietaryIds.includes(id)
      ? filterDietaryIds.filter((d) => d !== id)
      : [...filterDietaryIds, id];
  }

  let searchTimeout: ReturnType<typeof setTimeout>;
  function onSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadPickerMeals, 300);
  }

  async function assignMeal(meal: Meal) {
    await api.setPlanSlot(pickerDate, pickerSlot, { mealId: meal.id, servings: meal.servings });
    pickerOpen = false;
    await loadWeek();
  }

  async function clearSlot(date: string, slot: string) {
    try {
      await api.clearPlanSlot(date, slot);
      await loadWeek();
    } catch { /* slot may not exist */ }
  }

  const today = toDateString(new Date());
</script>

<div class="p-4 max-w-6xl mx-auto">
  <!-- Week navigation -->
  <div class="flex items-center justify-between mb-4 gap-2">
    <button onclick={prevWeek} class="p-2 rounded-lg hover:bg-gray-200 transition-colors">◀</button>
    <div class="text-center">
      <div class="font-semibold text-gray-800">{weekLabel}</div>
      <button onclick={goToday} class="text-xs text-green-700 hover:underline">Today</button>
    </div>
    <button onclick={nextWeek} class="p-2 rounded-lg hover:bg-gray-200 transition-colors">▶</button>
  </div>

  {#if loading}
    <div class="flex justify-center py-10">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else}
    <!-- Desktop grid -->
    <div class="hidden md:block overflow-x-auto">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th class="w-24 py-2 text-left text-gray-500 font-medium">Slot</th>
            {#each weekDays as day}
              <th class="py-2 px-1 text-center font-medium {toDateString(day) === today ? 'text-green-700' : 'text-gray-700'}">
                {formatDayShort(day)}
                {#if toDateString(day) === today}<div class="w-1.5 h-1.5 bg-green-600 rounded-full mx-auto mt-0.5"></div>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each MEAL_SLOTS as slot}
            <tr class="border-t border-gray-100">
              <td class="py-2 pr-2 text-gray-500 font-medium capitalize text-xs">{SLOT_LABELS[slot]}</td>
              {#each weekDays as day}
                {@const dateStr = toDateString(day)}
                {@const plan = planMap.get(`${dateStr}::${slot}`)}
                <td class="py-1 px-1">
                  {#if plan?.mealName}
                    <div class="bg-green-50 border border-green-200 rounded-lg p-2 relative group">
                      <a href="/meals/{plan.mealId}" class="block">
                        <div class="font-medium text-green-900 text-xs leading-tight">{plan.mealName}</div>
                        {#if plan.mealDifficulty}
                          <span class="inline-block text-xs px-1.5 py-0.5 rounded mt-1 {DIFFICULTY_COLORS[plan.mealDifficulty]}">{plan.mealDifficulty}</span>
                        {/if}
                        {#if plan.assignedByDisplayName}
                          <div class="text-xs text-gray-400 mt-0.5">{plan.assignedByDisplayName}</div>
                        {/if}
                      </a>
                      <button onclick={() => clearSlot(dateStr, slot)} class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs transition-opacity">✕</button>
                    </div>
                  {:else}
                    <button onclick={() => openPicker(dateStr, slot)}
                      class="w-full h-14 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors text-xl">
                      +
                    </button>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Mobile list -->
    <div class="md:hidden space-y-4">
      {#each weekDays as day}
        {@const dateStr = toDateString(day)}
        <div class="bg-white rounded-xl shadow-sm overflow-hidden">
          <div class="px-4 py-2 bg-gray-50 border-b font-semibold text-sm {dateStr === today ? 'text-green-700' : 'text-gray-700'}">
            {formatDayShort(day)}{dateStr === today ? ' · Today' : ''}
          </div>
          <div class="divide-y divide-gray-50">
            {#each MEAL_SLOTS as slot}
              {@const plan = planMap.get(`${dateStr}::${slot}`)}
              <div class="px-4 py-2 flex items-center gap-3">
                <span class="text-xs text-gray-400 w-16 shrink-0">{SLOT_LABELS[slot]}</span>
                {#if plan?.mealName}
                  <a href="/meals/{plan.mealId}" class="flex-1 text-sm text-green-900 font-medium">{plan.mealName}</a>
                  <button onclick={() => clearSlot(dateStr, slot)} class="text-gray-300 hover:text-red-400 text-sm">✕</button>
                {:else}
                  <button onclick={() => openPicker(dateStr, slot)} class="flex-1 text-sm text-gray-400 hover:text-green-600 text-left">+ Add meal</button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Meal Picker Bottom Sheet -->
{#if pickerOpen}
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onclick={(e) => { if (e.target === e.currentTarget) pickerOpen = false; }} role="presentation">
    <div class="bg-white rounded-t-2xl max-h-[90vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2 border-b shrink-0">
        <div>
          <div class="font-semibold text-gray-800">Pick a meal</div>
          <div class="text-xs text-gray-500">{pickerDate} · {SLOT_LABELS[pickerSlot]}</div>
        </div>
        <button onclick={() => pickerOpen = false} class="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
      </div>

      <!-- Search + filter toggle -->
      <div class="px-4 py-2 border-b shrink-0 flex gap-2">
        <input type="search" bind:value={mealSearch} oninput={onSearchInput} placeholder="Search meals…"
          class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        <button onclick={() => filterOpen = !filterOpen}
          class="relative p-2 rounded-lg border {activeFilterCount > 0 ? 'border-green-500 text-green-700' : 'border-gray-200 text-gray-500'} hover:bg-gray-50">
          ⚙️
          {#if activeFilterCount > 0}
            <span class="absolute -top-1 -right-1 bg-green-600 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
          {/if}
        </button>
      </div>

      <!-- Filter panel -->
      {#if filterOpen}
        <div class="px-4 py-3 border-b bg-gray-50 shrink-0 space-y-3">
          <!-- Dietary types -->
          <div class="flex flex-wrap gap-1.5">
            {#each dietaryTypes as dt}
              <button onclick={() => { toggleDietary(dt.id); loadPickerMeals(); }}
                class="text-xs px-2.5 py-1 rounded-full border transition-colors
                  {filterDietaryIds.includes(dt.id) ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-green-400'}">
                {dt.icon ?? ''} {dt.name}
              </button>
            {/each}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <select bind:value={filterDifficulty} onchange={loadPickerMeals}
              class="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">Any difficulty</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <select bind:value={filterCuisineId} onchange={loadPickerMeals}
              class="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value={null}>Any cuisine</option>
              {#each cuisines as c}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </div>

          <div>
            <label class="text-xs text-gray-500 block mb-1">
              Max prep time{filterPrepTimeMax ? ` · ${filterPrepTimeMax} min` : ''}
            </label>
            <input type="range" min="5" max="120" step="5" bind:value={filterPrepTimeMax} onchange={loadPickerMeals}
              class="w-full accent-green-600" />
          </div>

          <div class="flex gap-2">
            <button onclick={() => { filterIsTested = filterIsTested === true ? null : true; loadPickerMeals(); }}
              class="text-xs px-2.5 py-1 rounded-full border {filterIsTested === true ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600'}">
              ✅ Tested only
            </button>
            <button onclick={() => { filterIsTested = filterIsTested === false ? null : false; loadPickerMeals(); }}
              class="text-xs px-2.5 py-1 rounded-full border {filterIsTested === false ? 'bg-amber-500 text-white border-amber-500' : 'border-gray-200 text-gray-600'}">
              🧪 Untested only
            </button>
            {#if activeFilterCount > 0}
              <button onclick={() => { filterDietaryIds = []; filterCuisineId = null; filterDifficulty = ''; filterPrepTimeMax = null; filterIsTested = null; loadPickerMeals(); }}
                class="text-xs text-gray-400 hover:text-red-500 ml-auto underline">Clear</button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Meal list -->
      <div class="overflow-y-auto flex-1 py-2">
        {#if pickerLoading}
          <div class="flex justify-center py-8"><div class="animate-spin rounded-full h-7 w-7 border-4 border-green-600 border-t-transparent"></div></div>
        {:else if allMeals.length === 0}
          <p class="text-center text-gray-400 py-8 text-sm">No meals found. <a href="/meals/new" class="text-green-700 underline">Add one?</a></p>
        {:else}
          <div class="px-4 py-1 text-xs text-gray-400">{allMeals.length} meal{allMeals.length === 1 ? '' : 's'}</div>
          {#each allMeals as meal}
            <button onclick={() => assignMeal(meal)}
              class="w-full flex items-start gap-3 px-4 py-3 hover:bg-green-50 transition-colors text-left border-b border-gray-50">
              <div class="flex-1">
                <div class="font-medium text-gray-800 text-sm">{meal.name}</div>
                <div class="flex gap-2 mt-0.5 flex-wrap">
                  <span class="text-xs text-gray-400">⏱ {meal.prepTimeMinutes + meal.cookTimeMinutes} min</span>
                  <span class="text-xs px-1.5 rounded {DIFFICULTY_COLORS[meal.difficulty]}">{meal.difficulty}</span>
                  {#each (meal.dietaryTypes || []).slice(0, 3) as dt}
                    <span class="text-xs text-gray-400">{dt.icon ?? ''} {dt.name}</span>
                  {/each}
                  {#if !meal.isTested}<span class="text-xs text-amber-600">🧪</span>{/if}
                </div>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
