<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth, isAdmin } from '$lib/stores/auth';
  import type { User } from '$lib/types';

  let users = $state<User[]>([]);
  let loadingUsers = $state(false);

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
</script>

<div class="max-w-lg mx-auto p-4 space-y-6">
  <h1 class="text-xl font-bold text-gray-800">Settings</h1>

  <!-- Account info -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
    <div class="text-sm font-semibold text-gray-500 uppercase mb-3">Account</div>
    <div class="flex items-center justify-between">
      <div>
        <div class="font-medium text-gray-800">{$auth.user?.displayName}</div>
        <div class="text-sm text-gray-500">@{$auth.user?.username} · {$auth.user?.role}</div>
      </div>
      <button onclick={logout} class="text-sm text-red-600 hover:underline">Sign out</button>
    </div>
  </div>

  {#if $isAdmin}
    <!-- User management -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
      <div class="text-sm font-semibold text-gray-500 uppercase">Household Users</div>

      {#if loadingUsers}
        <div class="text-sm text-gray-400">Loading…</div>
      {:else}
        <ul class="space-y-2">
          {#each users as u}
            <li class="flex items-center justify-between text-sm">
              <div>
                <span class="font-medium text-gray-800">{u.displayName}</span>
                <span class="text-gray-400 ml-1">@{u.username}</span>
                <span class="text-xs ml-2 px-1.5 py-0.5 rounded {u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}">{u.role}</span>
              </div>
              <div class="flex gap-2">
                <button onclick={() => { resetId = u.id; resetPassword = ''; resetError = ''; }} class="text-xs text-blue-600 hover:underline">Reset pw</button>
                {#if u.id !== $auth.user?.id}
                  <button onclick={() => deleteUser(u.id, u.displayName)} class="text-xs text-red-500 hover:underline">Remove</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Reset password inline form -->
      {#if resetId}
        <form onsubmit={(e) => { e.preventDefault(); submitResetPassword(); }} class="flex gap-2 items-center border-t pt-3">
          <input type="password" bind:value={resetPassword} required minlength="8" placeholder="New password"
            class="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <button type="submit" class="bg-blue-600 text-white text-sm px-3 py-1.5 rounded-lg">Set</button>
          <button type="button" onclick={() => resetId = null} class="text-gray-400 text-sm">✕</button>
        </form>
        {#if resetError}<p class="text-red-600 text-xs">{resetError}</p>{/if}
      {/if}

      <!-- Add user form -->
      <div class="border-t pt-4 space-y-3">
        <div class="text-sm font-medium text-gray-700">Add New User</div>
        <div class="grid grid-cols-2 gap-2">
          <input type="text" bind:value={newUsername} placeholder="Username" required minlength="2"
            class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <input type="text" bind:value={newDisplayName} placeholder="Display name" required
            class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <input type="password" bind:value={newPassword} placeholder="Password (min 8 chars)" required minlength="8"
            class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <select bind:value={newRole} class="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {#if addError}<p class="text-red-600 text-xs">{addError}</p>{/if}
        {#if addSuccess}<p class="text-green-700 text-xs">{addSuccess}</p>{/if}
        <button onclick={addUser} disabled={addLoading || !newUsername || !newDisplayName || !newPassword}
          class="w-full bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg disabled:opacity-60 transition-colors">
          {addLoading ? 'Creating…' : '+ Add User'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Google Calendar placeholder -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 opacity-60">
    <div class="text-sm font-semibold text-gray-500 uppercase mb-2">Google Calendar</div>
    <p class="text-sm text-gray-500">Connect your Google Calendar to get smart meal suggestions based on your schedule.</p>
    <button disabled class="mt-3 text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-400 cursor-not-allowed">Coming soon</button>
  </div>
</div>
