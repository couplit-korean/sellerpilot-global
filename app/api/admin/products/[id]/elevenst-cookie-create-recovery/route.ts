import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import {
  elevenstCookieCreateRecoveryGetMatches,
  elevenstCookieCreateRecoveryIdentity,
  elevenstCookieCreateRecoveryTarget,
} from "../../../../../../lib/channels/elevenst-cookie-create-recovery";
import { readElevenstSellerProdcode } from "../../../../../../lib/channels/elevenst-sellerprodcode-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const productIdSchema = z.string().uuid();
const requestSchema = z.object({
  action: z.literal("bind"),
}).strict();

function noStore(status = 200) {
  return { status, headers: { "cache-control": "no-store, max-age=0" } };
}

function noStoreAdminError(response: NextResponse) {
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return noStoreAdminError(admin);
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success || !elevenstCookieCreateRecoveryTarget(productId.data)) {
    return NextResponse.json({
      message: "11번가 쿠키 상품 식별값이 일치하지 않습니다.",
    }, noStore(400));
  }
  const { data, error } = await admin.serviceClient.rpc(
    "sellerpilot_service_get_elevenst_cookie_create_recovery_status",
    { p_product_id: productId.data },
  );
  if (error || !data) {
    return NextResponse.json({
      message: "11번가 GET-only 복구 상태를 읽지 못했습니다.",
    }, noStore(503));
  }
  return NextResponse.json(data, noStore());
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return noStoreAdminError(admin);
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success
      || !elevenstCookieCreateRecoveryTarget(productId.data)) {
    return NextResponse.json({
      message: "11번가 GET-only 복구 요청의 상품 식별값을 확인해 주세요.",
    }, noStore(400));
  }

  const identity = elevenstCookieCreateRecoveryIdentity;
  const status = await admin.serviceClient.rpc(
    "sellerpilot_service_get_elevenst_cookie_create_recovery_status",
    { p_product_id: productId.data },
  );
  if (status.error || !status.data || status.data.current !== true) {
    return NextResponse.json({
      message: "11번가 원본 create 작업 프리이미지가 현재와 일치하지 않습니다.",
      mode: "elevenst_cookie_create_preimage_not_current",
    }, noStore(409));
  }

  const decrypted = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: identity.credentialId,
  });
  const apiKey = decrypted.data && typeof decrypted.data === "object"
    && typeof (decrypted.data as { api_key?: unknown }).api_key === "string"
    ? (decrypted.data as { api_key: string }).api_key.trim()
    : "";
  if (decrypted.error || !/^[A-Za-z0-9]{32}$/.test(apiKey)) {
    return NextResponse.json({
      message: "11번가 Vault 키를 안전하게 불러오지 못했습니다.",
    }, noStore(503));
  }

  const payload = { api_key: apiKey };
  try {
    const lookup = await readElevenstSellerProdcode({
      payload,
      sellerProductCode: identity.sellerSku,
    });
    if (!elevenstCookieCreateRecoveryGetMatches(lookup)) {
      return NextResponse.json({
        message: "11번가 sellerprodcode/prodmarket GET 결과가 관측 prdNo와 일치하지 않습니다.",
        mode: "elevenst_cookie_create_get_mismatch",
        outcome: lookup.outcome,
        productNo: lookup.productNo,
      }, noStore(409));
    }

    const recorded = await admin.serviceClient.rpc(
      "sellerpilot_service_record_elevenst_cookie_create_observation",
      {
        p_product_id: productId.data,
        p_remote_id: lookup.productNo,
        p_seller_sku: lookup.sellerProductCode,
        p_lookup_http_status: lookup.lookupHttpStatus,
        p_prodmarket_http_status: lookup.prodmarket?.httpStatus ?? 0,
        p_prodmarket_accepted: lookup.prodmarket?.accepted === true,
        p_seller_prd_cd_matched: lookup.prodmarket?.sellerProductCodeMatched === true,
        p_observed_sel_stat_cd: lookup.prodmarket?.selStatCd || null,
      },
    );
    if (recorded.error || !recorded.data) {
      return NextResponse.json({
        message: "11번가 GET 관측 receipt를 기록하지 못했습니다.",
      }, noStore(409));
    }

    const bound = await admin.serviceClient.rpc(
      "sellerpilot_service_bind_elevenst_cookie_create_observation",
      { p_observation_id: recorded.data },
    );
    if (bound.error || bound.data !== true) {
      return NextResponse.json({
        message: "11번가 GET 관측을 원장에 묶지 못했습니다.",
      }, noStore(409));
    }

    return NextResponse.json({
      contract: identity.contract,
      productId: productId.data,
      remoteId: identity.remoteId,
      sellerSku: identity.sellerSku,
      observationId: recorded.data,
      bound: true,
      sourceJobRewritten: false,
    }, noStore());
  } finally {
    payload.api_key = "";
  }
}
