import { fetchJsonWithDeadline } from "../bounded-json-request";

export class MarginMutationUncertain extends Error {
  constructor() {
    super("처리 응답을 확인하지 못했습니다. 자동 재전송하지 않았습니다. 계산 이력을 새로 조회해 처리 여부를 확인해 주세요.");
    this.name = "MarginMutationUncertain";
  }
}

export async function requestMarginMutation({ body, getAccessToken, fetcher = fetch, timeoutMs = 15_000 }: {
  body: Record<string, unknown>;
  getAccessToken: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(started ? new MarginMutationUncertain() : new Error("로그인 확인 시간이 초과되었습니다. 다시 시도해 주세요."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const token = await getAccessToken();
      if (controller.signal.aborted) throw new Error("요청이 만료되었습니다.");
      if (!token) throw new Error("계산을 저장하거나 삭제하려면 다시 로그인해 주세요.");
      started = true;
      let result;
      try {
        result = await fetchJsonWithDeadline<{ id?: string; message?: string }>({
          fetcher, input: "/api/operations/snapshot",
          init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) },
          parentSignal: controller.signal, timeoutMs, fallbackPayload: {},
        });
      } catch { throw new MarginMutationUncertain(); }
      if (result.response.status >= 500) throw new MarginMutationUncertain();
      if (!result.response.ok) throw new Error(result.payload.message ?? "계산 처리 요청이 거절되었습니다.");
      if (body.action === "margin_save" && !result.payload.id) throw new MarginMutationUncertain();
      return result.payload;
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
