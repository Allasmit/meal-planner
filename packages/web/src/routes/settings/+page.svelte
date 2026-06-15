<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth, isAdmin } from '$lib/stores/auth';
  import type { User, PlannerRule, PlannerSettings } from '$lib/types';

  let users = $state<User[]>([]);
  let loadingUsers = $state(false);

  // Planner settings
  let rules = $state<PlannerRule[]>([]);
  let settings = $state<PlannerSettings>({ monthlyBudget: null, batchCookingDay: 0 });
  let settingsSaving = $state(false);
  let settingsSaved = $state(false);

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // New user form
  let newUsername = $state('');
  let newDisplayName = $state('');
  let newPassword = $state('');
  let newRole = $state<'admin' | 'member'>('member');
  let addError = $state('');
  let addLoading = $state(false);
  let addSuccess = $state('');

  // Reset password
  let resetId = $state<number | null>(null);
  let resetPassword = $state('');
  let resetError = $state('');

  onMount(async () => {
    if ($isAdmin) await loadUsers();
    try {
      [rules, settings] = await Promise.all([
        api.getPlannerRules() as Promise<PlannerRule[]>,
        api.getPlannerSettings() as Promise<PlannerSettings>,
      ]);
    } catch { /* non-critical */ }
  });

  async function loadUsers() {
    loadingUsers = true;
    try { users = await api.getUsers() as User[]; } finally { loadingUsers = false; }
  }

  async function logout() {
    await api.logout();
    auth.clear();
    goto('/login');
  }

  async function addUser() {
    addError = ''; addSuccess = '';
    addLoading = true;
    try {
      await api.createUser({ username: newUsername, displayName: newDisplayName, password: newPassword, role: newRole });
      newUsername = ''; newDisplayName = ''; newPassword = ''; newRole = 'member';
      addSuccess = 'User created!';
      await loadUsers();
    } catch (e: any) {
      addError = e.message;
    } finally {
      addLoading = false;
    }
  }

  async function deleteUser(id: number, name: string) {
    if (!confirm(`Delete user "${name}"?`)) return;
    await api.deleteUser(id);
    await loadUsers();
  }

  async function submitResetPassword() {
    if (!resetId) return;
    resetError = '';
    try {
      await api.resetPassword(resetId, resetPassword);
      resetId = null; resetPassword = '';
    } catch (e: any) { resetError = e.message; }
  }

  async function toggleRule(rule: PlannerRule) {
    await api.updatePlannerRule(rule.id, { isEnabled: !rule.isEnabled });
    rules = rules.map((r) => r.id === rule.id ? { ...r, isEnabled: !r.isEnabled } : r);
  }

  async function saveSettings() {
    settingsSaving = true; settingsSaved = false;
    try {
      await api.updatePlannerSettings(settings);
      settingsSaved = true;
      setTimeout(() => settingsSaved = false, 2500);
    } finally {
      settingsSaving = false;
    }
  }
</script>

<div class="max-w-lg mx-auto p-4 space-y-6">
  <h1 class="text-xl font-bold" style="color: var(--color-text)">Settings</h1>

  <!-- Account info -->
  <div class="rounded-xl shadow-sm p-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="text-sm font-semibold uppercase mb-3" style="color: var(--color-text-muted)">Account</div>
    <div class="flex items-center justify-between">
      <div>
        <div class="font-medium" style="color: var(--color-text)">{$auth.user?.displayName}</div>
        <div class="text-sm" style="color: var(--color-text-muted)">@{$auth.user?.username} · {$auth.user?.role}</div>
      </div>
      <button onclick={logout} class="text-sm hover:underline" style="color: var(--color-danger)">Sign out</button>
    </div>
  </div>

  <!-- Planner settings -->
  <div class="rounded-xl shadow-sm p-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="text-sm font-semibold uppercase" style="color: var(--color-text-muted)">Planner Settings</div>

    <div>
      <label class="text-sm font-medium block mb-1" style="color: var(--color-text)">
        Monthly Budget {settings.monthlyBudget ? `· R${settings.monthlyBudget}` : '(not set)'}
      </label>
      <input type="number" min="0" step="50" bind:value={settings.monthlyBudget} placeholder="e.g. 3000"
        class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
    </div>

    <div>
      <label class="text-sm font-medium block mb-1" style="color: var(--color-text)">Preferred batch cooking day</label>
      <div class="flex flex-wrap gap-2">
        {#each DAY_NAMES as day, i}
          <button
            onclick={() => settings.batchCookingDay = i}
            class="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style="{settings.batchCookingDay === i ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}"
          >{day}</button>
        {/each}
      </div>
    </div>

    <button onclick={saveSettings} disabled={settingsSaving}
      class="w-full py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
      style="background: var(--color-accent)">
      {settingsSaving ? 'Saving…' : settingsSaved ? '✅ Saved!' : 'Save Settings'}
    </button>
  </div>

  <!-- Weekly rules -->
  {#if rules.length > 0}
    <div class="rounded-xl shadow-sm p-4 space-y-3" style="background: var(--color-surface); border: 1px solid var(--color-border)">
      <div class="text-sm font-semibold uppercase" style="color: var(--color-text-muted)">Weekly Planning Rules</div>
      {#each rules as rule}
        <div class="flex items-center justify-between gap-3">
          <div class="flex-1">
            <div class="text-sm font-medium" style="color: var(--color-text)">{rule.label}</div>
          </div>
          <button
            onclick={() => toggleRule(rule)}
            class="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 cursor-pointer"
            style="background: {rule.isEnabled ? 'var(--color-accent)' : 'var(--color-border)'};"
            role="switch"
            aria-checked={rule.isEnabled}
          >
            <span
              class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200"
              style="translate: {rule.isEnabled ? '20px' : '0px'}"
            ></span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if $isAdmin}
    <!-- User management -->
    <div class="rounded-xl shadow-sm p-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
      <div class="text-sm font-semibold uppercase" style="color: var(--color-text-muted)">Household Users</div>

      {#if loadingUsers}
        <div class="text-sm" style="color: var(--color-text-muted)">Loading…</div>
      {:else}
        <ul class="space-y-2">
          {#each users as u}
            <li class="flex items-center justify-between text-sm">
              <div>
                <span class="font-medium" style="color: var(--color-text)">{u.displayName}</span>
                <span class="ml-1" style="color: var(--color-text-muted)">@{u.username}</span>
                <span class="text-xs ml-2 px-1.5 py-0.5 rounded {u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}">{u.role}</span>
              </div>
              <div class="flex gap-2">
                <button onclick={() => { resetId = u.id; resetPassword = ''; resetError = ''; }} class="text-xs text-blue-600 hover:underline">Reset pw</button>
                {#if u.id !== $auth.user?.id}
                  <button onclick={() => deleteUser(u.id, u.displayName)} class="text-xs hover:underline" style="color: var(--color-danger)">Remove</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Reset password inline form -->
      {#if resetId}
        <form onsubmit={(e) => { e.preventDefault(); submitResetPassword(); }} class="flex gap-2 items-center border-t pt-3" style="border-color: var(--color-border)">
          <input type="password" bind:value={resetPassword} required minlength="8" placeholder="New password"
            class="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
          <button type="submit" class="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg">Set</button>
          <button type="button" onclick={() => resetId = null} class="text-sm" style="color: var(--color-text-muted)">✕</button>
        </form>
        {#if resetError}<p class="text-xs" style="color: var(--color-danger)">{resetError}</p>{/if}
      {/if}

      <!-- Add user form -->
      <div class="border-t pt-4 space-y-3" style="border-color: var(--color-border)">
        <div class="text-sm font-medium" style="color: var(--color-text)">Add New User</div>
        <div class="grid grid-cols-2 gap-2">
          <input type="text" bind:value={newUsername} placeholder="Username" required minlength="2"
            class="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
          <input type="text" bind:value={newDisplayName} placeholder="Display name" required
            class="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input type="password" bind:value={newPassword} placeholder="Password (min 8 chars)" required minlength="8"
            class="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
          <select bind:value={newRole} class="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {#if addError}<p class="text-xs" style="color: var(--color-danger)">{addError}</p>{/if}
        {#if addSuccess}<p class="text-xs" style="color: var(--color-accent)">{addSuccess}</p>{/if}
        <button onclick={addUser} disabled={addLoading || !newUsername || !newDisplayName || !newPassword}
          class="w-full text-white text-sm py-2 rounded-lg disabled:opacity-60 transition-colors" style="background: var(--color-accent)">
          {addLoading ? 'Creating…' : '+ Add User'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Google Calendar placeholder -->
  <div class="rounded-xl shadow-sm p-4 opacity-60" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="text-sm font-semibold uppercase mb-2" style="color: var(--color-text-muted)">Google Calendar</div>
    <p class="text-sm" style="color: var(--color-text-muted)">Connect your Google Calendar to get smart meal suggestions based on your schedule.</p>
    <button disabled class="mt-3 text-sm border rounded-lg px-3 py-1.5 cursor-not-allowed" style="border-color: var(--color-border); color: var(--color-text-muted)">Coming soon</button>
  </div>
</div>
