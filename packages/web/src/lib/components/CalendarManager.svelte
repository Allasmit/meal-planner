<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { auth, isAdmin } from '$lib/stores/auth';
  import type { CalendarFeed } from '$lib/types';

  const COLORS = ['#2563eb', '#db2777', '#7c3aed', '#ea580c', '#0d9488', '#ca8a04'];

  let feeds = $state<CalendarFeed[]>([]);
  let error = $state('');

  let url = $state('');
  let name = $state('');
  let showDetails = $state(true);
  let adding = $state(false);

  onMount(async () => {
    try { feeds = await api.getCalendarFeeds(); } catch { /* shown empty */ }
  });

  const canManage = (feed: CalendarFeed) => $isAdmin || feed.createdByUserId === $auth.user?.id;

  async function add() {
    error = '';
    adding = true;
    try {
      const feed = await api.addCalendarFeed({ url: url.trim(), name: name.trim() || undefined, showDetails });
      feeds = [...feeds, feed];
      url = ''; name = ''; showDetails = true;
    } catch (e: any) {
      error = e.message;
    } finally {
      adding = false;
    }
  }

  async function update(feed: CalendarFeed, body: Partial<Pick<CalendarFeed, 'name' | 'color' | 'showDetails'>>) {
    error = '';
    try {
      const updated = await api.updateCalendarFeed(feed.id, body);
      feeds = feeds.map((f) => (f.id === feed.id ? updated : f));
    } catch (e: any) { error = e.message; }
  }

  const nextColor = (feed: CalendarFeed) => COLORS[(COLORS.indexOf(feed.color) + 1) % COLORS.length];

  async function remove(feed: CalendarFeed) {
    if (!confirm(`Stop showing "${feed.name}" on the planner?`)) return;
    error = '';
    try {
      await api.deleteCalendarFeed(feed.id);
      feeds = feeds.filter((f) => f.id !== feed.id);
    } catch (e: any) { error = e.message; }
  }
</script>

<div class="rounded-xl shadow-sm p-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
  <div>
    <div class="text-sm font-semibold uppercase" style="color: var(--color-text-muted)">Calendars</div>
    <p class="text-xs mt-1" style="color: var(--color-text-muted)">Show your Google Calendar on the planner, so you can plan quick meals or leftovers on busy days.</p>
  </div>

  {#if feeds.length}
    <ul class="space-y-3">
      {#each feeds as feed (feed.id)}
        <li class="flex items-center gap-3">
          <button
            type="button"
            onclick={() => update(feed, { color: nextColor(feed) })}
            disabled={!canManage(feed)}
            class="w-5 h-5 rounded-full shrink-0 disabled:cursor-default"
            style="background: {feed.color}"
            title="Change colour"
            aria-label="Change colour of {feed.name}"
          ></button>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate" style="color: var(--color-text)">{feed.name}</div>
            <div class="text-xs truncate" style="color: var(--color-text-muted)">{feed.urlHint}{feed.showDetails ? '' : ' · shown as "Busy"'}</div>
          </div>
          {#if canManage(feed)}
            <button
              onclick={() => update(feed, { showDetails: !feed.showDetails })}
              class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer"
              style="background: {feed.showDetails ? 'var(--color-accent)' : 'var(--color-border)'};"
              role="switch"
              aria-label="Show event titles from {feed.name}"
              aria-checked={feed.showDetails}
              title="Show event titles"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200"
                style="translate: {feed.showDetails ? '20px' : '0px'}"
              ></span>
            </button>
            <button onclick={() => remove(feed)} class="text-xs hover:underline shrink-0" style="color: var(--color-danger)">Remove</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <form onsubmit={(e) => { e.preventDefault(); add(); }} class="space-y-3 {feeds.length ? 'border-t pt-4' : ''}" style="border-color: var(--color-border)">
    <div class="text-sm font-medium" style="color: var(--color-text)">Add a calendar</div>
    <input
      type="url"
      bind:value={url}
      required
      autocomplete="off"
      spellcheck="false"
      placeholder="Secret address in iCal format (https://…/basic.ics)"
      aria-label="Calendar iCal address"
      class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
    />
    <input
      type="text"
      bind:value={name}
      maxlength="60"
      placeholder="Name (optional, e.g. Alla's work)"
      aria-label="Calendar name"
      class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
    />
    <label class="flex items-center gap-2 text-sm cursor-pointer" style="color: var(--color-text)">
      <input type="checkbox" bind:checked={showDetails} class="w-4 h-4 accent-green-600" />
      Show event titles <span class="text-xs" style="color: var(--color-text-muted)">(off: everyone sees only "Busy")</span>
    </label>

    <details class="text-xs rounded-lg px-3 py-2" style="background: var(--color-bg); color: var(--color-text-muted)">
      <summary class="cursor-pointer font-medium" style="color: var(--color-text)">Where do I find my Google Calendar link?</summary>
      <ol class="list-decimal pl-4 mt-2 space-y-1">
        <li>Open <strong>calendar.google.com</strong> in a browser on a computer (the phone app doesn't show this).</li>
        <li>Click the ⚙️ gear → <strong>Settings</strong>, then pick your calendar under <strong>Settings for my calendars</strong>.</li>
        <li>Scroll to <strong>Integrate calendar</strong> and copy <strong>Secret address in iCal format</strong>.</li>
        <li>Paste it above. Changes in Google show up here within about 10 minutes.</li>
      </ol>
      <p class="mt-2">The link lets anyone who has it read that calendar, so don't share it elsewhere. It is kept on the meal planner's server and never shown again. Everyone in the household sees these events on the planner.</p>
    </details>

    {#if error}<p class="text-sm" role="alert" style="color: var(--color-danger)">{error}</p>{/if}
    <button type="submit" disabled={adding || !url.trim()}
      class="w-full text-white text-sm py-2 rounded-lg disabled:opacity-60 transition-colors" style="background: var(--color-accent)">
      {adding ? 'Checking the calendar…' : '+ Add calendar'}
    </button>
  </form>
</div>
