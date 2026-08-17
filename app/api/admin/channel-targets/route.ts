import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { executeChannelTargetDiscovery } from "../../../../lib/channels/gateway";
import { channelMarket, lazadaMarkets } from "../../../../lib/channels/markets";
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
  const credential = Array.isArray(credentials)
    ? credentials.find((row) => row && typeof row === "object" && "channel" in row && row.channel === channel.data && "status" in row && row.status === "active")
    : null;
  if (!credential || !("id" in credential) || typeof credential.id !== "string") return NextResponse.json({ message: "활성 채널 키가 없습니다." }, { status: 404 });

  if (Array.isArray(cachedTargets) && cachedTargets.length) {
    return NextResponse.json({
      channel: channel.data,
      credentialId: credential.id,
      targets: cachedTargets.map((target) => ({
        targetId: textValue(target.target_id),
        displayName: textValue(target.display_name),
        marketCode: textValue(target.market_code),
        locale: textValue(target.locale),
        language: textValue(target.language),
        currency: textValue(target.currency),
        status: textValue(target.remote_status),
        verifiedAt: textValue(target.verified_at),
      })),
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return NextResponse.json({ message: "채널 대상을 안전하게 불러오지 못했습니다." }, { status: 500 });
  const secret = data as Record<string, unknown>;
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
        };
      });
      const marketCode = textValue(secret.country || "MY").toUpperCase();
      const market = channelMarket("lazada", marketCode);
      return [{ targetId: "", displayName: "", marketCode, locale: market?.locale ?? "", language: market?.language ?? "", currency: market?.currency ?? "" }];
    })();

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
  const parsed = z.object({ channel: z.enum(["shopee", "lazada"]) }).safeParse(await request.json().catch(() => null));
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
  const credential = Array.isArray(credentials)
    ? credentials.find((row) => row && typeof row === "object" && "channel" in row && row.channel === parsed.data.channel && "status" in row && row.status === "active")
    : null;
  if (!credential || !("id" in credential) || typeof credential.id !== "string") return NextResponse.json({ message: "활성 채널 키가 없습니다." }, { status: 404 });

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
  const { data: secretData, error: secretError } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError || !secretData || typeof secretData !== "object" || Array.isArray(secretData)) return NextResponse.json({ message: "채널 대상을 안전하게 불러오지 못했습니다." }, { status: 500 });
  const secret = secretData as Record<string, unknown>;

  try {
    if (parsed.data.channel === "shopee") {
      const targetIds = objectRows(secret.shopee_targets)
        .filter((target) => target.type === "shop")
        .map((target) => textValue(target.id))
        .filter(Boolean);
      const profiles = [];
      for (const targetId of targetIds) {
        const currentCredentialId = await activeCredentialId();
        const result = await executeChannelTargetDiscovery({ serviceClient, credentialId: currentCredentialId, channel: "shopee", request: { shopId: targetId } });
        const profile = remoteProfile(result);
        const marketCode = textValue(profile.region || profile.country || profile.market).toUpperCase();
        const market = channelMarket("shopee", marketCode);
        profiles.push({
          targetId,
          displayName: textValue(profile.shop_name || profile.shopName || profile.name),
          marketCode,
          locale: market?.locale ?? "",
          language: market?.language ?? "",
          currency: market?.currency ?? "",
          status: textValue(profile.status || profile.shop_status),
        });
        const latestCredentialId = await activeCredentialId();
        await serviceClient.rpc("sellerpilot_service_upsert_channel_market_target", {
          p_owner_id: userData.user.id,
          p_credential_id: latestCredentialId,
          p_channel: "shopee",
          p_target_id: targetId,
          p_display_name: textValue(profile.shop_name || profile.shopName || profile.name),
          p_market_code: marketCode,
          p_locale: market?.locale ?? "",
          p_language: market?.language ?? "",
          p_currency: market?.currency ?? "",
          p_remote_status: textValue(profile.status || profile.shop_status),
        });
      }
      return NextResponse.json({ channel: "shopee", credentialId: credential.id, targets: profiles }, { headers: { "cache-control": "no-store, max-age=0" } });
    }

    const profiles = [];
    for (const market of lazadaMarkets) {
      const currentCredentialId = await activeCredentialId();
      const result = await executeChannelTargetDiscovery({ serviceClient, credentialId: currentCredentialId, channel: "lazada", request: { country: market.code.toLowerCase() } });
      const profile = remoteProfile(result);
      profiles.push({
        targetId: textValue(profile.seller_id || profile.sellerId || profile.user_id),
        displayName: textValue(profile.name || profile.seller_name || profile.short_code),
        marketCode: market.code,
        locale: market.locale,
        language: market.language,
        currency: market.currency,
        status: textValue(profile.status),
      });
      const latestCredentialId = await activeCredentialId();
      await serviceClient.rpc("sellerpilot_service_upsert_channel_market_target", {
        p_owner_id: userData.user.id,
        p_credential_id: latestCredentialId,
        p_channel: "lazada",
        p_target_id: textValue(profile.seller_id || profile.sellerId || profile.user_id),
        p_display_name: textValue(profile.name || profile.seller_name || profile.short_code),
        p_market_code: market.code,
        p_locale: market.locale,
        p_language: market.language,
        p_currency: market.currency,
        p_remote_status: textValue(profile.status),
      });
    }
    return NextResponse.json({ channel: "lazada", credentialId: credential.id, targets: profiles }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ message: "허용 IP 채널 작업자에서 판매자 대상을 확인하지 못했습니다." }, { status: 422 });
  }
}
