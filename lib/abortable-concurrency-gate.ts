type WaitingTask = {
  started: boolean;
  start: () => void;
  cancel: () => void;
};

function abortReason(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("사진 확인을 취소했습니다.", "AbortError");
}

export function createAbortableConcurrencyGate(concurrency: number) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  let active = 0;
  const waiting: WaitingTask[] = [];

  const removeWaiting = (entry: WaitingTask) => {
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
  };

  const drain = () => {
    while (active < concurrency && waiting.length > 0) {
      const entry = waiting.shift();
      if (!entry) return;
      entry.start();
    }
  };

  const run = <Result>(task: () => PromiseLike<Result>, signal?: AbortSignal): Promise<Result> => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", entry.cancel);
      callback();
    };
    const entry: WaitingTask = {
      started: false,
      cancel: () => {
        if (entry.started) return;
        removeWaiting(entry);
        finish(() => reject(abortReason(signal)));
        drain();
      },
      start: () => {
        if (settled) return;
        if (signal?.aborted) {
          finish(() => reject(abortReason(signal)));
          return;
        }
        entry.started = true;
        active += 1;
        void Promise.resolve()
          .then(task)
          .then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error)),
          )
          .finally(() => {
            active -= 1;
            drain();
          });
      },
    };
    if (signal?.aborted) {
      finish(() => reject(abortReason(signal)));
      return;
    }
    signal?.addEventListener("abort", entry.cancel, { once: true });
    waiting.push(entry);
    drain();
  });

  return {
    run,
    activeCount: () => active,
    pendingCount: () => waiting.length,
  };
}
