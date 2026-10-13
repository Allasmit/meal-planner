import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from './db';
import {
	enqueueMutation, getQueue, getFailed, removeFromQueue, markFailed, retryFailed, rewriteTempId,
	replaceTempId, mentionsTempId
} from './queue';
import { set } from './db';
import { flushQueue, syncStatus } from './sync';
import { get as getStore } from 'svelte/store';
import { getCachedGet, setCachedGet } from './cache';
import { applyOptimisticPatch } from './patch';

beforeEach(async () => {
	await clear();
	vi.restoreAllMocks();
});

describe('queue', () => {
	it('keeps changes in the order they were made, even when made at the same instant', async () => {
		await Promise.all([
			enqueueMutation('PUT', '/planner/2026-10-05/dinner', '{"mealId":1}'),
			enqueueMutation('PUT', '/planner/2026-10-06/dinner', '{"mealId":2}'),
			enqueueMutation('DELETE', '/meals/7')
		]);
		const queue = await getQueue();
		expect(queue).toHaveLength(3); // concurrent enqueues no longer overwrite each other
		expect(new Set(queue.map((q) => q.id)).size).toBe(3);
	});

	it('moves rejected changes to a failed list and lets them be retried or dismissed', async () => {
		const item = await enqueueMutation('PUT', '/meals/1', '{}');
		await markFailed(item.id, 'Invalid image');
		expect(await getQueue()).toHaveLength(0);
		expect((await getFailed())[0]).toMatchObject({ id: item.id, error: 'Invalid image' });

		await retryFailed(item.id);
		expect(await getQueue()).toHaveLength(1);
		expect(await getFailed()).toHaveLength(0);

		await removeFromQueue(item.id);
		expect(await getQueue()).toHaveLength(0);
	});

	it('imports the single-array queue used by older versions', async () => {
		await set('outbox-queue', [{ id: 'a', method: 'DELETE', path: '/meals/3', createdAt: 1000 }]);
		const queue = await getQueue();
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({ id: 'a', status: 'pending' });
		expect(await getQueue()).toHaveLength(1); // migrated once, not duplicated
	});

	it('queues changes on pages without crypto.randomUUID (plain HTTP, older phones)', async () => {
		const original = crypto.randomUUID;
		Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
		try {
			await enqueueMutation('POST', '/planner/2026-10-05/dinner', '{"mealId":1}', -1);
			await enqueueMutation('DELETE', '/meals/2');
			const queue = await getQueue();
			expect(queue).toHaveLength(2);
			expect(queue[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			expect(queue[0].id).not.toBe(queue[1].id);
		} finally {
			Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
		}
	});

	it('replaces temporary ids only where they stand alone', () => {
		expect(replaceTempId('/meals/-1234', -1234, 55)).toBe('/meals/55');
		expect(replaceTempId('{"mealId":-1234,"servings":2}', -1234, 55)).toBe('{"mealId":55,"servings":2}');
		expect(replaceTempId('/planner/2026-1234/dinner', -1234, 55)).toBe('/planner/2026-1234/dinner');
		expect(replaceTempId('{"x":-12345}', -1234, 55)).toBe('{"x":-12345}');
		expect(mentionsTempId({ path: '/meals/-9', body: undefined }, -9)).toBe(true);
		expect(mentionsTempId({ path: '/meals/9', body: '{"a":-99}' }, -9)).toBe(false);
	});

	it('rewrites temporary ids in waiting changes', async () => {
		await enqueueMutation('PUT', '/planner/2026-10-05/dinner', '{"mealId":-500}');
		await enqueueMutation('PUT', '/meals/-500', '{}');
		await rewriteTempId(-500, 42);
		const queue = await getQueue();
		expect(queue[0].body).toBe('{"mealId":42}');
		expect(queue[1].path).toBe('/meals/42');
	});
});

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('flushQueue', () => {
	it('sends changes in order and removes the ones that succeed', async () => {
		await enqueueMutation('PUT', '/planner/2026-10-05/dinner', '{"mealId":1}');
		await enqueueMutation('DELETE', '/meals/9');
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
		vi.stubGlobal('fetch', fetchMock);

		await flushQueue();

		expect(fetchMock.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual([
			'PUT /api/planner/2026-10-05/dinner',
			'DELETE /api/meals/9'
		]);
		expect(await getQueue()).toHaveLength(0);
		expect(getStore(syncStatus).pending).toBe(0);
	});

	it('uses the real id for a record created offline in the changes that follow it', async () => {
		await enqueueMutation('POST', '/meals', '{"name":"Soup"}', -700);
		await enqueueMutation('PUT', '/planner/2026-10-05/dinner', '{"mealId":-700}');
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(201, { id: 81 }))
			.mockResolvedValueOnce(jsonResponse(200, {}));
		vi.stubGlobal('fetch', fetchMock);

		await flushQueue();

		expect(fetchMock.mock.calls[1][1].body).toBe('{"mealId":81}');
		expect(await getQueue()).toHaveLength(0);
	});

	it('keeps rejected changes (and anything that depended on them) instead of dropping them silently', async () => {
		await enqueueMutation('POST', '/meals', '{"name":""}', -800);
		await enqueueMutation('PUT', '/planner/2026-10-05/dinner', '{"mealId":-800}');
		await enqueueMutation('DELETE', '/meals/3');
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(400, { error: 'Name required' }))
			.mockResolvedValueOnce(jsonResponse(200, {}));
		vi.stubGlobal('fetch', fetchMock);

		await flushQueue();

		const failed = await getFailed();
		expect(failed.map((f) => f.path)).toEqual(['/meals', '/planner/2026-10-05/dinner']);
		expect(failed[0].error).toBe('Name required');
		expect(fetchMock).toHaveBeenCalledTimes(2); // the dependent change was never sent
		expect(await getQueue()).toHaveLength(0); // unrelated DELETE still went through
		expect(getStore(syncStatus).failed).toBe(2);
	});

	it('stops and keeps everything when the session has expired (401)', async () => {
		await enqueueMutation('PUT', '/meals/1', '{}');
		await enqueueMutation('PUT', '/meals/2', '{}');
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorised' }));
		vi.stubGlobal('fetch', fetchMock);

		await flushQueue();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await getQueue()).toHaveLength(2);
		expect(await getFailed()).toHaveLength(0);
	});

	it('stops on a server error or network failure and retries later', async () => {
		await enqueueMutation('PUT', '/meals/1', '{}');
		await enqueueMutation('PUT', '/meals/2', '{}');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, {})));
		await flushQueue();
		expect(await getQueue()).toHaveLength(2);

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
		await flushQueue();
		expect(await getQueue()).toHaveLength(2);
	});
});

describe('applyOptimisticPatch', () => {
	it('only changes the meal lists, not other cached lists that happen to share the id', async () => {
		await setCachedGet('/meals', [{ id: 5, name: 'Soup' }]);
		await setCachedGet('/meals?search=so', [{ id: 5, name: 'Soup' }]);
		await setCachedGet('/meals/ingredients', [{ id: 5, name: 'Salt' }]);
		await setCachedGet('/meals/cuisines', [{ id: 5, name: 'Thai' }]);

		await applyOptimisticPatch('PUT', '/meals/5', '{"name":"Stew"}');
		expect((await getCachedGet<any[]>('/meals'))![0].name).toBe('Stew');
		expect((await getCachedGet<any[]>('/meals?search=so'))![0].name).toBe('Stew');
		expect((await getCachedGet<any[]>('/meals/ingredients'))![0].name).toBe('Salt');

		await applyOptimisticPatch('DELETE', '/meals/5');
		expect(await getCachedGet('/meals')).toEqual([]);
		expect(await getCachedGet('/meals/cuisines')).toEqual([{ id: 5, name: 'Thai' }]);
	});

	it('adds a planned dish to its own week only, and moves it between weeks', async () => {
		await setCachedGet('/planner?weekStart=2026-10-05', []);
		await setCachedGet('/planner?weekStart=2026-10-12', []);

		await applyOptimisticPatch('POST', '/planner/2026-10-07/dinner', '{"customName":"Pizza"}', -900);
		expect(await getCachedGet<any[]>('/planner?weekStart=2026-10-05')).toHaveLength(1);
		expect(await getCachedGet<any[]>('/planner?weekStart=2026-10-12')).toHaveLength(0);

		await applyOptimisticPatch('PUT', '/planner/entry/-900', '{"planDate":"2026-10-13"}');
		expect(await getCachedGet<any[]>('/planner?weekStart=2026-10-05')).toHaveLength(0);
		expect((await getCachedGet<any[]>('/planner?weekStart=2026-10-12'))![0]).toMatchObject({ id: -900, planDate: '2026-10-13', customName: 'Pizza' });
	});

	it('tracks leftovers offline: marking, planning a portion, and handing it back', async () => {
		const lasagne = { id: 7, planDate: '2026-10-05', mealSlot: 'dinner', mealId: 3, mealName: 'Lasagne', customName: null, leftoverPortions: 0, leftoverRemaining: 0, leftoverFromId: null };
		await setCachedGet('/planner?weekStart=2026-10-05', [lasagne]);
		await setCachedGet('/planner/leftovers', []);
		const leftovers = () => getCachedGet<any[]>('/planner/leftovers');

		await applyOptimisticPatch('PUT', '/planner/entry/7', '{"leftoverPortions":2}');
		expect(await leftovers()).toMatchObject([{ id: 7, leftoverRemaining: 2 }]);

		await applyOptimisticPatch('POST', '/planner/2026-10-06/lunch', '{"mealId":3,"servings":1,"leftoverFromId":7}', -950);
		expect(await leftovers()).toMatchObject([{ id: 7, leftoverRemaining: 1 }]);
		const week = (await getCachedGet<any[]>('/planner?weekStart=2026-10-05'))!;
		expect(week.find((p) => p.id === 7)).toMatchObject({ leftoverRemaining: 1 });
		expect(week.find((p) => p.id === -950)).toMatchObject({ leftoverFromId: 7 });

		await applyOptimisticPatch('POST', '/planner/2026-10-07/lunch', '{"mealId":3,"servings":1,"leftoverFromId":7}', -951);
		expect(await leftovers()).toEqual([]); // all used up

		await applyOptimisticPatch('DELETE', '/planner/entry/-951');
		expect(await leftovers()).toMatchObject([{ id: 7, leftoverRemaining: 1 }]);

		await applyOptimisticPatch('DELETE', '/planner/entry/7');
		expect(await leftovers()).toEqual([]);
	});

	it('places several leftover portions at once, defaulting to all that remain', async () => {
		const stew = { id: 8, planDate: '2026-10-05', mealSlot: 'dinner', mealId: 4, mealName: 'Stew', customName: null, servings: 4, leftoverPortions: 5, leftoverRemaining: 5, leftoverFromId: null };
		await setCachedGet('/planner?weekStart=2026-10-05', [stew]);
		await setCachedGet('/planner/leftovers', [stew]);
		const leftovers = () => getCachedGet<any[]>('/planner/leftovers');
		const week = async () => (await getCachedGet<any[]>('/planner?weekStart=2026-10-05'))!;

		await applyOptimisticPatch('POST', '/planner/2026-10-06/lunch', '{"mealId":4,"servings":2,"leftoverFromId":8}', -960);
		expect(await leftovers()).toMatchObject([{ id: 8, leftoverRemaining: 3 }]);

		await applyOptimisticPatch('PUT', '/planner/entry/-960', '{"servings":3}');
		expect(await leftovers()).toMatchObject([{ id: 8, leftoverRemaining: 2 }]);

		await applyOptimisticPatch('POST', '/planner/2026-10-07/dinner', '{"mealId":4,"leftoverFromId":8}', -961);
		expect((await week()).find((p) => p.id === -961)).toMatchObject({ servings: 2, leftoverFromId: 8 });
		expect(await leftovers()).toEqual([]);

		await applyOptimisticPatch('DELETE', '/planner/entry/-960');
		expect(await leftovers()).toMatchObject([{ id: 8, leftoverRemaining: 3 }]);
		expect((await week()).find((p) => p.id === 8)).toMatchObject({ leftoverRemaining: 3 });
	});
});

describe('clearing a week offline', () => {
	it('removes every entry from the cached week when the deletes are queued at the same time', async () => {
		const entries = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, planDate: '2026-10-05', mealSlot: 'dinner', mealId: i }));
		await setCachedGet('/planner?weekStart=2026-10-05', entries);

		await Promise.all(entries.map((e) => applyOptimisticPatch('DELETE', `/planner/entry/${e.id}`)));

		expect(await getCachedGet<any[]>('/planner?weekStart=2026-10-05')).toEqual([]);
	});
});
