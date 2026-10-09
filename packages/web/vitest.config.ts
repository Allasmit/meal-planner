import { defineConfig } from 'vitest/config';

// Unit tests only cover plain TypeScript modules (offline queue, sync, API client), so no SvelteKit plugin is needed.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['./src/test-setup.ts']
	}
});
