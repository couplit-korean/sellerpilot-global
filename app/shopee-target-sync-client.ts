import { exactShopeeTargetFromPayload, type ChannelTargetSelection, type ExactShopeeTarget } from "./channel-target-client";

type SyncResult = { target: ExactShopeeTarget; pending: false; message: string }
  | { target: null; pending: boolean; message: string };

/** Existing-authority shop discovery only. Never starts OAuth or retries POST. */
export async function syncExistingShopeeTarget({ accessToken, selection, checkOnly = false, signal, fetcher = fetch }: {
  accessToken: string;
  selection: ChannelTargetSelection;
  checkOnly?: boolean;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<SyncResult> {
  const target = { targetId: selection.targetId.trim(), marketCode: selection.marketCode.trim().toUpperCase() };
  if (!/^[1-9][0-9]{0,31}$/.test(target.targetId)) throw new Error("판매자센터에서 확인한 숫자 숍 ID를 입력해 주세요.");
  if (target.marketCode !== "SG") throw new Error("현재 기존 연결의 공식 숍 동기화는 SG를 지원합니다. 다른 국가로 바꾸어 요청하지 않습니다.");
  const url = `/api/admin/channel-targets?${new URLSearchParams({ channel: "shopee", ...target })}`;
  const request = async (method: "GET" | "POST", credentialId?: string, refreshExpiredJobId?: string) => {
    const response = await fetcher(url, {
      method, cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(method === "POST" ? 60_000 : 15_000)]),
      headers: { authorization: `Bearer ${accessToken}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ channel: "shopee", credentialId, ...target, ...(refreshExpiredJobId ? { refreshExpiredJobId } : {}) }) } : {}),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, body };
  };
  const before = await request("GET");
  const ready = before.response.ok ? exactShopeeTargetFromPayload(before.body, target) : null;
  if (ready) return { target: ready, pending: false, message: "기존 연결의 숍 국가·언어 정보를 확인했습니다." };
  // Server discovers the already enqueued job even after a reload/lost POST
  // response. Its pending/blocked result must never cause another POST.
  if (before.body?.channel === "shopee" && before.body.pending === true) return {
    target: null, pending: true,
    message: typeof before.body.message === "string" ? before.body.message : "기존 숍 조회의 완료를 확인하고 있습니다.",
  };
  const expiredJobId = before.response.status === 409 && before.body?.channel === "shopee"
    && before.body.code === "SHOPEE_TARGET_DISCOVERY_RECEIPT_EXPIRED" && before.body.refreshable === true
    && typeof before.body.jobId === "string" && /^[0-9a-f-]{36}$/i.test(before.body.jobId) ? before.body.jobId : undefined;
  if (checkOnly) return { target: null, pending: !expiredJobId, message: expiredJobId
    ? "기존 조회는 성공했고 유효시간이 지났습니다. 다시 누르면 기존 연결로 최신 숍 정보를 조회합니다."
    : "앞선 동기화의 완료를 아직 확인하지 못했습니다. 상태 확인은 새 동기화를 전송하지 않습니다." };
  const credentialId = typeof before.body?.credentialId === "string" ? before.body.credentialId : "";
  if (before.response.status !== 409 || before.body?.channel !== "shopee"
      || typeof before.body.code !== "string" || (!before.body.code.startsWith("SHOPEE_TARGET_CACHE_") && !expiredJobId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialId)) {
    return { target: null, pending: false, message: typeof before.body?.message === "string" ? before.body.message : "기존 연결과 선택한 숍을 확인하지 못했습니다." };
  }
  // A timeout can occur after the provider read or credential refresh committed.
  // Every POST outcome is resolved with a fresh exact GET, never a second POST.
  let postMessage = "";
  try {
    const posted = await request("POST", credentialId, expiredJobId);
    postMessage = typeof posted.body?.message === "string" ? posted.body.message : "";
  } catch {
    postMessage = "동기화 응답을 확인하지 못했습니다.";
  }
  try {
    const after = await request("GET");
    const confirmed = after.response.ok ? exactShopeeTargetFromPayload(after.body, target) : null;
    if (confirmed) return { target: confirmed, pending: false, message: "기존 연결로 숍 국가·언어를 동기화했습니다." };
  } catch { /* Preserve the uncertain operation; the next click is GET only. */ }
  return { target: null, pending: true, message: `${postMessage || "동기화가 처리 중이거나 확인이 필요합니다."} 같은 숍의 상태만 다시 확인해 주세요.` };
}
