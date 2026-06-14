<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { onMount } from 'svelte';

  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let confirm = $state('');
  let error = $state('');
  let loading = $state(false);

  onMount(async () => {
    try {
      const status = await api.setupStatus() as any;
      if (!status.setupRequired) goto('/login');
    } catch { goto('/login'); }
  });

  async function handleSetup() {
    error = '';
    if (password !== confirm) { error = 'Passwords do not match'; return; }
    loading = true;
    try {
      const user = await api.setup({ username, displayName, password }) as any;
      auth.setUser(user);
      goto('/planner');
    } catch (e: any) {
      error = e.message || 'Setup failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100 p-4">
  <div class="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
    <div class="text-center mb-8">
      <div class="text-5xl mb-3">🥘</div>
      <h1 class="text-2xl font-bold text-gray-800">First Time Setup</h1>
      <p class="text-gray-500 text-sm mt-1">Create your admin account to get started</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleSetup(); }} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="username">Username</label>
        <input id="username" type="text" bind:value={username} required minlength="2"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="displayName">Display Name</label>
        <input id="displayName" type="text" bind:value={displayName} required
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="e.g. Albert" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="password">Password</label>
        <input id="password" type="password" bind:value={password} required minlength="8"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="confirm">Confirm Password</label>
        <input id="confirm" type="password" bind:value={confirm} required
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      {#if error}
        <p class="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
      {/if}

      <button type="submit" disabled={loading}
        class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
        {loading ? 'Creating account…' : 'Create Account & Continue'}
      </button>
    </form>
  </div>
</div>
