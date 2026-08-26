export async function settleWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  worker: (item: Item, index: number) => Promise<Result>,
): Promise<Array<PromiseSettledResult<Result>>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const results = new Array<PromiseSettledResult<Result>>(items.length);
  let nextIndex = 0;

  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export function createPromiseGate(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  let active = 0;
  const waiting: Array<() => void> = [];
  const drain = () => {
    while (active < concurrency && waiting.length > 0) waiting.shift()?.();
  };

  return function run<Result>(task: () => PromiseLike<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      waiting.push(() => {
        active += 1;
        void (async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error);
          } finally {
            active -= 1;
            drain();
          }
        })();
      });
      drain();
    });
  };
}
