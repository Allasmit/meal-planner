<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import MealBrowser from '$lib/components/MealBrowser.svelte';
  import { getWeekStart, getWeekDays, toDateString, formatDayShort, formatWeekRange, MEAL_SLOTS, SLOT_LABELS, DIFFICULTY_COLORS } from '$lib/utils';
  import type { MealPlan, Meal } from '$lib/types';

  let weekStart = $state(getWeekStart());
  let planMap = $state(new Map<string, MealPlan>());
  let loading = $state(false);

  let pickerOpen = $state(false);
  let pickerDate = $state('');
  let pickerSlot = $state('');

  let autoOpen = $state(false);
  let autoOverwrite = $state(false);
  let autoPrepLimit = $state<number | null>(null);
  let autoLeftovers = $state(false);
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

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    weekStart = d;
    loadWeek();
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    weekStart = d;
    loadWeek();
  }

  function goToday() {
    weekStart = getWeekStart();
    loadWeek();
  }

  function printWeek() {
    window.print();
  }

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
    } catch {
      /* slot may not exist */
    }
  }

  async function autoGenerate() {
    autoLoading = true;
    autoError = '';
    autoResult = null;
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
  <div class="hidden print:block mb-4">
    <div class="text-2xl font-bold" style="color: var(--color-text)">Meal Plan</div>
    <div class="text-sm" style="color: var(--color-text-muted)">{weekLabel}</div>
    <div class="text-xs mt-1" style="color: var(--color-text-muted)">
      Printed {new Date().toLocaleDateString()}
    </div>
  </div>

  <div class="flex items-center justify-between mb-4 gap-2 print:hidden">
    <button onclick={prevWeek} class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">◀</button>
    <div class="text-center">
      <div class="font-semibold" style="color: var(--color-text)">{weekLabel}</div>
      <button onclick={goToday} class="text-xs hover:underline" style="color: var(--color-accent)">Today</button>
    </div>
    <button onclick={nextWeek} class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">▶</button>
    <div class="flex items-center gap-2">
      <button
        onclick={printWeek}
        class="text-sm font-semibold px-3 py-1.5 rounded-xl border transition-colors"
        style="border-color: var(--color-border); color: var(--color-text); background: var(--color-surface)"
      >
        Print / PDF
      </button>
      <button
        onclick={() => { autoOpen = true; autoError = ''; autoResult = null; }}
        class="text-sm font-semibold text-white px-3 py-1.5 rounded-xl shadow-sm transition-colors"
        style="background: var(--color-accent)"
      >
        ✨ Auto
      </button>
    </div>
  </div>

  {#if loading}
    <div class="flex justify-center py-10">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else}
    <div class="hidden md:block print:block print:overflow-visible overflow-x-auto">
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
                        <div class="font-medium text-xs leading-tight" style="color: var(--color-accent-text)">{plan.mealName}{plan._pendingSync ? ' ⏳' : ''}</div>
                        {#if plan.mealDifficulty}
                          <span class="inline-block text-xs px-1.5 py-0.5 rounded mt-1 {DIFFICULTY_COLORS[plan.mealDifficulty]}">{plan.mealDifficulty}</span>
                        {/if}
                      </a>
                      <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
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

    <div class="md:hidden print:hidden space-y-4">
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
                  <a href="/meals/{plan.mealId}" class="flex-1 text-sm font-medium" style="color: var(--color-accent-text)">{plan.mealName}{plan._pendingSync ? ' ⏳' : ''}</a>
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

{#if pickerOpen}
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 print:hidden" onclick={(e) => { if (e.target === e.currentTarget) pickerOpen = false; }} role="presentation">
    <div class="rounded-t-2xl max-h-[90vh] h-[90vh] flex flex-col overflow-hidden shadow-2xl" style="background: var(--color-surface)">
      <div class="flex items-center justify-between px-4 pt-4 pb-2 border-b shrink-0" style="border-color: var(--color-border)">
        <div>
          <div class="font-semibold" style="color: var(--color-text)">Pick a meal</div>
          <div class="text-xs" style="color: var(--color-text-muted)">{pickerDate} · {SLOT_LABELS[pickerSlot]}</div>
        </div>
        <button onclick={() => pickerOpen = false} class="text-xl leading-none" style="color: var(--color-text-muted)">✕</button>
      </div>

      <MealBrowser
        embedded={true}
        selectable={true}
        showAddButton={false}
        onSelect={assignMeal}
      />
    </div>
  </div>
{/if}

{#if autoOpen}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 print:hidden" onclick={(e) => { if (e.target === e.currentTarget) autoOpen = false; }} role="presentation">
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
          <span class="text-sm" style="color: var(--color-text)">Only overwrite already filled slots</span>
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

<style>
  @media print {
    @page {
      size: landscape;
      margin: 12mm;
    }
  }
</style>