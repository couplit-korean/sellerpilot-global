import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  coupangCsVerificationQuerySchema,
  coupangCsVerificationResultMatchesQuery,
  coupangCsVerificationResultSchema,
} from "../../../../../../../lib/cs/channels/coupang/verification";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  const query = coupangCsVerificationQuerySchema.safeParse({
    credentialId: params.get("credentialId"),
    from: params.get("from"),
    to: params.get("to"),
    kind: params.get("kind"),
    limit: params.get("limit") ?? 100,
  });
  if (!query.success) {
    return NextResponse.json(
      { message: "쿠팡 CS 대조 기간·종류·계정을 확인해 주세요." },
      { status: 400, headers },
    );
  }
  const { data, error } = await admin.userClient.rpc(
    "sellerpilot_read_coupang_cs_verification_v1",
    {
      p_credential_id: query.data.credentialId,
      p_from_date: query.data.from,
      p_to_date: query.data.to,
      p_kind: query.data.kind,
      p_limit: query.data.limit,
    },
  );
  if (error) {
    return NextResponse.json(
      { message: "쿠팡 CS 대조 데이터를 조회하지 못했습니다." },
      { status: 503, headers },
    );
  }
  const result = coupangCsVerificationResultSchema.safeParse(data);
  return result.success && coupangCsVerificationResultMatchesQuery(result.data, query.data)
    ? NextResponse.json(result.data, { headers })
    : NextResponse.json(
      { message: "쿠팡 CS 대조 응답 형식을 확인하지 못했습니다." },
      { status: 502, headers },
    );
}
