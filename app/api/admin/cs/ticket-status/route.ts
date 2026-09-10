import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const schema = z.object({
  id: z.string().uuid(),
  status: z.enum(["urgent", "waiting", "in_progress", "resolved"]),
  expectedInboundKey: z.string().min(1).max(500).nullable(),
  replyDraft: z.string().max(8000).optional(),
}).strict();

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8000 });
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "문의와 처리 상태를 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_update_ticket", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reply_draft: parsed.data.replyDraft ?? null,
    p_expected_inbound_key: parsed.data.expectedInboundKey,
  });
  if (error) {
    const conflicts = [
      ["INQUIRY_CONTEXT_STALE", "새 고객 메시지가 도착했습니다. 문의 상태를 새로고침해 주세요."],
      ["CS_DELIVERY_LOCKED", "판매채널 전송 결과를 확인 중입니다. 전송 원장을 확인한 뒤 상태를 변경해 주세요."],
      ["REMOTE_REPLY_SUCCESS_REQUIRED", "판매채널의 답변 또는 종료 상태가 아직 확인되지 않았습니다. 채널에서 결과를 확인해 주세요."],
      ["LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE", "회수됐거나 원문 충돌 상태인 Lazada 메시지에는 답변 초안을 저장하거나 완료 처리할 수 없습니다."],
    ];
    const conflict = conflicts.find(([code]) => error.message.includes(code));
    return NextResponse.json({ message: conflict?.[1] ?? "문의 처리 상태를 저장하지 못했습니다." }, { status: conflict ? 409 : 500, headers });
  }
  if (data !== true) return NextResponse.json({ message: "문의 처리 상태를 저장하지 못했습니다." }, { status: 404, headers });
  return NextResponse.json({ ok: true }, { headers });
}
