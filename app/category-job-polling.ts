import { categoryJobIdPattern, type CategoryJobOperation, type CategoryJobPayload } from "../lib/channel-category-job";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Input = { productId: string | null; channel: string; operation: CategoryJobOperation; credentialId: string; arguments: Record<string, unknown> };
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  if (typeof value === "string") {
    try { const url = new URL(value); if (/\/storage\/v1\/object\/sign\//.test(url.pathname)) { url.searchParams.delete("token"); return url.toString(); } } catch { /* Ordinary category text. */ }
  }
  return value;
}
export async function categoryJobStorageKey(input: Input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable(input))));
  return `sellerpilot:category-job:v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("카테고리 결과 조회를 중단했습니다.", "AbortError");
}
export function waitForCategoryPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal)); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function runCategoryJobOperation(input: Input, options: {
  storage: Store; signal: AbortSignal; authorization: () => Promise<string>;
  fetch?: typeof fetch; wait?: typeof waitForCategoryPoll; timeoutMs?: number;
}): Promise<CategoryJobPayload> {
  const key = await categoryJobStorageKey(input);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException("카테고리 조회가 12분을 넘었습니다. 다시 확인하면 같은 작업의 결과를 이어서 조회합니다.", "TimeoutError")), options.timeoutMs ?? 12 * 60_000);
  const signal = controller.signal;
  const fetcher = options.fetch ?? fetch;
  const wait = options.wait ?? waitForCategoryPoll;
  const request = async (url: string, init?: RequestInit) => {
    if (signal.aborted) throw abortError(signal);
    const authorization = await options.authorization();
    if (signal.aborted) throw abortError(signal);
    const response = await fetcher(url, { ...init, signal, cache: "no-store", headers: { "content-type": "application/json", authorization, ...init?.headers } });
    const payload = await response.json().catch(() => ({})) as CategoryJobPayload;
    if (signal.aborted) throw abortError(signal);
    return { response, payload };
  };
  try {
    let jobId = options.storage.getItem(key);
    if (jobId && !categoryJobIdPattern.test(jobId)) throw new Error("저장된 카테고리 작업 ID를 확인하지 못했습니다.");
    if (!jobId) {
      const { response, payload } = await request("/api/admin/channel-operations", { method: "POST", body: JSON.stringify({ credentialId: input.credentialId, channel: input.channel, operation: input.operation, idempotencyKey: crypto.randomUUID(), confirmWrite: false, arguments: input.arguments }) });
      if (response.status === 202 && payload.inProgress === true && categoryJobIdPattern.test(payload.jobId ?? "")) {
        jobId = payload.jobId!;
        options.storage.setItem(key, jobId);
      } else {
        if (!response.ok || payload.ok !== true) throw new Error(payload.message ?? "공식 카테고리 조회를 완료하지 못했습니다.");
        return payload;
      }
    }
    const url = `/api/admin/channel-category-jobs?${new URLSearchParams({ jobId, channel: input.channel, operation: input.operation })}`;
    let delay = 5000;
    for (;;) {
      let result: Awaited<ReturnType<typeof request>>;
      try { result = await request(url); } catch (error) {
        if (signal.aborted) throw abortError(signal);
        await wait(delay, signal); delay = Math.min(15_000, delay + 2500); continue;
      }
      const { response, payload } = result;
      if (response.status === 200 && payload.ok === true) {
        if (payload.jobId !== jobId || payload.channel !== input.channel || payload.operation !== input.operation || !Array.isArray(payload.steps)) throw new Error("조회한 카테고리 결과가 요청한 작업과 일치하지 않습니다.");
        options.storage.removeItem(key);
        return payload;
      }
      if (response.status === 409 && payload.code === "CATEGORY_JOB_FAILED") options.storage.removeItem(key);
      if (response.status !== 202 && response.status !== 429 && response.status < 500) throw new Error(payload.message ?? "카테고리 결과를 확인하지 못했습니다.");
      if (response.status === 202 && (payload.inProgress !== true || payload.jobId !== jobId || payload.channel !== input.channel || payload.operation !== input.operation)) throw new Error("대기 중인 카테고리 작업이 요청과 일치하지 않습니다.");
      await wait(delay, signal); delay = Math.min(15_000, delay + 2500);
    }
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", abort);
  }
}
