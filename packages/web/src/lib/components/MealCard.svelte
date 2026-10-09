<script lang="ts">
  import { DIFFICULTY_COLORS } from '$lib/utils';
  import { PROTEIN_COLORS, LEFTOVER_LABELS } from '$lib/constants';
  import type { Meal } from '$lib/types';

  type Props = {
    meal: Meal;
    /** Render as a link to the meal page. */
    href?: string;
    /** Render as a button that picks this meal (used by the planner's meal picker). */
    onselect?: (meal: Meal) => void;
  };

  let { meal, href, onselect }: Props = $props();
</script>

<svelte:element
  this={href ? 'a' : 'button'}
  {...href ? { href } : { type: 'button' }}
  onclick={href ? undefined : () => onselect?.(meal)}
  class="rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow block relative overflow-hidden {href ? '' : 'text-left w-full'}"
  style="background: var(--color-surface); border: 1px solid var(--color-border)"
>
  {#if meal.imageUrl}
    <div class="mb-3 -mx-4 -mt-4 overflow-hidden rounded-t-xl">
      <img src={meal.imageUrl} alt={meal.name} class="h-40 w-full object-cover block" loading="lazy" />
    </div>
  {/if}

  {#if meal.proteinType}
    <div class="absolute top-0 left-0 w-1 h-full rounded-l-xl" style="background: {PROTEIN_COLORS[meal.proteinType]}"></div>
  {/if}

  <div class="flex items-start justify-between gap-2" class:pl-2={!!meal.proteinType}>
    <h3 class="font-semibold leading-tight" style="color: var(--color-text)">{meal.name}</h3>
    <div class="flex items-center gap-1 shrink-0">
      {#if meal.isFavourite}<span title="Favourite" role="img" aria-label="Favourite">⭐</span>{/if}
      {#if meal.isSpecialOccasion}<span title="Special Occasion" role="img" aria-label="Special occasion">🎉</span>{/if}
      {#if !meal.isTested}<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="Not tested yet" role="img" aria-label="Not tested yet">🧪</span>{/if}
    </div>
  </div>

  {#if meal.description}
    <p class="text-sm mt-1 line-clamp-2" style="color: var(--color-text-muted)" class:pl-2={!!meal.proteinType}>{meal.description}</p>
  {/if}

  <div class="flex items-center gap-2 mt-2 flex-wrap" class:pl-2={!!meal.proteinType}>
    <span class="text-xs" style="color: var(--color-text-muted)">⏱ {meal.prepTimeMinutes + meal.cookTimeMinutes}m</span>
    <span class="text-xs px-2 py-0.5 rounded {DIFFICULTY_COLORS[meal.difficulty]}">{meal.difficulty}</span>
    {#if meal.leftoverBehaviour !== 'consumed_same'}
      <span class="text-xs" title={LEFTOVER_LABELS[meal.leftoverBehaviour]} role="img" aria-label={LEFTOVER_LABELS[meal.leftoverBehaviour]}>{meal.leftoverBehaviour === 'freezable' ? '❄️' : '🥡'}</span>
    {/if}
    {#if meal.cost != null}
      <span class="text-xs" style="color: var(--color-text-muted)">R{meal.cost.toFixed(0)}</span>
    {/if}
    {#each (meal.dietaryTypes || []).slice(0, 3) as dt}
      <span class="text-xs" style="color: var(--color-text-muted)" title={dt.name}>{dt.icon ?? ''}</span>
    {/each}
  </div>
</svelte:element>
