<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import MealBrowser from '$lib/components/MealBrowser.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import FilterChip from '$lib/components/FilterChip.svelte';
  import { busyDuring, eventsByDay, formatEventTime } from '$lib/calendar';
  import { getWeekStart, getWeekStartDay, setWeekStartDay, getWeekDays, toDateString, formatDayShort, formatWeekRange, MEAL_SLOTS, SLOT_LABELS, DIFFICULTY_COLORS } from '$lib/utils';
  import type { MealPlan, Meal, FamilyMember, CostSummary, AutoGenerateResult, CalendarWeek, CalendarEvent } from '$lib/types';

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
  /** Planned dishes (any week) that still have leftover portions to plan. */
  let leftovers = $state<MealPlan[]>([]);

  let weekDays = $derived(getWeekDays(weekStart));
  let weekLabel = $derived(formatWeekRange(weekStart));

  // ─── Calendar (schedule from connected calendars) ──────────────────────────
  const SHOW_SCHEDULE_KEY = 'plannerShowSchedule';
  const SCHEDULE_PREVIEW = 4; // events shown per day before "+ more"

  let calendar = $state<CalendarWeek | null>(null);
  let calendarError = $state('');
  let showSchedule = $state(readShowSchedule());
  let expandedDays = $state(new Set<string>());

  function readShowSchedule(): boolean {
    try { return localStorage.getItem(SHOW_SCHEDULE_KEY) !== 'false'; } catch { return true; }
  }

  function toggleSchedule() {
    showSchedule = !showSchedule;
    moreOpen = false;
    try { localStorage.setItem(SHOW_SCHEDULE_KEY, String(showSchedule)); } catch { /* ignore */ }
  }

  function toggleDayExpanded(date: string) {
    const next = new Set(expandedDays);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    expandedDays = next;
  }

  const hasCalendars = $derived((calendar?.feeds.length ?? 0) > 0);
  const scheduleVisible = $derived(showSchedule && hasCalendars);
  const feedColor = $derived(new Map(calendar?.feeds.map((f) => [f.id, f.color]) ?? []));
  const dayEvents = $derived(eventsByDay(calendar?.events ?? [], weekDays.map(toDateString)));
  const eventsOn = (date: string) => dayEvents.get(date) ?? [];
  const eventLabel = (ev: CalendarEvent, date: string) =>
    `${formatEventTime(ev, date)} · ${ev.title}${ev.location ? ` (${ev.location})` : ''}`;
  const busyAt = (date: string, slot: string) => (scheduleVisible ? busyDuring(eventsOn(date), date, slot) : []);
  const busyTitle = (busy: CalendarEvent[], date: string) => busy.map((ev) => eventLabel(ev, date)).join('\n');
  const calendarProblems = $derived(
    (calendar?.errors ?? []).map((e) => `${calendar?.feeds.find((f) => f.id === e.feedId)?.name ?? 'Calendar'}: ${e.message}`),
  );

  /** Loads the week's events separately so a slow calendar never holds up the meal plan. */
  async function loadCalendar(week: string) {
    try {
      const result = await api.getCalendarWeek(week);
      if (week !== toDateString(weekStart)) return;
      calendar = result;
      calendarError = '';
    } catch (e: any) {
      if (week !== toDateString(weekStart)) return;
      calendarError = e?.message ?? 'Could not load your calendar';
    }
  }

  onMount(async () => {
    loadWeek();
    // Pick up a week-start change made on another device.
    api.getPlannerSettings().then((s) => {
      if (typeof s.weekStartDay === 'number' && s.weekStartDay !== getWeekStartDay()) {
        setWeekStartDay(s.weekStartDay);
        weekStart = getWeekStart();
        loadWeek();
      }
    }).catch(() => { /* keep the stored value */ });
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
    if (!quiet) {
      expandedDays = new Set();
      loadCalendar(requestedWeek);
    }
    try {
      const [plans, summary, remaining] = await Promise.all([
        api.getWeekPlan(requestedWeek),
        api.getCostSummary(requestedWeek).catch(() => null), // the cost banner is a nice-to-have
        api.getLeftovers().catch(() => null),
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
      if (remaining) leftovers = remaining.filter((p) => p.leftoverRemaining > 0);
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

  function pickWeek(value: string) {
    if (!value) return;
    weekStart = getWeekStart(new Date(`${value}T00:00:00`));
    loadWeek();
  }

  const isCurrentWeek = $derived(toDateString(weekStart) === toDateString(getWeekStart()));

  // "More" overflow menu (Print / Clear week)
  let moreOpen = $state(false);
  let moreRoot = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => { if (moreRoot && !moreRoot.contains(e.target as Node)) moreOpen = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') moreOpen = false; };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  function printWeek() {
    moreOpen = false;
    window.print();
  }

  async function openPicker(date: string, slot: string) {
    pickerDate = date;
    pickerSlot = slot;
    pickerOpen = true;
  }

  // ─── Custom (free-text) dish ───────────────────────────────────────────────
  let customOpen = $state(false);
  let customName = $state('');
  let customError = $state('');
  let customSaving = $state(false);

  function openCustom(date: string, slot: string) {
    pickerDate = date;
    pickerSlot = slot;
    customName = '';
    customError = '';
    customOpen = true;
  }

  async function addCustom() {
    const name = customName.trim();
    if (!name) { customError = 'Enter a name for the dish'; return; }
    customSaving = true;
    customError = '';
    try {
      await api.addPlanEntry(pickerDate, pickerSlot, { customName: name });
      customOpen = false;
      await loadWeek(true);
    } catch (e: any) {
      customError = e?.message ?? 'Could not save that dish';
    } finally {
      customSaving = false;
    }
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
  let dragKey = $state<string | null>(null);
  let dragOver = $state<string | null>(null);
  let ghost = $state<{ x: number; y: number; label: string } | null>(null);
  /** Which week-change edge zone the pointer is hovering while dragging. */
  let weekZone = $state<'prev' | 'next' | null>(null);

  const isDragging = (id: number) => dragKey === `plan:${id}`;

  const EDGE_SCROLL_PX = 70; // distance from the top/bottom of the screen where dragging scrolls the page
  const MAX_SCROLL_SPEED = 18; // px per frame at the very edge
  const WEEK_DWELL_MS = 600; // hold over an edge arrow this long to change week
  const WEEK_REPEAT_MS = 900; // and keep holding to keep going

  const plansFor = (date: string, slot: string) => (planMap.get(`${date}::${slot}`) ?? []).filter((p) => p.mealName || p.customName);
  const entryName = (p: MealPlan) => p.mealName ?? p.customName ?? '';

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

  // ─── Leftovers ─────────────────────────────────────────────────────────────
  const leftoverName = (p: MealPlan) => entryName(p) || 'Leftovers';
  const leftoverUsed = (p: MealPlan) => p.leftoverPortions - p.leftoverRemaining;
  const slotDayLabel = (p: MealPlan) => `${formatDayShort(new Date(`${p.planDate}T00:00:00`))} ${SLOT_LABELS[p.mealSlot]}`;
  const portionsLabel = (n: number) => `${n} portion${n === 1 ? '' : 's'}`;

  /** The dish whose leftover portions are being recorded. */
  let leftoverEdit = $state<{ plan: MealPlan; portions: number } | null>(null);
  let leftoverSaving = $state(false);

  function openLeftoverEdit(plan: MealPlan) {
    leftoverEdit = { plan, portions: Math.max(plan.leftoverPortions, leftoverUsed(plan), 1) };
  }

  async function saveLeftoverPortions(portions: number) {
    if (!leftoverEdit) return;
    leftoverSaving = true;
    try {
      await api.updatePlanEntry(leftoverEdit.plan.id, { leftoverPortions: portions });
      leftoverEdit = null;
      await loadWeek(true);
    } catch (e: any) {
      leftoverEdit = null;
      loadError = e?.message ?? 'Could not save the leftovers';
    } finally {
      leftoverSaving = false;
    }
  }

  /** Plan portions of a dish's leftovers into a slot, as a meal or as an extra dish next to what is there. */
  async function useLeftover(source: MealPlan, to: SlotRef, portions: number) {
    const dish = source.mealId ? { mealId: source.mealId } : { customName: leftoverName(source) };
    try {
      await api.addPlanEntry(to.date, to.slot, { ...dish, servings: portions, leftoverFromId: source.id });
    } catch (e: any) {
      loadError = e?.message ?? 'Could not plan those leftovers';
      return;
    }
    await loadWeek(true);
  }

  /** Leftovers no one will eat: keep what's already planned, drop the rest. */
  async function discardLeftovers(source: MealPlan) {
    if (!confirm(`Throw away the remaining ${portionsLabel(source.leftoverRemaining)} of ${leftoverName(source)}?`)) return;
    try {
      await api.updatePlanEntry(source.id, { leftoverPortions: leftoverUsed(source) });
    } catch (e: any) {
      loadError = e?.message ?? 'Could not update the leftovers';
      return;
    }
    await loadWeek(true);
  }

  /** Where leftovers are being placed and how many portions (all that remain unless changed). */
  let leftoverAssign = $state<{ source: MealPlan; date: string; slot: string; portions: number } | null>(null);

  function openLeftoverAssign(source: MealPlan, to?: SlotRef) {
    // Default to the next day's lunch, or today when the dish was cooked a while ago.
    const next = new Date(`${source.planDate}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const date = toDateString(next) < today ? today : toDateString(next);
    leftoverAssign = { source, date: to?.date ?? date, slot: to?.slot ?? 'lunch', portions: source.leftoverRemaining };
  }

  async function confirmLeftoverAssign() {
    if (!leftoverAssign) return;
    const { source, date, slot, portions } = leftoverAssign;
    leftoverAssign = null;
    await useLeftover(source, { date, slot }, portions);
  }

  /** Placing leftovers in a chosen slot: ask how many portions when there's more than one to choose from. */
  function placeLeftover(source: MealPlan, to: SlotRef) {
    if (source.leftoverRemaining > 1) openLeftoverAssign(source, to);
    else useLeftover(source, to, 1);
  }

  const pressLeftover = (e: PointerEvent, source: MealPlan) =>
    startPress(e, `leftover:${source.id}`, `🥡 ${leftoverName(source)}`, (to) => placeLeftover(source, to));

  function assignLeftoverFromPicker(source: MealPlan) {
    pickerOpen = false;
    placeLeftover(source, { date: pickerDate, slot: pickerSlot });
  }

  function slotAt(x: number, y: number): SlotRef | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-date]');
    return el ? { date: el.dataset.dropDate!, slot: el.dataset.dropSlot! } : null;
  }

  const pressPlan = (e: PointerEvent, plan: MealPlan) => startPress(e, `plan:${plan.id}`, entryName(plan), (to) => moveEntry(plan, to));

  /** Long press (touch) or a short drag (mouse) on a planned meal (or a leftover) picks it up; releasing over a slot drops it there. */
  function startPress(e: PointerEvent, key: string, label: string, onDrop: (to: SlotRef) => void) {
    if (e.button !== 0) return;
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
      dragKey = key;
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
    const reset = () => { dragKey = null; dragOver = null; ghost = null; weekZone = null; };

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
      if (target) onDrop(target);
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

  <div class="flex flex-wrap items-center justify-between gap-3 mb-5 print:hidden">
    <!-- Week navigator: ‹ [ date range / tap to jump ] › + Today -->
    <div class="flex items-center gap-2 w-full sm:w-auto">
      <div class="flex items-center flex-1 sm:flex-none rounded-xl shadow-sm" style="background: var(--color-surface); border: 1px solid var(--color-border)">
        <button onclick={prevWeek} aria-label="Previous week" class="w-10 h-10 flex items-center justify-center rounded-l-xl hover:bg-black/5 dark:hover:bg-white/10" style="color: var(--color-text-muted)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <label class="relative flex-1 sm:min-w-52 h-10 px-3 flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 border-x" style="border-color: var(--color-border); color: var(--color-text)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--color-accent)"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>
          <span class="truncate">{weekLabel}</span>
          <input
            type="date"
            value={toDateString(weekStart)}
            onchange={(e) => pickWeek(e.currentTarget.value)}
            aria-label="Jump to week containing date"
            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
        <button onclick={nextWeek} aria-label="Next week" class="w-10 h-10 flex items-center justify-center rounded-r-xl hover:bg-black/5 dark:hover:bg-white/10" style="color: var(--color-text-muted)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      {#if !isCurrentWeek}
        <button onclick={goToday} class="h-10 px-3.5 rounded-xl text-sm font-semibold shrink-0" style="background: var(--color-accent-light); color: var(--color-accent-text)">Today</button>
      {/if}
    </div>

    <!-- Actions: one primary button + overflow menu -->
    <div class="flex items-center gap-2 w-full sm:w-auto">
      <button
        onclick={() => { autoOpen = true; autoError = ''; autoResult = null; }}
        class="flex-1 sm:flex-none h-10 px-5 rounded-xl text-sm font-semibold text-white shadow-sm"
        style="background: linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))"
      >✨ Auto-plan week</button>

      <div class="relative" bind:this={moreRoot}>
        <button
          onclick={() => (moreOpen = !moreOpen)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More actions"
          class="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
          style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {#if moreOpen}
          <div role="menu" class="absolute right-0 mt-2 w-48 rounded-2xl shadow-lg p-1.5 z-30" style="background: var(--color-surface); border: 1px solid var(--color-border)">
            <button role="menuitem" onclick={printWeek} class="w-full text-left text-sm px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10" style="color: var(--color-text)">🖨️ Print / PDF</button>
            {#if hasCalendars}
              <button role="menuitem" onclick={toggleSchedule} class="w-full text-left text-sm px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10" style="color: var(--color-text)">📅 {showSchedule ? 'Hide' : 'Show'} schedule</button>
            {:else}
              <a role="menuitem" href="/settings" class="block w-full text-left text-sm px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10" style="color: var(--color-text)">📅 Connect a calendar</a>
            {/if}
            <button
              role="menuitem"
              onclick={() => { moreOpen = false; clearWeek(); }}
              disabled={clearing || loading || planMap.size === 0}
              class="w-full text-left text-sm px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
              style="color: var(--color-danger)"
            >{clearing ? 'Clearing…' : '🗑️ Clear week'}</button>
          </div>
        {/if}
      </div>
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

  {#if showSchedule && (calendarError || calendarProblems.length) && !loadError}
    <div class="mb-4 rounded-xl px-4 py-2 text-xs print:hidden" role="status" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-muted)">
      📅 {calendarError || calendarProblems.join(' · ')}
    </div>
  {/if}

  {#if leftovers.length && !loadError}
    <section class="mb-4 rounded-xl px-4 py-3 print:hidden" aria-label="Leftovers to use up" style="background: var(--color-leftover-light); border: 1px solid var(--color-leftover)">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-2">
        <h2 class="text-sm font-semibold" style="color: var(--color-leftover)">🥡 Leftovers to use up</h2>
        <span class="text-xs" style="color: var(--color-text-muted)">Tap to plan portions, or drag onto a slot</span>
      </div>
      <ul class="flex flex-wrap gap-2">
        {#each leftovers as source (source.id)}
          <li
            class="flex items-center rounded-lg select-none"
            style="background: var(--color-surface); border: 1px solid var(--color-leftover); -webkit-touch-callout: none; opacity: {dragKey === `leftover:${source.id}` ? 0.4 : 1}"
          >
            <button
              onpointerdown={(e) => pressLeftover(e, source)}
              onclick={() => openLeftoverAssign(source)}
              class="text-left pl-3 pr-2 py-1.5 cursor-grab"
              aria-label="Plan {leftoverName(source)} leftovers"
            >
              <span class="block text-sm font-medium" style="color: var(--color-text)">{leftoverName(source)}{source._pendingSync ? ' ⏳' : ''}</span>
              <span class="block text-xs" style="color: var(--color-text-muted)">{portionsLabel(source.leftoverRemaining)} left · from {slotDayLabel(source)}</span>
            </button>
            <button onclick={() => discardLeftovers(source)} class="px-2 py-1.5 text-xs" style="color: var(--color-text-muted)" title="Throw away" aria-label="Throw away {leftoverName(source)} leftovers">✕</button>
          </li>
        {/each}
      </ul>
    </section>
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
          {#if scheduleVisible}
            <tr class="print:hidden">
              <td class="py-2 pr-2 font-medium text-xs align-top" style="color: var(--color-text-muted)">📅 Schedule</td>
              {#each weekDays as day}
                {@const dateStr = toDateString(day)}
                {@const events = eventsOn(dateStr)}
                {@const shown = expandedDays.has(dateStr) ? events : events.slice(0, SCHEDULE_PREVIEW)}
                <td class="py-1 px-1 align-top">
                  <ul class="space-y-1" aria-label="Schedule for {formatDayShort(day)}">
                    {#each shown as ev}
                      <li class="text-xs rounded-md pl-1.5 pr-1 py-1 leading-tight" style="border-left: 3px solid {feedColor.get(ev.feedId)}; background: var(--color-bg)" title={eventLabel(ev, dateStr)}>
                        <div class="tabular-nums" style="color: var(--color-text-muted)">{formatEventTime(ev, dateStr)}</div>
                        <div class="font-medium truncate" style="color: var(--color-text)">{ev.title}</div>
                      </li>
                    {:else}
                      <li class="text-xs px-1.5 py-1" style="color: var(--color-text-muted)">Nothing on</li>
                    {/each}
                  </ul>
                  {#if events.length > SCHEDULE_PREVIEW}
                    <button onclick={() => toggleDayExpanded(dateStr)} class="text-xs px-1.5 mt-1 hover:underline" style="color: var(--color-accent)">
                      {expandedDays.has(dateStr) ? 'Show less' : `+${events.length - SCHEDULE_PREVIEW} more`}
                    </button>
                  {/if}
                </td>
              {/each}
            </tr>
          {/if}
          {#each MEAL_SLOTS as slot}
            <tr class="border-t" style="border-color: var(--color-border)">
              <td class="py-2 pr-2 font-medium capitalize text-xs" style="color: var(--color-text-muted)">{SLOT_LABELS[slot]}</td>
              {#each weekDays as day}
                {@const dateStr = toDateString(day)}
                {@const plans = plansFor(dateStr, slot)}
                {@const hovered = dragOver === `${dateStr}::${slot}` && !plans.some((p) => isDragging(p.id))}
                {@const busy = busyAt(dateStr, slot)}
                <td class="py-1 px-1 align-top" data-drop-date={dateStr} data-drop-slot={slot}>
                  <div class="space-y-1 rounded-lg" style="outline: {hovered ? '2px solid var(--color-accent)' : 'none'}; outline-offset: 2px">
                    {#each plans as plan (plan.id)}
                      <div
                        class="rounded-lg p-2 relative group select-none cursor-grab"
                        onpointerdown={(e) => pressPlan(e, plan)}
                        role="presentation"
                        style="background: {plan.leftoverFromId ? 'var(--color-leftover-light)' : 'var(--color-accent-light)'}; border: 1px solid {plan.leftoverFromId ? 'var(--color-leftover)' : 'var(--color-accent)'}; opacity: {isDragging(plan.id) ? 0.4 : 1}; -webkit-touch-callout: none"
                      >
                        {#if plan.mealId}
                          <a href="/meals/{plan.mealId}" class="block" draggable="false" ondragstart={(e) => e.preventDefault()}>
                            <div class="font-medium text-xs leading-tight pr-12" style="color: var(--color-accent-text)">{entryName(plan)}{plan._pendingSync ? ' ⏳' : ''}</div>
                            {#if plan.mealDifficulty}
                              <span class="inline-block text-xs px-1.5 py-0.5 rounded mt-1 {DIFFICULTY_COLORS[plan.mealDifficulty]}">{plan.mealDifficulty}</span>
                            {/if}
                          </a>
                        {:else}
                          <div class="font-medium text-xs leading-tight pr-12" style="color: var(--color-accent-text)">{plan.leftoverFromId ? '' : '✏️ '}{entryName(plan)}{plan._pendingSync ? ' ⏳' : ''}</div>
                        {/if}
                        {#if plan.leftoverFromId}
                          <div class="text-xs mt-1 font-medium" style="color: var(--color-leftover)">🥡 Leftovers{plan.servings > 1 ? ` × ${plan.servings}` : ''}</div>
                        {:else if plan.leftoverRemaining > 0}
                          <button onclick={() => openLeftoverEdit(plan)} class="text-xs mt-1 font-medium" style="color: var(--color-leftover)" title="Change leftovers">🥡 {plan.leftoverRemaining} left</button>
                        {/if}
                        <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity print:hidden">
                          {#if !plan.leftoverFromId}
                            <button onclick={() => openLeftoverEdit(plan)} class="text-xs p-0.5" title="Record leftovers" aria-label="Record leftovers of {entryName(plan)}">🥡</button>
                          {/if}
                          <span class="text-sm leading-none p-0.5 cursor-grab" style="color: var(--color-accent)" title="Press and hold to move" aria-hidden="true">⠿</span>
                          <button onclick={() => removeEntry(plan.id)} class="text-xs p-0.5" style="color: var(--color-text-muted)" title="Remove" aria-label="Remove {entryName(plan)}">✕</button>
                        </div>
                      </div>
                    {/each}
                    {#if busy.length}
                      <div class="text-xs leading-tight flex items-center gap-1 print:hidden" style="color: var(--color-text-muted)" title={busyTitle(busy, dateStr)}>
                        <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: {feedColor.get(busy[0].feedId)}" aria-hidden="true"></span>
                        <span class="truncate">Busy {formatEventTime(busy[0], dateStr)}{busy.length > 1 ? ` +${busy.length - 1}` : ''}</span>
                      </div>
                    {/if}
                    <div class="flex gap-1 print:hidden">
                      <button onclick={() => openPicker(dateStr, slot)}
                        class="flex-1 border-2 border-dashed rounded-lg transition-colors {plans.length ? 'h-6 text-sm' : 'h-14 text-xl'}"
                        title="Add meal/dish"
                        aria-label="{plans.length ? 'Add another meal/dish to' : 'Add meal/dish to'} {SLOT_LABELS[slot]} on {formatDayShort(day)}"
                        style="border-color: {hovered ? 'var(--color-accent)' : 'var(--color-border)'}; color: var(--color-text-muted)">
                        +
                      </button>
                      <button onclick={() => openCustom(dateStr, slot)}
                        class="border-2 border-dashed rounded-lg transition-colors {plans.length ? 'h-6 w-6 text-xs' : 'h-14 w-9 text-base'}"
                        title="Add own dish"
                        aria-label="Add own dish to {SLOT_LABELS[slot]} on {formatDayShort(day)}"
                        style="border-color: var(--color-accent); color: var(--color-accent)">
                        +
                      </button>
                    </div>
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
          {#if scheduleVisible && eventsOn(dateStr).length}
            <ul class="px-4 py-2 border-b space-y-1" style="border-color: var(--color-border)" aria-label="Schedule for {formatDayShort(day)}">
              {#each eventsOn(dateStr) as ev}
                <li class="flex items-baseline gap-2 text-xs" title={eventLabel(ev, dateStr)}>
                  <span class="w-2 h-2 rounded-full shrink-0" style="background: {feedColor.get(ev.feedId)}" aria-hidden="true"></span>
                  <span class="tabular-nums shrink-0 w-20" style="color: var(--color-text-muted)">{formatEventTime(ev, dateStr)}</span>
                  <span class="min-w-0 truncate font-medium" style="color: var(--color-text)">{ev.title}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="divide-y" style="border-color: var(--color-border)">
            {#each MEAL_SLOTS as slot}
              {@const plans = plansFor(dateStr, slot)}
              {@const hovered = dragOver === `${dateStr}::${slot}` && !plans.some((p) => isDragging(p.id))}
              {@const busy = busyAt(dateStr, slot)}
              <div
                class="px-4 py-2 flex items-start gap-3"
                data-drop-date={dateStr} data-drop-slot={slot}
                style="background: {hovered ? 'var(--color-accent-light)' : 'transparent'}"
              >
                <div class="w-16 shrink-0 pt-1">
                  <span class="block text-xs" style="color: var(--color-text-muted)">{SLOT_LABELS[slot]}</span>
                  {#if busy.length}
                    <span class="block text-[11px] leading-tight mt-0.5 font-medium" style="color: {feedColor.get(busy[0].feedId)}" title={busyTitle(busy, dateStr)}>Busy</span>
                  {/if}
                </div>
                <div class="flex-1 min-w-0 space-y-1">
                  {#each plans as plan (plan.id)}
                    <div
                      class="flex items-center gap-2 select-none"
                      onpointerdown={(e) => { if (!(e.target as HTMLElement).closest('button')) pressPlan(e, plan); }}
                      role="presentation"
                      style="opacity: {isDragging(plan.id) ? 0.4 : 1}; -webkit-touch-callout: none"
                    >
                      {#if plan.mealId}
                        <a href="/meals/{plan.mealId}" class="flex-1 text-sm font-medium" style="color: var(--color-accent-text)">{entryName(plan)}{plan._pendingSync ? ' ⏳' : ''}</a>
                      {:else}
                        <span class="flex-1 text-sm font-medium" style="color: var(--color-accent-text)">{plan.leftoverFromId ? '' : '✏️ '}{entryName(plan)}{plan._pendingSync ? ' ⏳' : ''}</span>
                      {/if}
                      {#if plan.leftoverFromId}
                        <span class="text-xs font-medium shrink-0" style="color: var(--color-leftover)">🥡 Leftovers{plan.servings > 1 ? ` × ${plan.servings}` : ''}</span>
                      {:else}
                        <button onclick={() => openLeftoverEdit(plan)} class="text-xs font-medium p-1 shrink-0" style="color: var(--color-leftover)" title="Record leftovers" aria-label="Record leftovers of {entryName(plan)}">🥡{plan.leftoverRemaining > 0 ? ` ${plan.leftoverRemaining} left` : ''}</button>
                      {/if}
                      <span class="text-base p-1" style="color: var(--color-text-muted)" title="Press and hold to move" aria-hidden="true">⠿</span>
                      <button onclick={() => removeEntry(plan.id)} class="text-sm p-1" style="color: var(--color-text-muted)" aria-label="Remove {entryName(plan)}">✕</button>
                    </div>
                  {/each}
                  <div class="flex flex-wrap gap-x-4 gap-y-1">
                    <button onclick={() => openPicker(dateStr, slot)} class="text-sm text-left" style="color: var(--color-text-muted)">{plans.length ? '+ Add another meal/dish' : '+ Add meal/dish'}</button>
                    <button onclick={() => openCustom(dateStr, slot)} class="text-sm text-left" style="color: var(--color-accent)">+ Add own</button>
                  </div>
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

{#if customOpen}
  <Modal
    label="Add a custom dish to {SLOT_LABELS[pickerSlot]} on {pickerDate}"
    onclose={() => customOpen = false}
    panelClass="w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-4"
    panelStyle="background: var(--color-surface); color: var(--color-text)"
  >
    <form onsubmit={(e) => { e.preventDefault(); addCustom(); }} class="space-y-4">
      <div>
        <div class="font-bold text-base">Custom dish</div>
        <div class="text-xs" style="color: var(--color-text-muted)">{pickerDate} · {SLOT_LABELS[pickerSlot]}</div>
      </div>
      <div>
        <label for="custom-dish-name" class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">What are you having?</label>
        <input
          id="custom-dish-name"
          type="text"
          bind:value={customName}
          maxlength="120"
          placeholder="e.g. Takeaway pizza, Leftovers, Dinner out"
          class="w-full border rounded-xl px-3.5 py-2.5 text-sm"
          style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
        />
        <p class="text-xs mt-1.5" style="color: var(--color-text-muted)">Custom dishes show on the planner but are not added to the shopping list or costs.</p>
      </div>
      {#if customError}
        <div class="text-sm rounded-lg p-2" style="background: var(--color-danger-light); color: var(--color-danger)">{customError}</div>
      {/if}
      <div class="flex gap-2">
        <button type="submit" disabled={customSaving} class="flex-1 h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style="background: var(--color-accent)">{customSaving ? 'Adding…' : 'Add dish'}</button>
        <button type="button" onclick={() => customOpen = false} class="px-4 h-10 rounded-xl text-sm border" style="border-color: var(--color-border); color: var(--color-text-muted)">Cancel</button>
      </div>
    </form>
  </Modal>
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

    {#if leftovers.length}
      <div class="px-4 py-3 border-b shrink-0" style="border-color: var(--color-border); background: var(--color-leftover-light)">
        <div class="text-xs font-semibold mb-2" style="color: var(--color-leftover)">🥡 Use leftovers</div>
        <div class="flex gap-2 overflow-x-auto pb-1">
          {#each leftovers as source (source.id)}
            <button
              onclick={() => assignLeftoverFromPicker(source)}
              class="shrink-0 text-left rounded-lg px-3 py-1.5"
              style="background: var(--color-surface); border: 1px solid var(--color-leftover)"
            >
              <span class="block text-sm font-medium" style="color: var(--color-text)">{leftoverName(source)}</span>
              <span class="block text-xs" style="color: var(--color-text-muted)">{portionsLabel(source.leftoverRemaining)} left</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <MealBrowser
      embedded={true}
      selectable={true}
      showAddButton={false}
      onSelect={assignMeal}
    />
  </Modal>
{/if}

{#if leftoverEdit}
  {@const used = leftoverUsed(leftoverEdit.plan)}
  <Modal
    label="Leftovers of {entryName(leftoverEdit.plan)}"
    onclose={() => leftoverEdit = null}
    panelClass="w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-4"
    panelStyle="background: var(--color-surface); color: var(--color-text)"
  >
    <form onsubmit={(e) => { e.preventDefault(); saveLeftoverPortions(leftoverEdit!.portions); }} class="space-y-4">
      <div>
        <div class="font-bold text-base">🥡 Leftovers</div>
        <div class="text-xs" style="color: var(--color-text-muted)">{entryName(leftoverEdit.plan)} · {slotDayLabel(leftoverEdit.plan)}</div>
      </div>
      <div>
        <div class="text-sm font-medium mb-2" style="color: var(--color-text-muted)">How many portions are left over?</div>
        <div class="flex items-center gap-3">
          <button type="button" onclick={() => leftoverEdit!.portions = Math.max(Math.max(used, 1), leftoverEdit!.portions - 1)} disabled={leftoverEdit.portions <= Math.max(used, 1)} class="w-10 h-10 rounded-xl border text-lg disabled:opacity-40" style="border-color: var(--color-border)" aria-label="One portion fewer">−</button>
          <span class="text-2xl font-bold w-10 text-center" aria-live="polite">{leftoverEdit.portions}</span>
          <button type="button" onclick={() => leftoverEdit!.portions = Math.min(99, leftoverEdit!.portions + 1)} class="w-10 h-10 rounded-xl border text-lg" style="border-color: var(--color-border)" aria-label="One portion more">+</button>
        </div>
        {#if used > 0}
          <p class="text-xs mt-2" style="color: var(--color-text-muted)">{portionsLabel(used)} already planned.</p>
        {/if}
        <p class="text-xs mt-1.5" style="color: var(--color-text-muted)">Leftovers show at the top of the planner until they're planned or thrown away, and aren't added to the shopping list.</p>
      </div>
      <div class="flex gap-2">
        <button type="submit" disabled={leftoverSaving} class="flex-1 h-10 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style="background: var(--color-accent)">{leftoverSaving ? 'Saving…' : 'Save'}</button>
        {#if leftoverEdit.plan.leftoverPortions > used}
          <button type="button" disabled={leftoverSaving} onclick={() => saveLeftoverPortions(used)} class="px-4 h-10 rounded-xl text-sm border" style="border-color: var(--color-border); color: var(--color-danger)">No leftovers</button>
        {:else}
          <button type="button" onclick={() => leftoverEdit = null} class="px-4 h-10 rounded-xl text-sm border" style="border-color: var(--color-border); color: var(--color-text-muted)">Cancel</button>
        {/if}
      </div>
    </form>
  </Modal>
{/if}

{#if leftoverAssign}
  <Modal
    label="Plan leftovers of {leftoverName(leftoverAssign.source)}"
    onclose={() => leftoverAssign = null}
    panelClass="w-full max-w-sm rounded-2xl p-5 shadow-2xl space-y-4"
    panelStyle="background: var(--color-surface); color: var(--color-text)"
  >
    <form onsubmit={(e) => { e.preventDefault(); confirmLeftoverAssign(); }} class="space-y-4">
      <div>
        <div class="font-bold text-base">🥡 {leftoverName(leftoverAssign.source)}</div>
        <div class="text-xs" style="color: var(--color-text-muted)">{portionsLabel(leftoverAssign.source.leftoverRemaining)} left · from {slotDayLabel(leftoverAssign.source)}</div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label for="leftover-date" class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">Day</label>
          <input id="leftover-date" type="date" required bind:value={leftoverAssign.date} class="w-full border rounded-xl px-3 py-2.5 text-sm" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        </div>
        <div>
          <label for="leftover-slot" class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">Meal</label>
          <select id="leftover-slot" bind:value={leftoverAssign.slot} class="w-full border rounded-xl px-3 py-2.5 text-sm" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
            {#each MEAL_SLOTS as slot}
              <option value={slot}>{SLOT_LABELS[slot]}</option>
            {/each}
          </select>
        </div>
      </div>
      {#if leftoverAssign.source.leftoverRemaining > 1}
        <div>
          <div class="text-sm font-medium mb-2" style="color: var(--color-text-muted)">How many portions?</div>
          <div class="flex items-center gap-3">
            <button type="button" onclick={() => leftoverAssign!.portions = Math.max(1, leftoverAssign!.portions - 1)} disabled={leftoverAssign.portions <= 1} class="w-10 h-10 rounded-xl border text-lg disabled:opacity-40" style="border-color: var(--color-border)" aria-label="One portion fewer">−</button>
            <span class="text-2xl font-bold w-10 text-center" aria-live="polite">{leftoverAssign.portions}</span>
            <button type="button" onclick={() => leftoverAssign!.portions = Math.min(leftoverAssign!.source.leftoverRemaining, leftoverAssign!.portions + 1)} disabled={leftoverAssign.portions >= leftoverAssign.source.leftoverRemaining} class="w-10 h-10 rounded-xl border text-lg disabled:opacity-40" style="border-color: var(--color-border)" aria-label="One portion more">+</button>
          </div>
        </div>
      {/if}
      <p class="text-xs" style="color: var(--color-text-muted)">{portionsLabel(leftoverAssign.portions)} planned there, next to anything already in that slot.</p>
      <div class="flex gap-2">
        <button type="submit" class="flex-1 h-10 rounded-xl text-sm font-semibold text-white" style="background: var(--color-accent)">Add to plan</button>
        <button type="button" onclick={() => leftoverAssign = null} class="px-4 h-10 rounded-xl text-sm border" style="border-color: var(--color-border); color: var(--color-text-muted)">Cancel</button>
      </div>
    </form>
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