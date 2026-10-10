// Single-page app: every route renders client-side (all data is fetched in the browser and the
// layout shows a spinner until the auth check finishes anyway). This makes the HTML the server
// sends identical for every URL, so the service worker can precache it once and serve it for any
// navigation - online or offline - instead of keeping a per-URL snapshot. Server-rendered pages
// can't be shared like that: each one embeds its own route and params (e.g. which meal id), so a
// snapshot of one meal page served for another URL opened the wrong meal.
export const ssr = false;
