import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureShopeeAccessToken, ensureShopeeMerchantAccessToken, exchangeShopeeOAuthToken, shopeeMerchantRequest, shopeeRequest } from "../lib/channels/protocols.ts";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "sqaoqucxakebqkiygdxb";
const siteUrl = (process.env.SELLERPILOT_URL?.trim() || "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const channel = process.env.LIVE_CHANNEL?.trim();
const operation = process.env.LIVE_OPERATION?.trim();
let argumentsValue = JSON.parse(process.env.LIVE_OPERATION_ARGUMENTS || "{}");
const keys = JSON.parse(process.env.SUPABASE_KEYS_JSON || "[]");
const publishableKey = keys.find((item) => item?.type === "publishable")?.api_key
  || keys.find((item) => item?.type === "legacy" && item?.name === "anon")?.api_key;
const secretKey = keys.find((item) => item?.type === "legacy" && item?.name === "service_role")?.api_key
  || keys.find((item) => item?.type === "secret")?.api_key;
if (!publishableKey || !secretKey) throw new Error("Supabase publishable/secret key input is missing.");
if (!channel || !operation) throw new Error("LIVE_CHANNEL and LIVE_OPERATION are required.");

const supabaseUrl = `https://${projectRef}.supabase.co`;
const service = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: usersData, error: usersError } = await service.auth.admin.listUsers({ page: 1, perPage: 1_000 });
if (usersError) throw usersError;
const sampleEmail = "couplit.official+sellerpilot-sample@gmail.com";
const sampleUser = usersData.users.find((user) => user.email === sampleEmail);
if (!sampleUser) throw new Error("Authorized sample administrator account is missing.");
const password = `${randomBytes(24).toString("base64url")}!9aA`;
const { error: updateError } = await service.auth.admin.updateUserById(sampleUser.id, { password, email_confirm: true });
if (updateError) throw updateError;

const userClient = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({ email: sampleEmail, password });
if (signInError || !signIn.session?.access_token) throw signInError ?? new Error("Sample administrator sign-in failed.");
const { data: credentials, error: credentialError } = await userClient.rpc("sellerpilot_list_credentials");
if (credentialError) throw credentialError;
const credential = credentials.find((item) => item.channel === channel && item.status === "active");
if (!credential) throw new Error(`No active ${channel} credential found.`);
if (process.env.LIVE_TARGET_DIAGNOSTICS === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-targets?channel=${encodeURIComponent(channel)}`, {
    headers: { authorization: `Bearer ${signIn.session.access_token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  console.log(JSON.stringify({ status: response.status, targets: result.targets ?? [], message: result.message ?? null }, null, 2));
  if (!response.ok) process.exitCode = 1;
  process.exit();
}
if (process.env.LIVE_LAZADA_START_OAUTH === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-credentials/lazada/authorize`, {
    method: "POST",
    headers: { authorization: `Bearer ${signIn.session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ credentialId: credential.id, environment: credential.environment, secretPayload: {}, startOAuth: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  console.log(JSON.stringify({ status: response.status, ...result }, null, 2));
  if (!response.ok) process.exitCode = 1;
  process.exit();
}
if (process.env.LIVE_SHOPEE_ITEM_ID) {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const shopId = process.env.LIVE_TARGET_ID || "1719148844";
  const ensured = await ensureShopeeAccessToken(secretPayload, credential.environment === "sandbox" ? "sandbox" : "production", 10 * 60 * 1_000, shopId);
  const remote = await shopeeRequest({
    payload: ensured.payload,
    environment: credential.environment === "sandbox" ? "sandbox" : "production",
    method: "GET",
    path: "/api/v2/product/get_item_base_info",
    query: new URLSearchParams({ item_id_list: process.env.LIVE_SHOPEE_ITEM_ID }),
  });
  console.log(JSON.stringify({ status: remote.response.status, data: remote.data }, null, 2));
  process.exit(0);
}
if (process.env.LIVE_SHOPEE_GLOBAL_RELATION_ID) {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const ensured = await ensureShopeeMerchantAccessToken(secretPayload, credential.environment === "sandbox" ? "sandbox" : "production");
  const globalItemId = process.env.LIVE_SHOPEE_GLOBAL_RELATION_ID;
  const endpoints = [
    ["publishable", "/api/v2/global_product/get_publishable_shop", new URLSearchParams({ global_item_id: globalItemId })],
    ["published", "/api/v2/global_product/get_published_list", new URLSearchParams({ global_item_id: globalItemId })],
    ["relation", "/api/v2/global_product/get_global_item_relation", new URLSearchParams({ global_item_id_list: globalItemId })],
  ];
  const results = {};
  for (const [name, path, query] of endpoints) {
    const remote = await shopeeMerchantRequest({ payload: ensured.payload, environment: credential.environment === "sandbox" ? "sandbox" : "production", method: "GET", path, query });
    results[name] = { status: remote.response.status, data: remote.data };
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
if (process.env.LIVE_EXCHANGE_SHOPEE_CODE) {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const mainAccountId = String(secretPayload?.main_account_id ?? "").trim();
  const remote = await exchangeShopeeOAuthToken({
    environment: credential.environment === "sandbox" ? "sandbox" : "production",
    partnerId: String(secretPayload.partner_id ?? ""),
    partnerKey: String(secretPayload.partner_key ?? ""),
    code: process.env.LIVE_EXCHANGE_SHOPEE_CODE,
    mainAccountId,
  });
  const mainAccessToken = typeof remote.data.access_token === "string" ? remote.data.access_token : "";
  const mainRefreshToken = typeof remote.data.refresh_token === "string" ? remote.data.refresh_token : "";
  if (!remote.response.ok || remote.data.error || !mainAccessToken || !mainRefreshToken) throw new Error(`Shopee main-account token exchange failed: ${String(remote.data.error ?? remote.response.status)}`);
  const collectIds = (value, keys, depth = 0) => {
    if (depth > 8 || value == null) return [];
    if (Array.isArray(value)) return [...new Set(value.flatMap((item) => collectIds(item, keys, depth + 1)))];
    if (typeof value !== "object") return [];
    const direct = Object.entries(value).filter(([key]) => keys.includes(key)).flatMap(([, item]) => {
      const list = Array.isArray(item) ? item : [item];
      return list.map(String).filter((candidate) => /^\d+$/.test(candidate));
    });
    return [...new Set([...direct, ...Object.values(value).flatMap((item) => collectIds(item, keys, depth + 1))])];
  };
  const shopIds = collectIds(remote.data, ["shop_id", "shopId", "shop_id_list"]);
  if (!shopIds.length && Array.isArray(secretPayload.shop_ids)) shopIds.push(...secretPayload.shop_ids.map(String).filter((item) => /^\d+$/.test(item)));
  const merchantIds = collectIds(remote.data, ["merchant_id", "merchantId", "merchant_id_list"]);
  const refreshExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const targets = [];
  const priorTargets = Array.isArray(secretPayload.shopee_targets) ? secretPayload.shopee_targets : [];
  for (const shopId of [...new Set(shopIds)]) {
    const targetRemote = await exchangeShopeeOAuthToken({
      environment: credential.environment === "sandbox" ? "sandbox" : "production",
      partnerId: String(secretPayload.partner_id ?? ""),
      partnerKey: String(secretPayload.partner_key ?? ""),
      refreshToken: mainRefreshToken,
      shopId,
    });
    if (!targetRemote.response.ok || targetRemote.data.error || !targetRemote.data.access_token || !targetRemote.data.refresh_token) {
      const prior = priorTargets.find((target) => target?.type === "shop" && String(target?.id) === shopId && target?.access_token && target?.refresh_token);
      if (!prior) throw new Error(`Shopee shop token exchange failed: ${shopId}`);
      targets.push(prior);
      continue;
    }
    targets.push({
      type: "shop",
      id: shopId,
      access_token: targetRemote.data.access_token,
      refresh_token: targetRemote.data.refresh_token,
      access_token_expires_at: new Date(Date.now() + Number(targetRemote.data.expire_in ?? 14_400) * 1_000).toISOString(),
      refresh_token_expires_at: refreshExpiresAt,
    });
  }
  for (const merchantId of merchantIds) {
    const targetRemote = await exchangeShopeeOAuthToken({
      environment: credential.environment === "sandbox" ? "sandbox" : "production",
      partnerId: String(secretPayload.partner_id ?? ""),
      partnerKey: String(secretPayload.partner_key ?? ""),
      refreshToken: mainRefreshToken,
      merchantId,
    });
    if (!targetRemote.response.ok || targetRemote.data.error || !targetRemote.data.access_token || !targetRemote.data.refresh_token) throw new Error(`Shopee merchant token exchange failed: ${merchantId}`);
    targets.push({
      type: "merchant",
      id: merchantId,
      access_token: targetRemote.data.access_token,
      refresh_token: targetRemote.data.refresh_token,
      access_token_expires_at: new Date(Date.now() + Number(targetRemote.data.expire_in ?? 14_400) * 1_000).toISOString(),
      refresh_token_expires_at: refreshExpiresAt,
    });
  }
  const primaryShop = targets.find((target) => target.type === "shop");
  if (!primaryShop || !merchantIds.length) throw new Error("Shopee authorization did not return both shop and merchant targets.");
  const nextPayload = {
    ...secretPayload,
    main_account_access_token: mainAccessToken,
    main_account_refresh_token: mainRefreshToken,
    shop_ids: [...new Set(shopIds)],
    merchant_ids: merchantIds,
    shopee_targets: targets,
    shop_id: primaryShop.id,
    access_token: primaryShop.access_token,
    refresh_token: primaryShop.refresh_token,
    access_token_expires_at: primaryShop.access_token_expires_at,
    refresh_token_expires_at: primaryShop.refresh_token_expires_at,
  };
  const { data: stored, error: storeError } = await service.rpc("sellerpilot_service_refresh_shopee", {
    p_credential_id: credential.id,
    p_secret_payload: nextPayload,
    p_expires_at: secretPayload.authorization_expires_at ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
  });
  if (storeError || !stored) throw storeError ?? new Error("Shopee authorization targets could not be stored.");
  console.log(JSON.stringify({ ok: true, shopIds: [...new Set(shopIds)], merchantIds, stored: true }, null, 2));
  process.exit(0);
}
if (process.env.LIVE_BOOTSTRAP_SHOPEE_MERCHANT === "true") {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const merchantId = String(process.env.LIVE_SHOPEE_MERCHANT_ID ?? secretPayload?.main_account_id ?? "").trim();
  const refreshToken = String(secretPayload?.main_account_refresh_token ?? "").trim();
  if (!merchantId || !refreshToken) throw new Error("Shopee main account refresh input is missing.");
  const remote = await exchangeShopeeOAuthToken({
    environment: credential.environment === "sandbox" ? "sandbox" : "production",
    partnerId: String(secretPayload.partner_id ?? ""),
    partnerKey: String(secretPayload.partner_key ?? ""),
    refreshToken,
    merchantId,
  });
  const accessToken = typeof remote.data.access_token === "string" ? remote.data.access_token : "";
  const nextRefreshToken = typeof remote.data.refresh_token === "string" ? remote.data.refresh_token : "";
  if (!remote.response.ok || remote.data.error || !accessToken || !nextRefreshToken) {
    console.log(JSON.stringify({ ok: false, status: remote.response.status, error: remote.data.error ?? null, message: remote.data.message ?? remote.data.message_detail ?? null }, null, 2));
    process.exit(1);
  }
  const now = Date.now();
  const target = {
    type: "merchant",
    id: merchantId,
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    access_token_expires_at: new Date(now + Number(remote.data.expire_in ?? 14_400) * 1_000).toISOString(),
    refresh_token_expires_at: new Date(now + 30 * 86_400_000).toISOString(),
  };
  const priorTargets = Array.isArray(secretPayload.shopee_targets) ? secretPayload.shopee_targets : [];
  const nextPayload = {
    ...secretPayload,
    merchant_ids: [...new Set([...(Array.isArray(secretPayload.merchant_ids) ? secretPayload.merchant_ids.map(String) : []), merchantId])],
    shopee_targets: [...priorTargets.filter((item) => item?.type !== "merchant" || String(item?.id) !== merchantId), target],
  };
  const { data: stored, error: storeError } = await service.rpc("sellerpilot_service_refresh_shopee", {
    p_credential_id: credential.id,
    p_secret_payload: nextPayload,
    p_expires_at: secretPayload.authorization_expires_at ?? null,
  });
  if (storeError || !stored) throw storeError ?? new Error("Shopee merchant target could not be stored.");
  console.log(JSON.stringify({ ok: true, merchantId, stored: true }, null, 2));
  process.exit(0);
}
if (process.env.LIVE_CREDENTIAL_DIAGNOSTICS === "true") {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const targets = Array.isArray(secretPayload?.shopee_targets) ? secretPayload.shopee_targets : [];
  console.log(JSON.stringify({
    credentialId: credential.id,
    channel,
    hasMainAccountId: Boolean(secretPayload?.main_account_id),
    mainAccountId: secretPayload?.main_account_id ? String(secretPayload.main_account_id) : "",
    shopIds: Array.isArray(secretPayload?.shop_ids) ? secretPayload.shop_ids.map(String) : [],
    merchantIds: Array.isArray(secretPayload?.merchant_ids) ? secretPayload.merchant_ids.map(String) : [],
    targets: targets.map((target) => ({ type: target?.type, id: String(target?.id ?? ""), hasAccessToken: Boolean(target?.access_token), hasRefreshToken: Boolean(target?.refresh_token) })),
  }, null, 2));
  process.exit(0);
}
if (process.env.LIVE_SHOPEE_GLOBAL_TEST_PRODUCT_ID) {
  if (channel !== "shopee" || operation !== "listing.create") throw new Error("Shopee global test mode requires shopee listing.create.");
  const productId = process.env.LIVE_SHOPEE_GLOBAL_TEST_PRODUCT_ID;
  const headers = { authorization: `Bearer ${signIn.session.access_token}` };
  const [contextResponse, targetsResponse] = await Promise.all([
    fetch(`${siteUrl}/api/admin/products/${productId}/publish-context`, { headers, signal: AbortSignal.timeout(30_000) }),
    fetch(`${siteUrl}/api/admin/channel-targets?channel=shopee`, { headers, signal: AbortSignal.timeout(30_000) }),
  ]);
  const context = await contextResponse.json();
  if (!contextResponse.ok) throw new Error(context.message || "Product publish context could not be loaded.");
  const targetsPayload = await targetsResponse.json();
  if (!targetsResponse.ok) throw new Error(targetsPayload.message || "Shopee market targets could not be loaded.");
  const market = String(process.env.LIVE_MARKET || "SG").toUpperCase();
  const target = targetsPayload.targets?.find((item) => item.marketCode === market);
  const listing = context.localizedListings.find((item) => item.channel === "shopee" && item.market === market);
  const assignment = context.assignments.find((item) => item.channel === "shopee" && item.market === market && item.status === "confirmed");
  const imageUrls = [...context.sourceImages, ...context.generatedImages].map((item) => item.url).filter(Boolean);
  if (!target || !listing || !assignment || !imageUrls.length) throw new Error(`Shopee ${market} target, listing, confirmed category, or images are missing.`);
  const sku = `${context.product.sku}-GLOBAL-${Date.now().toString(36).toUpperCase()}`.slice(0, 100);
  const attributeList = Object.entries(assignment.providedAttributes ?? {}).map(([attributeId, value]) => ({
    attribute_id: Number(attributeId),
    attribute_value_list: /^\d+$/.test(String(value)) ? [{ value_id: Number(value) }] : [{ original_value_name: String(value) }],
  }));
  const localPrices = { SG: 12.9, MY: 39.9, PH: 499, VN: 219000, TH: 299, TW: 299, BR: 49.9, MX: 169 };
  const common = {
    category_id: Number(assignment.categoryId),
    description: listing.description.slice(0, 3_000),
    brand: { brand_id: 0, original_brand_name: "No Brand" },
    condition: "NEW",
    normal_stock: 1,
    seller_stock: [{ stock: 1 }],
    weight: 0.35,
    dimension: { package_length: 12, package_width: 12, package_height: 10 },
    pre_order: { is_pre_order: false, days_to_ship: 1 },
    attribute_list: attributeList,
  };
  argumentsValue = process.env.LIVE_SHOPEE_PUBLISH_TASK_ID ? {
    globalProduct: true,
    resumeOnly: true,
    globalItemId: process.env.LIVE_SHOPEE_GLOBAL_ITEM_ID,
    publishTaskId: process.env.LIVE_SHOPEE_PUBLISH_TASK_ID,
  } : {
    globalProduct: true,
    imageUrls,
    body: {
      ...common,
      original_price: 12.9,
      global_item_name: listing.title.slice(0, 120),
      global_item_sku: sku,
    },
    publish: {
      shop_id: Number(target.targetId),
      shop_region: market,
      item: {
        ...common,
        original_price: localPrices[market] ?? 12.9,
        item_name: listing.title.slice(0, 120),
        item_sku: `${sku}-${market}`.slice(0, 100),
        item_status: "UNLIST",
      },
    },
  };
  if (process.env.LIVE_SHOPEE_GLOBAL_ITEM_ID) argumentsValue.globalItemId = process.env.LIVE_SHOPEE_GLOBAL_ITEM_ID;
  if (process.env.LIVE_SHOPEE_RECOVER_PUBLISHED === "true") {
    argumentsValue.resumeOnly = true;
    argumentsValue.recoverPublished = true;
  }
}

const request = {
  credentialId: credential.id,
  channel,
  operation,
  idempotencyKey: `live-${createHash("sha256").update(`${channel}:${operation}:${Date.now()}:${randomBytes(8).toString("hex")}`).digest("hex")}`,
  confirmWrite: process.env.LIVE_CONFIRM_WRITE === "true",
  arguments: argumentsValue,
  ...(process.env.LIVE_PRODUCT_ID ? { productId: process.env.LIVE_PRODUCT_ID } : {}),
  ...(process.env.LIVE_MARKET ? { market: process.env.LIVE_MARKET } : {}),
  ...(process.env.LIVE_TARGET_ID ? { targetId: process.env.LIVE_TARGET_ID } : {}),
  ...(process.env.LIVE_CURRENCY ? { currency: process.env.LIVE_CURRENCY } : {}),
  ...(process.env.LIVE_PRICE ? { price: Number(process.env.LIVE_PRICE) } : {}),
};
const response = await fetch(`${siteUrl}/api/admin/channel-operations`, {
  method: "POST",
  headers: { authorization: `Bearer ${signIn.session.access_token}`, "content-type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(70_000),
});
const result = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
console.log(JSON.stringify({ httpStatus: response.status, response: result }, null, 2));
if (!response.ok) process.exitCode = 1;
