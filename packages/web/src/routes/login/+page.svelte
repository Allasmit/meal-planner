<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { runFullPrecache } from '$lib/offline/precache';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin() {
    error = '';
    loading = true;
    try {
      const user = await api.login({ username, password }) as any;
      auth.setUser(user);
      // The root layout's onMount (where this also runs) already fired once
      // before login succeeded, so it never re-triggers on this client-side
      // navigation - kick it off here instead so offline precaching actually
      // starts right after a fresh sign-in, not only on a later page reload.
      runFullPrecache();
      goto('/planner');
    } catch (e: any) {
      error = e.message || 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100 p-4">
  <div class="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
    <div class="text-center mb-8">
      <div class="text-5xl mb-3">🥘</div>
      <h1 class="text-2xl font-bold text-gray-800">Meal Planner</h1>
      <p class="text-gray-500 text-sm mt-1">Sign in to your household</p>
    </div>

    <form onsubmit={(e) => { e.preventDefault(); handleLogin(); }} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="username">Username</label>
        <input
          id="username"
          type="text"
          bind:value={username}
          required
          autocomplete="username"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="your username"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          autocomplete="current-password"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="••••••••"
        />
      </div>

      {#if error}
        <p class="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  </div>
</div>
