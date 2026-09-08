import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../../lib/admin-api";
import {
  syncEbayPaymentDisputeHistory,
  syncEbayResolutionCaseHistoryWindow,
} from "../../../../../../../../../lib/channels/cs/ebay/case-dispute-history-sync";
import { ebayVerifiedMessageAccountIdentifiers } from "../../../../../../../../../lib/channels/ebay-message-pages";
import { readProviderAccountIdentity } from "../../../../../../../../../lib/channels/provider-account-identity";
import {
  ebayCaseDisputeHistorySyncRequestSchema,
  ebayCaseDisputeHistorySyncResponseSchema,
} from "../../../../../../../../../lib/cs/channels/ebay/case-dispute-history";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
};

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 4_096) {
    return fail(413, "REQUEST_TOO_LARGE", "eBay 케이스·분쟁 이력 수집 요청이 너무 큽니다.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4_096) {
    return fail(413, "REQUEST_TOO_LARGE", "eBay 케이스·분쟁 이력 수집 요청이 너무 큽니다.");
  }
  const parsed = ebayCaseDisputeHistorySyncRequestSchema.safeParse(
    (() => { try { return JSON.parse(raw); } catch { return null; } })(),
  );
  if (!parsed.success) return fail(400, "INVALID_REQUEST", "eBay 케이스·분쟁 이력 수집 범위를 확인해 주세요.");
  const input = parsed.data;
  try {
    const accounts = await admin.userClient.rpc("sellerpilot_list_owned_ebay_message_accounts");
    if (accounts.error || !Array.isArray(accounts.data)) {
      return fail(503, "CREDENTIALS_UNAVAILABLE", "연결 계정을 확인하지 못했습니다.");
    }
    const account = accounts.data.map(record).find(row => row.id === input.credentialId);
    if (!account) return fail(404, "ACCOUNT_UNAVAILABLE", "선택한 활성 eBay 계정을 찾지 못했습니다.");
    if ((account.environment !== "production" && account.environment !== "sandbox")
        || account.seller_account_key_source !== "provider_certified_v1"
        || typeof account.seller_account_key !== "string") {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 확인이 필요합니다.");
    }
    const decrypted = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
      p_credential_id: input.credentialId,
    });
    if (decrypted.error || !decrypted.data || Array.isArray(decrypted.data)
        || typeof decrypted.data !== "object") {
      return fail(503, "CREDENTIAL_UNAVAILABLE", "eBay 연결 정보를 안전하게 불러오지 못했습니다.");
    }
    const payload = record(decrypted.data);
    const identity = readProviderAccountIdentity(payload, "ebay");
    if (!identity) return fail(409, "ACCOUNT_UNVERIFIED", "eBay 판매자 계정 인증이 필요합니다.");
    const environment = account.environment as "sandbox" | "production";
    const sellerAccountKey = createHash("sha256")
      .update(["ebay", environment, identity.subject].join("\u001f"))
      .digest("hex");
    if (sellerAccountKey !== account.seller_account_key) {
      return fail(409, "ACCOUNT_UNVERIFIED", "eBay 연결 계정과 인증 정보가 일치하지 않습니다.");
    }
    const serviceClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        const result = await admin.serviceClient.rpc(name, args);
        return { data: result.data, error: result.error };
      },
    };
    const common = {
      payload,
      environment,
      credentialId: input.credentialId,
      sellerAccountKey,
      serviceClient,
    };
    const result = input.resourceKind === "payment_dispute"
      ? await syncEbayPaymentDisputeHistory(common)
      : await syncEbayResolutionCaseHistoryWindow({
        ...common,
        startTime: input.startTime!,
        endTime: input.endTime!,
        verifiedSellerIdentifiers: ebayVerifiedMessageAccountIdentifiers(payload),
      });
    const receipt = ebayCaseDisputeHistorySyncResponseSchema.parse({
      contract: "sellerpilot-ebay-case-dispute-history-sync/1",
      credentialId: input.credentialId,
      resourceKind: input.resourceKind,
      ...result,
    });
    return NextResponse.json(receipt, { headers });
  } catch {
    return fail(502, "CASE_DISPUTE_HISTORY_SYNC_UNVERIFIED", "eBay 케이스·분쟁 이력 수집 결과를 확인하지 못했습니다.");
  }
}
