import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  elevenstCookieCreateRecoveryGetMatches,
  elevenstCookieCreateRecoveryIdentity,
} from "../lib/channels/elevenst-cookie-create-recovery.ts";
import { readElevenstSellerProdcode } from "../lib/channels/elevenst-sellerprodcode-read.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const identity = elevenstCookieCreateRecoveryIdentity;

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

const managementToken = keychainSecret("Supabase CLI", "supabase");
const serviceRole = String(process.env.SUPABASE_SECRET_KEY ?? "").trim()
  || await serviceRoleFromSupabaseManagement(managementToken);
if (!serviceRole) {
  console.log(JSON.stringify({ blocked: "ELEVENST_BIND_SERVICE_ROLE_UNAVAILABLE" }));
  process.exit(2);
}

const service = createClient(SUPABASE_URL, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const decrypted = await service.rpc("sellerpilot_decrypt_credential", {
  p_credential_id: identity.credentialId,
});
const apiKey = textField(decrypted.data, "api_key");
if (decrypted.error || !/^[A-Za-z0-9]{32}$/.test(apiKey)) {
  console.log(JSON.stringify({ blocked: "ELEVENST_BIND_VAULT_DECRYPT_FAILED" }));
  process.exit(2);
}

const payload = { api_key: apiKey };
try {
  const before = await service.rpc("sellerpilot_service_get_elevenst_cookie_create_recovery_status", {
    p_product_id: identity.productId,
  });
  if (before.error || before.data?.current !== true || before.data?.bound === true) {
    console.log(JSON.stringify({
      blocked: before.data?.bound === true
        ? "ELEVENST_BIND_ALREADY_COMPLETE"
        : "ELEVENST_BIND_PREIMAGE_NOT_CURRENT",
      current: before.data?.current === true,
      bound: before.data?.bound === true,
    }));
    process.exit(before.data?.bound === true ? 0 : 2);
  }

  const lookup = await readElevenstSellerProdcode({
    payload,
    sellerProductCode: identity.sellerSku,
  });
  if (!elevenstCookieCreateRecoveryGetMatches(lookup)) {
    console.log(JSON.stringify({
      blocked: "ELEVENST_BIND_GET_MISMATCH",
      outcome: lookup.outcome,
      productNo: lookup.productNo,
    }));
    process.exit(2);
  }

  const recorded = await service.rpc("sellerpilot_service_record_elevenst_cookie_create_observation", {
    p_product_id: identity.productId,
    p_remote_id: lookup.productNo,
    p_seller_sku: lookup.sellerProductCode,
    p_lookup_http_status: lookup.lookupHttpStatus,
    p_prodmarket_http_status: lookup.prodmarket?.httpStatus ?? 0,
    p_prodmarket_accepted: lookup.prodmarket?.accepted === true,
    p_seller_prd_cd_matched: lookup.prodmarket?.sellerProductCodeMatched === true,
    p_observed_sel_stat_cd: lookup.prodmarket?.selStatCd || null,
  });
  if (recorded.error || !recorded.data) {
    console.log(JSON.stringify({ blocked: "ELEVENST_BIND_OBSERVATION_NOT_RECORDED" }));
    process.exit(2);
  }

  const bound = await service.rpc("sellerpilot_service_bind_elevenst_cookie_create_observation", {
    p_observation_id: recorded.data,
  });
  if (bound.error || bound.data !== true) {
    console.log(JSON.stringify({ blocked: "ELEVENST_BIND_NOT_APPLIED" }));
    process.exit(2);
  }

  const after = await service.rpc("sellerpilot_service_get_elevenst_cookie_create_recovery_status", {
    p_product_id: identity.productId,
  });
  console.log(JSON.stringify({
    contract: identity.contract,
    productId: identity.productId,
    listingId: after.data?.listingId ?? null,
    remoteId: after.data?.listingRemoteId ?? null,
    sellerSku: identity.sellerSku,
    observationId: recorded.data,
    bound: after.data?.bound === true,
    current: after.data?.current === true,
    sourceJobRewritten: after.data?.sourceJobRewritten === true,
  }));
} finally {
  payload.api_key = "";
}
