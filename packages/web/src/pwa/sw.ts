/// <reference lib="webworker" />
// Service worker, built by vite-plugin-pwa (strategy "injectManifest", see vite.config.ts).
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { APP_SHELL_URLS } from './shells';

declare let self: ServiceWorkerGlobalScope;

// registerSW() (in +layout.svelte) asks a newly installed version to take over straight away.
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
// Control the open page on first install too, so offline works without a reload first.
clientsClaim();

// This build's JS/CSS plus the app shells (see APP_SHELL_URLS), all updated together.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The app renders entirely in the browser (src/routes/+layout.ts), so every page is the same
// shell HTML - except that its asset paths are relative ("./_app/..." at /planner, "../_app/..."
// at /meals/12). Serve every page navigation from the precached shell of the same depth: pages
// open instantly and identically online, offline, or on a connection that hangs, and never point
// at assets from another build.
registerRoute(
	new NavigationRoute(
		async ({ request, url }) => {
			const depth = Math.max(0, url.pathname.split('/').length - 2);
			const shell = APP_SHELL_URLS[depth];
			const cached = shell ? await matchPrecache(shell) : undefined;
			return cached ?? fetch(request);
		},
		{ denylist: [/^\/api\//] }
	)
);

// Meal photos are content-addressed (the file name is a hash), so they never change and can be
// served from cache first. Cleared on sign-out via clearOfflineData().
registerRoute(
	({ url }) => url.pathname.startsWith('/api/images/'),
	new CacheFirst({
		cacheName: 'images-cache',
		plugins: [
			new CacheableResponsePlugin({ statuses: [200] }),
			new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 90 * 24 * 60 * 60 }),
		],
	})
);
