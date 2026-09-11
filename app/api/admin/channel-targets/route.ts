import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { executeChannelTargetDiscovery } from "../../../../lib/channels/gateway";
import {
  activeLazadaSellerIdForMarket,
  activeProductionLazadaCredentialEnvelope,
  activeProductionLazadaCredentialId,
  lineageBoundLazadaTargetForMarket,
} from "../../../../lib/channels/lazada-target-lineage";
import {
  lazadaMyTargetMismatchCode,
  lazadaTargetCredentialChangedCode,
  lazadaTargetCountry,
  lazadaTargetMarketCode,
  lazadaTargetSyncRequiredCode,
} from "../../../../lib/channels/lazada-my-contract";
import { channelMarket, shopeeMarkets } from "../../../../lib/channels/markets";
import {
  activeProductionShopeeCredentialEnvelope,
  activeProductionShopeeCredentialId,
  lineageBoundShopeeTargets,
} from "../../../../lib/channels/shopee-target-lineage";
import { isCompleteChannelTarget, type ChannelTargetRecord } from "../../../../lib/channels/target-records";
import {
  mergeShopeeChannelTargets,
  shopeeIdentityChannelTargets,
} from "../../../../lib/channels/shopee-shop-identity";
import { readProviderAccountIdentity } from "../../../../lib/channels/provider-account-identity";
import { lazadaMySellerModeEvidenceFromGatewayResult, lazadaSellerProfileFromGatewayResult } from "../../../../lib/product-registration/lazada/listing-create-context";
import {
  exactShopeeCachedTargetForActiveCredential,
  exactShopeeTargetStoreBinding,
  shopeeShopDiscoveryEvidenceFromGatewayResult,
  type ShopeeCredentialSnapshot,
} from "../../../../lib/product-registration/shopee/target-lineage-readiness";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";

const querySchema = z.enum(["shopee", "lazada"]);

function objectRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function shopeeCredentialSnapshot(value: unknown): ShopeeCredentialSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const envelope = activeProductionShopeeCredentialEnvelope(row);
  const version = row.credential_version;
  return envelope && Number.isSafeInteger(version) && Number(version) > 0
    ? { ...envelope, version: Number(version) }
    : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const searchParams = new URL(request.url).searchParams;
  const channel = querySchema.safeParse(searchParams.get("channel"));
  const exactShopeeTarget = z.object({
    targetId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
    marketCode: z.literal("SG"),
  }).safeParse({
    targetId: searchParams.get("targetId"),
    marketCode: searchParams.get("marketCode")?.toUpperCase(),
  });
  const exactShopeeTargetRequested = searchParams.has("targetId") || searchParams.has("marketCode");
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!channel.success) return NextResponse.json({ message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (channel.data === "shopee" && exactShopeeTargetRequested && !exactShopeeTarget.success) {
    return NextResponse.json({
      code: "SHOPEE_EXACT_TARGET_INPUT_INVALID",
      message: "Shopee 대상 숍 ID와 SG 시장 코드를 정확히 지정해 주세요.",
      channel: "shopee",
      targets: [],
    }, { status: 400, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentials, error: credentialError }, { data: cachedTargets, error: targetError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
    userClient.rpc(
      channel.data === "shopee"
        ? "sellerpilot_list_channel_market_targets_v2"
        : "sellerpilot_list_channel_market_targets",
      { p_channel: channel.data },
    ),
  ]);
  if (userError || !userData.user || adminError || credentialError || targetError || isAdmin !== true) return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  const productionCredentialId = channel.data === "shopee"
    ? activeProductionShopeeCredentialId(credentials)
    : activeProductionLazadaCredentialId(credentials);
  const credential = Array.isArray(credentials)
    ? credentials.find((row) => row && typeof row === "object"
      && "channel" in row && row.channel === channel.data
      && "status" in row && row.status === "active"
      && "id" in row && row.id === productionCredentialId)
    : null;
  if (!credential || !("id" in credential) || typeof credential.id !== "string") return NextResponse.json({ message: "활성 운영 채널 키가 없습니다." }, { status: 404 });

  let normalizedCachedTargets: Array<ChannelTargetRecord & { credentialId?: string; credentialVersion?: number }> = Array.isArray(cachedTargets)
    ? cachedTargets.map((target) => ({
      targetId: textValue(target.target_id),
      displayName: textValue(target.display_name),
      marketCode: textValue(target.market_code).toUpperCase(),
      locale: textValue(target.locale),
      language: textValue(target.language),
      currency: textValue(target.currency),
      status: textValue(target.remote_status),
      verifiedAt: textValue(target.verified_at),
      credentialId: textValue(target.credential_id),
      credentialVersion: numberValue(target.credential_version),
    }))
    : [];
  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let activeShopeeSecret: Record<string, unknown> | null = null;
  let activeLazadaSecret: Record<string, unknown> | null = null;
  if (channel.data === "shopee") {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret_v2",
      { p_channel: "shopee", p_environment: "production" },
    );
    const envelope = shopeeCredentialSnapshot(activeCredential);
    if (activeCredentialError) {
      return NextResponse.json({
        message: "현재 운영 Shopee 키의 계보를 확인하지 못했습니다.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const listedVersion = "version" in credential ? numberValue(credential.version) : 0;
    if (!envelope || envelope.credentialId !== credential.id || envelope.version !== listedVersion) {
      return NextResponse.json({
        message: "선택된 운영 Shopee 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 숍을 다시 동기화해 주세요.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    activeShopeeSecret = envelope.secretPayload;
    if (exactShopeeTarget.success) {
      const exactTarget = exactShopeeCachedTargetForActiveCredential({
        cachedTargets: normalizedCachedTargets,
        activeCredentialId: envelope.credentialId,
        activeCredentialVersion: envelope.version,
        activeCredentialSecret: envelope.secretPayload,
        targetId: exactShopeeTarget.data.targetId,
        marketCode: exactShopeeTarget.data.marketCode,
      });
      if (exactTarget.status === "ready") {
        return NextResponse.json({
          contractVersion: 2,
          channel: "shopee",
          credentialId: envelope.credentialId,
          credentialVersion: envelope.version,
          targets: [exactTarget.target],
        }, { headers: { "cache-control": "no-store, max-age=0" } });
      }
      return NextResponse.json({
        code: exactTarget.reason,
        message: "현재 운영 키에 결속된 정확한 SG 숍 대상을 한 번 동기화해야 합니다.",
        channel: "shopee",
        credentialId: envelope.credentialId,
        credentialVersion: envelope.version,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    normalizedCachedTargets = normalizedCachedTargets.filter(
      (target) => target.credentialId === envelope.credentialId,
    );
    const lineageBoundTargets = lineageBoundShopeeTargets(normalizedCachedTargets, activeShopeeSecret);
    if (lineageBoundTargets.length === shopeeMarkets.length) {
      return NextResponse.json({
        contractVersion: 2,
        channel: channel.data,
        credentialId: envelope.credentialId,
        credentialVersion: envelope.version,
        targets: lineageBoundTargets,
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
  } else {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret",
      { p_channel: "lazada", p_environment: "production" },
    );
    const lazadaEnvelope = activeProductionLazadaCredentialEnvelope(activeCredential);
    if (activeCredentialError) {
      return NextResponse.json({
        message: "현재 운영 Lazada 키의 계보를 확인하지 못했습니다.",
        channel: "lazada",
        credentialId: credential.id,
        targets: [],
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (!lazadaEnvelope || lazadaEnvelope.credentialId !== credential.id) {
      return NextResponse.json({
        message: "선택된 운영 Lazada 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 셀러를 다시 동기화해 주세요.",
        channel: "lazada",
        credentialId: credential.id,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    activeLazadaSecret = lazadaEnvelope.secretPayload;
    const configuredCountry = textValue(activeLazadaSecret.country).toLowerCase();
    const expectedMySellerId = activeLazadaSellerIdForMarket(activeLazadaSecret, lazadaTargetMarketCode);
    if (configuredCountry !== lazadaTargetCountry || !expectedMySellerId) {
      return NextResponse.json({
        code: lazadaMyTargetMismatchCode,
        message: "현재 운영 Lazada 키에서 Malaysia(MY) 판매자 계보를 확인하지 못했습니다. OAuth를 다시 연결해 주세요.",
        channel: "lazada",
        credentialId: lazadaEnvelope.credentialId,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const lineageBoundTargets = lineageBoundLazadaTargetForMarket(
      normalizedCachedTargets,
      activeLazadaSecret,
      lazadaTargetMarketCode,
    );
    if (lineageBoundTargets.length) {
      return NextResponse.json({
        channel: channel.data,
        credentialId: lazadaEnvelope.credentialId,
        targets: lineageBoundTargets,
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      code: lazadaTargetSyncRequiredCode,
      message: "검증된 Malaysia(MY) 판매자 대상을 한 번 동기화해야 합니다.",
      channel: "lazada",
      credentialId: lazadaEnvelope.credentialId,
      targets: [],
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  let secret = activeShopeeSecret ?? activeLazadaSecret;
  if (!secret) {
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return NextResponse.json({ message: "채널 대상을 안전하게 불러오지 못했습니다." }, { status: 500 });
    secret = data as Record<string, unknown>;
  }
  let targets = channel.data === "shopee"
    ? objectRows(secret.shopee_targets).filter((target) => target.type === "shop").map((target) => {
      const marketCode = textValue(target.region || target.market).toUpperCase();
      const market = channelMarket("shopee", marketCode);
      return {
        targetId: textValue(target.id),
        displayName: textValue(target.shop_name || target.name),
        marketCode,
        locale: market?.locale ?? "",
        language: market?.language ?? "",
        currency: market?.currency ?? "",
        status: textValue(target.status || target.shop_status),
      };
    })
    : (() => {
      const rows = objectRows(secret.country_user_info);
      if (rows.length) return rows.map((target) => {
        const marketCode = textValue(target.country || target.short_code).toUpperCase();
        const market = channelMarket("lazada", marketCode);
        return {
          targetId: textValue(target.seller_id || target.user_id),
          displayName: textValue(target.seller_name || target.short_code),
          marketCode,
          locale: market?.locale ?? "",
          language: market?.language ?? "",
          currency: market?.currency ?? "",
          status: textValue(target.status),
        };
      });
      return [];
    })();

  // The OAuth flow stores shop tokens without the shop's country/language, while a
  // verified discovery persists that identity in the market-target ledger. Prefer the
  // persisted identity instead of failing closed and asking for another OAuth round.
  if (channel.data === "shopee" && (!targets.length || targets.some((target) => !isCompleteChannelTarget("shopee", target)))) {
    const { data: storedTargets } = await serviceClient.rpc("sellerpilot_list_channel_market_targets_v2", { p_channel: "shopee" });
    const storedRows = objectRows(storedTargets);
    if (storedRows.length) {
      const merged = new Map(targets.map((target) => [target.targetId, target]));
      for (const row of storedRows) {
        const targetId = textValue(row.target_id);
        const marketCode = textValue(row.market_code).toUpperCase();
        const market = channelMarket("shopee", marketCode);
        const candidate = {
          targetId,
          displayName: textValue(row.display_name),
          marketCode,
          locale: textValue(row.locale) || (market?.locale ?? ""),
          language: textValue(row.language) || (market?.language ?? ""),
          currency: textValue(row.currency) || (market?.currency ?? ""),
          status: textValue(row.remote_status),
        };
        if (targetId && isCompleteChannelTarget("shopee", candidate)) merged.set(targetId, candidate);
      }
      targets = [...merged.values()];
    }
  }

  // A verified discovery also records the shop identity on the credential payload,
  // which stays bound to the active credential version across token rotations. Read it
  // alongside the ledger so a shop synchronized once resolves without another OAuth round.
  if (channel.data === "shopee") {
    const identityTargets = shopeeIdentityChannelTargets({
      secret,
      credentialId: credential.id,
      credentialVersion: numberValue("version" in credential ? credential.version : 0),
    });
    if (identityTargets.length) {
      const merged = new Map(targets.map((target) => [target.targetId, target]));
      for (const target of mergeShopeeChannelTargets([], identityTargets)) {
        merged.set(target.targetId, {
          targetId: target.targetId,
          displayName: target.displayName,
          marketCode: target.marketCode,
          locale: target.locale,
          language: target.language,
          currency: target.currency,
          status: target.status ?? "",
        });
      }
      targets = [...merged.values()];
    }
  }

  if (!targets.length || targets.some((target) => !isCompleteChannelTarget(channel.data, target))) {
    return NextResponse.json({
      message: channel.data === "shopee"
        ? "Shopee 숍의 국가·언어 정보가 없어 OAuth 재승인과 숍 동기화가 필요합니다."
        : "Lazada 셀러의 국가·언어 정보를 확인하지 못했습니다. OAuth 재승인이 필요합니다.",
      channel: channel.data,
      credentialId: credential.id,
      targets: [],
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  // The OAuth envelope is the authoritative Shopee target lineage. GET used
  // to show these shops without populating the cache required by the atomic
  // listing-create fence, so a UI-ready card could still fail at reservation.
  // Seed only complete targets from the currently active encrypted envelope;
  // the service RPC independently requires that exact credential to be active.
  if (channel.data === "shopee") {
    const stored = await Promise.all(targets.map((target) => serviceClient.rpc(
      "sellerpilot_service_upsert_channel_market_target",
      {
        p_owner_id: userData.user.id,
        p_credential_id: credential.id,
        p_channel: "shopee",
        p_target_id: target.targetId,
        p_display_name: target.displayName,
        p_market_code: target.marketCode,
        p_locale: target.locale,
        p_language: target.language,
        p_currency: target.currency,
        p_remote_status: target.status,
      },
    )));
    if (stored.some(({ data, error }) => error || typeof data !== "string")) {
      return NextResponse.json({
        message: "Shopee 숍 계보를 등록 안전 원장에 동기화하지 못했습니다.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  return NextResponse.json({ channel: channel.data, credentialId: credential.id, targets }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const parsed = z.object({
    channel: z.enum(["shopee", "lazada"]),
    credentialId: z.string().uuid().optional(),
    targetId: z.string().regex(/^[1-9][0-9]{0,31}$/u).optional(),
    marketCode: z.string().transform((value) => value.trim().toUpperCase()).optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!parsed.success) return NextResponse.json({ message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentials, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  const productionCredentialId = parsed.data.channel === "shopee"
    ? activeProductionShopeeCredentialId(credentials)
    : activeProductionLazadaCredentialId(credentials);
  const credential = Array.isArray(credentials)
    ? credentials.find((row) => row && typeof row === "object"
      && "channel" in row && row.channel === parsed.data.channel
      && "status" in row && row.status === "active"
      && "id" in row && row.id === productionCredentialId)
    : null;
  if (!credential || !("id" in credential) || typeof credential.id !== "string") return NextResponse.json({ message: "활성 운영 채널 키가 없습니다." }, { status: 404 });
  if (parsed.data.channel === "shopee"
      && (parsed.data.credentialId !== credential.id
        || !parsed.data.targetId
        || parsed.data.marketCode !== "SG")) {
    return NextResponse.json({
      code: "SHOPEE_EXACT_TARGET_SELECTION_REQUIRED",
      message: "현재 운영 credential과 정확한 SG 숍 ID를 지정한 요청만 동기화할 수 있습니다.",
      channel: "shopee",
      credentialId: credential.id,
      credentialVersion: "version" in credential ? numberValue(credential.version) : 0,
      targets: [],
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (parsed.data.channel === "lazada" && parsed.data.credentialId !== credential.id) {
    return NextResponse.json({
      code: lazadaTargetCredentialChangedCode,
      message: "Lazada 운영 키가 대상 조회 사이에 변경됐습니다. 최신 키로 다시 확인해 주세요.",
      channel: "lazada",
      credentialId: credential.id,
      targets: [],
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const activeCredentialId = async () => {
    const { data, error } = await serviceClient.rpc("sellerpilot_get_active_credential_secret", {
      p_channel: parsed.data.channel,
      p_environment: "production",
    });
    const row = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
    const id = row && typeof row.credential_id === "string" ? row.credential_id : "";
    if (error || !id) throw new Error("ACTIVE_CHANNEL_CREDENTIAL_MISSING");
    return id;
  };
  let secret: Record<string, unknown>;
  let initialShopeeSnapshot: ShopeeCredentialSnapshot | null = null;
  if (parsed.data.channel === "shopee") {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret_v2",
      { p_channel: "shopee", p_environment: "production" },
    );
    initialShopeeSnapshot = shopeeCredentialSnapshot(activeCredential);
    const listedVersion = "version" in credential ? numberValue(credential.version) : 0;
    if (activeCredentialError || !initialShopeeSnapshot
        || initialShopeeSnapshot.credentialId !== credential.id
        || initialShopeeSnapshot.version !== listedVersion) {
      return NextResponse.json({
        message: "선택된 운영 Shopee 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 숍을 다시 동기화해 주세요.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: activeCredentialError ? 503 : 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    secret = initialShopeeSnapshot.secretPayload;
  } else {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret",
      { p_channel: "lazada", p_environment: "production" },
    );
    const lazadaEnvelope = activeProductionLazadaCredentialEnvelope(activeCredential);
    if (activeCredentialError || !lazadaEnvelope || lazadaEnvelope.credentialId !== credential.id) {
      return NextResponse.json({
        message: "선택된 운영 Lazada 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 셀러를 다시 동기화해 주세요.",
        channel: "lazada",
        credentialId: credential.id,
        targets: [],
      }, { status: activeCredentialError ? 503 : 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    secret = lazadaEnvelope.secretPayload;
    if (textValue(secret.country).toLowerCase() !== lazadaTargetCountry
        || !activeLazadaSellerIdForMarket(secret, lazadaTargetMarketCode)) {
      return NextResponse.json({
        code: lazadaMyTargetMismatchCode,
        message: "현재 운영 Lazada 키에서 Malaysia(MY) 판매자 계보를 확인하지 못했습니다. OAuth를 다시 연결해 주세요.",
        channel: "lazada",
        credentialId: credential.id,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  try {
    if (parsed.data.channel === "shopee") {
      if (!initialShopeeSnapshot || !parsed.data.targetId || parsed.data.marketCode !== "SG") {
        throw new Error("SHOPEE_EXACT_TARGET_SELECTION_REQUIRED");
      }
      const result = await executeChannelTargetDiscovery({
        serviceClient,
        credentialId: initialShopeeSnapshot.credentialId,
        channel: "shopee",
        request: { shopId: parsed.data.targetId },
      });
      const discoveryEvidence = shopeeShopDiscoveryEvidenceFromGatewayResult({
        result,
        requestedTargetId: parsed.data.targetId,
      });
      const observedAt = new Date().toISOString();
      const { data: activeCredentialAfter, error: activeCredentialAfterError } = await serviceClient.rpc(
        "sellerpilot_get_active_credential_secret_v2",
        { p_channel: "shopee", p_environment: "production" },
      );
      const after = shopeeCredentialSnapshot(activeCredentialAfter);
      if (activeCredentialAfterError || !after) throw new Error("SHOPEE_TARGET_STORE_ACTIVE_CREDENTIAL_MISSING");
      const binding = exactShopeeTargetStoreBinding({
        requestedCredentialId: parsed.data.credentialId ?? "",
        requestedTargetId: parsed.data.targetId,
        requestedMarketCode: parsed.data.marketCode,
        before: initialShopeeSnapshot,
        after,
        providerProfile: discoveryEvidence.providerProfile,
        providerReadSucceeded: discoveryEvidence.providerReadSucceeded,
        signedRequestBoundToTarget: discoveryEvidence.signedRequestBoundToTarget,
        observedAt,
      });
      const providerIdentity = readProviderAccountIdentity(after.secretPayload, "shopee");
      if (!providerIdentity) throw new Error("SHOPEE_TARGET_STORE_IDENTITY_MISSING");
      const { data: storeReceipt, error: storeTargetError } = await serviceClient.rpc(
        "sellerpilot_service_upsert_shopee_market_target_v2",
        {
          p_owner_id: userData.user.id,
          p_expected_credential_id: binding.credentialId,
          p_expected_credential_version: after.version,
          p_target_id: binding.target.targetId,
          p_display_name: binding.target.displayName,
          p_market_code: binding.target.marketCode,
          p_locale: binding.target.locale,
          p_language: binding.target.language,
          p_currency: binding.target.currency,
          p_remote_status: binding.target.status ?? "",
          p_provider_subject: providerIdentity.subject,
          p_observed_at: binding.target.verifiedAt,
        },
      );
      const receipt = storeReceipt && typeof storeReceipt === "object" && !Array.isArray(storeReceipt)
        ? storeReceipt as Record<string, unknown>
        : null;
      if (storeTargetError) {
        const storeErrorMessage = textValue(storeTargetError.message);
        for (const code of [
          "SHOPEE_EXACT_TARGET_ACCESS_NOT_FRESH",
          "SHOPEE_EXACT_TARGET_CREDENTIAL_CHANGED",
          "SHOPEE_EXACT_TARGET_IDENTITY_MISMATCH",
          "SHOPEE_EXACT_TARGET_METADATA_INVALID",
          "SHOPEE_EXACT_TARGET_NOT_AUTHORIZED",
        ]) {
          if (storeErrorMessage.includes(code)) throw new Error(code);
        }
      }
      if (storeTargetError
          || textValue(receipt?.credentialId) !== binding.credentialId
          || numberValue(receipt?.credentialVersion) !== after.version
          || textValue(receipt?.targetId) !== binding.target.targetId
          || textValue(receipt?.marketCode) !== binding.target.marketCode) {
        throw new Error("SHOPEE_TARGET_CACHE_STORE_FAILED");
      }
      return NextResponse.json({
        contractVersion: 2,
        channel: "shopee",
        credentialId: binding.credentialId,
        credentialVersion: after.version,
        rotatedDuringDiscovery: binding.rotated,
        targets: [binding.target],
        storeReceipt: receipt,
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }

    const activeLazadaCredentialId = credential.id;
    const profiles = [];
    const configuredMarket = channelMarket("lazada", lazadaTargetMarketCode);
    if (!configuredMarket) throw new Error("ACTIVE_LAZADA_MARKET_MISSING");
    for (const market of [configuredMarket]) {
      const expectedSellerId = activeLazadaSellerIdForMarket(secret, market.code);
      if (!expectedSellerId) throw new Error("ACTIVE_LAZADA_SELLER_MISSING");
      const currentCredentialId = await activeCredentialId();
      if (currentCredentialId !== activeLazadaCredentialId) throw new Error("ACTIVE_CHANNEL_CREDENTIAL_CHANGED");
      const result = await executeChannelTargetDiscovery({ serviceClient, credentialId: activeLazadaCredentialId, channel: "lazada", request: { country: market.code.toLowerCase() } });
      const profile = lazadaSellerProfileFromGatewayResult(result);
      if (!profile) throw new Error("LAZADA_SELLER_GATEWAY_RESULT_INVALID");
      const remoteTargetId = textValue(profile.seller_id || profile.sellerId);
      if (remoteTargetId !== expectedSellerId) throw new Error("LAZADA_SELLER_LINEAGE_MISMATCH");
      const sellerModeEvidence = lazadaMySellerModeEvidenceFromGatewayResult({
        result,
        expectedSellerId,
        verifiedAt: new Date().toISOString(),
      });
      profiles.push({
        targetId: remoteTargetId,
        displayName: textValue(profile.name || profile.seller_name || profile.short_code),
        marketCode: market.code,
        locale: market.locale,
        language: market.language,
        currency: market.currency,
        status: textValue(profile.status),
        sellerModeEvidence: sellerModeEvidence
          ? { status: "verified", ...sellerModeEvidence }
          : {
            status: "unknown",
            market: "MY",
            sellerId: remoteTargetId,
            reason: "LAZADA_MY_SELLER_MODE_UNVERIFIED",
          },
      });
      const latestCredentialId = await activeCredentialId();
      if (latestCredentialId !== activeLazadaCredentialId) throw new Error("ACTIVE_CHANNEL_CREDENTIAL_CHANGED");
      const { data: storedTargetId, error: storeTargetError } = await serviceClient.rpc("sellerpilot_service_upsert_channel_market_target", {
        p_owner_id: userData.user.id,
        p_credential_id: activeLazadaCredentialId,
        p_channel: "lazada",
        p_target_id: remoteTargetId,
        p_display_name: textValue(profile.name || profile.seller_name || profile.short_code),
        p_market_code: market.code,
        p_locale: market.locale,
        p_language: market.language,
        p_currency: market.currency,
        p_remote_status: textValue(profile.status),
      });
      if (storeTargetError || typeof storedTargetId !== "string") throw new Error("CHANNEL_TARGET_CACHE_STORE_FAILED");
    }
    if (!profiles[0]?.targetId) return NextResponse.json({ message: "Lazada 판매자 응답에서 실제 Seller ID를 확인하지 못했습니다.", channel: "lazada", credentialId: credential.id, targets: [] }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    return NextResponse.json({ channel: "lazada", credentialId: credential.id, targets: profiles }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (error) {
    if (parsed.data.channel === "shopee") {
      const unsafeCode = error instanceof Error ? error.message : "";
      const safeCodes = new Set([
        "SHOPEE_EXACT_TARGET_SELECTION_REQUIRED",
        "SHOPEE_EXACT_TARGET_ACCESS_NOT_FRESH",
        "SHOPEE_EXACT_TARGET_CREDENTIAL_CHANGED",
        "SHOPEE_EXACT_TARGET_IDENTITY_MISMATCH",
        "SHOPEE_EXACT_TARGET_METADATA_INVALID",
        "SHOPEE_EXACT_TARGET_NOT_AUTHORIZED",
        "SHOPEE_SHOP_IDENTITY_INVALID",
        "SHOPEE_SHOP_IDENTITY_MISSING",
        "SHOPEE_SHOP_IDENTITY_MISMATCH",
        "SHOPEE_TARGET_STORE_ACCESS_NOT_FRESH",
        "SHOPEE_TARGET_STORE_ACTIVE_CREDENTIAL_MISSING",
        "SHOPEE_TARGET_STORE_CLOCK_INVALID",
        "SHOPEE_TARGET_STORE_CREDENTIAL_CHANGED_BEFORE_DISCOVERY",
        "SHOPEE_TARGET_STORE_CREDENTIAL_ROTATION_INVALID",
        "SHOPEE_TARGET_STORE_IDENTITY_CHANGED",
        "SHOPEE_TARGET_STORE_IDENTITY_MISSING",
        "SHOPEE_TARGET_STORE_INPUT_INVALID",
        "SHOPEE_TARGET_STORE_MARKET_MISMATCH",
        "SHOPEE_TARGET_STORE_PROFILE_INCOMPLETE",
        "SHOPEE_TARGET_STORE_PROVIDER_READ_FAILED",
        "SHOPEE_TARGET_STORE_TARGET_NOT_AUTHORIZED",
        "SHOPEE_TARGET_CACHE_STORE_FAILED",
      ]);
      const code = safeCodes.has(unsafeCode) ? unsafeCode : "SHOPEE_EXACT_TARGET_DISCOVERY_FAILED";
      const conflict = code.includes("CREDENTIAL") || code.includes("IDENTITY") || code.includes("NOT_AUTHORIZED");
      return NextResponse.json({
        code,
        message: "정확한 SG 숍의 현재 운영 키 계보와 공식 조회 결과를 함께 검증하지 못했습니다.",
        channel: "shopee",
        credentialId: credential.id,
        credentialVersion: "version" in credential ? numberValue(credential.version) : 0,
        targets: [],
      }, { status: conflict ? 409 : 422, headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ message: "허용 IP 채널 작업자에서 판매자 대상을 확인하지 못했습니다." }, { status: 422 });
  }
}
