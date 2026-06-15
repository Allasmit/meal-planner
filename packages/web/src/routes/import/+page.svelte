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

  // CSV import
  let csvFile = $state<File | null>(null);
  let csvLoading = $state(false);
  let csvResult = $state<{ created: number; errors: number; results: any[] } | null>(null);
  let csvError = $state('');

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
          return {
            row: index + 1,
            url: currentUrl,
            status: 'created' as const,
          };
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

  async function importCsv() {
    if (!csvFile) return;
    csvError = '';
    csvResult = null;
    csvLoading = true;

    try {
      const csvText = await csvFile.text();
      csvResult = await api.importCsv(csvText) as any;
    } catch (e: any) {
      csvError = e.message;
    } finally {
      csvLoading = false;
    }
  }

  function downloadTemplate() {
    window.open('/api/import/csv-template', '_blank');
  }
</script>

<div class="max-w-3xl mx-auto p-4 space-y-8">
  <h1 class="text-xl font-bold text-gray-800">Import Meals</h1>

  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📎 Import from URL</div>
      <p class="text-sm text-gray-500 mt-1">
        Paste a recipe URL from AllRecipes, BBC Good Food, Food Network, Serious Eats, or similar sites.
        The server will extract the recipe data and import it as a meal.
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

  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📚 Bulk URL Import</div>
      <p class="text-sm text-gray-500 mt-1">
        Paste one recipe URL per line. Each URL will be imported separately using the normal URL importer.
      </p>
    </div>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Recipe URLs</label>
      <textarea
        bind:value={bulkUrls}
        rows="8"
        wrap="off"
        spellcheck="false"
        placeholder="https://example.com/recipe-1
https://example.com/recipe-2"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      />
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

  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📊 Import from CSV / Excel</div>
      <p class="text-sm text-gray-500 mt-1">
        Download the template, fill it in Excel or Google Sheets, save as CSV, then upload here.
        You can import multiple meals at once.
      </p>
    </div>

    <button
      onclick={downloadTemplate}
      class="text-sm border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 transition-colors"
    >
      ⬇️ Download CSV Template
    </button>

    <details class="text-xs text-gray-500">
      <summary class="cursor-pointer hover:text-gray-700">CSV column reference</summary>
      <div class="mt-2 space-y-1 pl-2 border-l-2 border-gray-100">
        <p><strong>name</strong> — meal name, required</p>
        <p><strong>description</strong> — short description</p>
        <p><strong>prep_time_minutes</strong> — number</p>
        <p><strong>cook_time_minutes</strong> — number</p>
        <p><strong>servings</strong> — number</p>
        <p><strong>difficulty</strong> — easy, medium, or hard</p>
        <p><strong>cuisine</strong> — must match an existing cuisine name</p>
        <p><strong>cost</strong> — estimated cost</p>
        <p><strong>protein_type</strong> — chicken, red_meat, pork, fish, lamb, other</p>
        <p><strong>meal_category</strong> — dinner, breakfast, lunch, baking, treat, snack</p>
        <p><strong>leftover_behaviour</strong> — consumed_same, fridge_next_day, freezable</p>
        <p><strong>source_url</strong> — source recipe URL</p>
        <p><strong>image_url</strong> — photo URL</p>
        <p><strong>is_tested</strong> — true / false</p>
        <p><strong>is_favourite</strong> — true / false</p>
        <p><strong>is_special_occasion</strong> — true / false</p>
        <p><strong>notes</strong> — free text</p>
        <p><strong>dietary_types</strong> — pipe-separated dietary type names</p>
        <p><strong>suitable_for</strong> — pipe-separated family member names</p>
        <p><strong>instructions</strong> — steps separated by <code>|</code></p>
        <p><strong>ingredients</strong> — each as <code>name:quantity:unit[:notes]</code> separated by <code>|</code></p>
        <p class="mt-1 text-gray-400">Example: <code>Flour:500:g|Eggs:3:whole|Butter:100:g</code></p>
      </div>
    </details>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">Upload CSV file</label>
      <input
        type="file"
        accept=".csv,text/csv"
        onchange={(e) => {
          csvFile = (e.target as HTMLInputElement).files?.[0] ?? null;
          csvResult = null;
          csvError = '';
        }}
        class="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
      />
    </div>

    {#if csvFile}
      <button
        onclick={importCsv}
        disabled={csvLoading}
        class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-60 transition-colors"
      >
        {csvLoading ? 'Importing…' : `Import "${csvFile.name}"`}
      </button>
    {/if}

    {#if csvError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{csvError}</div>
    {/if}

    {#if csvResult}
      <div class="space-y-2">
        <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          ✅ {csvResult.created} meal{csvResult.created === 1 ? '' : 's'} imported
          {#if csvResult.errors > 0}
            · <span class="text-amber-700">{csvResult.errors} row{csvResult.errors === 1 ? '' : 's'} failed</span>
          {/if}
        </div>
        {#if csvResult.errors > 0}
          <div class="space-y-1">
            {#each csvResult.results.filter((r: any) => r.status === 'error') as row}
              <div class="text-xs text-red-600 bg-red-50 rounded px-3 py-1">
                Row {row.row} ({row.name}): {row.error}
              </div>
            {/each}
          </div>
        {/if}
        {#if csvResult.created > 0}
          <a href="/meals" class="block text-center text-sm text-green-700 underline">View all meals →</a>
        {/if}
      </div>
    {/if}
  </div>
</div>