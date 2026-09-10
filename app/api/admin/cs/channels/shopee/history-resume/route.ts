import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  shopeeHistoryRecoveryRequestSchema,
  shopeeHistoryRecoveryResultSchema,
} from "../../../../../../../lib/cs/channels/shopee/history-recovery-contract";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1_000) {
      return NextResponse.json({ message: "Shopee 과거수집 재개 요청이 너무 큽니다." },
        { status: 413, headers });
    }
    const parsed = shopeeHistoryRecoveryRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Shopee 과거수집 재개 대상을 확인해 주세요." },
        { status: 400, headers });
    }
    const { data, error } = await admin.serviceClient.rpc(
      "sellerpilot_service_resume_cs_shopee_history_v1",
      {
        p_actor_id: admin.user.id,
        p_request_key: parsed.data.requestKey,
        p_history_run_id: parsed.data.historyRunId,
        p_scope_key: parsed.data.scopeKey,
      },
    );
    if (error) {
      return NextResponse.json({ message: "Shopee 과거수집 중단 지점을 재개하지 못했습니다." },
        { status: 409, headers });
    }
    const result = shopeeHistoryRecoveryResultSchema.safeParse(data);
    if (!result.success
        || result.data.historyRunId !== parsed.data.historyRunId
        || result.data.scopeKey !== parsed.data.scopeKey) {
      return NextResponse.json({ message: "Shopee 과거수집 재개 결과를 확인하지 못했습니다." },
        { status: 502, headers });
    }
    return NextResponse.json(result.data, {
      status: result.data.status === "queued" ? 202 : 200,
      headers,
    });
  } catch {
    return NextResponse.json({ message: "Shopee 과거수집 재개 요청을 처리하지 못했습니다." },
      { status: 400, headers });
  }
}
