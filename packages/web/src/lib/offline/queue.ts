import { get, set } from './db';

const QUEUE_KEY = 'outbox-queue';

export interface QueuedMutation {
  id: string;
  method: string;
  path: string;
  body?: string;
  createdAt: number;
}

export async function getQueue(): Promise<QueuedMutation[]> {
  return (await get<QueuedMutation[]>(QUEUE_KEY)) ?? [];
}

export async function enqueueMutation(method: string, path: string, body?: string): Promise<QueuedMutation> {
  const queue = await getQueue();
  const item: QueuedMutation = {
    id: crypto.randomUUID(),
    method,
    path,
    body,
    createdAt: Date.now(),
  };
  queue.push(item);
  await set(QUEUE_KEY, queue);
  return item;
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  await set(QUEUE_KEY, queue.filter((item) => item.id !== id));
}

export async function queueLength(): Promise<number> {
  return (await getQueue()).length;
}
