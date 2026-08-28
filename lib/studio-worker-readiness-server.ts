import "server-only";
import type { AdminApiContext } from "./admin-api";
import { withPromiseTimeout } from "./promise-timeout";
import { resolveStudioWorkerReadiness, type StudioWorkerReadiness } from "./studio-worker-readiness";

export async function readStudioWorkerReadiness(
  admin: AdminApiContext,
): Promise<StudioWorkerReadiness> {
  const runtimeStatus = await withPromiseTimeout(
    admin.userClient.rpc("sellerpilot_ai_runtime_status"),
    10_000,
    "AI 작업자 연결 상태 확인 제한시간을 초과했습니다.",
  ).catch(() => null);
  if (!runtimeStatus || runtimeStatus.error) {
    return resolveStudioWorkerReadiness(null, { statusAvailable: false });
  }
  return resolveStudioWorkerReadiness(runtimeStatus.data);
}
