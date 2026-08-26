import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { shopeeMerchantRequest, shopeeRequest } from "../lib/channels/protocols.ts";
import { marketplaceChannelDetailImageCount } from "../lib/channels/marketplace-image-contract.ts";
import { buildLocalizedBudgetedPlainDetail } from "../lib/marketplace-localized-content.ts";

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

function liveShopeeReadPayload(payload, targetType, requestedId = "") {
  const targets = Array.isArray(payload?.shopee_targets) ? payload.shopee_targets : [];
  const target = targets.find((candidate) => candidate?.type === targetType
    && (!requestedId || String(candidate?.id ?? "") === requestedId));
  const projected = target ? {
    ...payload,
    ...(targetType === "shop" ? { shop_id: String(target.id) } : { merchant_id: String(target.id) }),
    access_token: target.access_token,
    refresh_token: target.refresh_token,
    access_token_expires_at: target.access_token_expires_at,
    refresh_token_expires_at: target.refresh_token_expires_at,
  } : payload;
  const accessToken = typeof projected?.access_token === "string" ? projected.access_token.trim() : "";
  const expiresAt = Date.parse(String(projected?.access_token_expires_at ?? ""));
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    throw new Error("Direct QA reads never rotate OAuth tokens. Run the channel gateway diagnostic first, then retry.");
  }
  return projected;
}

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
if (process.env.LIVE_SHOPEE_START_OAUTH === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-credentials/shopee/authorize`, {
    method: "POST",
    headers: { authorization: `Bearer ${signIn.session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      credentialId: credential.id,
      environment: credential.environment,
      secretPayload: {},
      startOAuth: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
  console.log(JSON.stringify({
    status: response.status,
    authorizationUrl: typeof result.authorizationUrl === "string" ? result.authorizationUrl : null,
    message: result.message ?? null,
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
  process.exit();
}
if (process.env.LIVE_SHOPEE_ITEM_ID) {
  const { data: secretPayload, error: secretError } = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (secretError) throw secretError;
  const shopId = process.env.LIVE_TARGET_ID || "1719148844";
  const readPayload = liveShopeeReadPayload(secretPayload, "shop", shopId);
  const remote = await shopeeRequest({
    payload: readPayload,
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
  const readPayload = liveShopeeReadPayload(secretPayload, "merchant");
  const globalItemId = process.env.LIVE_SHOPEE_GLOBAL_RELATION_ID;
  const endpoints = [
    ["publishable", "/api/v2/global_product/get_publishable_shop", new URLSearchParams({ global_item_id: globalItemId })],
    ["published", "/api/v2/global_product/get_published_list", new URLSearchParams({ global_item_id: globalItemId })],
    ["relation", "/api/v2/global_product/get_global_item_relation", new URLSearchParams({ global_item_id_list: globalItemId })],
  ];
  const results = {};
  for (const [name, path, query] of endpoints) {
    const remote = await shopeeMerchantRequest({ payload: readPayload, environment: credential.environment === "sandbox" ? "sandbox" : "production", method: "GET", path, query });
    results[name] = { status: remote.response.status, data: remote.data };
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
if (process.env.LIVE_EXCHANGE_SHOPEE_CODE) {
  throw new Error("Direct OAuth code exchange is disabled. Complete Shopee OAuth through the SellerPilot dashboard.");
}
if (process.env.LIVE_BOOTSTRAP_SHOPEE_MERCHANT === "true") {
  throw new Error("Direct merchant token bootstrap is disabled. Use the claim-fenced channel gateway flow.");
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
  const generatedImage = (id) => context.generatedImages.find((item) => item.id === id)?.url;
  const imageUrls = [...new Set([generatedImage("square"), ...context.sourceImages.map((item) => item.url), generatedImage("hero")].filter(Boolean))];
  const localizedDetailSections = Array.isArray(listing?.detailSections) ? listing.detailSections : [];
  const detailImageRoles = localizedDetailSections.map((section) => String(section?.imageAsset ?? ""));
  const detailImageAltTexts = localizedDetailSections.map((section) => String(section?.imageAltText ?? ""));
  const detailImageUrls = detailImageRoles.map(generatedImage).filter(Boolean);
  if (!target || !listing || !assignment || !imageUrls.length || detailImageUrls.length !== marketplaceChannelDetailImageCount) {
    throw new Error(`Shopee ${market} target, listing, confirmed category, thumbnail, or ${marketplaceChannelDetailImageCount} detail images are missing.`);
  }
  const classification = listing.classification ?? context.classification;
  const shopeeDescription = buildLocalizedBudgetedPlainDetail(
    listing,
    listing.title,
    listing.description,
    3_000,
    { classification },
  );
  const sellerpilotAssets = {
    galleryImageUrls: imageUrls,
    detailImageUrls,
    detailImageRoles,
    detailImageAltTexts,
    localizedDetailSections,
    classification,
    detailAssetMode: "dedicated",
  };
  const sku = `${context.product.sku}-GLOBAL-${Date.now().toString(36).toUpperCase()}`.slice(0, 100);
  const attributeList = Object.entries(assignment.providedAttributes ?? {}).map(([attributeId, value]) => ({
    attribute_id: Number(attributeId),
    attribute_value_list: /^\d+$/.test(String(value)) ? [{ value_id: Number(value) }] : [{ original_value_name: String(value) }],
  }));
  const localPrices = { SG: 12.9, MY: 39.9, PH: 499, VN: 219000, TH: 299, TW: 299, BR: 49.9, MX: 169 };
  const common = {
    category_id: Number(assignment.categoryId),
    description: shopeeDescription,
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
    sellerpilotAssets,
  } : {
    globalProduct: true,
    sellerpilotAssets,
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
