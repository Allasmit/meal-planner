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

  // Auto-generate state
  let autoOpen = $state(false);
  let autoOverwrite = $state(false);
  let autoPrepLimit = $state<number | null>(null);
  let autoLeftovers = $state(true);
  let autoLoading = $state(false);
  let autoError = $state('');
  let autoResult = $state<{ generated: number } | null>(null);

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

  async function autoGenerate() {
    autoLoading = true; autoError = ''; autoResult = null;
    try {
      const days = weekDays.flatMap((day) =>
        MEAL_SLOTS.map((slot) => ({
          date: toDateString(day),
          slot,
          prepTimeLimitMinutes: autoPrepLimit,
          leftoversRequired: autoLeftovers,
        }))
      );
      autoResult = await api.autoGenerateWeek({ days, overwriteExisting: autoOverwrite }) as any;
      autoOpen = false;
      await loadWeek();
    } catch (e: any) {
      autoError = e.message;
    } finally {
      autoLoading = false;
    }
  }

  const today = toDateString(new Date());
</script>

<div class="p-4 max-w-6xl mx-auto">
  <!-- Week navigation -->
  <div class="flex items-center justify-between mb-4 gap-2">
    <button onclick={prevWeek} class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">◀</button>
    <div class="text-center">
      <div class="font-semibold" style="color: var(--color-text)">{weekLabel}</div>
      <button onclick={goToday} class="text-xs hover:underline" style="color: var(--color-accent)">Today</button>
    </div>
    <button onclick={nextWeek} class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">▶</button>
    <button onclick={() => { autoOpen = true; autoError = ''; autoResult = null; }}
      class="text-sm font-semibold text-white px-3 py-1.5 rounded-xl shadow-sm transition-colors"
      style="background: var(--color-accent)">✨ Auto</button>
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
              <th class="w-24 py-2 text-left font-medium" style="color: var(--color-text-muted)">Slot</th>
              {#each weekDays as day}
                <th class="py-2 px-1 text-center font-medium" style="color: {toDateString(day) === today ? 'var(--color-accent)' : 'var(--color-text)'}">
                  {formatDayShort(day)}
                  {#if toDateString(day) === today}<div class="w-1.5 h-1.5 rounded-full mx-auto mt-0.5" style="background: var(--color-accent)"></div>{/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each MEAL_SLOTS as slot}
              <tr class="border-t" style="border-color: var(--color-border)">
                <td class="py-2 pr-2 font-medium capitalize text-xs" style="color: var(--color-text-muted)">{SLOT_LABELS[slot]}</td>
                {#each weekDays as day}
                  {@const dateStr = toDateString(day)}
                  {@const plan = planMap.get(`${dateStr}::${slot}`)}
                  <td class="py-1 px-1">
                    {#if plan?.mealName}
                      <div class="rounded-lg p-2 relative group" style="background: var(--color-accent-light); border: 1px solid var(--color-accent)">
                        <a href="/meals/{plan.mealId}" class="block">
                          <div class="font-medium text-xs leading-tight" style="color: var(--color-accent-text)">{plan.mealName}</div>
                          {#if plan.mealDifficulty}
                            <span class="inline-block text-xs px-1.5 py-0.5 rounded mt-1 {DIFFICULTY_COLORS[plan.mealDifficulty]}">{plan.mealDifficulty}</span>
                          {/if}
                        </a>
                        <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onclick={() => openPicker(dateStr, slot)} class="text-xs" style="color: var(--color-accent)" title="Swap">⇄</button>
                          <button onclick={() => clearSlot(dateStr, slot)} class="text-xs" style="color: var(--color-text-muted)" title="Remove">✕</button>
                        </div>
                      </div>
                    {:else}
                      <button onclick={() => openPicker(dateStr, slot)}
                        class="w-full h-14 border-2 border-dashed rounded-lg text-xl transition-colors"
                        style="border-color: var(--color-border); color: var(--color-text-muted)">
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
          <div class="rounded-xl shadow-sm overflow-hidden" style="background: var(--color-surface); border: 1px solid var(--color-border)">
            <div class="px-4 py-2 border-b font-semibold text-sm" style="background: var(--color-bg); border-color: var(--color-border); color: {dateStr === today ? 'var(--color-accent)' : 'var(--color-text)'}">
              {formatDayShort(day)}{dateStr === today ? ' · Today' : ''}
            </div>
            <div class="divide-y" style="border-color: var(--color-border)">
              {#each MEAL_SLOTS as slot}
                {@const plan = planMap.get(`${dateStr}::${slot}`)}
                <div class="px-4 py-2 flex items-center gap-3">
                  <span class="text-xs w-16 shrink-0" style="color: var(--color-text-muted)">{SLOT_LABELS[slot]}</span>
                  {#if plan?.mealName}
                    <a href="/meals/{plan.mealId}" class="flex-1 text-sm font-medium" style="color: var(--color-accent-text)">{plan.mealName}</a>
                    <button onclick={() => openPicker(dateStr, slot)} class="text-xs" style="color: var(--color-text-muted)" title="Swap">⇄</button>
                    <button onclick={() => clearSlot(dateStr, slot)} class="text-sm" style="color: var(--color-text-muted)">✕</button>
                  {:else}
                    <button onclick={() => openPicker(dateStr, slot)} class="flex-1 text-sm text-left" style="color: var(--color-text-muted)">+ Add meal</button>
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
    <div class="rounded-t-2xl max-h-[90vh] flex flex-col shadow-2xl" style="background: var(--color-surface)">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 pt-4 pb-2 border-b shrink-0" style="border-color: var(--color-border)">
        <div>
          <div class="font-semibold" style="color: var(--color-text)">Pick a meal</div>
          <div class="text-xs" style="color: var(--color-text-muted)">{pickerDate} · {SLOT_LABELS[pickerSlot]}</div>
        </div>
        <button onclick={() => pickerOpen = false} class="text-xl leading-none" style="color: var(--color-text-muted)">✕</button>
      </div>

      <!-- Search + filter toggle -->
      <div class="px-4 py-2 border-b shrink-0 flex gap-2" style="border-color: var(--color-border)">
        <input type="search" bind:value={mealSearch} oninput={onSearchInput} placeholder="Search meals…"
          class="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        <button onclick={() => filterOpen = !filterOpen}
          class="relative p-2 rounded-lg border transition-colors"
          style="border-color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-border)'}; color: {activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)'}">
          ⚙️
          {#if activeFilterCount > 0}
            <span class="absolute -top-1 -right-1 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center" style="background: var(--color-accent)">{activeFilterCount}</span>
          {/if}
        </button>
      </div>

      <!-- Filter panel -->
      {#if filterOpen}
        <div class="px-4 py-3 border-b shrink-0 space-y-3" style="background: var(--color-bg); border-color: var(--color-border)">
          <div class="flex flex-wrap gap-1.5">
            {#each dietaryTypes as dt}
              <button onclick={() => { toggleDietary(dt.id); loadPickerMeals(); }}
                class="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style="{filterDietaryIds.includes(dt.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
                {dt.icon ?? ''} {dt.name}
              </button>
            {/each}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <select bind:value={filterDifficulty} onchange={loadPickerMeals}
              class="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
              <option value="">Any difficulty</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <select bind:value={filterCuisineId} onchange={loadPickerMeals}
              class="border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
              <option value={null}>Any cuisine</option>
              {#each cuisines as c}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </div>

          <div>
            <label class="text-xs block mb-1" style="color: var(--color-text-muted)">
              Max prep time{filterPrepTimeMax ? ` · ${filterPrepTimeMax} min` : ''}
            </label>
            <input type="range" min="5" max="120" step="5" bind:value={filterPrepTimeMax} onchange={loadPickerMeals}
              class="w-full accent-green-600" />
          </div>

          <div class="flex gap-2">
            <button onclick={() => { filterIsTested = filterIsTested === true ? null : true; loadPickerMeals(); }}
              class="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style="{filterIsTested === true ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
              ✅ Tested only
            </button>
            {#if activeFilterCount > 0}
              <button onclick={() => { filterDietaryIds = []; filterCuisineId = null; filterDifficulty = ''; filterPrepTimeMax = null; filterIsTested = null; loadPickerMeals(); }}
                class="text-xs ml-auto underline" style="color: var(--color-text-muted)">Clear</button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Meal list -->
      <div class="overflow-y-auto flex-1 py-2">
        {#if pickerLoading}
          <div class="flex justify-center py-8"><div class="animate-spin rounded-full h-7 w-7 border-4 border-green-600 border-t-transparent"></div></div>
        {:else if allMeals.length === 0}
          <p class="text-center py-8 text-sm" style="color: var(--color-text-muted)">No meals found. <a href="/meals/new" class="underline" style="color: var(--color-accent)">Add one?</a></p>
        {:else}
          <div class="px-4 py-1 text-xs" style="color: var(--color-text-muted)">{allMeals.length} meal{allMeals.length === 1 ? '' : 's'}</div>
          {#each allMeals as meal}
            <button onclick={() => assignMeal(meal)}
              class="w-full flex items-start gap-3 px-4 py-3 transition-colors text-left border-b"
              style="border-color: var(--color-border)">
              <div class="flex-1">
                <div class="font-medium text-sm flex items-center gap-1" style="color: var(--color-text)">
                  {meal.name}
                  {#if meal.isFavourite}<span class="text-xs">⭐</span>{/if}
                </div>
                <div class="flex gap-2 mt-0.5 flex-wrap">
                  <span class="text-xs" style="color: var(--color-text-muted)">⏱ {meal.prepTimeMinutes + meal.cookTimeMinutes} min</span>
                  <span class="text-xs px-1.5 rounded {DIFFICULTY_COLORS[meal.difficulty]}">{meal.difficulty}</span>
                  {#if (meal as any).leftoverBehaviour && (meal as any).leftoverBehaviour !== 'consumed_same'}
                    <span class="text-xs">{(meal as any).leftoverBehaviour === 'freezable' ? '❄️' : '🥡'}</span>
                  {/if}
                  {#each (meal.dietaryTypes || []).slice(0, 3) as dt}
                    <span class="text-xs" style="color: var(--color-text-muted)">{dt.icon ?? ''} {dt.name}</span>
                  {/each}
                </div>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Auto-Generate Modal -->
{#if autoOpen}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4" onclick={(e) => { if (e.target === e.currentTarget) autoOpen = false; }} role="presentation">
    <div class="w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4" style="background: var(--color-surface)">
      <div class="flex items-center justify-between">
        <h2 class="font-bold text-base" style="color: var(--color-text)">✨ Auto-generate week</h2>
        <button onclick={() => autoOpen = false} class="text-xl leading-none" style="color: var(--color-text-muted)">✕</button>
      </div>

      <p class="text-sm" style="color: var(--color-text-muted)">
        The planner will suggest meals from your library for each empty slot this week, respecting your weekly rules.
      </p>

      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium block mb-1" style="color: var(--color-text)">
            Max total time per slot {autoPrepLimit ? `· ${autoPrepLimit} min` : '(no limit)'}
          </label>
          <input type="range" min="15" max="180" step="15" bind:value={autoPrepLimit} class="w-full accent-green-600" />
          <button onclick={() => autoPrepLimit = null} class="text-xs underline mt-1" style="color: var(--color-text-muted)">No limit</button>
        </div>

        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={autoLeftovers} class="w-4 h-4 accent-green-600" />
          <span class="text-sm" style="color: var(--color-text)">🥡 Prefer meals with leftovers (for next-day lunches)</span>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={autoOverwrite} class="w-4 h-4 accent-green-600" />
          <span class="text-sm" style="color: var(--color-text)">Overwrite existing planned meals</span>
        </label>
      </div>

      {#if autoError}
        <div class="text-sm rounded-lg p-2" style="background: var(--color-danger-light); color: var(--color-danger)">{autoError}</div>
      {/if}

      <button onclick={autoGenerate} disabled={autoLoading}
        class="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
        style="background: var(--color-accent)">
        {autoLoading ? 'Generating…' : 'Generate Week'}
      </button>
    </div>
  </div>
{/if}
