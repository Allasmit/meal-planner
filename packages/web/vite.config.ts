import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_SHELL_URLS } from './src/pwa/shells';

const BUILD_ID = Date.now().toString(36);

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
			// Vite's dev server serves unbundled modules that are never precached, so a service worker
			// can't make the dev build work offline - it only served stale pages. Test offline mode with
			// a production build (`pnpm build && pnpm start`).
			devOptions: { enabled: false },
			// The icons are already precached by globPatterns below.
			includeManifestIcons: false,
			// Icons are rendered from static/icons/icon.svg by scripts/generate-icons.cjs.
			manifest: {
				id: '/',
				name: 'Meal Planner',
				short_name: 'Meals',
				description: 'Weekly household meal planning app',
				theme_color: '#12875c',
				background_color: '#12875c',
				display: 'standalone',
				display_override: ['standalone', 'minimal-ui'],
				orientation: 'portrait',
				scope: '/',
				start_url: '/planner',
				categories: ['food', 'lifestyle', 'productivity'],
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					// The artwork sits inside the central safe zone, so the same file works as maskable.
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
				],
				// Long-press shortcuts on the home-screen icon.
				shortcuts: [
					{ name: 'Planner', url: '/planner', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
					{ name: 'Shopping list', short_name: 'Shopping', url: '/shopping-list', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
					{ name: 'Meals', url: '/meals', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
				],
			},
			// Our own service worker (src/pwa/sw.ts), so page navigations can be served from the app
			// shell matching the URL's depth - see the comments there.
			strategies: 'injectManifest',
			srcDir: 'src/pwa',
			filename: 'sw.ts',
			injectManifest: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				// The app shells are rendered by the server, not files in the build. The revision changes on
				// every build, so each deploy precaches shells that match its own JS/CSS.
				additionalManifestEntries: APP_SHELL_URLS.map((url) => ({ url, revision: BUILD_ID })),
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
