/** How many leftover portions a new entry takes: all that remain unless fewer were asked for. null when that many aren't left. */
export function portionsToPlace(requested: number | undefined, remaining: number): number | null {
  const portions = requested ?? remaining;
  return portions >= 1 && portions <= remaining ? portions : null;
}
