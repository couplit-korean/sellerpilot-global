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
import { isCompleteChannelTarget, shopeeShopTargetIds, type ChannelTargetRecord } from "../../../../lib/channels/target-records";
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

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const channel = querySchema.safeParse(new URL(request.url).searchParams.get("channel"));
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!channel.success) return NextResponse.json({ message: "지원하지 않는 채널입니다." }, { status: 400 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentials, error: credentialError }, { data: cachedTargets, error: targetError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
    userClient.rpc("sellerpilot_list_channel_market_targets", { p_channel: channel.data }),
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

  const normalizedCachedTargets: ChannelTargetRecord[] = Array.isArray(cachedTargets)
    ? cachedTargets.map((target) => ({
      targetId: textValue(target.target_id),
      displayName: textValue(target.display_name),
      marketCode: textValue(target.market_code).toUpperCase(),
      locale: textValue(target.locale),
      language: textValue(target.language),
      currency: textValue(target.currency),
      status: textValue(target.remote_status),
      verifiedAt: textValue(target.verified_at),
    }))
    : [];
  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let activeShopeeSecret: Record<string, unknown> | null = null;
  let activeLazadaSecret: Record<string, unknown> | null = null;
  if (channel.data === "shopee") {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret",
      { p_channel: "shopee", p_environment: "production" },
    );
    const envelope = activeProductionShopeeCredentialEnvelope(activeCredential);
    if (activeCredentialError) {
      return NextResponse.json({
        message: "현재 운영 Shopee 키의 계보를 확인하지 못했습니다.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (!envelope || envelope.credentialId !== credential.id) {
      return NextResponse.json({
        message: "선택된 운영 Shopee 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 숍을 다시 동기화해 주세요.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    activeShopeeSecret = envelope.secretPayload;
    const lineageBoundTargets = lineageBoundShopeeTargets(normalizedCachedTargets, activeShopeeSecret);
    if (lineageBoundTargets.length === shopeeMarkets.length) {
      return NextResponse.json({
        channel: channel.data,
        credentialId: envelope.credentialId,
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
  const targets = channel.data === "shopee"
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

function remoteProfile(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const row = result as Record<string, unknown>;
  const steps = Array.isArray(row.steps) ? row.steps : [];
  const first = steps[0] && typeof steps[0] === "object" && !Array.isArray(steps[0]) ? steps[0] as Record<string, unknown> : {};
  const data = first.data && typeof first.data === "object" && !Array.isArray(first.data) ? first.data as Record<string, unknown> : {};
  const nested = data.response && typeof data.response === "object" && !Array.isArray(data.response)
    ? data.response as Record<string, unknown>
    : data.data && typeof data.data === "object" && !Array.isArray(data.data)
      ? data.data as Record<string, unknown>
      : data;
  return nested;
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const parsed = z.object({
    channel: z.enum(["shopee", "lazada"]),
    credentialId: z.string().uuid().optional(),
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
  if (parsed.data.channel === "shopee") {
    const { data: activeCredential, error: activeCredentialError } = await serviceClient.rpc(
      "sellerpilot_get_active_credential_secret",
      { p_channel: "shopee", p_environment: "production" },
    );
    const envelope = activeProductionShopeeCredentialEnvelope(activeCredential);
    if (activeCredentialError || !envelope || envelope.credentialId !== credential.id) {
      return NextResponse.json({
        message: "선택된 운영 Shopee 키와 서버의 현재 활성 계보가 일치하지 않습니다. OAuth 재승인 후 숍을 다시 동기화해 주세요.",
        channel: "shopee",
        credentialId: credential.id,
        targets: [],
      }, { status: activeCredentialError ? 503 : 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    secret = envelope.secretPayload;
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
      const targetIds = shopeeShopTargetIds(secret);
      const profiles = [];
      for (const targetId of targetIds) {
        const currentCredentialId = await activeCredentialId();
        const result = await executeChannelTargetDiscovery({ serviceClient, credentialId: currentCredentialId, channel: "shopee", request: { shopId: targetId } });
        const profile = remoteProfile(result);
        const marketCode = textValue(profile.region || profile.country || profile.market).toUpperCase();
        const market = channelMarket("shopee", marketCode);
        if (!market) continue;
        profiles.push({
          targetId,
          displayName: textValue(profile.shop_name || profile.shopName || profile.name),
          marketCode,
          locale: market.locale,
          language: market.language,
          currency: market.currency,
          status: textValue(profile.status || profile.shop_status),
        });
        const latestCredentialId = await activeCredentialId();
        const { data: storedTargetId, error: storeTargetError } = await serviceClient.rpc("sellerpilot_service_upsert_channel_market_target", {
          p_owner_id: userData.user.id,
          p_credential_id: latestCredentialId,
          p_channel: "shopee",
          p_target_id: targetId,
          p_display_name: textValue(profile.shop_name || profile.shopName || profile.name),
          p_market_code: marketCode,
          p_locale: market.locale,
          p_language: market.language,
          p_currency: market.currency,
          p_remote_status: textValue(profile.status || profile.shop_status),
        });
        if (storeTargetError || typeof storedTargetId !== "string") throw new Error("CHANNEL_TARGET_CACHE_STORE_FAILED");
      }
      if (!profiles.length) return NextResponse.json({ message: "Shopee 승인 숍에서 지원 국가 정보를 확인하지 못했습니다.", channel: "shopee", credentialId: credential.id, targets: [] }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      return NextResponse.json({ channel: "shopee", credentialId: credential.id, targets: profiles }, { headers: { "cache-control": "no-store, max-age=0" } });
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
      const profile = remoteProfile(result);
      const remoteTargetId = textValue(profile.seller_id || profile.sellerId);
      if (remoteTargetId !== expectedSellerId) throw new Error("LAZADA_SELLER_LINEAGE_MISMATCH");
      profiles.push({
        targetId: remoteTargetId,
        displayName: textValue(profile.name || profile.seller_name || profile.short_code),
        marketCode: market.code,
        locale: market.locale,
        language: market.language,
        currency: market.currency,
        status: textValue(profile.status),
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
  } catch {
    return NextResponse.json({ message: "허용 IP 채널 작업자에서 판매자 대상을 확인하지 못했습니다." }, { status: 422 });
  }
}
