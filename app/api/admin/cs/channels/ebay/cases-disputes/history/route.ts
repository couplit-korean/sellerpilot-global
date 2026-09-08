import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../lib/admin-api";
import {
  ebayCaseDisputeHistoryPageSchema,
  ebayCaseDisputeHistoryQuerySchema,
} from "../../../../../../../../lib/cs/channels/ebay/case-dispute-history";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
};

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) {
    return fail(400, "INVALID_QUERY", "eBay 케이스·분쟁 이력 조건이 중복됐습니다.");
  }
  const parsed = ebayCaseDisputeHistoryQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) {
    return fail(400, "INVALID_QUERY", "eBay 케이스·분쟁 계정·종류·페이지 선택을 확인해 주세요.");
  }
  const query = parsed.data;
  try {
    const result = await admin.userClient.rpc("sellerpilot_read_ebay_case_dispute_history_v2", {
      p_credential_id: query.credentialId,
      p_resource_kind: query.resourceKind ?? null,
      p_before_observed_at: query.beforeObservedAt ?? null,
      p_before_id: query.beforeId ?? null,
      p_limit: query.limit,
    });
    if (result.error) return fail(503, "CASE_DISPUTE_HISTORY_UNAVAILABLE", "eBay 케이스·분쟁 이력을 확인하지 못했습니다.");
    const page = ebayCaseDisputeHistoryPageSchema.safeParse(result.data);
    if (!page.success
        || page.data.credentialId !== query.credentialId
        || page.data.resourceKind !== (query.resourceKind ?? null)) {
      return fail(502, "CASE_DISPUTE_HISTORY_UNVERIFIED", "eBay 케이스·분쟁 이력 응답을 검증하지 못했습니다.");
    }
    return NextResponse.json(page.data, { headers });
  } catch {
    return fail(503, "CASE_DISPUTE_HISTORY_UNAVAILABLE", "eBay 케이스·분쟁 이력을 확인하지 못했습니다.");
  }
}
