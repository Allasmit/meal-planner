<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { FamilyMember, DietaryType } from '$lib/types';

  let members = $state<FamilyMember[]>([]);
  let dietaryTypes = $state<DietaryType[]>([]);
  let loading = $state(false);
  let error = $state('');

  // Add/Edit form
  let editingId = $state<number | null>(null);
  let formName = $state('');
  let formRole = $state<'Adult' | 'Teen' | 'Child'>('Adult');
  let formNotes = $state('');
  let formDietaryIds = $state<number[]>([]);
  let formError = $state('');
  let formSaving = $state(false);
  let showForm = $state(false);

  onMount(async () => {
    loading = true;
    try {
      [members, dietaryTypes] = await Promise.all([
        api.getFamilyMembers() as Promise<FamilyMember[]>,
        api.getDietaryTypes() as Promise<DietaryType[]>,
      ]);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  function startAdd() {
    editingId = null;
    formName = '';
    formRole = 'Adult';
    formNotes = '';
    formDietaryIds = [];
    formError = '';
    showForm = true;
  }

  function startEdit(m: FamilyMember) {
    editingId = m.id;
    formName = m.name;
    formRole = m.role;
    formNotes = m.notes ?? '';
    formDietaryIds = m.dietaryTypes.map((d) => d.id);
    formError = '';
    showForm = true;
  }

  function cancelForm() {
    showForm = false;
    editingId = null;
    formError = '';
  }

  function toggleDietary(id: number) {
    formDietaryIds = formDietaryIds.includes(id)
      ? formDietaryIds.filter((d) => d !== id)
      : [...formDietaryIds, id];
  }

  async function saveForm() {
    if (!formName.trim()) { formError = 'Name is required'; return; }
    formSaving = true; formError = '';
    const body = { name: formName.trim(), role: formRole, notes: formNotes || null, dietaryTypeIds: formDietaryIds };
    try {
      if (editingId) {
        await api.updateFamilyMember(editingId, body);
      } else {
        await api.createFamilyMember(body);
      }
      members = await api.getFamilyMembers() as FamilyMember[];
      cancelForm();
    } catch (e: any) {
      formError = e.message;
    } finally {
      formSaving = false;
    }
  }

  async function deleteMember(id: number, name: string) {
    if (!confirm(`Remove ${name} from the family? This cannot be undone.`)) return;
    await api.deleteFamilyMember(id);
    members = members.filter((m) => m.id !== id);
  }

  const roleColors: Record<string, string> = {
    Adult: 'bg-blue-100 text-blue-700',
    Teen: 'bg-purple-100 text-purple-700',
    Child: 'bg-yellow-100 text-yellow-700',
  };
</script>

<div class="max-w-2xl mx-auto p-4 space-y-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold" style="color: var(--color-text)">👨‍👩‍👧 Family Profiles</h1>
    <button
      onclick={startAdd}
      class="text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm transition-colors"
      style="background: var(--color-accent)"
    >+ Add Member</button>
  </div>

  {#if error}
    <div class="rounded-xl p-3 text-sm" style="background: var(--color-danger-light); color: var(--color-danger)">{error}</div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-10">
      <div class="animate-spin rounded-full h-8 w-8 border-4 border-green-600 border-t-transparent"></div>
    </div>
  {:else if members.length === 0 && !showForm}
    <div class="rounded-xl p-8 text-center" style="background: var(--color-surface); border: 1px solid var(--color-border)">
      <div class="text-4xl mb-3">👨‍👩‍👧</div>
      <p class="font-medium" style="color: var(--color-text)">No family members yet</p>
      <p class="text-sm mt-1" style="color: var(--color-text-muted)">Add each person so the planner can match meals to their dietary needs.</p>
      <button onclick={startAdd} class="mt-4 text-sm font-semibold px-4 py-2 rounded-xl text-white transition-colors" style="background: var(--color-accent)">Add first member</button>
    </div>
  {:else}
    <div class="space-y-3">
      {#each members as m}
        <div class="rounded-xl p-4 space-y-2" style="background: var(--color-surface); border: 1px solid var(--color-border)">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold" style="color: var(--color-text)">{m.name}</span>
                <span class="text-xs px-2 py-0.5 rounded-full font-medium {roleColors[m.role]}">{m.role}</span>
              </div>
              {#if m.notes}
                <p class="text-sm mt-1" style="color: var(--color-text-muted)">{m.notes}</p>
              {/if}
              {#if m.dietaryTypes.length > 0}
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {#each m.dietaryTypes as dt}
                    <span class="text-xs px-2 py-0.5 rounded-full font-medium" style="background: var(--color-accent-light); color: var(--color-accent-text)">
                      {dt.icon ?? ''} {dt.name}
                    </span>
                  {/each}
                </div>
              {:else}
                <p class="text-xs mt-1.5" style="color: var(--color-text-muted)">No dietary restrictions</p>
              {/if}
            </div>
            <div class="flex gap-2 shrink-0">
              <button onclick={() => startEdit(m)} class="text-sm px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80" style="border-color: var(--color-border); color: var(--color-text-muted)">Edit</button>
              <button onclick={() => deleteMember(m.id, m.name)} class="text-sm px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80" style="border-color: var(--color-danger); color: var(--color-danger)">Remove</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Add/Edit Form -->
  {#if showForm}
    <div class="rounded-xl p-4 space-y-4 shadow-lg" style="background: var(--color-surface); border: 2px solid var(--color-accent)">
      <h2 class="font-semibold text-base" style="color: var(--color-text)">{editingId ? 'Edit' : 'Add'} Family Member</h2>

      <div class="space-y-3">
        <div>
          <label class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">Name</label>
          <input
            type="text"
            bind:value={formName}
            placeholder="e.g. Mum, Dad, Amy…"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
          />
        </div>

        <div>
          <label class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">Role</label>
          <div class="flex gap-2">
            {#each ['Adult', 'Teen', 'Child'] as r}
              <button
                onclick={() => formRole = r as any}
                class="flex-1 py-2 rounded-lg text-sm font-medium border transition-colors"
                style="{formRole === r
                  ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);'
                  : 'background: var(--color-bg); border-color: var(--color-border); color: var(--color-text-muted);'}"
              >{r}</button>
            {/each}
          </div>
        </div>

        <div>
          <label class="text-sm font-medium block mb-2" style="color: var(--color-text-muted)">Dietary Restrictions</label>
          <div class="flex flex-wrap gap-2">
            {#each dietaryTypes as dt}
              <button
                onclick={() => toggleDietary(dt.id)}
                class="text-sm px-3 py-1.5 rounded-full border transition-colors"
                style="{formDietaryIds.includes(dt.id)
                  ? 'background: var(--color-accent); color: white; border-color: var(--color-accent);'
                  : 'background: var(--color-bg); border-color: var(--color-border); color: var(--color-text-muted);'}"
              >{dt.icon ?? ''} {dt.name}</button>
            {/each}
          </div>
        </div>

        <div>
          <label class="text-sm font-medium block mb-1" style="color: var(--color-text-muted)">Likes / Dislikes (optional)</label>
          <textarea
            bind:value={formNotes}
            rows="2"
            placeholder="e.g. Loves pasta, hates mushrooms…"
            class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            style="background: var(--color-bg); border-color: var(--color-border); color: var(--color-text)"
          ></textarea>
        </div>
      </div>

      {#if formError}
        <div class="text-sm rounded-lg p-2" style="background: var(--color-danger-light); color: var(--color-danger)">{formError}</div>
      {/if}

      <div class="flex gap-2 pt-1">
        <button onclick={saveForm} disabled={formSaving}
          class="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style="background: var(--color-accent)"
        >{formSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Member'}</button>
        <button onclick={cancelForm}
          class="px-4 py-2 rounded-xl text-sm border transition-colors"
          style="border-color: var(--color-border); color: var(--color-text-muted)"
        >Cancel</button>
      </div>
    </div>
  {/if}
</div>
