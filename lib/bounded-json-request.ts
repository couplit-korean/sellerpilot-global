function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

function waitForSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
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

export async function fetchJsonWithDeadline<Payload>({
  fetcher,
  input,
  init,
  parentSignal,
  timeoutMs,
  fallbackPayload,
}: {
  fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  input: string;
  init?: RequestInit;
  parentSignal: AbortSignal;
  timeoutMs: number;
  fallbackPayload: Payload;
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortReason(parentSignal));
  const abortFromInit = () => controller.abort(abortReason(init!.signal!));
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  if (init?.signal?.aborted) abortFromInit();
  else init?.signal?.addEventListener("abort", abortFromInit, { once: true });
  const timer = globalThis.setTimeout(() => {
    controller.abort(new DOMException("요청 제한시간을 초과했습니다.", "TimeoutError"));
  }, timeoutMs);
  try {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    const response = await waitForSignal(
      fetcher(input, { ...init, signal: controller.signal }),
      controller.signal,
    );
    const payload = await waitForSignal(
      response.json().catch(() => fallbackPayload),
      controller.signal,
    ) as Payload;
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return { response, payload };
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal.removeEventListener("abort", abortFromParent);
    init?.signal?.removeEventListener("abort", abortFromInit);
  }
}
