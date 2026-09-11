import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadShopeeSgOfficialRequirementCandidates } from "../../../../lib/product-registration/shopee/provider-requirements";
import { shopeeSgRequirementSnapshotContract } from "../../../../lib/product-registration/shopee/requirement-view-model";
import {
  ensureShopeeMerchantAccessToken,
  readStoredShopeeShopAccessToken,
  runWithChannelRequestSignal,
  runWithProviderReadOnlyTransport,
  shopeeMerchantRequest,
  shopeeRequest,
} from "../../../../lib/channels/protocols";
import {
  activeProductionShopeeCredentialEnvelope,
  activeProductionShopeeCredentialId,
} from "../../../../lib/channels/shopee-target-lineage";
import { shopeeShopTargetIds, type ChannelTargetRecord } from "../../../../lib/channels/target-records";
import { mergeShopeeChannelTargets, shopeeIdentityChannelTargets } from "../../../../lib/channels/shopee-shop-identity";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid(),
  shopId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  categoryId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
  sourceFingerprint: z.string().min(1).max(50_000),
}).strict();

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function blockedResources(code: string, message: string) {
  const state = { state: "blocked" as const, code, message };
  return {
    category: state,
    brand: state,
    attributes: state,
    logistics: state,
    warehouses: state,
    eligibleShops: state,
  };
}

function safeCode(error: unknown) {
  const candidate = error instanceof Error ? error.message.split(":")[0] : "";
  return /^SHOPEE_[A-Z0-9_]+$/u.test(candidate)
    ? candidate
    : "SHOPEE_SG_REQUIREMENTS_QUERY_FAILED";
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!parsed.success) return NextResponse.json({ message: "Shopee SG 필수조건 조회 형식이 올바르지 않습니다." }, { status: 400 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentials, error: credentialError }, { data: cachedTargets, error: targetError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
    userClient.rpc("sellerpilot_list_channel_market_targets", { p_channel: "shopee" }),
  ]);
  if (userError || !userData.user || adminError || credentialError || targetError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  const activeCredentials = Array.isArray(credentials) ? credentials.filter((row) =>
    row && typeof row === "object" && !Array.isArray(row)
    && row.channel === "shopee" && row.environment === "production" && row.status === "active") : [];
  if (activeCredentials.length !== 1
    || activeProductionShopeeCredentialId(credentials) !== parsed.data.credentialId) {
    return NextResponse.json({ message: "선택한 Shopee 키가 현재 활성 운영 키와 일치하지 않습니다." }, { status: 409 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
    "sellerpilot_get_active_credential_secret",
    { p_channel: "shopee", p_environment: "production" },
  );
  const envelope = activeProductionShopeeCredentialEnvelope(activeCredential);
  if (activeCredentialError || !envelope || envelope.credentialId !== parsed.data.credentialId) {
    return NextResponse.json({ message: "현재 운영 Shopee credential 계보를 확인하지 못했습니다." }, { status: 409 });
  }

  if (!Array.isArray(cachedTargets) || cachedTargets.some((target) =>
    !target || typeof target !== "object" || Array.isArray(target))) {
    return NextResponse.json({ message: "저장된 Shopee 숍 목록을 확인하지 못했습니다." }, { status: 409 });
  }
  const normalizedTargets: ChannelTargetRecord[] = Array.isArray(cachedTargets)
    ? cachedTargets.map((target) => ({
      targetId: text(target.target_id),
      displayName: text(target.display_name),
      marketCode: text(target.market_code).toUpperCase(),
      locale: text(target.locale),
      language: text(target.language),
      currency: text(target.currency),
      status: text(target.remote_status),
      verifiedAt: text(target.verified_at),
    }))
    : [];
  // This SG request depends only on its own authorized target, not all eight markets.
  const authorizedShopIds = new Set(shopeeShopTargetIds(envelope.secretPayload));
  // The verified discovery ledger and the credential payload identity are both
  // provider-attested reads of the same shop. Accept either one so a shop that has been
  // synchronized once can resolve its SG requirements without another OAuth round.
  const identityTargets = shopeeIdentityChannelTargets({
    secret: envelope.secretPayload,
    credentialId: envelope.credentialId,
  });
  const matches = mergeShopeeChannelTargets(
    normalizedTargets,
    identityTargets,
  ).filter((target) =>
    target.targetId === parsed.data.shopId && target.marketCode === "SG"
    && target.locale === "en-SG" && target.currency === "SGD"
    && authorizedShopIds.has(target.targetId));
  if (matches.length !== 1) {
    return NextResponse.json({ message: "현재 credential에 연결된 exact SG shop을 확인하지 못했습니다." }, { status: 409 });
  }
  const merchantId = text(envelope.secretPayload.merchant_id);
  if (!/^[1-9][0-9]{0,31}$/u.test(merchantId)) {
    return NextResponse.json({ message: "현재 credential의 merchant ID를 확인하지 못했습니다." }, { status: 409 });
  }

  const observedAt = new Date().toISOString();
  const tuple = {
    credentialId: parsed.data.credentialId,
    merchantId,
    shopId: parsed.data.shopId,
    region: "SG" as const,
    categoryId: parsed.data.categoryId,
    sourceFingerprint: parsed.data.sourceFingerprint,
  };
  try {
    const candidates = await runWithChannelRequestSignal(request.signal, () =>
      runWithProviderReadOnlyTransport(async () => {
        request.signal.throwIfAborted();
        const shopPayload = readStoredShopeeShopAccessToken(envelope.secretPayload, parsed.data.shopId);
        if (!shopPayload) throw new Error("SHOPEE_SG_SHOP_AUTH_REFRESH_REQUIRED");
        const refuseRefresh = async () => {
          throw new Error("SHOPEE_SG_MERCHANT_AUTH_REFRESH_REQUIRED");
        };
        const merchant = await ensureShopeeMerchantAccessToken(
          envelope.secretPayload, "production", 10 * 60_000, merchantId,
          refuseRefresh, refuseRefresh,
        );
        request.signal.throwIfAborted();
        return loadShopeeSgOfficialRequirementCandidates({
          categoryId: parsed.data.categoryId,
          readers: {
            merchantGet: (path, query) => shopeeMerchantRequest({ payload: merchant.payload, environment: "production", method: "GET", path, query }),
            merchantPost: (path, body) => shopeeMerchantRequest({ payload: merchant.payload, environment: "production", method: "POST", path, body }),
            shopGet: (path, query) => shopeeRequest({ payload: shopPayload, environment: "production", method: "GET", path, query }),
          },
        });
      }));
    return NextResponse.json({
      contract: shopeeSgRequirementSnapshotContract,
      observedAt,
      tuple,
      resources: Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, { state: "ready", value }])),
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    const code = safeCode(error);
    return NextResponse.json({
      contract: shopeeSgRequirementSnapshotContract,
      observedAt,
      tuple,
      resources: blockedResources(code, "Shopee SG 공식 필수조건을 조회하지 못했습니다."),
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
