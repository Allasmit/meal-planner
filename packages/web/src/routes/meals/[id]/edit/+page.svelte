<script lang="ts">
  import { page } from '$app/stores';
  import MealForm from '$lib/components/MealForm.svelte';
  let id = $derived(parseInt($page.params.id, 10));
</script>

<MealForm mealId={id} />
