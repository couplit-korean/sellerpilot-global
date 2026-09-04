import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  ebayCookieCategoryId,
  readEbayTaxonomyPolicyGetOnly,
} from "../lib/channels/ebay-taxonomy-policy-get-only.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const categoryId = String(process.env.EBAY_CATEGORY_ID ?? ebayCookieCategoryId).trim();

function keychainSecret(service, account) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function textField(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

async function serviceRoleFromSupabaseManagement(accessToken) {
  if (!accessToken) return "";
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return "";
  const keys = await response.json().catch(() => null);
  if (!Array.isArray(keys)) return "";
  const service = keys.find((item) => item && (item.name === "service_role" || item.id === "service_role"));
  return textField(service, "api_key");
}

async function ebayCredentialIdFromManagement(accessToken) {
  if (!accessToken) return { error: "EBAY_VAULT_METADATA_UNREADABLE" };
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: "select id::text as id, channel, status, environment from sellerpilot_private.channel_credentials where channel = 'ebay' and status = 'active' and environment = 'production'",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return { error: `EBAY_VAULT_METADATA_UNREADABLE:HTTP_${response.status}` };
  const rows = await response.json().catch(() => null);
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const matches = list.filter((row) => row && row.channel === "ebay" && row.status === "active");
  if (matches.length !== 1 || !textField(matches[0], "id")) {
    return { error: "EBAY_VAULT_ACTIVE_CREDENTIAL_NOT_UNIQUE" };
  }
  return { credentialId: textField(matches[0], "id") };
}

async function vaultedEbayPayload(serviceRoleKey, accessToken) {
  if (!serviceRoleKey) return null;
  const listed = await ebayCredentialIdFromManagement(accessToken);
  if (listed.error || !listed.credentialId) return { error: listed.error || "EBAY_VAULT_METADATA_UNREADABLE" };
  const service = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: listed.credentialId });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object") {
    return { error: "EBAY_VAULT_DECRYPT_FAILED" };
  }
  const ebayAccessToken = textField(decrypted.data, "access_token");
  if (!ebayAccessToken) {
    return { error: "EBAY_VAULT_ACCESS_TOKEN_MISSING" };
  }
  const marketplaceId = textField(decrypted.data, "marketplace_id") || "EBAY_US";
  return {
    credentialId: listed.credentialId,
    payload: {
      access_token: ebayAccessToken,
      marketplace_id: marketplaceId,
    },
  };
}

if (categoryId !== ebayCookieCategoryId) {
  console.log(JSON.stringify({
    blocked: "EBAY_GET_ONLY_COOKIE_CATEGORY_REQUIRED",
    expectedCategoryId: ebayCookieCategoryId,
  }));
  process.exit(2);
}

let payload = null;
let credentialSource = null;
let credentialId = null;

const envServiceRole = String(process.env.SUPABASE_SECRET_KEY ?? "").trim();
const managementToken = keychainSecret("Supabase CLI", "supabase");
const serviceRole = envServiceRole || await serviceRoleFromSupabaseManagement(managementToken);
const vault = await vaultedEbayPayload(serviceRole, managementToken);
if (vault?.payload) {
  payload = vault.payload;
  credentialSource = envServiceRole ? "supabase_secret_env" : "vault_via_supabase_cli_keychain";
  credentialId = vault.credentialId;
} else if (vault?.error) {
  console.log(JSON.stringify({
    blocked: vault.error,
    hint: "Decrypt the already-vaulted eBay access_token in-process. Do not print it. Do not refresh, PUT inventory, POST offer, or use live-channel-operation.mjs / gateway:worker:once.",
  }));
  process.exit(2);
}

if (!payload) {
  console.log(JSON.stringify({
    blocked: "EBAY_CREDENTIALS_UNAVAILABLE_WITHOUT_EXPOSURE",
    bridge: [
      "Prefer already-vaulted eBay access_token. Do not print tokens.",
      "In-process: SUPABASE_SECRET_KEY in env, or Keychain svce='Supabase CLI' acct='supabase' for Management API service_role, then sellerpilot_decrypt_credential.",
      "Then: node --import tsx scripts/ebay-taxonomy-policy-get-only.mjs",
      "Do not refresh OAuth, PUT inventory, POST offer, or enqueue a listing create.",
    ],
  }));
  process.exit(2);
}

try {
  const result = await readEbayTaxonomyPolicyGetOnly({
    payload,
    categoryId,
    environment: "production",
    brandProbes: ["Lotte", "LOTTE", "Lotte Wellfood", "Lotte Well Food", "Lotsand", "Pasteur", "Unbranded"],
    productProbes: ["Cookies", "Cookie", "Biscuits", "Biscuit", "Snack", "Snacks", "Sandwich Cookie", "Sandwich Cookies", "Chips"],
  });
  console.log(JSON.stringify({
    contract: "ebay_taxonomy_policy_get_only_v1",
    credentialSource,
    credentialId,
    marketplaceId: result.marketplaceId,
    categoryId: result.categoryId,
    categoryTreeId: result.categoryTreeId,
    treeHttpStatus: result.treeHttpStatus,
    aspectsHttpStatus: result.aspectsHttpStatus,
    aspectCount: result.aspectCount,
    requiredAspectNames: result.requiredAspectNames,
    brandAspect: result.brandAspect,
    productAspect: result.productAspect,
    brandProbeHits: result.brandProbeHits,
    productProbeHits: result.productProbeHits,
    fulfillmentPolicy: result.fulfillmentPolicy,
    paymentPolicy: result.paymentPolicy,
    returnPolicy: result.returnPolicy,
    unverifiedReason: result.unverifiedReason ?? null,
  }));
} finally {
  if (payload) payload.access_token = "";
}
