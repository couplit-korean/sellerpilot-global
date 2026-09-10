import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { lazadaRawInboxHealthSchema } from "../../../../../../lib/cs/lazada-raw-inbox";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_lazada_im_raw_health_v1");
    if (error) return NextResponse.json({ message: "Lazada 원문 보관함 상태를 조회하지 못했습니다." }, { status: 503, headers });
    const health = lazadaRawInboxHealthSchema.safeParse(data);
    if (!health.success) return NextResponse.json({ message: "Lazada 원문 보관함 상태 응답을 확인하지 못했습니다." }, { status: 502, headers });
    return NextResponse.json(health.data, { headers });
  } catch {
    return NextResponse.json({ message: "Lazada 원문 보관함 상태를 조회하지 못했습니다." }, { status: 503, headers });
  }
}
