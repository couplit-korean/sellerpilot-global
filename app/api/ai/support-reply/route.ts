import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { supportReplyJobRequestSchema } from "../../../../lib/ai-cli-contract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = supportReplyJobRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "문의와 답변 언어를 확인해 주세요." }, { status: 400 });
  }

  const { error } = await admin.userClient.rpc("sellerpilot_create_support_reply_job", {
    p_id: parsed.data.jobId,
    p_ticket_id: parsed.data.ticketId,
    p_expected_inbound_key: parsed.data.expectedInboundKey,
    p_target_locale: parsed.data.targetLocale,
    p_tone: parsed.data.tone,
  });
  if (error) {
    if (error.message.includes("INQUIRY_CONTEXT_STALE")) {
      return NextResponse.json({ message: "새 고객 메시지가 도착했습니다. 최신 문의를 다시 확인해 주세요." }, { status: 409 });
    }
    return NextResponse.json({ message: "CLI 답변 초안 작업을 등록하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    mode: "support-reply",
    jobId: parsed.data.jobId,
    status: "queued",
    message: "ChatGPT CLI가 주문 맥락을 확인해 답변 초안을 작성하고 있습니다.",
  }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
}
