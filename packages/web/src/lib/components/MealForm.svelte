<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { DietaryType, Cuisine, Ingredient, IngredientCategory, MealFormData, FamilyMember } from '$lib/types';

  let { mealId = null }: { mealId?: number | null } = $props();

  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);
  let allIngredients = $state<Ingredient[]>([]);
  let ingredientCategories = $state<IngredientCategory[]>([]);
  let familyMembers = $state<FamilyMember[]>([]);

  let saving = $state(false);
  let error = $state('');
  let ingredientSearch = $state('');
  let selectedIngredientCategoryId = $state<number | null>(null);

  let imageError = $state('');
  let imageBusy = $state(false);

  let form = $state<MealFormData>({
    name: '',
    description: '',
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    servings: 2,
    difficulty: 'easy',
    cuisineId: null,
    instructions: [''],
    imageUrl: '',
    isTested: false,
    cost: null,
    proteinType: null,
    mealCategory: null,
    leftoverBehaviour: 'consumed_same',
    sourceUrl: '',
    isFavourite: false,
    isSpecialOccasion: false,
    notes: '',
    dietaryTypeIds: [],
    suitableForMemberIds: [],
    preferredByMemberIds: [],
    ingredients: [],
  });

  onMount(async () => {
    [dietaryTypes, cuisines, allIngredients, ingredientCategories, familyMembers] = await Promise.all([
      api.getDietaryTypes() as Promise<DietaryType[]>,
      api.getCuisines() as Promise<Cuisine[]>,
      api.getIngredients() as Promise<Ingredient[]>,
      api.getIngredientCategories() as Promise<IngredientCategory[]>,
      api.getFamilyMembers() as Promise<FamilyMember[]>,
    ]);

    if (mealId) {
      const meal = await api.getMeal(mealId) as any;
      form = {
        name: meal.name,
        description: meal.description ?? '',
        prepTimeMinutes: meal.prepTimeMinutes,
        cookTimeMinutes: meal.cookTimeMinutes,
        servings: meal.servings,
        difficulty: meal.difficulty,
        cuisineId: meal.cuisineId,
        instructions: meal.instructions.length ? meal.instructions : [''],
        imageUrl: meal.imageUrl ?? '',
        isTested: meal.isTested,
        cost: meal.cost ?? null,
        proteinType: meal.proteinType ?? null,
        mealCategory: meal.mealCategory ?? null,
        leftoverBehaviour: meal.leftoverBehaviour ?? 'consumed_same',
        sourceUrl: meal.sourceUrl ?? '',
        isFavourite: meal.isFavourite ?? false,
        isSpecialOccasion: meal.isSpecialOccasion ?? false,
        notes: meal.notes ?? '',
        dietaryTypeIds: meal.dietaryTypes.map((d: DietaryType) => d.id),
        suitableForMemberIds: meal.suitableForMemberIds ?? [],
        preferredByMemberIds: meal.preferredByMemberIds ?? [],
        ingredients: meal.ingredients.map((i: any) => ({
          ingredientId: i.id,
          quantity: i.quantity,
          unit: i.unit,
          notes: i.notes ?? '',
        })),
      };
    }
  });

  async function save() {
    error = '';
    saving = true;
    try {
      const body = { ...form, instructions: form.instructions.filter((s) => s.trim()) };
      if (mealId) {
        await api.updateMeal(mealId, body);
        goto(`/meals/${mealId}`);
      } else {
        const created = await api.createMeal(body) as any;
        goto(`/meals/${created.id}`);
      }
    } catch (e: any) {
      error = e.message ?? 'Save failed';
    } finally {
      saving = false;
    }
  }

  function addStep() { form.instructions = [...form.instructions, '']; }
  function removeStep(i: number) { form.instructions = form.instructions.filter((_, idx) => idx !== i); }

  function toggleDietary(id: number) {
    form.dietaryTypeIds = form.dietaryTypeIds.includes(id)
      ? form.dietaryTypeIds.filter((d) => d !== id)
      : [...form.dietaryTypeIds, id];
  }

  function toggleMember(id: number) {
    form.suitableForMemberIds = form.suitableForMemberIds.includes(id)
      ? form.suitableForMemberIds.filter((m) => m !== id)
      : [...form.suitableForMemberIds, id];
  }

  function togglePreferredMember(id: number) {
    form.preferredByMemberIds = form.preferredByMemberIds.includes(id)
      ? form.preferredByMemberIds.filter((m) => m !== id)
      : [...form.preferredByMemberIds, id];
  }

  async function updateIngredientCategory(ingredientId: number, categoryId: number | null) {
    await api.updateIngredient(ingredientId, { categoryId });
    allIngredients = allIngredients.map((ingredient) =>
      ingredient.id === ingredientId ? { ...ingredient, categoryId } : ingredient
    );
  }

    let filteredIngredients = $derived(
    allIngredients.filter(
      (i) =>
        i.name.toLowerCase().includes(ingredientSearch.toLowerCase()) &&
        !form.ingredients.find((fi) => fi.ingredientId === i.id)
    )
  );

  let normalizedIngredientSearch = $derived(ingredientSearch.trim().toLowerCase());
  let exactIngredientMatch = $derived(
    allIngredients.find((i) => i.name.trim().toLowerCase() === normalizedIngredientSearch) ?? null
  );

  function addIngredient(ing: Ingredient) {
    form.ingredients = [...form.ingredients, { ingredientId: ing.id, quantity: 1, unit: ing.defaultUnit ?? 'unit', notes: '' }];
    ingredientSearch = '';
  }

  function removeIngredient(idx: number) { form.ingredients = form.ingredients.filter((_, i) => i !== idx); }

  function getIngredientName(id: number) { return allIngredients.find((i) => i.id === id)?.name ?? ''; }

  function getIngredientCategoryId(id: number) {
    return allIngredients.find((i) => i.id === id)?.categoryId ?? null;
  }

  async function createAndAddIngredient() {
    const name = ingredientSearch.trim();
    if (!name) return;

    if (exactIngredientMatch) {
      if (!form.ingredients.find((fi) => fi.ingredientId === exactIngredientMatch.id)) {
        addIngredient(exactIngredientMatch);
      } else {
        ingredientSearch = '';
      }
      selectedIngredientCategoryId = null;
      return;
    }

    try {
      const body: { name: string; categoryId?: number } = { name };
      if (selectedIngredientCategoryId !== null) {
        body.categoryId = selectedIngredientCategoryId;
      }

      const ing = await api.createIngredient(body) as Ingredient;
      allIngredients = [...allIngredients, ing];
      addIngredient(ing);
      selectedIngredientCategoryId = null;
    } catch (e: any) {
      error = e?.message ?? 'Failed to create ingredient';
    }
  }


  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  async function compressImageFile(file: File): Promise<string> {
    // Lightweight client-side compression to stay below request size limits.
    const bitmap = await createImageBitmap(file);
    const maxW = 1200;
    const maxH = 1200;
    const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return fileToDataUrl(file);
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  async function setImageFromFile(file: File | null) {
    imageError = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      imageError = 'Please choose an image file.';
      return;
    }

    imageBusy = true;
    try {
      form.imageUrl = await compressImageFile(file);
    } catch (e: any) {
      imageError = e?.message ?? 'Failed to process image.';
    } finally {
      imageBusy = false;
    }
  }

  async function onImageFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    await setImageFromFile(file);
    input.value = '';
  }

  async function onImagePaste(event: ClipboardEvent) {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((i) => i.type.startsWith('image/'));
    if (!imageItem) return;

    event.preventDefault();
    const file = imageItem.getAsFile();
    await setImageFromFile(file);
  }

  function clearImage() {
    form.imageUrl = '';
    imageError = '';
  }  
  const PROTEIN_OPTIONS = [
    { value: 'chicken', label: '🍗 Chicken' },
    { value: 'red_meat', label: '🥩 Red Meat' },
    { value: 'pork', label: '🐷 Pork' },
    { value: 'fish', label: '🐟 Fish' },
    { value: 'lamb', label: '🐑 Lamb' },
    { value: 'other', label: '🍲 Other' },
  ];
  const CATEGORY_OPTIONS = [
    { value: 'dinner', label: '🌙 Dinner' },
    { value: 'breakfast', label: '☀️ Breakfast' },
    { value: 'lunch', label: '🥪 Lunch' },
    { value: 'baking', label: '🍞 Baking' },
    { value: 'treat', label: '🍰 Treat' },
    { value: 'snack', label: '🍎 Snack' },
  ];
  const LEFTOVER_OPTIONS = [
    { value: 'consumed_same', label: '🍽️ Consumed same meal' },
    { value: 'fridge_next_day', label: '🥡 Fridge — next day' },
    { value: 'freezable', label: '❄️ Freezable' },
  ];
</script>

<form onsubmit={(e) => { e.preventDefault(); save(); }} class="max-w-2xl mx-auto p-4 space-y-6">
  <h2 class="text-xl font-bold" style="color: var(--color-text)">{mealId ? 'Edit Meal' : 'New Meal'}</h2>

  <!-- Basic info -->
  <div class="rounded-xl shadow-sm p-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="text-sm font-semibold uppercase mb-1" style="color: var(--color-text-muted)">Basic Info</div>
    <div>
      <label class="label">Meal Name *</label>
      <input type="text" bind:value={form.name} required class="input" placeholder="e.g. Chicken Curry" />
    </div>
    <div>
      <label class="label">Description</label>
      <textarea bind:value={form.description} class="input" rows="2" placeholder="Short description…"></textarea>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Prep Time (min)</label>
        <input type="number" bind:value={form.prepTimeMinutes} min="0" class="input" />
      </div>
      <div>
        <label class="label">Cook Time (min)</label>
        <input type="number" bind:value={form.cookTimeMinutes} min="0" class="input" />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Servings</label>
        <input type="number" bind:value={form.servings} min="1" class="input" />
      </div>
      <div>
        <label class="label">Difficulty</label>
        <select bind:value={form.difficulty} class="input">
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Cuisine</label>
        <select bind:value={form.cuisineId} class="input">
          <option value={null}>— Select —</option>
          {#each cuisines as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div>
        <label class="label">Estimated Cost (R)</label>
        <input type="number" bind:value={form.cost} min="0" step="5" class="input" placeholder="e.g. 120" />
      </div>
    </div>
    <div>
      <label class="label">Source URL (optional)</label>
      <input type="url" bind:value={form.sourceUrl} class="input" placeholder="https://…" />
    </div>
    <div onpaste={onImagePaste}>
      <label class="label">{mealId && !form.imageUrl ? 'Add Image' : 'Image (URL, upload, or paste)'}</label>

      <div class="flex flex-wrap items-center gap-2">
        <input
          type="url"
          bind:value={form.imageUrl}
          class="input flex-1 min-w-[16rem]"
          placeholder="https://example.com/meal.jpg"
        />

        <label class="text-sm px-3 py-2 rounded-lg border cursor-pointer"
          style="border-color: var(--color-border); color: var(--color-text)">
          {imageBusy ? 'Processing...' : 'Upload'}
          <input type="file" accept="image/*" class="hidden" onchange={onImageFileChange} disabled={imageBusy} />
        </label>

        <button
          type="button"
          onclick={clearImage}
          class="text-sm px-3 py-2 rounded-lg border"
          style="border-color: var(--color-border); color: var(--color-text-muted)">
          Clear
        </button>
      </div>

      <p class="text-xs mt-1" style="color: var(--color-text-muted)">
        Tip: click Upload, or paste an image from clipboard with Ctrl+V.
      </p>

      {#if imageError}
        <p class="text-xs mt-2" style="color: var(--color-danger)">{imageError}</p>
      {/if}
    </div>

    {#if form.imageUrl}
      <div class="overflow-hidden rounded-xl" style="border: 1px solid var(--color-border)">
        <img src={form.imageUrl} alt="Meal preview" class="block w-full max-h-64 object-cover" loading="lazy" />
      </div>
    {/if}  
    <div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={form.isTested} class="w-4 h-4 accent-green-600" />
        <span class="text-sm" style="color: var(--color-text)">I have tested this recipe ✅</span>
      </label>
    </div>
  </div>

  <!-- Category & Protein -->
  <div class="rounded-xl shadow-sm p-4 space-y-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="text-sm font-semibold uppercase mb-1" style="color: var(--color-text-muted)">Category & Protein</div>

    <div>
      <label class="label">Meal Category</label>
      <div class="flex flex-wrap gap-2">
        {#each CATEGORY_OPTIONS as opt}
          <button type="button"
            onclick={() => form.mealCategory = form.mealCategory === opt.value ? null : opt.value as any}
            class="text-sm px-3 py-1.5 rounded-full border transition-colors"
            style="{form.mealCategory === opt.value ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <label class="label">Protein Type</label>
      <div class="flex flex-wrap gap-2">
        {#each PROTEIN_OPTIONS as opt}
          <button type="button"
            onclick={() => form.proteinType = form.proteinType === opt.value ? null : opt.value as any}
            class="text-sm px-3 py-1.5 rounded-full border transition-colors"
            style="{form.proteinType === opt.value ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <label class="label">Leftover Behaviour</label>
      <div class="flex flex-wrap gap-2">
        {#each LEFTOVER_OPTIONS as opt}
          <button type="button"
            onclick={() => form.leftoverBehaviour = opt.value as any}
            class="text-sm px-3 py-1.5 rounded-full border transition-colors"
            style="{form.leftoverBehaviour === opt.value ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap gap-4">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={form.isFavourite} class="w-4 h-4 accent-green-600" />
        <span class="text-sm" style="color: var(--color-text)">⭐ Favourite</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={form.isSpecialOccasion} class="w-4 h-4 accent-green-600" />
        <span class="text-sm" style="color: var(--color-text)">🎉 Special Occasion</span>
      </label>
    </div>
  </div>

  <!-- Dietary types -->
  <div class="rounded-xl shadow-sm p-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="label mb-2">Dietary Types</div>
    <div class="flex flex-wrap gap-2">
      {#each dietaryTypes as dt}
        <button type="button" onclick={() => toggleDietary(dt.id)}
          class="text-sm px-3 py-1.5 rounded-full border transition-colors"
          style="{form.dietaryTypeIds.includes(dt.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
          {dt.icon ?? ''} {dt.name}
        </button>
      {/each}
    </div>
  </div>

  <!-- Family members -->
  {#if familyMembers.length > 0}
    <div class="rounded-xl shadow-sm p-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
      <div class="label mb-2">Suitable For</div>
      <p class="text-xs mb-3" style="color: var(--color-text-muted)">Leave all unselected if the meal suits everyone.</p>
      <div class="flex flex-wrap gap-2">
        {#each familyMembers as m}
          <button type="button" onclick={() => toggleMember(m.id)}
            class="text-sm px-3 py-1.5 rounded-full border transition-colors"
            style="{form.suitableForMemberIds.includes(m.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
            {m.name}
          </button>
        {/each}
      </div>
    </div>

    <div class="rounded-xl shadow-sm p-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
      <div class="label mb-2">Preference</div>
      <p class="text-xs mb-3" style="color: var(--color-text-muted)">Select who especially prefers this meal.</p>
      <div class="flex flex-wrap gap-2">
        {#each familyMembers as m}
          <button type="button" onclick={() => togglePreferredMember(m.id)}
            class="text-sm px-3 py-1.5 rounded-full border transition-colors"
            style="{form.preferredByMemberIds.includes(m.id) ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);' : 'border-color: var(--color-border); color: var(--color-text-muted);'}">
            {m.name}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Ingredients -->
  <div class="rounded-xl shadow-sm p-4 space-y-3" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="label">Ingredients</div>

    {#each form.ingredients as ing, idx}
      <div class="flex items-center gap-2 text-sm">
        <span class="flex-1 font-medium" style="color: var(--color-text)">{getIngredientName(ing.ingredientId)}</span>

        <select
          value={getIngredientCategoryId(ing.ingredientId) ?? ''}
          onchange={(e) => updateIngredientCategory(
            ing.ingredientId,
            e.currentTarget.value === '' ? null : Number(e.currentTarget.value)
          )}
          class="w-44 border rounded px-2 py-1 text-sm"
          style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
          <option value="">No category</option>
          {#each ingredientCategories as category}
            <option value={category.id}>{category.name}</option>
          {/each}
        </select>

        <input type="number" bind:value={ing.quantity} min="0" step="0.1" class="w-20 border rounded px-2 py-1 text-center" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        <input type="text" bind:value={ing.unit} class="w-20 border rounded px-2 py-1" placeholder="unit" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        <input type="text" bind:value={ing.notes} class="w-28 border rounded px-2 py-1" placeholder="notes" style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />
        <button type="button" onclick={() => removeIngredient(idx)} class="" style="color: var(--color-danger)">✕</button>
      </div>
    {/each}

    <div class="relative">
      <input type="search" bind:value={ingredientSearch} placeholder="Search or add ingredient…"
        class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)" />

      <select
        bind:value={selectedIngredientCategoryId}
        class="w-full mt-2 border rounded-lg px-3 py-2 text-sm"
        style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)">
        <option value={null}>No category</option>
        {#each ingredientCategories as category}
          <option value={category.id}>{category.name}</option>
        {/each}
      </select>

      {#if ingredientSearch}
        <div class="absolute z-10 top-full left-0 right-0 border rounded-lg shadow-lg mt-1 max-h-56 overflow-y-auto" style="background: var(--color-surface); border-color: var(--color-border)">
          {#each filteredIngredients.slice(0, 10) as ing}
            <button type="button" onclick={() => addIngredient(ing)}
              class="w-full text-left px-3 py-2 text-sm border-b" style="border-color: var(--color-border); color: var(--color-text)">
              {ing.name} {ing.defaultUnit ? `(${ing.defaultUnit})` : ''}
            </button>
          {/each}

          {#if !exactIngredientMatch}
            <button type="button" onclick={createAndAddIngredient}
              class="w-full text-left px-3 py-2 text-sm" style="color: var(--color-accent)">
              + Create "{ingredientSearch}"
            </button>
          {:else if !form.ingredients.find((fi) => fi.ingredientId === exactIngredientMatch.id)}
            <button type="button" onclick={() => addIngredient(exactIngredientMatch)}
              class="w-full text-left px-3 py-2 text-sm" style="color: var(--color-accent)">
              + Add existing "{exactIngredientMatch.name}"
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Instructions -->
  <div class="rounded-xl shadow-sm p-4 space-y-3" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <div class="label">Instructions</div>
    {#each form.instructions as step, idx}
      <div class="flex gap-2 items-start">
        <span class="text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-2" style="background: var(--color-accent)">{idx + 1}</span>
        <textarea bind:value={form.instructions[idx]} class="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" rows="2" placeholder="Describe this step…"
          style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"></textarea>
        {#if form.instructions.length > 1}
          <button type="button" onclick={() => removeStep(idx)} class="mt-2" style="color: var(--color-danger)">✕</button>
        {/if}
      </div>
    {/each}
    <button type="button" onclick={addStep} class="text-sm hover:underline" style="color: var(--color-accent)">+ Add step</button>
  </div>

  <!-- Notes -->
  <div class="rounded-xl shadow-sm p-4" style="background: var(--color-surface); border: 1px solid var(--color-border)">
    <label class="label">Notes</label>
    <textarea bind:value={form.notes} class="input" rows="3" placeholder="Personal notes, tips, variations…"></textarea>
  </div>

  {#if error}<p class="text-sm rounded-lg px-3 py-2" style="color: var(--color-danger); background: var(--color-danger-light)">{error}</p>{/if}

  <div class="flex gap-3 pb-4">
    <button type="button" onclick={() => history.back()} class="flex-1 border rounded-xl py-3 text-sm" style="border-color: var(--color-border); color: var(--color-text-muted)">Cancel</button>
    <button type="submit" disabled={saving} class="flex-1 text-white font-semibold rounded-xl py-3 disabled:opacity-60 transition-colors" style="background: var(--color-accent)">
      {saving ? 'Saving…' : mealId ? 'Save Changes' : 'Create Meal'}
    </button>
  </div>
</form>

<style>
  @reference "tailwindcss";
  .label {
    @apply block text-sm font-medium mb-1;
    color: var(--color-text-muted);
  }
  .input {
    @apply w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500;
    background-color: var(--color-bg);
    border-color: var(--color-border);
    color: var(--color-text);
  }
</style>
