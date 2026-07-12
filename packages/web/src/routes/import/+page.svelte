<script lang="ts">
  import { api } from '$lib/api';

  type MealResult = { id: number; name: string; ingredientCount: number };

  // Single URL import
  let url = $state('');
  let urlLoading = $state(false);
  let urlResult = $state<MealResult | null>(null);
  let urlError = $state('');

  // Bulk URL import
  let bulkUrls = $state('');
  let bulkLoading = $state(false);
  let bulkResult = $state<{
    created: number;
    errors: number;
    results: { row: number; url: string; status: 'created' | 'error'; error?: string }[];
  } | null>(null);
  let bulkError = $state('');

  // Paste HTML import
  let htmlSourceUrl = $state('');
  let htmlText = $state('');
  let htmlLoading = $state(false);
  let htmlResult = $state<MealResult | null>(null);
  let htmlError = $state('');

  // CSV import
  let csvFile = $state<FileList | null>(null);
  let csvLoading = $state(false);
  let csvResult = $state<{ created: number; errors: number; results: any[] } | null>(null);
  let csvError = $state('');

  // Media import (image / screenshot / camera / PDF)
  let mediaFile = $state<FileList | null>(null);
  let mediaSourceUrl = $state('');
  let mediaLoading = $state(false);
  let mediaResult = $state<MealResult | null>(null);
  let mediaError = $state('');

  async function importFromUrl() {
    urlError = '';
    urlResult = null;
    urlLoading = true;
    try {
      urlResult = await api.importUrl({ url }) as any;
    } catch (e: any) {
      urlError = e.message;
    } finally {
      urlLoading = false;
    }
  }

  function extractUrls(text: string): string[] {
    return Array.from(
      new Set(
        text
          .replace(/\r\n/g, '\n')
          .match(/https?:\/\/[^\s]+/g) ?? []
      )
    );
  }

  async function importBulkUrls() {
    bulkError = '';
    bulkResult = null;

    const urls = extractUrls(bulkUrls);
    if (urls.length === 0) {
      bulkError = 'Enter at least one URL';
      return;
    }

    bulkLoading = true;
    try {
      const settled = await Promise.allSettled(
        urls.map(async (currentUrl) => api.importUrl({ url: currentUrl }))
      );

      const results = settled.map((entry, index) => {
        const currentUrl = urls[index];
        if (entry.status === 'fulfilled') {
          return { row: index + 1, url: currentUrl, status: 'created' as const };
        }
        return {
          row: index + 1,
          url: currentUrl,
          status: 'error' as const,
          error: entry.reason?.message ?? 'Failed to import recipe',
        };
      });

      bulkResult = {
        created: results.filter((r) => r.status === 'created').length,
        errors: results.filter((r) => r.status === 'error').length,
        results,
      };
    } catch (e: any) {
      bulkError = e.message;
    } finally {
      bulkLoading = false;
    }
  }

  async function importFromHtml() {
    htmlError = '';
    htmlResult = null;

    if (!htmlText.trim()) {
      htmlError = 'Paste page HTML first';
      return;
    }

    htmlLoading = true;
    try {
      htmlResult = await api.importParseHtml({
        html: htmlText,
        sourceUrl: htmlSourceUrl.trim() || undefined,
      }) as any;
    } catch (e: any) {
      htmlError = e.message;
    } finally {
      htmlLoading = false;
    }
  }

  async function importCsv() {
    if (!csvFile?.[0]) return;
    csvError = '';
    csvResult = null;
    csvLoading = true;
    try {
      const csvText = await csvFile[0].text();
      csvResult = await api.importCsv(csvText) as any;
    } catch (e: any) {
      csvError = e.message;
    } finally {
      csvLoading = false;
    }
  }

  async function importMediaFile() {
    if (!mediaFile?.[0]) return;
    mediaError = '';
    mediaResult = null;
    mediaLoading = true;
    try {
      const formData = new FormData();
      formData.append('file', mediaFile[0]);
      if (mediaSourceUrl.trim()) {
        formData.append('sourceUrl', mediaSourceUrl.trim());
      }
      mediaResult = await api.importMedia(formData) as any;
    } catch (e: any) {
      mediaError = e.message;
    } finally {
      mediaLoading = false;
    }
  }

  function downloadTemplate() {
    window.open('/api/import/csv-template', '_blank');
  }
</script>

<div class="max-w-3xl mx-auto p-4 space-y-8">
  <h1 class="text-xl font-bold text-gray-800">Import Meals</h1>

  <!-- Import from URL -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📎 Import from URL</div>
      <p class="text-sm text-gray-500 mt-1">
        Paste a recipe URL from AllRecipes, BBC Good Food, Food Network, Serious Eats, or similar sites.
      </p>
    </div>
    <div class="flex gap-2">
      <input
        type="url"
        bind:value={url}
        placeholder="https://www.allrecipes.com/recipe/..."
        class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
      <button
        onclick={importFromUrl}
        disabled={urlLoading || !url}
        class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors shrink-0"
      >
        {urlLoading ? 'Importing…' : 'Import'}
      </button>
    </div>
    {#if urlError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{urlError}</div>
    {/if}
    {#if urlResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{urlResult.name}</strong> imported with {urlResult.ingredientCount} ingredients.
        <a href="/meals/{urlResult.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>

  <!-- Paste Page HTML -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">🌐 Paste Page HTML</div>
      <p class="text-sm text-gray-500 mt-1">
        Use this when the site blocks server-side fetching. Copy the page source and paste it here.
      </p>
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Source URL</label>
      <input
        type="url"
        bind:value={htmlSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">HTML</label>
      <textarea
        bind:value={htmlText}
        rows="10"
        spellcheck="false"
        placeholder="<html>...</html>"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromHtml}
      disabled={htmlLoading || !htmlText.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {htmlLoading ? 'Importing…' : 'Import HTML'}
    </button>
    {#if htmlError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{htmlError}</div>
    {/if}
    {#if htmlResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{htmlResult.name}</strong> imported with {htmlResult.ingredientCount} ingredients.
        <a href="/meals/{htmlResult.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>

  <!-- Bulk URL Import -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📚 Bulk URL Import</div>
      <p class="text-sm text-gray-500 mt-1">Paste one recipe URL per line.</p>
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Recipe URLs</label>
      <textarea
        bind:value={bulkUrls}
        rows="8"
        wrap="off"
        spellcheck="false"
        placeholder="https://example.com/recipe-1&#10;https://example.com/recipe-2"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importBulkUrls}
      disabled={bulkLoading || !bulkUrls.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {bulkLoading ? 'Importing…' : 'Import URLs'}
    </button>
    {#if bulkError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{bulkError}</div>
    {/if}
    {#if bulkResult}
      <div class="space-y-2">
        <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          ✅ {bulkResult.created} imported
          {#if bulkResult.errors > 0}
            · <span class="text-amber-700">{bulkResult.errors} failed</span>
          {/if}
        </div>
        {#if bulkResult.errors > 0}
          <div class="space-y-1">
            {#each bulkResult.results.filter((r) => r.status === 'error') as row}
              <div class="text-xs text-red-600 bg-red-50 rounded px-3 py-1">
                Row {row.row} ({row.url}): {row.error}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- CSV Import -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📊 Import from CSV / Excel</div>
      <p class="text-sm text-gray-500 mt-1">
        Download the template, fill it in, save as CSV, then upload here.
      </p>
    </div>
    <button
      onclick={downloadTemplate}
      class="text-sm border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 transition-colors"
    >
      ⬇️ Download CSV Template
    </button>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">CSV file</label>
      <input
        type="file"
        accept=".csv,text/csv"
        bind:files={csvFile}
        class="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gray-800 hover:file:bg-gray-200"
      />
    </div>
    <button
      onclick={importCsv}
      disabled={csvLoading || !csvFile?.[0]}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {csvLoading ? 'Importing…' : 'Import CSV'}
    </button>
    {#if csvError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{csvError}</div>
    {/if}
    {#if csvResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ {csvResult.created} created, {csvResult.errors} errors
      </div>
    {/if}
  </div>

  <!-- Media Import -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📷 Import from Image / PDF / Camera</div>
      <p class="text-sm text-gray-500 mt-1">
        Upload a screenshot, phone camera photo, or PDF recipe. The server extracts text and creates a meal.
      </p>
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Optional source URL</label>
      <input
        type="url"
        bind:value={mediaSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Recipe file</label>
      <input
        type="file"
        accept="image/*,application/pdf,.pdf"
        capture="environment"
        bind:files={mediaFile}
        class="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gray-800 hover:file:bg-gray-200"
      />
      <p class="text-xs text-gray-500">Mobile: this can open your camera directly for a quick photo.</p>
    </div>
    <button
      onclick={importMediaFile}
      disabled={mediaLoading || !mediaFile?.[0]}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {mediaLoading ? 'Importing…' : 'Import Media'}
    </button>
    {#if mediaError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{mediaError}</div>
    {/if}
    {#if mediaResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{mediaResult.name}</strong> imported with {mediaResult.ingredientCount} ingredients.
        <a href="/meals/{mediaResult.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>
</div>