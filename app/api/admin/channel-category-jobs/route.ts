import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { categoryJobResponse, validCategoryJobQuery } from "../../../../lib/channel-category-job";

export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "cache-control": "private, no-store, max-age=0" };
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;
  const query = new URL(request.url).searchParams;
  const jobId = query.get("jobId") ?? "";
  const channel = query.get("channel") ?? "";
  const operation = query.get("operation") ?? "";
  if (!validCategoryJobQuery(jobId, channel, operation)) return NextResponse.json({ ok: false, code: "CATEGORY_JOB_QUERY_INVALID", message: "카테고리 조회 조건이 올바르지 않습니다." }, { status: 400, headers });
  try {
    const { data, error } = await admin.serviceClient.rpc("sellerpilot_get_channel_gateway_job", { p_job_id: jobId }).abortSignal(AbortSignal.timeout(15_000));
    if (error) throw new Error("CATEGORY_JOB_READ_UNAVAILABLE");
    const result = categoryJobResponse(data, { jobId, channel, operation });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch {
    return NextResponse.json({ ok: false, code: "CATEGORY_JOB_READ_UNAVAILABLE", message: "카테고리 결과 조회가 지연되고 있습니다." }, { status: 503, headers });
  }
}
