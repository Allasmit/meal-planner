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

  // Paste plain text import
  let textSourceUrl = $state('');
  let plainText = $state('');
  let textLoading = $state(false);
  let textResult = $state<MealResult | null>(null);
  let textError = $state('');

  // Social media post import
  let socialUrl = $state('');
  let socialCaption = $state('');
  let socialComments = $state('');
  let socialLoading = $state(false);
  let socialResult = $state<MealResult | null>(null);
  let socialError = $state('');

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

  async function importFromText() {
    textError = '';
    textResult = null;

    if (!plainText.trim()) {
      textError = 'Paste some recipe text first';
      return;
    }

    textLoading = true;
    try {
      textResult = await api.importParseText({
        text: plainText,
        sourceUrl: textSourceUrl.trim() || undefined,
      }) as any;
    } catch (e: any) {
      textError = e.message;
    } finally {
      textLoading = false;
    }
  }

  async function importFromSocial() {
    socialError = '';
    socialResult = null;

    if (!socialUrl.trim() && !socialCaption.trim() && !socialComments.trim()) {
      socialError = 'Enter a post URL, or paste the caption or comment text';
      return;
    }

    socialLoading = true;
    try {
      socialResult = await api.importSocial({
        url: socialUrl.trim() || undefined,
        caption: socialCaption.trim() || undefined,
        comments: socialComments.trim() || undefined,
      }) as any;
    } catch (e: any) {
      socialError = e.message;
    } finally {
      socialLoading = false;
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
      <label class="block text-sm font-medium text-gray-700">Optional source URL</label>
      <input
        type="url"
        bind:value={textSourceUrl}
        placeholder="https://example.com/recipe"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Recipe text</label>
      <textarea
        bind:value={plainText}
        rows="10"
        spellcheck="false"
        placeholder={"Spaghetti Bolognese\n\nIngredients\n500g minced beef\n400g spaghetti\n...\n\nInstructions\nBrown the mince\nAdd tomatoes and simmer\n..."}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromText}
      disabled={textLoading || !plainText.trim()}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {textLoading ? 'Importing…' : 'Import Text'}
    </button>
    {#if textError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{textError}</div>
    {/if}
    {#if textResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{textResult.name}</strong> imported with {textResult.ingredientCount} ingredients.
        <a href="/meals/{textResult.id}" class="underline ml-2">View recipe →</a>
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
      <label class="block text-sm font-medium text-gray-700">Post URL</label>
      <input
        type="url"
        bind:value={socialUrl}
        placeholder="https://www.instagram.com/p/..."
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Caption / post text (paste if the URL fails)</label>
      <textarea
        bind:value={socialCaption}
        rows="6"
        spellcheck="false"
        placeholder={"Copy the caption from the post, e.g.\nCreamy Garlic Butter Chicken 🍗\nIngredients:\n- 4 chicken breasts\n- 3 tbsp butter\n...\nMethod:\n1. Season the chicken...\n"}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-700">Comments (paste the comment with the recipe, if that's where it is)</label>
      <textarea
        bind:value={socialComments}
        rows="6"
        spellcheck="false"
        placeholder={"Copy relevant comments, e.g.\n\"Recipe: 500g chicken, 2 cloves garlic, 1 cup cream...\""}
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono overflow-x-auto focus:outline-none focus:ring-2 focus:ring-green-500"
      ></textarea>
    </div>
    <button
      onclick={importFromSocial}
      disabled={socialLoading || (!socialUrl.trim() && !socialCaption.trim() && !socialComments.trim())}
      class="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors"
    >
      {socialLoading ? 'Importing…' : 'Import Post'}
    </button>
    {#if socialError}
      <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{socialError}</div>
    {/if}
    {#if socialResult}
      <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
        ✅ <strong>{socialResult.name}</strong> imported with {socialResult.ingredientCount} ingredients.
        <a href="/meals/{socialResult.id}" class="underline ml-2">View recipe →</a>
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