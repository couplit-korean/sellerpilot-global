import { createHash } from "node:crypto";
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
  const { data: rows, error: contextError } = await admin.userClient.rpc("sellerpilot_get_ticket_reply_context", { p_id: parsed.data.ticketId });
  const ticket = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, unknown> : null;
  const externalId = ticket && typeof ticket.external_ticket_id === "string" ? ticket.external_ticket_id : "";
  const sessionId = externalId.startsWith("lazada-im:") ? externalId.slice("lazada-im:".length) : "";
  if (contextError || ticket?.channel_key !== "lazada" || !sessionId) {
    return NextResponse.json({ message: "Lazada IM 세션을 확인하지 못했습니다." }, { status: 409 });
  }

  const replyFingerprint = createHash("sha256").update(parsed.data.reply).digest("hex");
  const { data: claimData, error: claimError } = await admin.serviceClient.rpc("sellerpilot_service_claim_lazada_reply", {
    p_actor_id: admin.user.id,
    p_ticket_id: parsed.data.ticketId,
    p_reply_fingerprint: replyFingerprint,
  });
  if (claimError || !claimData || typeof claimData !== "object" || Array.isArray(claimData)) {
    return NextResponse.json({ message: "Lazada 답변 중복 방지 원장을 만들지 못했습니다." }, { status: 409 });
  }
  const claim = claimData as Record<string, unknown>;
  const attemptId = typeof claim.attempt_id === "string" ? claim.attempt_id : "";
  if (!attemptId) return NextResponse.json({ message: "Lazada 답변 추적 ID를 만들지 못했습니다." }, { status: 500 });
  if (claim.duplicate === true) {
    const status = typeof claim.status === "string" ? claim.status : "";
    const inProgress = status === "preparing" || status === "sending";
    const reconciliationRequired = status === "reconciliation_required";
    return NextResponse.json({
      ok: status === "succeeded",
      duplicate: true,
      inProgress,
      reconciliationRequired,
      attemptId,
      status,
      message: typeof claim.safe_message === "string"
        ? claim.safe_message
        : inProgress
          ? "같은 문의의 답변 전송이 진행 중입니다."
          : "같은 문의의 답변 작업이 이미 처리됐습니다.",
    }, { status: status === "succeeded" ? 200 : inProgress ? 202 : 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const complete = async (outcome: "succeeded" | "failed" | "reconciliation_required", message: string) =>
    await admin.serviceClient.rpc("sellerpilot_service_complete_lazada_reply", {
      p_attempt_id: attemptId,
      p_reply_fingerprint: replyFingerprint,
      p_outcome: outcome,
      p_reply: outcome === "succeeded" ? parsed.data.reply : null,
      p_safe_message: message,
    });

  const { data: credential, error: credentialError } = await admin.serviceClient.rpc("sellerpilot_get_active_credential_secret", {
    p_channel: "lazada",
    p_environment: "production",
  });
  const context = credential && typeof credential === "object" && !Array.isArray(credential) ? credential as Record<string, unknown> : null;
  const secret = context?.secret_payload && typeof context.secret_payload === "object" && !Array.isArray(context.secret_payload)
    ? context.secret_payload as Record<string, unknown>
    : null;
  if (credentialError || !secret) {
    await complete("failed", "Lazada 운영 인증을 읽지 못해 원격 호출 전에 중단했습니다.");
    return NextResponse.json({ message: "Lazada 운영 인증을 확인하지 못했습니다.", attemptId }, { status: 409 });
  }

  const { data: began, error: beginError } = await admin.serviceClient.rpc("sellerpilot_service_begin_lazada_reply", {
    p_attempt_id: attemptId,
    p_reply_fingerprint: replyFingerprint,
  });
  if (beginError || began !== true) {
    return NextResponse.json({ message: "Lazada 답변 전송 직전 안전 원장을 확정하지 못했습니다.", attemptId }, { status: 409 });
  }

  try {
    const remote = await lazadaRequest({
      payload: secret,
      path: "/im/message/send",
      method: "POST",
      params: { template_id: "1", session_id: sessionId, txt: parsed.data.reply },
    });
    const providerCode = String(remote.data.code ?? "0");
    const accepted = remote.response.ok && providerCode === "0";
    const explicitRejected = !accepted && (
      (remote.response.status >= 400 && remote.response.status < 500)
      || (remote.response.ok && providerCode !== "0")
    );
    if (!accepted && !explicitRejected) {
      const message = "Lazada 답변 접수 여부를 확정할 수 없어 수동 확인이 필요합니다.";
      await complete("reconciliation_required", message);
      return NextResponse.json({ message, attemptId, reconciliationRequired: true }, {
        status: 409,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    const message = accepted
      ? "Lazada 답변 전송과 문의 처리 원장 갱신이 완료됐습니다."
      : "Lazada IM이 답변을 명시적으로 거절했습니다.";
    let completion = await complete(accepted ? "succeeded" : "failed", message);
    if (completion.error || completion.data !== true) {
      completion = await complete(accepted ? "succeeded" : "failed", message);
    }
    const { data: completed, error: completeError } = completion;
    if (completeError || completed !== true) {
      await complete("reconciliation_required", "Lazada 응답 원장을 확정하지 못해 수동 확인이 필요합니다.");
      return NextResponse.json({
        message: "Lazada 응답은 받았지만 처리 원장을 확정하지 못했습니다.",
        attemptId,
        reconciliationRequired: true,
      }, { status: 500 });
    }
    return NextResponse.json({ ok: accepted, attemptId, message }, {
      status: accepted ? 200 : 422,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch {
    const message = "Lazada 답변 접수 여부를 확정할 수 없어 수동 확인이 필요합니다.";
    await complete("reconciliation_required", message);
    return NextResponse.json({ message, attemptId, reconciliationRequired: true }, {
      status: 409,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
}
