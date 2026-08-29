import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { sellerSafeAiJobFailure } from "../../../../lib/ai-worker-error-safety";
import { wakeServerProductStudioAfterResponse } from "../../../../lib/server-product-studio-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const actionSchema = z.object({
  jobId: z.string().uuid(),
  action: z.enum(["retry", "cancel"]),
});

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const parsedLimit = Number(url.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100) : 30;
  const { data, error } = await admin.userClient.rpc("sellerpilot_list_ai_jobs", { p_limit: limit });
  if (error) {
    return NextResponse.json({ message: "AI 작업 이력을 불러오지 못했습니다." }, { status: 500 });
  }
  const jobs = (Array.isArray(data) ? data : []).map((job) => {
    const row = job as Record<string, unknown>;
    return {
      ...row,
      error_message: row.error_message ? sellerSafeAiJobFailure(row.error_message) : null,
    };
  });
  return NextResponse.json({ jobs }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "AI 작업 제어 요청을 확인해 주세요." }, { status: 400 });
  }

  const rpc = parsed.data.action === "retry"
    ? "sellerpilot_retry_ai_job"
    : "sellerpilot_cancel_ai_job";
  const { data, error } = await admin.userClient.rpc(rpc, { p_id: parsed.data.jobId });
  if (error) {
    return NextResponse.json({ message: "AI 작업 상태를 변경하지 못했습니다." }, { status: 500 });
  }
  if (data !== true) {
    return NextResponse.json({
      message: parsed.data.action === "retry"
        ? "실패·취소된 작업만 다시 실행할 수 있습니다."
        : "대기·실행 중인 작업만 취소할 수 있습니다.",
    }, { status: 409 });
  }

  if (parsed.data.action === "retry") {
    // The retry RPC preserves the exact server-stored request and resets only
    // its lease/receipt generation. The RPC is short, so this authenticated
    // 300-second request can run the bounded claimant after the transaction
    // has committed without spending another network handoff.
    after(wakeServerProductStudioAfterResponse);
  }

  return NextResponse.json({
    message: parsed.data.action === "retry"
      ? "AI 작업을 다시 대기열에 등록했습니다."
      : "AI 작업을 취소했습니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
