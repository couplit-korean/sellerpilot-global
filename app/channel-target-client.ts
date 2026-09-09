import { createBoundedRequestSignal, waitForAbortablePromise } from "./operations-snapshot-request-coordinator";
import { lazadaTargetSyncRequiredPayload } from "../lib/channels/lazada-my-contract";

type TargetChannel = "shopee" | "lazada";
export type ChannelTargetSelection = { targetId: string; marketCode: string };
export type ExactShopeeTarget = ChannelTargetSelection & {
  credentialId: string;
  displayName: string;
  locale: string;
  language: string;
  currency: string;
  status?: string;
};
type TargetRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  selectedTarget?: ChannelTargetSelection;
};
type PendingTargetRequest = {
  accessToken: string;
  controller: AbortController;
  consumers: number;
  settled: boolean;
  promise: Promise<Response>;
};

export const channelTargetRequestTimeoutMs = 25_000;

const pendingTargetRequests = new Map<string, PendingTargetRequest>();

function exactShopeeSelection(channel: TargetChannel, value?: ChannelTargetSelection) {
  const targetId = value?.targetId.trim() ?? "";
  const marketCode = value?.marketCode.trim().toUpperCase() ?? "";
  if (channel !== "shopee" || marketCode !== "SG") return null;
  return /^[1-9][0-9]{0,31}$/u.test(targetId) ? { targetId, marketCode: "SG" as const } : null;
}

function requestKey(channel: TargetChannel, selectedTarget?: ChannelTargetSelection) {
  const exact = exactShopeeSelection(channel, selectedTarget);
  return exact ? `${channel}:${exact.marketCode}:${exact.targetId}` : channel;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function shopeeCredentialIdForExactSync(payload: unknown) {
  const row = record(payload);
  const credentialId = text(row?.credentialId);
  const code = text(row?.code);
  return row?.channel === "shopee"
    && code.startsWith("SHOPEE_TARGET_CACHE_")
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(credentialId)
    ? credentialId
    : "";
}

export function exactShopeeTargetResponseIsBound(
  payload: unknown,
  selection: ChannelTargetSelection,
  expectedCredentialId: string,
) {
  const root = record(payload);
  const target = exactShopeeTargetFromPayload(payload, selection);
  const receipt = record(root?.storeReceipt);
  const credentialVersion = root?.credentialVersion;
  return root?.contractVersion === 2
    && root.channel === "shopee"
    && text(root.credentialId) === expectedCredentialId
    && typeof credentialVersion === "number"
    && Number.isSafeInteger(credentialVersion)
    && credentialVersion > 0
    && text(target?.credentialId) === expectedCredentialId
    && receipt?.contractVersion === 2
    && text(receipt.credentialId) === expectedCredentialId
    && receipt.credentialVersion === credentialVersion
    && text(receipt.targetId) === selection.targetId
    && text(receipt.marketCode).toUpperCase() === selection.marketCode;
}

export function exactShopeeTargetFromPayload(
  payload: unknown,
  selection: ChannelTargetSelection,
): ExactShopeeTarget | null {
  const root = record(payload);
  const targets = Array.isArray(root?.targets) ? root.targets.map(record).filter(Boolean) : [];
  const target = targets.length === 1 ? targets[0] : null;
  const credentialId = text(root?.credentialId);
  const credentialVersion = root?.credentialVersion;
  const ready = root?.contractVersion === 2
    && root.channel === "shopee"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(credentialId)
    && typeof credentialVersion === "number"
    && Number.isSafeInteger(credentialVersion)
    && credentialVersion > 0
    && text(target?.credentialId) === credentialId
    && text(target?.targetId) === selection.targetId
    && text(target?.marketCode).toUpperCase() === selection.marketCode
    && Boolean(text(target?.displayName))
    && Boolean(text(target?.locale))
    && Boolean(text(target?.language))
    && Boolean(text(target?.currency));
  return ready ? {
    credentialId,
    targetId: selection.targetId,
    marketCode: selection.marketCode,
    displayName: text(target?.displayName),
    locale: text(target?.locale),
    language: text(target?.language),
    currency: text(target?.currency),
    ...(text(target?.status) ? { status: text(target?.status) } : {}),
  } : null;
}

function requestAbortReason(signal: AbortSignal, message: string) {
  return signal.reason ?? new DOMException(message, "AbortError");
}

function createPendingTargetRequest(
  channel: TargetChannel,
  accessToken: string,
  timeoutMs: number,
  selectedTarget?: ChannelTargetSelection,
) {
  const exactTarget = exactShopeeSelection(channel, selectedTarget);
  const key = requestKey(channel, selectedTarget);
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
  const request = (method: "GET" | "POST", credentialId = "") => {
    const query = new URLSearchParams({ channel });
    if (exactTarget) {
      query.set("targetId", exactTarget.targetId);
      query.set("marketCode", exactTarget.marketCode);
    }
    return waitForAbortablePromise(
      fetch(`/api/admin/channel-targets?${query.toString()}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? {
          body: JSON.stringify({
            channel,
            ...(credentialId ? { credentialId } : {}),
            ...(exactTarget ? exactTarget : {}),
          }),
        } : {}),
        cache: "no-store",
        signal: bounded.signal,
      }),
      bounded.signal,
    );
  };
  entry.promise = Promise.resolve().then(async () => {
    try {
      const cached = await request("GET");
      const payload = await cached.clone().json().catch(() => null) as unknown;
      if (channel === "lazada") {
        if (cached.ok || cached.status !== 409) return cached;
        const syncRequired = lazadaTargetSyncRequiredPayload(payload);
        if (!syncRequired) return cached;
        return await request("POST", syncRequired.credentialId);
      }
      if (!exactTarget) return cached;
      if (cached.ok) {
        return exactShopeeTargetFromPayload(payload, exactTarget)
          ? cached
          : Response.json({
            code: "SHOPEE_EXACT_TARGET_RESPONSE_UNBOUND",
            message: "조회 응답이 선택한 Shopee 숍과 일치하지 않습니다.",
            channel: "shopee",
            targets: [],
          }, { status: 502 });
      }
      if (cached.status !== 409) return cached;
      const credentialId = shopeeCredentialIdForExactSync(payload);
      if (!credentialId) return cached;
      const synchronized = await request("POST", credentialId);
      if (!synchronized.ok) return synchronized;
      const synchronizedPayload = await synchronized.clone().json().catch(() => null) as unknown;
      if (exactShopeeTargetResponseIsBound(synchronizedPayload, exactTarget, credentialId)) {
        return synchronized;
      }
      return Response.json({
        code: "SHOPEE_EXACT_TARGET_RESPONSE_UNBOUND",
        message: "동기화 응답이 선택한 Shopee 숍과 일치하지 않습니다.",
        channel: "shopee",
        targets: [],
      }, { status: 502 });
    } finally {
      entry.settled = true;
      bounded.dispose();
      if (pendingTargetRequests.get(key) === entry) pendingTargetRequests.delete(key);
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
  const key = requestKey(channel, options.selectedTarget);
  let pending = pendingTargetRequests.get(key);
  if (pending && (pending.accessToken !== accessToken || pending.controller.signal.aborted)) {
    pending.controller.abort(new DOMException("더 최신 로그인 또는 재시도 요청으로 교체되었습니다.", "AbortError"));
    if (pendingTargetRequests.get(key) === pending) pendingTargetRequests.delete(key);
    pending = undefined;
  }
  if (!pending) {
    pending = createPendingTargetRequest(channel, accessToken, options.timeoutMs ?? channelTargetRequestTimeoutMs, options.selectedTarget);
    pendingTargetRequests.set(key, pending);
  }
  return await consumePendingTargetRequest(pending, options.signal);
}
