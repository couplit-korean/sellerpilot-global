import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  elevenstCookieSellerProductCode,
  readElevenstSellerProdcode,
} from "../lib/channels/elevenst-sellerprodcode-read.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const sellerProductCode = String(process.env.ELEVENST_SELLER_PRODUCT_CODE ?? elevenstCookieSellerProductCode).trim();

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

async function elevenstCredentialIdFromManagement(accessToken) {
  if (!accessToken) return { error: "ELEVENST_VAULT_METADATA_UNREADABLE" };
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: "select id::text as id, channel, status, environment from sellerpilot_private.channel_credentials where channel = 'elevenst' and status = 'active' and environment = 'production'",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return { error: `ELEVENST_VAULT_METADATA_UNREADABLE:HTTP_${response.status}` };
  const rows = await response.json().catch(() => null);
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const matches = list.filter((row) => row && row.channel === "elevenst" && row.status === "active");
  if (matches.length !== 1 || !textField(matches[0], "id")) {
    return { error: "ELEVENST_VAULT_ACTIVE_CREDENTIAL_NOT_UNIQUE" };
  }
  return { credentialId: textField(matches[0], "id") };
}

async function vaultedElevenstPayload(serviceRoleKey, accessToken) {
  if (!serviceRoleKey) return null;
  const listed = await elevenstCredentialIdFromManagement(accessToken);
  if (listed.error || !listed.credentialId) return { error: listed.error || "ELEVENST_VAULT_METADATA_UNREADABLE" };
  const service = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: listed.credentialId });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object") {
    return { error: "ELEVENST_VAULT_DECRYPT_FAILED" };
  }
  const apiKey = textField(decrypted.data, "api_key");
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey)) {
    return { error: "ELEVENST_VAULT_API_KEY_SHAPE_INVALID" };
  }
  return { credentialId: listed.credentialId, payload: { api_key: apiKey } };
}

if (sellerProductCode !== elevenstCookieSellerProductCode) {
  console.log(JSON.stringify({
    blocked: "ELEVENST_GET_ONLY_COOKIE_SKU_REQUIRED",
    expectedSku: elevenstCookieSellerProductCode,
  }));
  process.exit(2);
}

const envApiKey = String(process.env.ELEVENST_SELLER_API_KEY ?? "").trim();
let payload = envApiKey ? { api_key: envApiKey } : null;
let credentialSource = envApiKey ? "process_env" : null;
let credentialId = null;

if (!payload) {
  const envServiceRole = String(process.env.SUPABASE_SECRET_KEY ?? "").trim();
  const managementToken = keychainSecret("Supabase CLI", "supabase");
  const serviceRole = envServiceRole || await serviceRoleFromSupabaseManagement(managementToken);
  const vault = await vaultedElevenstPayload(serviceRole, managementToken);
  if (vault?.payload) {
    payload = vault.payload;
    credentialSource = envServiceRole ? "supabase_secret_env" : "vault_via_supabase_cli_keychain";
    credentialId = vault.credentialId;
  } else if (vault?.error) {
    console.log(JSON.stringify({
      blocked: vault.error,
      hint: "Decrypt the already-vaulted 11st key in-process. Do not print it. Do not use live-channel-operation.mjs, gateway:worker:once, seller-office conversion, or Open API key reveal.",
    }));
    process.exit(2);
  }
}

if (!payload) {
  console.log(JSON.stringify({
    blocked: "ELEVENST_CREDENTIALS_UNAVAILABLE_WITHOUT_EXPOSURE",
    bridge: [
      "Prefer already-vaulted 11st api_key. Do not reveal it in SQL, Open API 2nd-auth, or chat.",
      "In-process: SUPABASE_SECRET_KEY in env, or Keychain svce='Supabase CLI' acct='supabase' for Management API service_role, then sellerpilot_decrypt_credential.",
      "Then: node --import tsx scripts/elevenst-sellerprodcode-get-only.mjs",
      "Do not convert Astra/couplit business-buyer to seller. Email auth only if a login is required. Never POST/create or alter recon b9faa28e.",
    ],
  }));
  process.exit(2);
}

try {
  const result = await readElevenstSellerProdcode({
    payload,
    sellerProductCode,
  });
  console.log(JSON.stringify({
    contract: "elevenst_sellerprodcode_get_only_v1",
    sellerProductCode,
    credentialSource,
    credentialId,
    outcome: result.outcome,
    lookupHttpStatus: result.lookupHttpStatus,
    lookupResultCode: result.lookupResultCode,
    lookupRoot: result.lookupRoot,
    lookupBodyBytes: result.lookupBodyBytes,
    productNo: result.productNo,
    absentReason: result.absentReason ?? null,
    unverifiedReason: result.unverifiedReason ?? null,
    prodmarket: result.prodmarket,
  }));
} finally {
  payload.api_key = "";
}
