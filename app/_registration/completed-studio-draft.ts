import type { RegistrationActivity } from "./registration-status";

type StudioActivity = Pick<RegistrationActivity, "id" | "status" | "productId" | "controlState">;
const jobPattern = /^job:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function completedStudioDraftJobId(activity: StudioActivity): string | null {
  if (activity.status !== "ready" || activity.productId !== null || activity.controlState) return null;
  return activity.id.match(jobPattern)?.[1] ?? null;
}

export async function recoverCompletedStudioDraft(activity: StudioActivity, dependencies: {
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  refresh: () => Promise<void>;
  lock: { current: boolean };
}): Promise<string | null> {
  const jobId = completedStudioDraftJobId(activity);
  if (!jobId || dependencies.lock.current) return null;
  dependencies.lock.current = true;
  let productId: string | null = null;
  let failure: Error | null = null;
  try {
    const response = await dependencies.authenticatedFetch("/api/admin/products/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ action: "product_create", jobId }),
    });
    const payload = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
    if (!response.ok || typeof payload?.id !== "string" || !uuidPattern.test(payload.id)) {
      const uncertain = response.ok || [408, 425, 429].includes(response.status) || response.status >= 500;
      throw new Error(uncertain
        ? "상품 연결 응답을 확정하지 못했습니다. 원장을 다시 확인한 후 같은 완료 작업으로 다시 확인할 수 있습니다."
        : typeof payload?.message === "string" ? payload.message.slice(0, 500) : "완료된 AI 초안을 상품에 연결하지 못했습니다.");
    }
    productId = payload.id;
  } catch (error) {
    failure = error instanceof Error && error.name === "Error"
      ? error
      : new Error("상품 연결 응답을 확인하지 못했습니다. 원장을 다시 확인한 후 같은 완료 작업으로 다시 확인할 수 있습니다.");
  } finally {
    // Refresh even after a lost reply: the idempotent RPC may have succeeded.
    // Keep the lock until this read finishes so rapid clicks cannot overlap.
    try { await dependencies.refresh(); } catch {
      failure ??= new Error("최신 상품 원장을 읽지 못했습니다. 새로고침 후 같은 완료 작업으로 다시 확인해 주세요.");
    } finally { dependencies.lock.current = false; }
  }
  if (failure) throw failure;
  return productId;
}
