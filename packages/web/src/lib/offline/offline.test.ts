import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from './db';
import {
	enqueueMutation, getQueue, getFailed, removeFromQueue, markFailed, retryFailed, rewriteTempId,
	replaceTempId, mentionsTempId
} from './queue';
import { set } from './db';
import { flushQueue, syncStatus } from './sync';
import { get as getStore } from 'svelte/store';

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
