import { after } from "next/server";
import { configuredServerProductResearchDependencies } from "../../../../lib/server-product-research-runtime";
import {
  internalScheduleAuthorization,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "../../../../lib/internal-scheduler-auth";
import { wakeServerProductStudioAfterResponse } from "../../../../lib/server-product-studio-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function wakeJson(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * A terminal Studio job calls this fast admission endpoint to give the serial
 * drain a fresh 300-second Vercel invocation. It is deliberately separate
 * from the Supabase-owned product-research schedule and never claims a channel
 * publication job.
 */
export async function POST(request: Request) {
  const research = configuredServerProductResearchDependencies();
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    research.cronSecret?.trim() ?? "",
  );
  if (authorization === "missing") {
    return wakeJson({ message: "상품 AI 일정 인증값이 설정되지 않았습니다." }, 503);
  }
  if (authorization !== "authorized") {
    return wakeJson({ message: "상품 AI 일정 인증이 필요합니다." }, 401);
  }
  if (internalScheduleRequestMode(request) !== "live") {
    return wakeJson({ message: "상품 AI 즉시 실행 모드를 확인하지 못했습니다." }, 400);
  }
  if (!research.rpc) {
    return wakeJson({ message: "상품 AI 서버 연결이 완료되지 않았습니다." }, 503);
  }
  const status = await research.rpc("sellerpilot_service_serverless_cs_wakeup_status");
  if (status.error || !runtimeStatusMatchesCurrentRelease(status.data, {
    sellerpilotReleaseSha: research.releaseId,
    vercelGitCommitSha: research.vercelGitCommitSha,
  })) {
    return wakeJson({ message: "서버 일정이 활성화되지 않았습니다." }, 503);
  }

  after(wakeServerProductStudioAfterResponse);
  return wakeJson({ accepted: true, status: "queued" }, 202);
}
