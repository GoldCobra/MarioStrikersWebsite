/** Runs `worker` over `items` with at most `limit` calls in flight, in item order. */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, queue.length || 1));
  const run = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
  };
  await Promise.all(Array.from({ length: workerCount }, run));
}
