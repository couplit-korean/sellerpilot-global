import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";

export const runtime = "nodejs";

const REVIEW_RPC_TIMEOUT_MS = 10_000;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" } as const;
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const reviewReasonSchema = z.enum([
  "source_opened",
  "brand_model_match",
  "gtin_mpn_match",
  "quantity_pack_match",
  "variant_condition_match",
  "not_accessory_refill",
  "identity_mismatch",
  "insufficient_identity",
  "review_withdrawn",
]);

const reviewRequestSchema = z.object({
  observationId: z.string().uuid(),
  expectedFingerprint: fingerprintSchema,
  expectedCheckedAt: z.string().datetime({ offset: true }),
  expectedLatestReviewId: z.string().uuid().nullable(),
  decision: z.enum(["confirmed_exact", "rejected", "revoked"]),
  reasonCodes: z.array(reviewReasonSchema).min(1).max(12),
  note: z.string().trim().min(5).max(2_000),
  requestId: z.string().uuid(),
}).superRefine((value, context) => {
  const reasons = new Set(value.reasonCodes);
  if (reasons.size !== value.reasonCodes.length) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "검토 근거를 중복 없이 선택해 주세요." });
  }
  if (value.decision === "confirmed_exact") {
    const required = ["source_opened", "quantity_pack_match", "variant_condition_match", "not_accessory_refill"];
    const allowed = new Set(["source_opened", "brand_model_match", "gtin_mpn_match", "quantity_pack_match", "variant_condition_match", "not_accessory_refill"]);
    if (value.reasonCodes.some((reason) => !allowed.has(reason))
      || required.some((reason) => !reasons.has(reason as z.infer<typeof reviewReasonSchema>))
      || (!reasons.has("brand_model_match") && !reasons.has("gtin_mpn_match"))) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "exact 승인에 필요한 동일상품 근거를 모두 확인해 주세요." });
    }
  } else if (value.decision === "rejected") {
    const allowed = new Set(["source_opened", "identity_mismatch", "insufficient_identity"]);
    if (value.reasonCodes.some((reason) => !allowed.has(reason))
      || !reasons.has("source_opened")
      || (!reasons.has("identity_mismatch") && !reasons.has("insufficient_identity"))) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "제외 사유를 선택해 주세요." });
    }
  } else if (value.reasonCodes.length !== 1 || !reasons.has("review_withdrawn")) {
    context.addIssue({ code: "custom", path: ["reasonCodes"], message: "철회 요청 형식을 확인해 주세요." });
  }
});

function rpcFailure(message: string) {
  if (/observation not found/iu.test(message)) {
    return NextResponse.json({ message: "검토할 가격 관측값을 찾지 못했습니다." }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (/request conflict|observation changed|review state changed|not reviewable/iu.test(message)) {
    return NextResponse.json({ message: "가격 관측값이나 검토 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409, headers: NO_STORE_HEADERS });
  }
  if (/invalid competitor match review|evidence incomplete/iu.test(message)) {
    return NextResponse.json({ message: "검토 근거와 메모를 다시 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (/administrator access required|permission denied/iu.test(message)) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ message: "동일상품 검토 결과를 저장하지 못했습니다." }, { status: 500, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: REVIEW_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;

  const observationId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("observationId"));
  if (!observationId.success) {
    return NextResponse.json({ message: "가격 관측값 ID를 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_competitor_match_review_history", {
    p_observation_id: observationId.data,
  });
  if (error) return rpcFailure(error.message);
  if (data === null) {
    return NextResponse.json({ message: "검토할 가격 관측값을 찾지 못했습니다." }, { status: 404, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ reviews: data }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: REVIEW_RPC_TIMEOUT_MS });
  if (isAdminApiError(admin)) return admin;

  const body = await request.json().catch(() => null);
  const parsed = reviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "검토 요청 형식을 확인해 주세요." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_review_competitor_match", {
    p_observation_id: parsed.data.observationId,
    p_expected_fingerprint: parsed.data.expectedFingerprint,
    p_expected_checked_at: parsed.data.expectedCheckedAt,
    p_expected_latest_review_id: parsed.data.expectedLatestReviewId,
    p_decision: parsed.data.decision,
    p_reason_codes: parsed.data.reasonCodes,
    p_note: parsed.data.note,
    p_request_id: parsed.data.requestId,
  });
  if (error) return rpcFailure(error.message);
  return NextResponse.json({ review: data }, { status: 201, headers: NO_STORE_HEADERS });
}
