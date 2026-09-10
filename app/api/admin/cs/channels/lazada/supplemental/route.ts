import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { lazadaSupplementalSurfaceSchema } from "../../../../../../../lib/cs/channels/lazada/supplemental-contract";
import { projectLazadaSupplementalReadRpc } from "../../../../../../../lib/cs/channels/lazada/supplemental-web";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const url = new URL(request.url);
  const parsedSurface = lazadaSupplementalSurfaceSchema.safeParse(url.searchParams.get("surface"));
  const surface = url.searchParams.has("surface")
    ? parsedSurface.success ? parsedSurface.data : null
    : null;
  const beforeAt = url.searchParams.get("beforeAt");
  const beforeKey = url.searchParams.get("beforeKey");
  const beforeCredentialId = url.searchParams.get("beforeCredentialId");
  const beforeCountry = url.searchParams.get("beforeCountry");
  const parsedLimit = Number(url.searchParams.get("limit") ?? "50");
  const cursorValues = [beforeAt, beforeKey, beforeCredentialId, beforeCountry];
  const cursorPresent = cursorValues.filter((value) => value !== null).length;
  if ((url.searchParams.has("surface") && !surface)
      || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100
      || (cursorPresent !== 0 && cursorPresent !== cursorValues.length)
      || (beforeAt !== null && !Number.isFinite(Date.parse(beforeAt)))
      || (beforeKey !== null && !/^[a-f0-9]{64}$/u.test(beforeKey))
      || (beforeCredentialId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(beforeCredentialId))
      || (beforeCountry !== null && !/^(?:SG|MY|TH|VN|ID|PH)$/u.test(beforeCountry))) {
    return NextResponse.json({
      code: "LAZADA_SUPPLEMENTAL_READ_ARGUMENT_INVALID",
      message: "Lazada 보조 CS 조회 조건이 올바르지 않습니다.",
    }, { status: 400, headers: responseHeaders });
  }
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_lazada_supplemental_cs_v1", {
      p_surface: surface,
      p_before_at: beforeAt,
      p_before_event_key: beforeKey,
      p_before_credential_id: beforeCredentialId,
      p_before_country: beforeCountry,
      p_limit: parsedLimit,
    });
    if (error) {
      return NextResponse.json({
        code: "LAZADA_SUPPLEMENTAL_READ_UNAVAILABLE",
        message: "Lazada 리뷰·사후지원 저장 이력을 조회하지 못했습니다.",
      }, { status: 503, headers: responseHeaders });
    }
    return NextResponse.json(projectLazadaSupplementalReadRpc(data), { headers: responseHeaders });
  } catch {
    return NextResponse.json({
      code: "LAZADA_SUPPLEMENTAL_READ_INVALID",
      message: "Lazada 리뷰·사후지원 저장 이력 응답을 검증하지 못했습니다.",
    }, { status: 502, headers: responseHeaders });
  }
}
