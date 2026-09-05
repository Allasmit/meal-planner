import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		}),
		VitePWA({
			registerType: 'autoUpdate',
			// SvelteKit's HTML isn't run through Vite's normal transformIndexHtml
			// pipeline (it's server-rendered by adapter-node), so vite-plugin-pwa's
			// automatic <script> injection into the page never actually happens -
			// the service worker was silently never being registered at all. We
			// register it explicitly instead via `virtual:pwa-register/svelte` in
			// +layout.svelte, so disable the (non-functional) auto-injection.
			injectRegister: false,
			devOptions: { enabled: true },
			manifest: {
				name: 'Meal Planner',
				short_name: 'Meals',
				description: 'Weekly household meal planning app',
				theme_color: '#16a34a',
				background_color: '#ffffff',
				display: 'standalone',
				orientation: 'portrait',
				scope: '/',
				start_url: '/planner',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
				],
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				// vite-plugin-pwa defaults this to 'index.html', which registers a
				// NavigationRoute that tries to serve a precached "index.html" for
				// every navigation - but this SvelteKit build (adapter-node, SSR)
				// never produces a top-level index.html, so that default silently
				// breaks ALL navigations once the SW takes control (including while
				// online). Explicitly disable it; the `pages-cache` runtimeCaching
				// rule below handles offline page navigation correctly instead.
				navigateFallback: undefined,
				runtimeCaching: [
					// Cache full page navigations (reloads / deep links / PWA launch)
					// so previously-visited routes still open when offline. Pages here
					// render the same generic app shell regardless of URL (all data is
					// fetched client-side), so caching them by their own URL is safe.
					// NOTE: `navigateFallback` was considered instead, but SvelteKit's
					// adapter-node writes prerendered pages to build/prerendered/,
					// separate from build/client/, so they never end up in the SW's
					// precache manifest - this runtime-caching approach works with the
					// actual build layout without needing a prerendered fallback page.
					{
						urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'pages-cache',
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 },
						},
					},
					{
						urlPattern: /^\/api\/meals\//,
						method: 'GET',
						handler: 'StaleWhileRevalidate',
						options: { cacheName: 'meal-detail-cache', expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 } },
					},
					{
						urlPattern: /^\/api\/(meals|family|planner|users)(\?.*)?$/,
						method: 'GET',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'api-cache',
							networkTimeoutSeconds: 4,
							expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
						},
					},
				],
			},
		}),
	],
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:3001',
				changeOrigin: true,
			},
		},
	},
});
