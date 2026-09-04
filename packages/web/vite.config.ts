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
				runtimeCaching: [
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
