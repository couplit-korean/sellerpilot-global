import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { shopeeRequest } from "../lib/channels/protocols.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

function keychainSecret(service, account) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch { return ""; }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function serviceRole(accessToken) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) return "";
  const keys = await response.json().catch(() => null);
  const key = Array.isArray(keys)
    ? keys.find((item) => item && (item.name === "service_role" || item.id === "service_role"))
    : null;
  return text(key?.api_key);
}

async function activeCredentialId(accessToken) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ query: "select id::text id from sellerpilot_private.channel_credentials where channel='shopee' and environment='production' and status='active' order by version desc limit 2" }),
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("SHOPEE_CREDENTIAL_METADATA_UNREADABLE");
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  if (rows.length !== 1 || !text(rows[0]?.id)) throw new Error("SHOPEE_ACTIVE_CREDENTIAL_NOT_UNIQUE");
  return text(rows[0].id);
}

function commentPage(data, pageSize) {
  const response = data?.response;
  const rows = response?.item_comment_list;
  const more = response?.more;
  const cursor = text(response?.next_cursor);
  if (!response || typeof response !== "object" || Array.isArray(response)
      || !Array.isArray(rows) || rows.length > pageSize
      || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
      || ![true, false, "true", "false"].includes(more)
      || ((more === true || more === "true") && (!rows.length || !cursor))
      || ((more === false || more === "false") && cursor)) {
    throw new Error("SHOPEE_COMMENT_PAGE_INVALID");
  }
  return { count: rows.length, more: more === true || more === "true", cursor };
}

async function readShop(payload, ordinal) {
  const pageSize = 100;
  let cursor = "";
  let total = 0;
  let pages = 0;
  const seen = new Set();
  while (pages < 100) {
    const remote = await shopeeRequest({
      payload, environment: "production", method: "GET", path: "/api/v2/product/get_comment",
      query: new URLSearchParams({ cursor, page_size: String(pageSize) }),
    });
    if (remote.response.status === 401 || remote.response.status === 403) {
      return { shopOrdinal: ordinal, status: "authorization_required", pages, total: null };
    }
    if (!remote.response.ok || text(remote.data.error)) {
      return { shopOrdinal: ordinal, status: "unverified", pages, total: null };
    }
    const page = commentPage(remote.data, pageSize);
    total += page.count;
    pages += 1;
    if (!page.more) return { shopOrdinal: ordinal, status: "readable", pages, total };
    if (page.cursor === cursor || seen.has(page.cursor)) throw new Error("SHOPEE_COMMENT_CURSOR_REPEATED");
    seen.add(page.cursor);
    cursor = page.cursor;
  }
  return { shopOrdinal: ordinal, status: "unverified", pages, total: null };
}

const managementToken = keychainSecret("Supabase CLI", "supabase");
const secretKey = text(process.env.SUPABASE_SECRET_KEY) || await serviceRole(managementToken);
if (!managementToken || !secretKey) throw new Error("SHOPEE_VAULT_ACCESS_UNAVAILABLE");
const credentialId = await activeCredentialId(managementToken);
const service = createClient(SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object" || Array.isArray(decrypted.data)) {
  throw new Error("SHOPEE_VAULT_DECRYPT_FAILED");
}
const root = decrypted.data;
const targets = Array.isArray(root.shopee_targets)
  ? root.shopee_targets.filter((target) => target && typeof target === "object" && !Array.isArray(target) && target.type === "shop")
  : [];
const unique = new Map(targets.map((target) => [text(target.id), target]).filter(([id]) => /^[1-9]\d{0,31}$/.test(id)));
const now = Date.now();
const results = [];
let ordinal = 0;
for (const [shopId, target] of unique) {
  ordinal += 1;
  const expiresAt = Date.parse(text(target.access_token_expires_at));
  const accessToken = text(target.access_token);
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    const refreshExpiresAt = Date.parse(text(target.refresh_token_expires_at));
    const refreshReady = Boolean(
      text(root.partner_id)
      && text(root.partner_key)
      && text(target.refresh_token)
      && Number.isFinite(refreshExpiresAt)
      && refreshExpiresAt > now + 60_000,
    );
    results.push({ shopOrdinal: ordinal, status: "token_refresh_required", refreshReady, pages: 0, total: null });
    continue;
  }
  const projected = {
    ...root,
    shop_id: shopId,
    access_token: accessToken,
    refresh_token: text(target.refresh_token),
    access_token_expires_at: text(target.access_token_expires_at),
    refresh_token_expires_at: text(target.refresh_token_expires_at),
  };
  try {
    results.push(await readShop(projected, ordinal));
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_:-]{1,120}$/.test(error.message)
      ? error.message
      : "SHOPEE_COMMENT_READ_FAILED";
    results.push({ shopOrdinal: ordinal, status: "unverified", pages: 0, total: null, code });
  }
  projected.access_token = "";
  projected.refresh_token = "";
}
if (root && typeof root === "object") {
  root.access_token = "";
  root.refresh_token = "";
  root.shopee_targets = [];
}
console.log(JSON.stringify({
  contract: "shopee_comment_counts_get_only_v1",
  checkedAt: new Date().toISOString(),
  targetCount: unique.size,
  readableShops: results.filter((result) => result.status === "readable").length,
  refreshRequiredShops: results.filter((result) => result.status === "token_refresh_required").length,
  refreshReadyShops: results.filter((result) => result.status === "token_refresh_required" && result.refreshReady === true).length,
  failedShops: results.filter((result) => !["readable", "token_refresh_required"].includes(result.status)).length,
  totalComments: results.every((result) => result.status === "readable")
    ? results.reduce((sum, result) => sum + result.total, 0)
    : null,
  shops: results,
  customerContentLogged: false,
  providerMutationPerformed: false,
}));
