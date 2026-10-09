<script lang="ts">
  import { api } from '$lib/api';
  import { createJob } from '$lib/job.svelte';
  import type { ImportedMeal, CsvImportResult } from '$lib/types';

  type BulkResult = {
    created: number;
    errors: number;
    results: { row: number; url: string; status: 'created' | 'error'; error?: string }[];
  };

  // Each import method keeps its own loading / result / error state in a job.
  const urlJob = createJob<ImportedMeal>();
  const bulkJob = createJob<BulkResult>();
  const htmlJob = createJob<ImportedMeal>();
  const textJob = createJob<ImportedMeal>();
  const socialJob = createJob<ImportedMeal>();
  const csvJob = createJob<CsvImportResult>();
  const mediaJob = createJob<ImportedMeal>();

  let url = $state('');
  let bulkUrls = $state('');
  let bulkProgress = $state('');
  let htmlSourceUrl = $state('');
  let htmlText = $state('');
  let textSourceUrl = $state('');
  let plainText = $state('');
  let socialUrl = $state('');
  let socialCaption = $state('');
  let socialComments = $state('');
  let csvFile = $state<FileList | null>(null);
  let mediaFile = $state<FileList | null>(null);
  let mediaSourceUrl = $state('');

  const importFromUrl = () => urlJob.run(() => api.importUrl({ url }));

  function extractUrls(text: string): string[] {
    return Array.from(new Set(text.replace(/\r\n/g, '\n').match(/https?:\/\/[^\s]+/g) ?? []));
  }

  async function importBulkUrls() {
    const urls = extractUrls(bulkUrls);
    if (urls.length === 0) {
      bulkJob.fail('Enter at least one URL');
      return;
    }

    await bulkJob.run(async () => {
      // Sequential on purpose: each import fetches and parses a page server-side, and running
      // them in parallel overloads the server and risks timeouts on a modest home machine.
      const results: BulkResult['results'] = [];
      try {
        for (const [index, currentUrl] of urls.entries()) {
          bulkProgress = `Importing ${index + 1} of ${urls.length}…`;
          try {
            await api.importUrl({ url: currentUrl });
            results.push({ row: index + 1, url: currentUrl, status: 'created' });
          } catch (e: any) {
            results.push({ row: index + 1, url: currentUrl, status: 'error', error: e?.message ?? 'Failed to import recipe' });
          }
        }
      } finally {
        bulkProgress = '';
      }
      return {
        created: results.filter((r) => r.status === 'created').length,
        errors: results.filter((r) => r.status === 'error').length,
        results,
      };
    });
  }

  async function importFromHtml() {
    if (!htmlText.trim()) return htmlJob.fail('Paste page HTML first');
    await htmlJob.run(() => api.importParseHtml({ html: htmlText, sourceUrl: htmlSourceUrl.trim() || undefined }));
  }

  async function importFromText() {
    if (!plainText.trim()) return textJob.fail('Paste some recipe text first');
    await textJob.run(() => api.importParseText({ text: plainText, sourceUrl: textSourceUrl.trim() || undefined }));
  }

  async function importFromSocial() {
    if (!socialUrl.trim() && !socialCaption.trim() && !socialComments.trim()) {
      return socialJob.fail('Enter a post URL, or paste the caption or comment text');
    }
    await socialJob.run(() =>
      api.importSocial({
        url: socialUrl.trim() || undefined,
        caption: socialCaption.trim() || undefined,
        comments: socialComments.trim() || undefined,
      }),
    );
  }

  async function importCsv() {
    const file = csvFile?.[0];
    if (!file) return;
    await csvJob.run(async () => api.importCsv(await file.text()));
  }

  async function importMediaFile() {
    const file = mediaFile?.[0];
    if (!file) return;
    await mediaJob.run(() => {
      const formData = new FormData();
      formData.append('file', file);
      if (mediaSourceUrl.trim()) formData.append('sourceUrl', mediaSourceUrl.trim());
      return api.importMedia(formData);
    });
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
        disabled={urlJob.loading || !url}
        class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors shrink-0"
      >
        {urlJob.loading ? 'Importing…' : 'Import'}
      </button>
    </div>
    {#if urlJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{urlJob.error}</div>
    {/if}
    {#if urlJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{urlJob.result.name}</strong> imported with {urlJob.result.ingredientCount} ingredients.
        <a href="/meals/{urlJob.result.id}" class="underline ml-2">View recipe →</a>
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
      <label for="f164" class="block text-sm font-medium text-gray-700">Source URL</label>
      <input id="f164"
        type="url"
        bind:value={htmlSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label for="f173" class="block text-sm font-medium text-gray-700">HTML</label>
      <textarea id="f173"
        bind:value={htmlText}
        rows="10"
        spellcheck="false"
        placeholder="<html>...</html>"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromHtml}
      disabled={htmlJob.loading || !htmlText.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {htmlJob.loading ? 'Importing…' : 'Import HTML'}
    </button>
    {#if htmlJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{htmlJob.error}</div>
    {/if}
    {#if htmlJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{htmlJob.result.name}</strong> imported with {htmlJob.result.ingredientCount} ingredients.
        <a href="/meals/{htmlJob.result.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>

  <!-- Paste Plain Text -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📝 Paste Plain Text</div>
      <p class="text-sm text-gray-500 mt-1">
        Paste a recipe copied from anywhere (notes app, email, a message, etc.). We'll scan the text for a
        title, ingredients, and instructions automatically.
      </p>
    </div>
    <div class="space-y-2">
      <label for="f210" class="block text-sm font-medium text-gray-700">Optional source URL</label>
      <input id="f210"
        type="url"
        bind:value={textSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label for="f219" class="block text-sm font-medium text-gray-700">Recipe text</label>
      <textarea id="f219"
        bind:value={plainText}
        rows="10"
        spellcheck="false"
        placeholder={"Spaghetti Bolognese\n\nIngredients\n500g minced beef\n400g spaghetti\n...\n\nInstructions\nBrown the mince\nAdd tomatoes and simmer\n..."}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromText}
      disabled={textJob.loading || !plainText.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {textJob.loading ? 'Importing…' : 'Import Text'}
    </button>
    {#if textJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{textJob.error}</div>
    {/if}
    {#if textJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{textJob.result.name}</strong> imported with {textJob.result.ingredientCount} ingredients.
        <a href="/meals/{textJob.result.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>

  <!-- Social Media Post Import -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
    <div>
      <div class="font-semibold text-gray-800">📱 Import from Social Media Post</div>
      <p class="text-sm text-gray-500 mt-1">
        Import a recipe shared on Instagram, TikTok, Facebook, Pinterest, X/Twitter, or YouTube. We'll try
        to fetch the post automatically (including visible comments, since recipe details are often posted
        there instead of the caption), but most of these apps block automated access or hide content behind
        a login — if that happens, paste the caption and/or the comment with the recipe and we'll scan it.
      </p>
    </div>
    <div class="space-y-2">
      <label for="f258" class="block text-sm font-medium text-gray-700">Post URL</label>
      <input id="f258"
        type="url"
        bind:value={socialUrl}
        placeholder="https://www.instagram.com/p/..."
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label for="f267" class="block text-sm font-medium text-gray-700">Caption / post text (paste if the URL fails)</label>
      <textarea id="f267"
        bind:value={socialCaption}
        rows="6"
        spellcheck="false"
        placeholder={"Copy the caption from the post, e.g.\nCreamy Garlic Butter Chicken 🍗\nIngredients:\n- 4 chicken breasts\n- 3 tbsp butter\n...\nMethod:\n1. Season the chicken...\n"}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <div class="space-y-2">
      <label for="f277" class="block text-sm font-medium text-gray-700">Comments (paste the comment with the recipe, if that's where it is)</label>
      <textarea id="f277"
        bind:value={socialComments}
        rows="6"
        spellcheck="false"
        placeholder={"Copy relevant comments, e.g.\n\"Recipe: 500g chicken, 2 cloves garlic, 1 cup cream...\""}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromSocial}
      disabled={socialJob.loading || (!socialUrl.trim() && !socialCaption.trim() && !socialComments.trim())}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {socialJob.loading ? 'Importing…' : 'Import Post'}
    </button>
    {#if socialJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{socialJob.error}</div>
    {/if}
    {#if socialJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{socialJob.result.name}</strong> imported with {socialJob.result.ingredientCount} ingredients.
        <a href="/meals/{socialJob.result.id}" class="underline ml-2">View recipe →</a>
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
      <label for="f311" class="block text-sm font-medium text-gray-700">Recipe URLs</label>
      <textarea id="f311"
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
      disabled={bulkJob.loading || !bulkUrls.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {bulkJob.loading ? bulkProgress || 'Importing…' : 'Import URLs'}
    </button>
    {#if bulkJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{bulkJob.error}</div>
    {/if}
    {#if bulkJob.result}
      <div class="space-y-2">
        <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          ✅ {bulkJob.result.created} imported
          {#if bulkJob.result.errors > 0}
            · <span class="text-amber-700">{bulkJob.result.errors} failed</span>
          {/if}
        </div>
        {#if bulkJob.result.errors > 0}
          <div class="space-y-1">
            {#each bulkJob.result.results.filter((r) => r.status === 'error') as row}
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
      <label for="f367" class="block text-sm font-medium text-gray-700">CSV file</label>
      <input id="f367"
        type="file"
        accept=".csv,text/csv"
        bind:files={csvFile}
        class="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gray-800 hover:file:bg-gray-200"
      />
    </div>
    <button
      onclick={importCsv}
      disabled={csvJob.loading || !csvFile?.[0]}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {csvJob.loading ? 'Importing…' : 'Import CSV'}
    </button>
    {#if csvJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{csvJob.error}</div>
    {/if}
    {#if csvJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 space-y-1">
        <div>✅ {csvJob.result.created} created, {csvJob.result.errors} errors</div>
        {#each csvJob.result.results.filter((r) => r.status === 'error' || r.warnings?.length) as r}
          <div class={r.status === 'error' ? 'text-red-700' : 'text-amber-700'}>
            Row {r.row} ({r.name}): {r.status === 'error' ? r.error : r.warnings?.join('; ')}
          </div>
        {/each}
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
      <label for="f406" class="block text-sm font-medium text-gray-700">Optional source URL</label>
      <input id="f406"
        type="url"
        bind:value={mediaSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label for="f415" class="block text-sm font-medium text-gray-700">Recipe file</label>
      <input id="f415"
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
      disabled={mediaJob.loading || !mediaFile?.[0]}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {mediaJob.loading ? 'Importing…' : 'Import Media'}
    </button>
    {#if mediaJob.error}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{mediaJob.error}</div>
    {/if}
    {#if mediaJob.result}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{mediaJob.result.name}</strong> imported with {mediaJob.result.ingredientCount} ingredients.
        <a href="/meals/{mediaJob.result.id}" class="underline ml-2">View recipe →</a>
      </div>
    {/if}
  </div>
</div>