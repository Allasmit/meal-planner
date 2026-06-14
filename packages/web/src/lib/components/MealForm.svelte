<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { DietaryType, Cuisine, Ingredient, IngredientCategory, MealFormData } from '$lib/types';

  let { mealId = null }: { mealId?: number | null } = $props();

  let dietaryTypes = $state<DietaryType[]>([]);
  let cuisines = $state<Cuisine[]>([]);
  let allIngredients = $state<Ingredient[]>([]);
  let ingredientCategories = $state<IngredientCategory[]>([]);

  let saving = $state(false);
  let error = $state('');
  let ingredientSearch = $state('');

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
    notes: '',
    dietaryTypeIds: [],
    ingredients: [],
  });

  onMount(async () => {
    [dietaryTypes, cuisines, allIngredients, ingredientCategories] = await Promise.all([
      api.getDietaryTypes() as Promise<DietaryType[]>,
      api.getCuisines() as Promise<Cuisine[]>,
      api.getIngredients() as Promise<Ingredient[]>,
      api.getIngredientCategories() as Promise<IngredientCategory[]>,
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
        notes: meal.notes ?? '',
        dietaryTypeIds: meal.dietaryTypes.map((d: DietaryType) => d.id),
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

  let filteredIngredients = $derived(
    allIngredients.filter(
      (i) => i.name.toLowerCase().includes(ingredientSearch.toLowerCase()) &&
        !form.ingredients.find((fi) => fi.ingredientId === i.id)
    )
  );

  function addIngredient(ing: Ingredient) {
    form.ingredients = [...form.ingredients, { ingredientId: ing.id, quantity: 1, unit: ing.defaultUnit ?? 'unit', notes: '' }];
    ingredientSearch = '';
  }

  function removeIngredient(idx: number) { form.ingredients = form.ingredients.filter((_, i) => i !== idx); }

  function getIngredientName(id: number) { return allIngredients.find((i) => i.id === id)?.name ?? ''; }

  async function createAndAddIngredient() {
    if (!ingredientSearch.trim()) return;
    const ing = await api.createIngredient({ name: ingredientSearch.trim() }) as Ingredient;
    allIngredients = [...allIngredients, ing];
    addIngredient(ing);
  }
</script>

<form onsubmit={(e) => { e.preventDefault(); save(); }} class="max-w-2xl mx-auto p-4 space-y-6">
  <h2 class="text-xl font-bold text-gray-800">{mealId ? 'Edit Meal' : 'New Meal'}</h2>

  <!-- Basic info -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
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
    <div>
      <label class="label">Cuisine</label>
      <select bind:value={form.cuisineId} class="input">
        <option value={null}>— Select —</option>
        {#each cuisines as c}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </div>
    <div class="flex items-center gap-2">
      <input type="checkbox" id="isTested" bind:checked={form.isTested} class="w-4 h-4 accent-green-600" />
      <label for="isTested" class="text-sm text-gray-700">I have tested this recipe ✅</label>
    </div>
  </div>

  <!-- Dietary types -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
    <div class="label mb-2">Dietary Types</div>
    <div class="flex flex-wrap gap-2">
      {#each dietaryTypes as dt}
        <button type="button" onclick={() => toggleDietary(dt.id)}
          class="text-sm px-3 py-1.5 rounded-full border transition-colors
            {form.dietaryTypeIds.includes(dt.id) ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:border-green-400'}">
          {dt.icon ?? ''} {dt.name}
        </button>
      {/each}
    </div>
  </div>

  <!-- Ingredients -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
    <div class="label">Ingredients</div>

    {#each form.ingredients as ing, idx}
      <div class="flex items-center gap-2 text-sm">
        <span class="flex-1 font-medium text-gray-700">{getIngredientName(ing.ingredientId)}</span>
        <input type="number" bind:value={ing.quantity} min="0" step="0.1" class="w-20 border border-gray-200 rounded px-2 py-1 text-center" />
        <input type="text" bind:value={ing.unit} class="w-20 border border-gray-200 rounded px-2 py-1" placeholder="unit" />
        <input type="text" bind:value={ing.notes} class="w-28 border border-gray-200 rounded px-2 py-1" placeholder="notes" />
        <button type="button" onclick={() => removeIngredient(idx)} class="text-red-400 hover:text-red-600">✕</button>
      </div>
    {/each}

    <div class="relative">
      <input type="search" bind:value={ingredientSearch} placeholder="Search or add ingredient…"
        class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      {#if ingredientSearch && filteredIngredients.length > 0}
        <div class="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
          {#each filteredIngredients.slice(0, 10) as ing}
            <button type="button" onclick={() => addIngredient(ing)}
              class="w-full text-left px-3 py-2 text-sm hover:bg-green-50 border-b border-gray-50">
              {ing.name} {ing.defaultUnit ? `(${ing.defaultUnit})` : ''}
            </button>
          {/each}
        </div>
      {:else if ingredientSearch && filteredIngredients.length === 0}
        <div class="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1">
          <button type="button" onclick={createAndAddIngredient}
            class="w-full text-left px-3 py-2 text-sm text-green-700 hover:bg-green-50">
            + Create "{ingredientSearch}"
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Instructions -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
    <div class="label">Instructions</div>
    {#each form.instructions as step, idx}
      <div class="flex gap-2 items-start">
        <span class="bg-green-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-2">{idx + 1}</span>
        <textarea bind:value={form.instructions[idx]} class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" rows="2" placeholder="Describe this step…"></textarea>
        {#if form.instructions.length > 1}
          <button type="button" onclick={() => removeStep(idx)} class="text-red-400 hover:text-red-600 mt-2">✕</button>
        {/if}
      </div>
    {/each}
    <button type="button" onclick={addStep} class="text-sm text-green-700 hover:underline">+ Add step</button>
  </div>

  <!-- Notes -->
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
    <label class="label">Notes</label>
    <textarea bind:value={form.notes} class="input" rows="3" placeholder="Personal notes, tips, variations…"></textarea>
  </div>

  {#if error}<p class="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>{/if}

  <div class="flex gap-3 pb-4">
    <button type="button" onclick={() => history.back()} class="flex-1 border border-gray-200 rounded-xl py-3 text-gray-600 hover:bg-gray-50">Cancel</button>
    <button type="submit" disabled={saving} class="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl py-3 disabled:opacity-60 transition-colors">
      {saving ? 'Saving…' : mealId ? 'Save Changes' : 'Create Meal'}
    </button>
  </div>
</form>

<style>
  @reference "tailwindcss";
  .label { @apply block text-sm font-medium text-gray-700 mb-1; }
  .input { @apply w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500; }
</style>
