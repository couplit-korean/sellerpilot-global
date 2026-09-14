import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { lazadaRequest } from "../../../../../lib/channels/protocols";

export const runtime = "nodejs";

const schema = z.object({ ticketId: z.string().uuid(), reply: z.string().trim().min(1).max(4000) });

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Lazada 답변 내용을 확인해 주세요." }, { status: 400 });
  const [{ data: rows, error: contextError }, { data: credential, error: credentialError }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_ticket_reply_context", { p_id: parsed.data.ticketId }),
    admin.serviceClient.rpc("sellerpilot_get_active_credential_secret", { p_channel: "lazada", p_environment: "production" }),
  ]);
  const ticket = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, unknown> : null;
  const context = credential && typeof credential === "object" && !Array.isArray(credential) ? credential as Record<string, unknown> : null;
  const secret = context?.secret_payload && typeof context.secret_payload === "object" && !Array.isArray(context.secret_payload) ? context.secret_payload as Record<string, unknown> : null;
  const externalId = ticket && typeof ticket.external_ticket_id === "string" ? ticket.external_ticket_id : "";
  const sessionId = externalId.startsWith("lazada-im:") ? externalId.slice("lazada-im:".length) : "";
  if (contextError || credentialError || ticket?.channel_key !== "lazada" || !sessionId || !secret) return NextResponse.json({ message: "Lazada IM 세션 또는 운영 인증을 확인하지 못했습니다." }, { status: 409 });
  const remote = await lazadaRequest({ payload: secret, path: "/im/message/send", method: "POST", params: { template_id: "1", session_id: sessionId, txt: parsed.data.reply } });
  if (!remote.response.ok || String(remote.data.code ?? "0") !== "0") return NextResponse.json({ message: "Lazada IM이 답변을 수락하지 않았습니다." }, { status: 502 });
  const { data: updated, error: updateError } = await admin.userClient.rpc("sellerpilot_update_ticket", { p_id: parsed.data.ticketId, p_status: "resolved", p_reply_draft: parsed.data.reply });
  if (updateError || updated !== true) return NextResponse.json({ message: "Lazada 답변은 전송됐지만 처리완료 원장을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
