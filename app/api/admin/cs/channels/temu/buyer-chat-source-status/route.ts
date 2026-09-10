import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { temuBuyerChatRuntimeReadSchema } from "../../../../../../../lib/channels/cs/temu/runtime-readiness";
import {
  temuBuyerChatSourceStatus,
} from "../../../../../../../lib/channels/cs/temu/buyer-chat-source-adapter";
import { temuHistoryAccountsSchema } from "../../../../../../../lib/cs/channels/temu/history-resume";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const querySchema = z.object({ credentialId: z.string().uuid() }).strict();

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!query.success || url.searchParams.getAll("credentialId").length !== 1) {
    return NextResponse.json({
      message: "조회할 Temu 운영 계정을 정확히 하나 선택해 주세요.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID",
      sourceAdapterImplemented: true,
      providerFetchPerformed: false,
      canonicalPromotionPerformed: false,
    }, { status: 400, headers });
  }

  const accountsResult = await admin.userClient.rpc("sellerpilot_list_temu_cs_accounts_v1");
  const accounts = temuHistoryAccountsSchema.safeParse(accountsResult.data);
  if (accountsResult.error || !accounts.success) {
    return NextResponse.json({
      message: "Temu 운영 계정 목록을 확인하지 못했습니다.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_EVIDENCE_UNAVAILABLE",
      sourceAdapterImplemented: true,
      providerFetchPerformed: false,
      canonicalPromotionPerformed: false,
    }, { status: 503, headers });
  }
  const account = accounts.data.accounts.find(
    item => item.credentialId === query.data.credentialId,
  );
  if (!account) {
    return NextResponse.json({
      message: "선택한 Temu 운영 계정이 활성·provider-certified 상태가 아닙니다.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID",
      sourceAdapterImplemented: true,
      providerFetchPerformed: false,
      canonicalPromotionPerformed: false,
    }, { status: 409, headers });
  }

  const readinessResult = await admin.userClient.rpc(
    "sellerpilot_read_temu_buyer_chat_readiness_v1",
    { p_credential_id: account.credentialId },
  );
  if (readinessResult.error) {
    return NextResponse.json({
      message: "Temu Buyer Chat 서버 증거를 확인하지 못했습니다.",
      code: "TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE",
      sourceAdapterImplemented: true,
      providerFetchPerformed: false,
      canonicalPromotionPerformed: false,
    }, { status: 503, headers });
  }
  const read = temuBuyerChatRuntimeReadSchema.safeParse(readinessResult.data);
  if (!read.success
      || read.data.credentialId !== account.credentialId
      || read.data.sellerAccountKey !== account.sellerAccountKeyHash
      || read.data.environment !== account.environment) {
    return NextResponse.json({
      message: "Temu Buyer Chat 서버 증거의 계정·환경 계약이 일치하지 않습니다.",
      code: "TEMU_BUYER_CHAT_EVIDENCE_INVALID",
      sourceAdapterImplemented: true,
      providerFetchPerformed: false,
      canonicalPromotionPerformed: false,
    }, { status: 502, headers });
  }

  return NextResponse.json(temuBuyerChatSourceStatus(read.data.evidence, {
    credentialId: account.credentialId,
    sellerAccountKey: account.sellerAccountKeyHash,
    environment: account.environment,
    expectedRegion: "GLOBAL",
    now: new Date().toISOString(),
  }), { headers });
}
