import 'fake-indexeddb/auto';

// Minimal browser globals used by the offline modules.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
		setItem: (k: string, v: string) => void storage.set(k, String(v)),
		removeItem: (k: string) => void storage.delete(k),
		clear: () => storage.clear(),
		key: (i: number) => [...storage.keys()][i] ?? null,
		get length() {
			return storage.size;
		}
	},
	configurable: true
});
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
