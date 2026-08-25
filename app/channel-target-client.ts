import { createBoundedRequestSignal, waitForAbortablePromise } from "./operations-snapshot-request-coordinator";

type TargetChannel = "shopee" | "lazada";
type TargetRequestOptions = { signal?: AbortSignal; timeoutMs?: number };
type PendingTargetRequest = {
  accessToken: string;
  controller: AbortController;
  consumers: number;
  settled: boolean;
  promise: Promise<Response>;
};

export const channelTargetRequestTimeoutMs = 25_000;

const pendingTargetRequests = new Map<TargetChannel, PendingTargetRequest>();

function requestAbortReason(signal: AbortSignal, message: string) {
  return signal.reason ?? new DOMException(message, "AbortError");
}

function createPendingTargetRequest(
  channel: TargetChannel,
  accessToken: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const bounded = createBoundedRequestSignal(
    controller.signal,
    timeoutMs,
    `${channel === "shopee" ? "Shopee" : "Lazada"} 등록 대상 조회가 제한시간을 초과했습니다. 다시 확인해 주세요.`,
  );
  const entry: PendingTargetRequest = {
    accessToken,
    controller,
    consumers: 0,
    settled: false,
    promise: Promise.resolve(new Response(null, { status: 503 })),
  };
  const request = (method: "GET" | "POST") => waitForAbortablePromise(
    fetch(`/api/admin/channel-targets?channel=${channel}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify({ channel }) } : {}),
      cache: "no-store",
      signal: bounded.signal,
    }),
    bounded.signal,
  );
  entry.promise = Promise.resolve().then(async () => {
    try {
      const cached = await request("GET");
      if (cached.ok || cached.status === 401 || cached.status === 403) return cached;
      return await request("POST");
    } finally {
      entry.settled = true;
      bounded.dispose();
      if (pendingTargetRequests.get(channel) === entry) pendingTargetRequests.delete(channel);
    }
  });
  return entry;
}

function consumePendingTargetRequest(entry: PendingTargetRequest, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(requestAbortReason(signal, "채널 대상 조회가 취소되었습니다."));
  entry.consumers += 1;
  return new Promise<Response>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      entry.consumers = Math.max(0, entry.consumers - 1);
      if (!entry.settled && entry.consumers === 0) {
        entry.controller.abort(new DOMException("채널 대상 조회 화면이 닫혔습니다.", "AbortError"));
      }
    };
    const onAbort = () => {
      finish();
      reject(requestAbortReason(signal!, "채널 대상 조회가 취소되었습니다."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (response) => {
        finish();
        resolve(response.clone());
      },
      (error) => {
        finish();
        reject(error);
      },
    );
  });
}

export function pendingChannelTargetRequestCount() {
  return pendingTargetRequests.size;
}

export async function fetchChannelTargets(
  channel: TargetChannel,
  accessToken: string,
  options: TargetRequestOptions = {},
) {
  if (options.signal?.aborted) {
    throw requestAbortReason(options.signal, "채널 대상 조회가 취소되었습니다.");
  }
  let pending = pendingTargetRequests.get(channel);
  if (pending && (pending.accessToken !== accessToken || pending.controller.signal.aborted)) {
    pending.controller.abort(new DOMException("더 최신 로그인 또는 재시도 요청으로 교체되었습니다.", "AbortError"));
    if (pendingTargetRequests.get(channel) === pending) pendingTargetRequests.delete(channel);
    pending = undefined;
  }
  if (!pending) {
    pending = createPendingTargetRequest(channel, accessToken, options.timeoutMs ?? channelTargetRequestTimeoutMs);
    pendingTargetRequests.set(channel, pending);
  }
  return await consumePendingTargetRequest(pending, options.signal);
}
