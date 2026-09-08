import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { lazadaRawInboxCursorSchema, lazadaRawInboxPageSchema } from "../../../../../lib/cs/lazada-raw-inbox";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  let cursor = null;
  try {
    if (params.has("cursor")) cursor = lazadaRawInboxCursorSchema.parse(JSON.parse(params.get("cursor")!));
  } catch {
    return NextResponse.json({ message: "조회 위치를 확인해 주세요." }, { status: 400, headers });
  }
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_lazada_im_raw_inbox_v1", {
      p_before_time: cursor?.beforeTime ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_as_of: cursor?.asOf ?? null,
    });
    if (error) return NextResponse.json({ message: "Lazada 원문 이벤트를 조회하지 못했습니다." }, { status: 503, headers });
    const page = lazadaRawInboxPageSchema.safeParse(data);
    if (!page.success) return NextResponse.json({ message: "Lazada 원문 이벤트 응답을 확인하지 못했습니다." }, { status: 502, headers });
    return NextResponse.json(page.data, { headers });
  } catch {
    return NextResponse.json({ message: "Lazada 원문 이벤트를 조회하지 못했습니다." }, { status: 503, headers });
  }
}
