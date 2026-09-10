import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { conversationCursorSchema, conversationPageSchema } from "../../../../../../../lib/cs/conversation";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const id = z.string().uuid().safeParse((await context.params).id);
  const params = new URL(request.url).searchParams;
  const limit = z.coerce.number().int().min(1).max(100).safeParse(params.get("limit") ?? 50);
  const rawCursor = params.get("cursor");
  let cursor: z.infer<typeof conversationCursorSchema> | null = null;
  if (rawCursor !== null) {
    try { cursor = conversationCursorSchema.parse(JSON.parse(rawCursor)); }
    catch { return NextResponse.json({ message: "대화 페이지 위치를 확인해 주세요." }, { status: 400, headers }); }
  }
  if (!id.success || !limit.success) return NextResponse.json({ message: "문의 조회 조건을 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_cs_conversation", {
    p_ticket_id: id.data, p_limit: limit.data,
    p_before_time: cursor?.beforeTime ?? null, p_before_key: cursor?.beforeKey ?? null, p_as_of: cursor?.asOf ?? null,
  });
  if (error) return NextResponse.json({ message: "대화 이력을 읽지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers });
  if (data === null) return NextResponse.json({ message: "조회할 수 있는 문의가 없습니다." }, { status: 404, headers });
  const parsed = conversationPageSchema.safeParse(data);
  if (!parsed.success || parsed.data.ticketId !== id.data) return NextResponse.json({ message: "대화 이력 형식을 확인하지 못했습니다." }, { status: 502, headers });
  return NextResponse.json(parsed.data, { headers });
}
