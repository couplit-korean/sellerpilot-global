import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { quarantineCursorSchema, quarantinePageSchema } from "../../../../../lib/cs/lazada-quarantine";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  let cursor = null;
  try {
    if (params.has("cursor")) cursor = quarantineCursorSchema.parse(JSON.parse(params.get("cursor")!));
  } catch {
    return NextResponse.json({ message: "조회 위치를 확인해 주세요." }, { status: 400, headers });
  }
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_lazada_quarantine", {
      p_before_time: cursor?.beforeTime ?? null, p_before_key: cursor?.beforeKey ?? null, p_as_of: cursor?.asOf ?? null,
    });
    if (error) return NextResponse.json({ message: "확인 필요 원문을 조회하지 못했습니다." }, { status: 503, headers });
    const page = quarantinePageSchema.safeParse(data);
    if (!page.success) return NextResponse.json({ message: "원문 조회 응답을 확인하지 못했습니다." }, { status: 502, headers });
    return NextResponse.json(page.data, { headers });
  } catch {
    return NextResponse.json({ message: "확인 필요 원문을 조회하지 못했습니다." }, { status: 503, headers });
  }
}
