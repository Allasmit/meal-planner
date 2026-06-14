<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth } from '$lib/stores/auth';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);
  let urlLoading = $state(false);
  let urlError = $state('');
  let urlResult = $state<{ id: number; name: string; ingredientCount: number } | null>(null);

  async function handleLogin() {
    error = '';
    loading = true;
    try {
      const user = await api.login({ username, password }) as any;
      auth.setUser(user);
      goto('/planner');
    } catch (e: any) {
      error = e.message || 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function importFromUrl() {
    urlError = ''; urlResult = null; urlLoading = true;
    try {
      // Use allorigins.win as a CORS proxy — browser fetches, not server
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
      const data = await res.json();
      if (!data.contents) throw new Error('No content returned from proxy');
      urlResult = await api.importParseHtml(data.contents, url) as any;
    } catch (e: any) {
      urlError = e.message;
    } finally {
      urlLoading = false;
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

    <div class="mt-6">
      <h2 class="text-xl font-bold text-gray-800">Import from URL</h2>
      <input
        type="text"
        bind:value={url}
        placeholder="https://example.com"
        class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
      />
      <button
        type="button"
        disabled={urlLoading}
        class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
      >
        {urlLoading ? 'Importing…' : 'Import'}
      </button>
      {#if urlError}
        <p class="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{urlError}</p>
      {/if}
      {#if urlResult}
        <p class="text-green-600 text-sm bg-green-50 rounded-lg px-3 py-2">{urlResult.name} ({urlResult.ingredientCount} ingredients)</p>
      {/if}
    </div>
  </div>
</div>
