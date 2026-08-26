function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("작업 실행 대기가 취소됐습니다.");
}

export function createConcurrencyGate(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("동시 실행 제한은 1 이상의 정수여야 합니다.");
  }

  let activeCount = 0;
  const waiting = [];

  const drain = () => {
    while (activeCount < limit && waiting.length) {
      const waiter = waiting.shift();
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }

      activeCount += 1;
      if (waiter.signal) waiter.signal.removeEventListener("abort", waiter.onAbort);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        activeCount -= 1;
        drain();
      });
    }
  };

  const acquire = (signal) => {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: null,
      };
      waiter.onAbort = () => {
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        reject(abortReason(signal));
      };
      if (signal) signal.addEventListener("abort", waiter.onAbort, { once: true });
      waiting.push(waiter);
      drain();
    });
  };

  return {
    get activeCount() {
      return activeCount;
    },
    get pendingCount() {
      return waiting.length;
    },
    async run(task, { signal } = {}) {
      const release = await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
