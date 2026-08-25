export type OperationsSnapshotRequest = {
  key: string;
  generation: number;
  signal: AbortSignal;
};

export type BoundedRequestSignal = {
  signal: AbortSignal;
  dispose: () => void;
};

type ActiveRequest = {
  request: OperationsSnapshotRequest;
  controller: AbortController;
  promise: Promise<void>;
};

function abortReason(signal: AbortSignal, fallbackMessage: string) {
  return signal.reason ?? new DOMException(fallbackMessage, "AbortError");
}

export function createBoundedRequestSignal(
  parentSignal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string,
): BoundedRequestSignal {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortReason(parentSignal, "요청이 취소되었습니다."));
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timer = globalThis.setTimeout(() => {
    controller.abort(new DOMException(timeoutMessage, "TimeoutError"));
  }, timeoutMs);
  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      globalThis.clearTimeout(timer);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

export function waitForAbortablePromise<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal, "요청이 취소되었습니다."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal, "요청이 취소되었습니다."));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function operationsSnapshotRangeKey(range: { from: string; to: string }) {
  return JSON.stringify([range.from, range.to]);
}

export function unavailableOperationsSnapshot<T>(
  lastGoodData: T | null,
  message: string,
  retainLastGood: boolean,
) {
  const data = retainLastGood ? lastGoodData : null;
  return {
    data,
    state: "unavailable" as const,
    message: data ? `${message} 마지막 정상 데이터를 유지합니다.` : message,
  };
}

export class OperationsSnapshotRequestCoordinator {
  private active: ActiveRequest | null = null;
  private generation = 0;

  run(key: string, task: (request: OperationsSnapshotRequest) => Promise<void>) {
    if (this.active?.request.key === key) return this.active.promise;

    this.active?.controller.abort();
    const controller = new AbortController();
    const request: OperationsSnapshotRequest = {
      key,
      generation: this.generation + 1,
      signal: controller.signal,
    };
    this.generation = request.generation;

    const active: ActiveRequest = {
      request,
      controller,
      promise: Promise.resolve(),
    };
    this.active = active;
    active.promise = Promise.resolve()
      .then(() => task(request))
      .finally(() => {
        if (this.active === active) this.active = null;
      });
    return active.promise;
  }

  isCurrent(request: OperationsSnapshotRequest, selectedKey = request.key) {
    return selectedKey === request.key
      && this.active?.request.generation === request.generation
      && !request.signal.aborted;
  }

  commitIfCurrent(
    request: OperationsSnapshotRequest,
    selectedKey: string,
    commit: () => void,
  ) {
    if (!this.isCurrent(request, selectedKey)) return false;
    commit();
    return true;
  }

  abortCurrent() {
    this.active?.controller.abort();
    this.active = null;
  }
}
