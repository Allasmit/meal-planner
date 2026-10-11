import { writable } from 'svelte/store';

// "Install app" support. Chrome/Edge/Samsung fire `beforeinstallprompt` once the app qualifies, and
// we keep the event so the menu can show the install dialog later. iOS Safari has no install API:
// there the menu explains Share → Add to Home Screen instead.

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = {
	/** Already running as an installed app. */
	installed: boolean;
	/** The browser's install dialog can be shown. */
	canPrompt: boolean;
	/** iOS Safari: installable only by hand from the Share menu. */
	ios: boolean;
};

export const installState = writable<InstallState>({ installed: false, canPrompt: false, ios: false });

let deferred: BeforeInstallPromptEvent | null = null;

function isStandalone(): boolean {
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/** Call once at startup, before the browser has a chance to fire `beforeinstallprompt`. */
export function initInstall() {
	const ua = navigator.userAgent;
	// iPadOS reports itself as a Mac, so also check for touch.
	const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
	installState.set({ installed: isStandalone(), canPrompt: false, ios });

	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferred = e as BeforeInstallPromptEvent;
		installState.update((s) => ({ ...s, canPrompt: true }));
	});
	window.addEventListener('appinstalled', () => {
		deferred = null;
		installState.update((s) => ({ ...s, installed: true, canPrompt: false }));
	});
}

/** Shows the browser's install dialog. Resolves true if the user installed the app. */
export async function promptInstall(): Promise<boolean> {
	if (!deferred) return false;
	const event = deferred;
	deferred = null;
	installState.update((s) => ({ ...s, canPrompt: false }));
	await event.prompt();
	const { outcome } = await event.userChoice;
	return outcome === 'accepted';
}
