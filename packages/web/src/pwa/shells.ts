// One app-shell URL per path depth, indexed by the number of segments after the first:
// /planner -> 0, /meals/12 -> 1, /meals/12/edit -> 2. Any URL of the same depth renders identical
// shell HTML (its relative asset paths depend only on depth), so these are precached by the
// service worker and served for every page navigation. Extend this if a deeper route is added.
export const APP_SHELL_URLS = ['/', '/meals/0', '/meals/0/edit'];
