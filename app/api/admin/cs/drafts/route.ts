import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { supportReplyJobRequestSchema } from "../../../../../lib/cs/draft-contract";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = supportReplyJobRequestSchema.strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "문의와 답변 언어를 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_create_cs_reply_draft", {
    p_id: parsed.data.jobId, p_ticket_id: parsed.data.ticketId, p_expected_inbound_key: parsed.data.expectedInboundKey,
    p_target_locale: parsed.data.targetLocale, p_tone: parsed.data.tone,
  });
  if (error) return NextResponse.json({ message: error.message.includes("INQUIRY_CONTEXT_STALE")
    ? "새 고객 메시지가 도착했습니다. 최신 문의를 다시 확인해 주세요."
    : error.message.includes("LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE") ? "회수됐거나 원문 충돌 상태인 메시지에는 답변 초안을 만들 수 없습니다." : "답변 초안 작업을 접수하지 못했습니다." }, { status: error.code === "55000" ? 409 : 503, headers });
  if (data !== parsed.data.jobId) return NextResponse.json({ message: "답변 초안 작업 ID가 일치하지 않습니다." }, { status: 502, headers });
  return NextResponse.json({ jobId: data, status: "queued", mode: "support-reply" }, { status: 202, headers });
}
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ message: "작업 ID를 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_cs_reply_draft", { p_id: id.data });
  if (error) return NextResponse.json({ message: "답변 초안 상태를 읽지 못했습니다." }, { status: 503, headers });
  if (!data) return NextResponse.json({ message: "답변 초안 작업을 찾지 못했습니다." }, { status: 404, headers });
  return NextResponse.json(data, { headers });
}
export async function DELETE(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ message: "작업 ID를 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_cancel_cs_reply_draft", { p_id: id.data });
  return NextResponse.json({ cancelled: data === true }, { status: error ? 503 : 200, headers });
}
