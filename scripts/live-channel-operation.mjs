import { createClient } from "@supabase/supabase-js";
import { shopeeMerchantRequest, shopeeRequest } from "../lib/channels/protocols.ts";

const APPROVED_PROJECT = "sqaoqucxakebqkiygdxb";
const APPROVED_ORIGIN = "https://sellerpilot-global.vercel.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateLiveDestinations(env) {
  if ((env.SUPABASE_PROJECT_REF?.trim() || APPROVED_PROJECT) !== APPROVED_PROJECT) throw new Error("LIVE_UNAPPROVED_PROJECT");
  let url;
  try { url = new URL(env.SELLERPILOT_URL?.trim() || APPROVED_ORIGIN); } catch { throw new Error("LIVE_UNAPPROVED_ORIGIN"); }
  if (url.origin !== APPROVED_ORIGIN || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("LIVE_UNAPPROVED_ORIGIN");
}
// Output deliberately excludes all provider strings, object spreads, IDs and URLs.
function emitSafe(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { value = null; }
  const candidate = value?.httpStatus ?? value?.status;
  const httpStatus = Number.isInteger(candidate) && candidate >= 100 && candidate <= 599 ? candidate : null;
  console.log(JSON.stringify({ ok: httpStatus !== null ? httpStatus >= 200 && httpStatus < 300 : value?.ok === true, httpStatus }));
}
function fixedFailure(error) {
  const codes = new Set(["LIVE_ADMIN_ACCESS_TOKEN_REQUIRED","LIVE_ADMIN_USER_ID_REQUIRED","LIVE_CHANNEL_AND_OPERATION_REQUIRED","LIVE_SUPABASE_KEYS_INVALID","LIVE_SUPABASE_PUBLISHABLE_KEY_REQUIRED","LIVE_UNAPPROVED_PROJECT","LIVE_UNAPPROVED_ORIGIN","LIVE_ADMIN_VERIFICATION_TIMEOUT","LIVE_ADMIN_SESSION_INVALID","LIVE_ADMIN_OWNER_MISMATCH","LIVE_ADMIN_ACCESS_DENIED","LIVE_CREDENTIAL_METADATA_UNAVAILABLE","LIVE_ENVIRONMENT_INVALID","LIVE_ACTIVE_CREDENTIAL_NOT_UNIQUE","LIVE_CREDENTIAL_OWNER_PROOF_UNAVAILABLE","LIVE_CREDENTIAL_OWNER_PROOF_INVALID","LIVE_CREDENTIAL_OWNER_PROOF_CHANGED","LIVE_DISABLED_TEST_MODE","LIVE_ARGUMENTS_INVALID","LIVE_IDEMPOTENCY_KEY_REQUIRED","LIVE_RESOURCE_ID_REQUIRED","LIVE_COMMERCE_VALUES_REQUIRED","LIVE_EXPLICIT_SHOPEE_TARGET_REQUIRED","LIVE_ADMIN_VERIFICATION_FAILED"]);
  return codes.has(error?.message) ? error.message : "LIVE_CHANNEL_OPERATION_FAILED";
}

// Legacy RPC name. Proves the authenticated actor's shared-workspace access;
// credentialOwnerId is preserved storage lineage, NOT the acting administrator.
// Never infer either identity from metadata aliases or substitute a service role.
async function readCredentialAccessProof(userClient, credential, expectedUserId) {
  const { data: proof, error } = await userClient.rpc("sellerpilot_verify_channel_credential_owner_v1", {
    p_credential_id: credential.id, p_channel: credential.channel, p_environment: credential.environment,
  });
  if (error) throw new Error("LIVE_CREDENTIAL_OWNER_PROOF_UNAVAILABLE");
  const keys = ["actorId", "authorizationModel", "channel", "contractVersion", "credentialId", "credentialOwnerId", "credentialVersion", "environment", "expiresAt"];
  if (!proof || typeof proof !== "object" || Array.isArray(proof)
      || JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify(keys)
      || proof.contractVersion !== 1 || typeof proof.credentialId !== "string" || !UUID.test(proof.credentialId) || proof.credentialId !== credential.id
      || proof.authorizationModel !== "shared_admin_workspace"
      || proof.actorId !== expectedUserId || !UUID.test(proof.actorId)
      || typeof proof.credentialOwnerId !== "string" || !UUID.test(proof.credentialOwnerId)
      || proof.channel !== credential.channel
      || proof.environment !== credential.environment
      || !Number.isSafeInteger(proof.credentialVersion) || proof.credentialVersion < 1
      || proof.credentialVersion !== credential.version
      || proof.expiresAt !== credential.expires_at
      || (proof.expiresAt !== null && (typeof proof.expiresAt !== "string"
        || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.now()))) {
    throw new Error("LIVE_CREDENTIAL_OWNER_PROOF_INVALID");
  }
  return proof;
}

// Legacy export name: authorizes the existing actor, preserving a separate
// credential lineage owner. Never creates, changes or substitutes an account.
export async function authorizeLiveChannelOwner({ env = process.env, createClientImpl = createClient, timeoutMs = 30_000 } = {}) {
  validateLiveDestinations(env);
  if (env.LIVE_SHOPEE_GLOBAL_TEST_PRODUCT_ID) throw new Error("LIVE_DISABLED_TEST_MODE");
  const accessToken = env.LIVE_ADMIN_ACCESS_TOKEN?.trim();
  const expectedUserId = env.LIVE_ADMIN_USER_ID?.trim();
  if (!accessToken) throw new Error("LIVE_ADMIN_ACCESS_TOKEN_REQUIRED");
  if (!expectedUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedUserId)) throw new Error("LIVE_ADMIN_USER_ID_REQUIRED");
  const channel = env.LIVE_CHANNEL?.trim();
  if (!channel || !env.LIVE_OPERATION?.trim()) throw new Error("LIVE_CHANNEL_AND_OPERATION_REQUIRED");
  let keys;
  try { keys = JSON.parse(env.SUPABASE_KEYS_JSON || "[]"); } catch { throw new Error("LIVE_SUPABASE_KEYS_INVALID"); }
  if (!Array.isArray(keys)) throw new Error("LIVE_SUPABASE_KEYS_INVALID");
  const publishableKey = keys.find((item) => item?.type === "publishable")?.api_key
    || keys.find((item) => item?.type === "legacy" && item?.name === "anon")?.api_key;
  if (!publishableKey) throw new Error("LIVE_SUPABASE_PUBLISHABLE_KEY_REQUIRED");
  const projectRef = env.SUPABASE_PROJECT_REF?.trim() || "sqaoqucxakebqkiygdxb";
  if (!/^[a-z0-9]+$/.test(projectRef)) throw new Error("LIVE_SUPABASE_PROJECT_INVALID");
  const controller = new AbortController();
  const limitMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(30_000, timeoutMs)) : 30_000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT")); }, limitMs);
  });
  const verify = async () => {
    const userClient = createClientImpl(`https://${projectRef}.supabase.co`, publishableKey, {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
        fetch: (input, init = {}) => fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal }),
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await userClient.auth.getUser(accessToken);
    if (controller.signal.aborted) throw new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT");
    if (error || !data?.user?.id) throw new Error("LIVE_ADMIN_SESSION_INVALID");
    if (data.user.id !== expectedUserId) throw new Error("LIVE_ADMIN_OWNER_MISMATCH");
    const admin = await userClient.rpc("sellerpilot_is_admin");
    if (controller.signal.aborted) throw new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT");
    if (admin.error || admin.data !== true) throw new Error("LIVE_ADMIN_ACCESS_DENIED");
    const listed = await userClient.rpc("sellerpilot_list_credentials");
    if (controller.signal.aborted) throw new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT");
    if (listed.error || !Array.isArray(listed.data)) throw new Error("LIVE_CREDENTIAL_METADATA_UNAVAILABLE");
    const environment = env.LIVE_ENVIRONMENT?.trim() || "production";
    if (!["production", "sandbox"].includes(environment)) throw new Error("LIVE_ENVIRONMENT_INVALID");
    const matches = listed.data.filter((item) => item?.channel === channel && item.status === "active" && item.environment === environment
      && (!env.LIVE_CREDENTIAL_ID || item.id === env.LIVE_CREDENTIAL_ID.trim()));
    if (matches.length !== 1 || !matches[0].id) throw new Error("LIVE_ACTIVE_CREDENTIAL_NOT_UNIQUE");
    const credential = matches[0];
    const proof = await readCredentialAccessProof(userClient, credential, expectedUserId);
    if (controller.signal.aborted) throw new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT");
    return { accessToken, credential, proof };
  };
  try { return await Promise.race([verify(), timeout]); }
  catch (error) {
    const code = fixedFailure(error);
    throw new Error(code);
  } finally { clearTimeout(timer); controller.abort(); }
}

async function main() {
validateLiveDestinations(process.env);
if (process.env.LIVE_SHOPEE_GLOBAL_TEST_PRODUCT_ID) throw new Error("LIVE_DISABLED_TEST_MODE");
if (!process.env.LIVE_ADMIN_ACCESS_TOKEN?.trim()) throw new Error("LIVE_ADMIN_ACCESS_TOKEN_REQUIRED");
if (!process.env.LIVE_ADMIN_USER_ID?.trim()) throw new Error("LIVE_ADMIN_USER_ID_REQUIRED");
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || "sqaoqucxakebqkiygdxb";
const siteUrl = (process.env.SELLERPILOT_URL?.trim() || "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const channel = process.env.LIVE_CHANNEL?.trim();
const operation = process.env.LIVE_OPERATION?.trim();
let argumentsValue;
try { argumentsValue = JSON.parse(process.env.LIVE_OPERATION_ARGUMENTS || "{}"); } catch { throw new Error("LIVE_ARGUMENTS_INVALID"); }
if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) throw new Error("LIVE_ARGUMENTS_INVALID");
const idempotencyKey = process.env.LIVE_IDEMPOTENCY_KEY?.trim();
if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 160) throw new Error("LIVE_IDEMPOTENCY_KEY_REQUIRED");
// Mirror the existing route's central product/listing resource contract. No ID synthesis.
const listingBound = ["listing.update","listing.stop","listing.activate","price.update","inventory.update"].includes(operation);
if ((operation === "listing.create" || listingBound) && !UUID.test(process.env.LIVE_PRODUCT_ID || "")) throw new Error("LIVE_RESOURCE_ID_REQUIRED");
if (listingBound && !UUID.test(process.env.LIVE_RESOURCE_LISTING_ID || "")) throw new Error("LIVE_RESOURCE_ID_REQUIRED");
if (["shipment.acknowledge","shipment.confirm"].includes(operation) && !UUID.test(process.env.LIVE_ORDER_ID || "")) throw new Error("LIVE_RESOURCE_ID_REQUIRED");
if (operation === "listing.create" && (!/^[A-Z]{3}$/.test(process.env.LIVE_CURRENCY || "") || !process.env.LIVE_PRICE?.trim() || !Number.isFinite(Number(process.env.LIVE_PRICE)) || Number(process.env.LIVE_PRICE) < 0)) throw new Error("LIVE_COMMERCE_VALUES_REQUIRED");
let keys;
try { keys = JSON.parse(process.env.SUPABASE_KEYS_JSON || "[]"); } catch { throw new Error("LIVE_SUPABASE_KEYS_INVALID"); }
if (!Array.isArray(keys)) throw new Error("LIVE_SUPABASE_KEYS_INVALID");
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
  const actualTargetId = targetType === "shop" ? projected.shop_id : projected.merchant_id;
  if (!requestedId || String(actualTargetId ?? "") !== requestedId) throw new Error("LIVE_EXPLICIT_SHOPEE_TARGET_REQUIRED");
  const accessToken = typeof projected?.access_token === "string" ? projected.access_token.trim() : "";
  const expiresAt = Date.parse(String(projected?.access_token_expires_at ?? ""));
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    throw new Error("Direct QA reads never rotate OAuth tokens. Run the channel gateway diagnostic first, then retry.");
  }
  return projected;
}

const supabaseUrl = `https://${projectRef}.supabase.co`;
const verificationDeadline = Date.now() + 30_000;
const remainingVerificationMs = () => {
  const remaining = verificationDeadline - Date.now();
  if (remaining <= 0) throw new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT");
  return remaining;
};
const { accessToken, credential, proof } = await authorizeLiveChannelOwner({ timeoutMs: remainingVerificationMs() });
// Privileged decrypt access is created only after existing-actor/admin approval.
// Downstream resource handlers retain the credential's original lineage owner.
const decryptController = new AbortController();
const service = createClient(supabaseUrl, secretKey, {
  global: { fetch: (input, init = {}) => fetch(input, { ...init, redirect: "error",
    signal: init.signal ? AbortSignal.any([decryptController.signal, init.signal]) : decryptController.signal }) },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
async function decryptProvenCredential() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      decryptController.abort();
      reject(new Error("LIVE_ADMIN_VERIFICATION_TIMEOUT"));
    }, remainingVerificationMs());
  });
  try {
  const { data, error } = await Promise.race([
    service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id }), timeout,
  ]);
  if (error) throw new Error("LIVE_CHANNEL_OPERATION_FAILED");
  const verified = await authorizeLiveChannelOwner({ env: { ...process.env, LIVE_CREDENTIAL_ID: credential.id }, timeoutMs: remainingVerificationMs() });
  const after = verified.proof;
  if (after.credentialId !== proof.credentialId || after.actorId !== proof.actorId
      || after.authorizationModel !== proof.authorizationModel
      || after.credentialOwnerId !== proof.credentialOwnerId
      || after.credentialVersion !== proof.credentialVersion || after.expiresAt !== proof.expiresAt
      || after.channel !== proof.channel || after.environment !== proof.environment) {
    throw new Error("LIVE_CREDENTIAL_OWNER_PROOF_CHANGED");
  }
  return data;
  } finally { clearTimeout(timer); decryptController.abort(); }
}
if (process.env.LIVE_TARGET_DIAGNOSTICS === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-targets?channel=${encodeURIComponent(channel)}`, {
    redirect: "error",
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  emitSafe(JSON.stringify({ status: response.status, targets: result.targets ?? [], message: result.message ?? null }, null, 2));
  if (!response.ok) process.exitCode = 1;
  return;
}
if (process.env.LIVE_LAZADA_START_OAUTH === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-credentials/lazada/authorize`, {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ credentialId: credential.id, environment: credential.environment, secretPayload: {}, startOAuth: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  emitSafe(JSON.stringify({ status: response.status, ...result }, null, 2));
  if (!response.ok) process.exitCode = 1;
  return;
}
if (process.env.LIVE_SHOPEE_START_OAUTH === "true") {
  const response = await fetch(`${siteUrl}/api/admin/channel-credentials/shopee/authorize`, {
    method: "POST",
    redirect: "error",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      credentialId: credential.id,
      environment: credential.environment,
      secretPayload: {},
      startOAuth: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
  emitSafe(JSON.stringify({
    status: response.status,
    authorizationUrl: typeof result.authorizationUrl === "string" ? result.authorizationUrl : null,
    message: result.message ?? null,
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
  return;
}
if (process.env.LIVE_SHOPEE_ITEM_ID) {
  const secretPayload = await decryptProvenCredential();
  const shopId = process.env.LIVE_TARGET_ID?.trim();
  if (!shopId) throw new Error("LIVE_EXPLICIT_SHOPEE_TARGET_REQUIRED");
  const readPayload = liveShopeeReadPayload(secretPayload, "shop", shopId);
  const remote = await shopeeRequest({
    payload: readPayload,
    environment: credential.environment === "sandbox" ? "sandbox" : "production",
    method: "GET",
    path: "/api/v2/product/get_item_base_info",
    query: new URLSearchParams({ item_id_list: process.env.LIVE_SHOPEE_ITEM_ID }),
  });
  emitSafe(JSON.stringify({ status: remote.response.status, data: remote.data }, null, 2));
  return;
}
if (process.env.LIVE_SHOPEE_GLOBAL_RELATION_ID) {
  const secretPayload = await decryptProvenCredential();
  const merchantId = process.env.LIVE_TARGET_ID?.trim();
  if (!merchantId) throw new Error("LIVE_EXPLICIT_SHOPEE_TARGET_REQUIRED");
  const readPayload = liveShopeeReadPayload(secretPayload, "merchant", merchantId);
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
  emitSafe(JSON.stringify(results, null, 2));
  return;
}
if (process.env.LIVE_EXCHANGE_SHOPEE_CODE) {
  throw new Error("Direct OAuth code exchange is disabled. Complete Shopee OAuth through the SellerPilot dashboard.");
}
if (process.env.LIVE_BOOTSTRAP_SHOPEE_MERCHANT === "true") {
  throw new Error("Direct merchant token bootstrap is disabled. Use the claim-fenced channel gateway flow.");
}
if (process.env.LIVE_CREDENTIAL_DIAGNOSTICS === "true") {
  const secretPayload = await decryptProvenCredential();
  const targets = Array.isArray(secretPayload?.shopee_targets) ? secretPayload.shopee_targets : [];
  emitSafe(JSON.stringify({
    credentialId: credential.id,
    channel,
    hasMainAccountId: Boolean(secretPayload?.main_account_id),
    mainAccountId: secretPayload?.main_account_id ? String(secretPayload.main_account_id) : "",
    shopIds: Array.isArray(secretPayload?.shop_ids) ? secretPayload.shop_ids.map(String) : [],
    merchantIds: Array.isArray(secretPayload?.merchant_ids) ? secretPayload.merchant_ids.map(String) : [],
    targets: targets.map((target) => ({ type: target?.type, id: String(target?.id ?? ""), hasAccessToken: Boolean(target?.access_token), hasRefreshToken: Boolean(target?.refresh_token) })),
  }, null, 2));
  return;
}

const request = {
  credentialId: credential.id,
  channel,
  operation,
  idempotencyKey,
  confirmWrite: process.env.LIVE_CONFIRM_WRITE === "true",
  arguments: argumentsValue,
  ...(process.env.LIVE_RESOURCE_LISTING_ID ? { resourceListingId: process.env.LIVE_RESOURCE_LISTING_ID } : {}),
  ...(process.env.LIVE_ORDER_ID ? { orderId: process.env.LIVE_ORDER_ID } : {}),
  ...(process.env.LIVE_PRODUCT_ID ? { productId: process.env.LIVE_PRODUCT_ID } : {}),
  ...(process.env.LIVE_MARKET ? { market: process.env.LIVE_MARKET } : {}),
  ...(process.env.LIVE_TARGET_ID ? { targetId: process.env.LIVE_TARGET_ID } : {}),
  ...(process.env.LIVE_CURRENCY ? { currency: process.env.LIVE_CURRENCY } : {}),
  ...(process.env.LIVE_PRICE ? { price: Number(process.env.LIVE_PRICE) } : {}),
};
const response = await fetch(`${siteUrl}/api/admin/channel-operations`, {
  method: "POST",
  redirect: "error",
  headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(70_000),
});
const result = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
emitSafe(JSON.stringify({ httpStatus: response.status, response: result }, null, 2));
if (!response.ok) process.exitCode = 1;

}

try { await main(); } catch (error) {
  console.error(JSON.stringify({ ok: false, code: fixedFailure(error) }));
  process.exitCode = 1;
}
