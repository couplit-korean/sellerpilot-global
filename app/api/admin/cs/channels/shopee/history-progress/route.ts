import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { projectShopeeHistoryProgress } from "../../../../../../../lib/channels/cs/shopee/history-progress";
import {
  shopeeHistoryEvidenceReadSchema,
  shopeeHistoryReadSchema,
  shopeeHistoryStartSchema,
} from "../../../../../../../lib/cs/channels/shopee/history-events";
import {
  shopeeHistoryRangeEpoch,
  shopeeHistoryStartMatchesRequestKey,
  shopeeHistoryStartRequestSchema,
} from "../../../../../../../lib/cs/channels/shopee/history-start-request";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_cs_shopee_history_events_v1");
    if (error) {
      return NextResponse.json({ message: "Shopee 과거수집 범위를 조회하지 못했습니다." },
        { status: 503, headers });
    }
    const evidence = shopeeHistoryEvidenceReadSchema.safeParse(data);
    if (!evidence.success) {
      return NextResponse.json({ message: "Shopee 과거수집 원장 응답을 확인하지 못했습니다." },
        { status: 502, headers });
    }
    const progress = evidence.data.plannedScopes.length
      ? projectShopeeHistoryProgress(evidence.data.plannedScopes, evidence.data.observedEvents)
      : { contract: "sellerpilot-shopee-history-progress/1" as const, scopes: [], shopKinds: [] };
    const response = shopeeHistoryReadSchema.safeParse({
      contract: "sellerpilot-shopee-history-read/1",
      checkedAt: evidence.data.checkedAt,
      historyRunId: evidence.data.historyRunId,
      progress,
    });
    if (!response.success) {
      return NextResponse.json({ message: "Shopee 과거수집 진행도를 계산하지 못했습니다." },
        { status: 502, headers });
    }
    return NextResponse.json(response.data, { headers });
  } catch {
    return NextResponse.json({ message: "Shopee 과거수집 범위를 조회하지 못했습니다." },
      { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_000) {
      return NextResponse.json({ message: "Shopee 과거수집 요청이 너무 큽니다." }, { status: 413, headers });
    }
    const parsed = shopeeHistoryStartRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Shopee 과거수집 기간을 확인해 주세요." }, { status: 400, headers });
    }
    try {
      shopeeHistoryRangeEpoch(parsed.data);
    } catch {
      return NextResponse.json({ message: "Shopee Returns 기간은 오늘까지 최대 10년 범위로 선택해 주세요." },
        { status: 400, headers });
    }
    const { data, error } = await admin.serviceClient.rpc("sellerpilot_service_start_cs_shopee_history_v2", {
      p_owner_id: admin.user.id,
      p_request_key: parsed.data.requestKey,
      p_from_date: parsed.data.fromDate,
      p_to_date: parsed.data.toDate,
    });
    if (error) {
      return NextResponse.json({ message: "Shopee shop별 과거수집 작업을 접수하지 못했습니다." },
        { status: 503, headers });
    }
    const result = shopeeHistoryStartSchema.safeParse(data);
    if (!result.success || !shopeeHistoryStartMatchesRequestKey(parsed.data.requestKey, result.data)) {
      return NextResponse.json({ message: "Shopee 과거수집 접수 결과를 확인하지 못했습니다." },
        { status: 502, headers });
    }
    return NextResponse.json(result.data, {
      status: result.data.status === "reconnect_required" ? 409
        : result.data.status === "queued" ? 202 : 200,
      headers,
    });
  } catch {
    return NextResponse.json({ message: "Shopee 과거수집 요청을 처리하지 못했습니다." },
      { status: 400, headers });
  }
}
