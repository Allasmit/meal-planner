<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import MealBrowser from '$lib/components/MealBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import FilterChip from '$lib/components/FilterChip.svelte';
  import { getWeekStart, getWeekDays, toDateString, formatDayShort, formatWeekRange, MEAL_SLOTS, SLOT_LABELS, DIFFICULTY_COLORS } from '$lib/utils';
  import type { MealPlan, Meal, FamilyMember, CostSummary, AutoGenerateResult } from '$lib/types';

  let weekStart = $state(getWeekStart());
  let planMap = $state(new Map<string, MealPlan[]>());
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
  let autoResult = $state<AutoGenerateResult | null>(null);
  let autoMemberIds = $state<number[]>([]);
  let familyMembers = $state<FamilyMember[]>([]);
  let cost = $state<CostSummary | null>(null);

  let weekDays = $derived(getWeekDays(weekStart));
  let weekLabel = $derived(formatWeekRange(weekStart));

  onMount(async () => {
    loadWeek();
    try { familyMembers = await api.getFamilyMembers(); } catch { /* the picker simply hides */ }
  });

  let loadSeq = 0;
  let loadError = $state('');
  let loadNotice = $state('');

  /** `quiet` keeps the grid on screen while loading (used while dragging into another week). */
  async function loadWeek(quiet = false) {
    // Ignore a slow response for a week the user has already navigated away from.
    const seq = ++loadSeq;
    const requestedWeek = toDateString(weekStart);
    if (!quiet) loading = true;
    loadError = '';
    loadNotice = '';
    try {
      const [plans, summary] = await Promise.all([
        api.getWeekPlan(requestedWeek),
        api.getCostSummary(requestedWeek).catch(() => null), // the cost banner is a nice-to-have
      ]);
      if (seq !== loadSeq) return;
      const grouped = new Map<string, MealPlan[]>();
      for (const p of plans) {
        const key = `${p.planDate}::${p.mealSlot}`;
        grouped.set(key, [...(grouped.get(key) ?? []), p]);
      }
      // Oldest first; dishes still waiting to sync (negative temp ids) go last.
      const order = (p: MealPlan) => (p.id < 0 ? Number.MAX_SAFE_INTEGER : p.id);
      for (const list of grouped.values()) list.sort((a, b) => order(a) - order(b));
      planMap = grouped;
      cost = summary;
    } catch (e: any) {
      if (seq === loadSeq) loadError = e?.message ?? 'Could not load the plan';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function shiftWeek(days: number, quiet = false) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + days);
    weekStart = d;
    loadWeek(quiet);
  }

  const prevWeek = () => shiftWeek(-7);
  const nextWeek = () => shiftWeek(7);

  function goToday() {
    weekStart = getWeekStart();
    loadWeek();
  }

  function printWeek() {
    window.print();
  }

  async function openPicker(date: string, slot: string) {
    pickerDate = date;
    pickerSlot = slot;
    pickerOpen = true;
  }

  async function assignMeal(meal: Meal) {
    try {
      await api.addPlanEntry(pickerDate, pickerSlot, { mealId: meal.id, servings: meal.servings });
    } catch (e: any) {
      pickerOpen = false;
      loadError = e?.message ?? 'Could not save that meal';
      return;
    }
    pickerOpen = false;
    await loadWeek();
  }

  async function removeEntry(id: number) {
    try {
      await api.removePlanEntry(id);
      await loadWeek();
    } catch {
      /* entry may already be gone */
    }
  }

  let clearing = $state(false);
  const weekEntries = () => [...planMap.values()].flat();

  /** Remove every dish planned in the week on screen, one entry at a time so it also works offline. */
  async function clearWeek() {
    const entries = weekEntries();
    if (!entries.length) return;
    if (!confirm(`Remove all ${entries.length} meal${entries.length === 1 ? '' : 's'} from ${weekLabel}?`)) return;
    clearing = true;
    try {
      const results = await Promise.allSettled(entries.map((p) => api.removePlanEntry(p.id)));
      await loadWeek();
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) loadNotice = `${failed} meal${failed === 1 ? '' : 's'} couldn't be removed. Try again.`;
    } finally {
      clearing = false;
    }
  }

  type SlotRef = { date: string; slot: string };
  const LONG_PRESS_MS = 350;
  const MOVE_TOLERANCE_PX = 8;

  /** The slot being dragged, the slot it is hovering over, and the floating label that follows the pointer. */
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<string | null>(null);
  let ghost = $state<{ x: number; y: number; label: string } | null>(null);
  /** Which week-change edge zone the pointer is hovering while dragging. */
  let weekZone = $state<'prev' | 'next' | null>(null);

  const isDragging = (id: number) => dragFrom === id;

  const EDGE_SCROLL_PX = 70; // distance from the top/bottom of the screen where dragging scrolls the page
  const MAX_SCROLL_SPEED = 18; // px per frame at the very edge
  const WEEK_DWELL_MS = 600; // hold over an edge arrow this long to change week
  const WEEK_REPEAT_MS = 900; // and keep holding to keep going

  const plansFor = (date: string, slot: string) => (planMap.get(`${date}::${slot}`) ?? []).filter((p) => p.mealName);

  /** Move a planned dish to another slot; it joins whatever is already planned there. */
  async function moveEntry(entry: MealPlan, to: SlotRef) {
    if (entry.planDate === to.date && entry.mealSlot === to.slot) return;
    try {
      await api.updatePlanEntry(entry.id, { planDate: to.date, mealSlot: to.slot });
    } catch (e: any) {
      loadError = e?.message ?? 'Could not move that meal';
      return;
    }
    await loadWeek();
  }

  function slotAt(x: number, y: number): SlotRef | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-date]');
    return el ? { date: el.dataset.dropDate!, slot: el.dataset.dropSlot! } : null;
  }

  /** Long press (touch) or a short drag (mouse) on a planned meal picks it up; releasing over a slot drops it there. */
  function startPress(e: PointerEvent, entry: MealPlan) {
    if (e.button !== 0) return;
    const label = entry.mealName ?? '';
    const sourceEl = e.currentTarget as HTMLElement;
    const startX = e.clientX, startY = e.clientY;
    const isMouse = e.pointerType === 'mouse';
    let active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let pointerX = startX, pointerY = startY;
    let zoneSince = 0;

    const activate = (x: number, y: number) => {
      active = true;
      clearTimeout(timer);
      dragFrom = entry.id;
      ghost = { x, y, label };
      navigator.vibrate?.(15);
      frame = requestAnimationFrame(tick);
    };

    /** Runs every frame while dragging: scrolls near the top/bottom edge, changes week on the side arrows,
     * and re-checks what is under the pointer (the page moves even when the pointer doesn't). */
    const tick = (now: number) => {
      if (!active) return;
      const vh = window.innerHeight;
      if (pointerY < EDGE_SCROLL_PX) window.scrollBy(0, -MAX_SCROLL_SPEED * (1 - Math.max(pointerY, 0) / EDGE_SCROLL_PX));
      else if (pointerY > vh - EDGE_SCROLL_PX) window.scrollBy(0, MAX_SCROLL_SPEED * (1 - Math.max(vh - pointerY, 0) / EDGE_SCROLL_PX));

      const zone = document.elementFromPoint(pointerX, pointerY)?.closest<HTMLElement>('[data-week-zone]')?.dataset.weekZone as 'prev' | 'next' | undefined;
      if (zone !== (weekZone ?? undefined)) { weekZone = zone ?? null; zoneSince = now; }
      else if (zone && now - zoneSince > WEEK_DWELL_MS) {
        shiftWeek(zone === 'next' ? 7 : -7, true);
        zoneSince = now + (WEEK_REPEAT_MS - WEEK_DWELL_MS);
      }

      const over = slotAt(pointerX, pointerY);
      dragOver = over ? `${over.date}::${over.slot}` : null;
      frame = requestAnimationFrame(tick);
    };
    const blockScroll = (ev: TouchEvent) => { if (active) ev.preventDefault(); };
    const blockMenu = (ev: Event) => ev.preventDefault();
    const reset = () => { dragFrom = null; dragOver = null; ghost = null; weekZone = null; };

    const cleanup = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockScroll);
      sourceEl.removeEventListener('touchmove', blockScroll);
      window.removeEventListener('contextmenu', blockMenu, true);
    };
    function onMove(ev: PointerEvent) {
      if (!active) {
        const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (isMouse && moved > 5) activate(ev.clientX, ev.clientY);
        else if (!isMouse && moved > MOVE_TOLERANCE_PX) cleanup(); // the user is scrolling, not pressing
        return;
      }
      pointerX = ev.clientX;
      pointerY = ev.clientY;
      ghost = { x: pointerX, y: pointerY, label };
    }
    function onUp(ev: PointerEvent) {
      const wasActive = active;
      cleanup();
      if (!wasActive) return;
      const target = slotAt(ev.clientX, ev.clientY);
      reset();
      // Swallow the click that follows a drag so it doesn't open the meal.
      const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      if (target) moveEntry(entry, target);
    }
    function onCancel() {
      cleanup();
      reset();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', blockScroll, { passive: false });
    // The card can leave the DOM when the week changes mid-drag; touch events still reach their original target.
    sourceEl.addEventListener('touchmove', blockScroll, { passive: false });
    window.addEventListener('contextmenu', blockMenu, true);
    if (!isMouse) timer = setTimeout(() => activate(startX, startY), LONG_PRESS_MS);
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
          leftoversRequired: autoLeftovers ? true : undefined,
          familyMemberIds: autoMemberIds.length ? autoMemberIds : undefined,
        }))
      );
      autoResult = await api.autoGenerateWeek({ days, overwriteExisting: autoOverwrite });
      autoOpen = false;
      await loadWeek();
      if (autoResult.unfilled > 0) {
        loadNotice = `${autoResult.unfilled} slot${autoResult.unfilled === 1 ? '' : 's'} couldn't be filled — no meal fit your rules, time limit or family members.`;
      }
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
    <button onclick={prevWeek} aria-label="Previous week" class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">◀</button>
    <div class="text-center">
      <div class="font-semibold" style="color: var(--color-text)">{weekLabel}</div>
      <button onclick={goToday} class="text-xs hover:underline" style="color: var(--color-accent)">Today</button>
    </div>
    <button onclick={nextWeek} aria-label="Next week" class="p-2 rounded-lg transition-colors hover:opacity-70" style="color: var(--color-text-muted)">▶</button>
    <div class="flex items-center gap-2">
      <button
        onclick={printWeek}
        class="text-sm font-semibold px-3 py-1.5 rounded-xl border transition-colors"
        style="border-color: var(--color-border); color: var(--color-text); background: var(--color-surface)"
      >
        Print / PDF
      </button>
      <button
        onclick={clearWeek}
        disabled={clearing || loading || planMap.size === 0}
        class="text-sm font-semibold px-3 py-1.5 rounded-xl border transition-colors disabled:opacity-50"
        style="border-color: var(--color-border); color: var(--color-danger); background: var(--color-surface)"
      >
        {clearing ? 'Clearing…' : 'Clear week'}
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

  {#if cost && !loading && !loadError}
    <div class="mb-4 rounded-xl px-4 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1 print:hidden" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)">
      <span>This week: <strong>R{cost.weekCost.toFixed(0)}</strong></span>
      <span>
        This month: <strong>R{cost.monthCost.toFixed(0)}</strong>
        {#if cost.monthlyBudget}
          of R{cost.monthlyBudget.toFixed(0)}
          <span style="color: {cost.monthCost > cost.monthlyBudget ? 'var(--color-danger)' : 'var(--color-accent)'}">
            ({cost.monthCost > cost.monthlyBudget ? `R${(cost.monthCost - cost.monthlyBudget).toFixed(0)} over` : `R${(cost.monthlyBudget - cost.monthCost).toFixed(0)} left`})
          </span>
        {/if}
      </span>
      {#if cost.mealsWithoutCost > 0}
        <span style="color: var(--color-text-muted)">{cost.mealsWithoutCost} planned meal{cost.mealsWithoutCost === 1 ? ' has' : 's have'} no cost set</span>
      {/if}
    </div>
  {/if}
  {#if loadNotice}
    <div class="mb-4 rounded-xl px-4 py-2 text-sm print:hidden" role="status" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted)">{loadNotice}</div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-10" role="status" aria-label="Loading plan">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else if loadError}
    <div class="text-center py-10 space-y-3">
      <p class="text-sm" style="color: var(--color-danger)">{loadError}</p>
      <button onclick={() => loadWeek()} class="text-sm font-semibold px-4 py-2 rounded-xl text-white" style="background: var(--color-accent)">Try again</button>
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
                {@const plans = plansFor(dateStr, slot)}
                {@const hovered = dragOver === `${dateStr}::${slot}` && !plans.some((p) => isDragging(p.id))}
                <td class="py-1 px-1 align-top" data-drop-date={dateStr} data-drop-slot={slot}>
                  <div class="space-y-1 rounded-lg" style="outline: {hovered ? '2px solid var(--color-accent)' : 'none'}; outline-offset: 2px">
                    {#each plans as plan (plan.id)}
                      <div
                        class="rounded-lg p-2 relative group select-none cursor-grab"
                        onpointerdown={(e) => startPress(e, plan)}
                        role="presentation"
                        style="background: var(--color-accent-light); border: 1px solid var(--color-accent); opacity: {isDragging(plan.id) ? 0.4 : 1}; -webkit-touch-callout: none"
                      >
                        <a href="/meals/{plan.mealId}" class="block" draggable="false" ondragstart={(e) => e.preventDefault()}>
                          <div class="font-medium text-xs leading-tight pr-8" style="color: var(--color-accent-text)">{plan.mealName}{plan._pendingSync ? ' ⏳' : ''}</div>
                          {#if plan.mealDifficulty}
                            <span class="inline-block text-xs px-1.5 py-0.5 rounded mt-1 {DIFFICULTY_COLORS[plan.mealDifficulty]}">{plan.mealDifficulty}</span>
                          {/if}
                        </a>
                        <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity print:hidden">
                          <span class="text-sm leading-none p-0.5 cursor-grab" style="color: var(--color-accent)" title="Press and hold to move" aria-hidden="true">⠿</span>
                          <button onclick={() => removeEntry(plan.id)} class="text-xs p-0.5" style="color: var(--color-text-muted)" title="Remove" aria-label="Remove {plan.mealName}">✕</button>
                        </div>
                      </div>
                    {/each}
                    <button onclick={() => openPicker(dateStr, slot)}
                      class="w-full border-2 border-dashed rounded-lg transition-colors print:hidden {plans.length ? 'h-6 text-sm' : 'h-14 text-xl'}"
                      aria-label="{plans.length ? 'Add another dish to' : 'Add'} {SLOT_LABELS[slot]} on {formatDayShort(day)}"
                      style="border-color: {hovered ? 'var(--color-accent)' : 'var(--color-border)'}; color: var(--color-text-muted)">
                      +
                    </button>
                  </div>
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
              {@const plans = plansFor(dateStr, slot)}
              {@const hovered = dragOver === `${dateStr}::${slot}` && !plans.some((p) => isDragging(p.id))}
              <div
                class="px-4 py-2 flex items-start gap-3"
                data-drop-date={dateStr} data-drop-slot={slot}
                style="background: {hovered ? 'var(--color-accent-light)' : 'transparent'}"
              >
                <span class="text-xs w-16 shrink-0 pt-1" style="color: var(--color-text-muted)">{SLOT_LABELS[slot]}</span>
                <div class="flex-1 min-w-0 space-y-1">
                  {#each plans as plan (plan.id)}
                    <div
                      class="flex items-center gap-2 select-none"
                      onpointerdown={(e) => { if (!(e.target as HTMLElement).closest('button')) startPress(e, plan); }}
                      role="presentation"
                      style="opacity: {isDragging(plan.id) ? 0.4 : 1}; -webkit-touch-callout: none"
                    >
                      <a href="/meals/{plan.mealId}" class="flex-1 text-sm font-medium" style="color: var(--color-accent-text)">{plan.mealName}{plan._pendingSync ? ' ⏳' : ''}</a>
                      <span class="text-base p-1" style="color: var(--color-text-muted)" title="Press and hold to move" aria-hidden="true">⠿</span>
                      <button onclick={() => removeEntry(plan.id)} class="text-sm p-1" style="color: var(--color-text-muted)" aria-label="Remove {plan.mealName}">✕</button>
                    </div>
                  {/each}
                  <button onclick={() => openPicker(dateStr, slot)} class="text-sm text-left" style="color: var(--color-text-muted)">{plans.length ? '+ Add another dish' : '+ Add meal'}</button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if ghost}
  <div
    class="fixed z-50 pointer-events-none px-3 py-2 rounded-lg text-xs font-medium shadow-xl"
    style="left: {ghost.x}px; top: {ghost.y}px; transform: translate(-50%, -120%); background: var(--color-accent); color: white"
  >{ghost.label}</div>
{/if}

{#if ghost}
  {#each [['prev', '◀', 'left-0 rounded-r-2xl'], ['next', '▶', 'right-0 rounded-l-2xl']] as [zone, icon, pos]}
    <div
      data-week-zone={zone}
      class="fixed top-1/2 -translate-y-1/2 z-40 w-12 h-28 flex items-center justify-center text-lg shadow-lg transition-colors print:hidden {pos}"
      style="background: {weekZone === zone ? 'var(--color-accent)' : 'var(--color-surface)'}; color: {weekZone === zone ? 'white' : 'var(--color-accent)'}; border: 1px solid var(--color-accent)"
      aria-hidden="true"
    >{icon}</div>
  {/each}
{/if}

{#if pickerOpen}
  <Modal
    label="Pick a meal for {SLOT_LABELS[pickerSlot]} on {pickerDate}"
    variant="sheet"
    onclose={() => pickerOpen = false}
    panelClass="rounded-t-2xl max-h-[90vh] h-[90vh] flex flex-col overflow-hidden shadow-2xl"
    panelStyle="background: var(--color-surface)"
  >
    <div class="flex items-center justify-between px-4 pt-4 pb-2 border-b shrink-0" style="border-color: var(--color-border)">
      <div>
        <div class="font-semibold" style="color: var(--color-text)">Pick a meal</div>
        <div class="text-xs" style="color: var(--color-text-muted)">{pickerDate} · {SLOT_LABELS[pickerSlot]}</div>
      </div>
      <button onclick={() => pickerOpen = false} class="text-xl leading-none p-1" style="color: var(--color-text-muted)" aria-label="Close">✕</button>
    </div>

    <MealBrowser
      embedded={true}
      selectable={true}
      showAddButton={false}
      onSelect={assignMeal}
    />
  </Modal>
{/if}

{#if autoOpen}
  <Modal
    label="Auto-generate week"
    onclose={() => autoOpen = false}
    panelClass="w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
    panelStyle="background: var(--color-surface)"
  >
    <div class="flex items-center justify-between">
      <h2 class="font-bold text-base" style="color: var(--color-text)">✨ Auto-generate week</h2>
      <button onclick={() => autoOpen = false} class="text-xl leading-none p-1" style="color: var(--color-text-muted)" aria-label="Close">✕</button>
    </div>

    <p class="text-sm" style="color: var(--color-text-muted)">
      The planner will suggest meals from your library for each empty slot this week, respecting your weekly rules.
    </p>

    <div class="space-y-3">
      <div>
        <label for="auto-limit" class="text-sm font-medium block mb-1" style="color: var(--color-text)">
          Max total time per slot {autoPrepLimit ? `· ${autoPrepLimit} min` : '(no limit)'}
        </label>
        <input id="auto-limit" type="range" min="15" max="180" step="15" bind:value={autoPrepLimit} class="w-full accent-green-600" />
        <button onclick={() => autoPrepLimit = null} class="text-xs underline mt-1" style="color: var(--color-text-muted)">No limit</button>
      </div>

      {#if familyMembers.length > 0}
        <div>
          <div class="text-sm font-medium mb-1" style="color: var(--color-text)">Who is eating? <span class="text-xs font-normal" style="color: var(--color-text-muted)">(only meals suitable for everyone selected)</span></div>
          <div class="flex flex-wrap gap-2">
            {#each familyMembers as m}
              <FilterChip
                active={autoMemberIds.includes(m.id)}
                onclick={() => autoMemberIds = autoMemberIds.includes(m.id) ? autoMemberIds.filter((x) => x !== m.id) : [...autoMemberIds, m.id]}
              >{m.name}</FilterChip>
            {/each}
          </div>
        </div>
      {/if}

      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={autoLeftovers} class="w-4 h-4 accent-green-600" />
        <span class="text-sm" style="color: var(--color-text)">🥡 Prefer meals with leftovers (for next-day lunches)</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={autoOverwrite} class="w-4 h-4 accent-green-600" />
        <span class="text-sm" style="color: var(--color-text)">Replace meals in slots that are already filled</span>
      </label>
    </div>

    {#if autoError}
      <div class="text-sm rounded-lg p-2" role="alert" style="background: var(--color-danger-light); color: var(--color-danger)">{autoError}</div>
    {/if}

    <button onclick={autoGenerate} disabled={autoLoading}
      class="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
      style="background: var(--color-accent)">
      {autoLoading ? 'Generating…' : 'Generate Week'}
    </button>
  </Modal>
{/if}

<style>
  @media print {
    @page {
      size: landscape;
      margin: 12mm;
    }
  }
</style>