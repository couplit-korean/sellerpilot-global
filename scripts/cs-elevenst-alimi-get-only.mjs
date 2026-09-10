import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const SELLER_ID = "couplit";
const SELLER_NAME = "커플릿";
const DAY_MS = 86_400_000;

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stripControlCharacters(value) {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

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

function calendarDate(value, key) {
  if (!/^\d{8}$/.test(value)) throw new Error(`ELEVENST_${key.toUpperCase()}_INVALID`);
  const timestamp = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
  );
  if (new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "") !== value) {
    throw new Error(`ELEVENST_${key.toUpperCase()}_INVALID`);
  }
  return timestamp;
}

function exactScope() {
  const startDate = argument("start");
  const endDate = argument("end");
  const sellerId = argument("seller-id");
  const sellerName = argument("seller-name");
  const start = calendarDate(startDate, "start_date");
  const end = calendarDate(endDate, "end_date");
  if (sellerId !== SELLER_ID || sellerName !== SELLER_NAME) {
    throw new Error("ELEVENST_EXACT_SELLER_REQUIRED");
  }
  if (end < start || end - start > 29 * DAY_MS) {
    throw new Error("ELEVENST_ALIMI_THIRTY_DAY_SCOPE_REQUIRED");
  }
  return { startDate, endDate, sellerId, sellerName };
}

async function managementServiceRole(accessToken) {
  if (!accessToken) return "";
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return "";
  const keys = await response.json().catch(() => null);
  const service = Array.isArray(keys)
    ? keys.find((item) => item && (item.name === "service_role" || item.id === "service_role"))
    : null;
  return text(service?.api_key);
}

async function activeCredentialMetadata(accessToken) {
  if (!accessToken) throw new Error("ELEVENST_VAULT_MANAGEMENT_SESSION_UNAVAILABLE");
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `select id::text as id, version, fingerprint, status, environment,
                     seller_account_key_source, seller_account_verified_at,
                     last_check_status
                from sellerpilot_private.channel_credentials
               where channel = 'elevenst'
                 and environment = 'production'
                 and status = 'active'
               order by version desc
               limit 2`,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ELEVENST_CREDENTIAL_METADATA_UNREADABLE:HTTP_${response.status}`);
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  if (rows.length !== 1 || !text(rows[0]?.id)) throw new Error("ELEVENST_ACTIVE_CREDENTIAL_NOT_UNIQUE");
  const row = rows[0];
  if (row.environment !== "production" || row.status !== "active"
      || !["credential_incarnation_v1", "provider_certified_v1"].includes(text(row.seller_account_key_source))
      || !row.seller_account_verified_at || text(row.last_check_status) !== "passed") {
    throw new Error("ELEVENST_ACTIVE_CREDENTIAL_LINEAGE_UNVERIFIED");
  }
  return row;
}

function jsonbText(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort((left, right) => {
      const leftBytes = Buffer.from(left);
      const rightBytes = Buffer.from(right);
      return leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes);
    });
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${jsonbText(value[key])}`).join(", ")}}`;
  }
  throw new Error("ELEVENST_VAULT_PAYLOAD_JSON_INVALID");
}

function xmlValue(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const decoded = new RegExp(
    `<(?:[\\w.-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
    "iu",
  ).exec(xml)?.[1]
    ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/<[^>]*>/gu, " ");
  return decoded
    ? stripControlCharacters(decoded)
    .replace(/\s+/gu, " ")
    .trim()
    : "";
}

function fragments(xml, tag) {
  const matches = [];
  const expression = new RegExp(
    `<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
    "giu",
  );
  for (const match of xml.matchAll(expression)) matches.push(match[1] ?? "");
  return matches;
}

function safeDiagnostic(response, bytes) {
  const contentType = text(response.headers.get("content-type")).toLowerCase();
  const xml = new TextDecoder(/charset\s*=\s*["']?utf-?8/u.test(contentType) ? "utf-8" : "euc-kr")
    .decode(bytes);
  const rows = fragments(xml, "alimListInfo");
  const resultCode = xmlValue(xml, "result_code");
  const documentRoot = /^(?:\s*<\?xml[^>]*>\s*)?<((?:[\w.-]+:)?[A-Za-z_][\w.:-]*)\b/u.exec(xml)?.[1] ?? "";
  const providerMessage = documentRoot === "AuthMessage"
    ? xmlValue(xml, "AuthMessage").slice(0, 160) || null
    : resultCode ? xmlValue(xml, "result_text").slice(0, 160) || null : null;
  const classificationCounts = { urgentInquiry: 0, urgentNotice: 0, unknown: 0 };
  const statusCounts = Object.fromEntries(["01", "02", "03", "04", "05", "06"].map((status) => [status, 0]));
  for (const row of rows) {
    const classification = xmlValue(row, "emerNtceClfNo1");
    if (classification === "10") classificationCounts.urgentInquiry += 1;
    else if (classification === "11") classificationCounts.urgentNotice += 1;
    else classificationCounts.unknown += 1;
    const status = xmlValue(row, "emerNtceCrntCd");
    if (Object.hasOwn(statusCounts, status)) statusCounts[status] += 1;
  }
  return {
    httpStatus: response.status,
    accepted: response.status === 200 && (resultCode === "0" || (!resultCode && rows.length > 0)),
    acceptedEmpty: response.status === 200 && resultCode === "0" && rows.length === 0,
    resultCode: resultCode || null,
    providerMessage,
    providerRows: rows.length,
    classificationCounts,
    statusCounts,
    documentRoot: documentRoot.slice(0, 80) || null,
    bodyBytes: bytes.byteLength,
    bodySha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
  };
}

const execute = process.argv.includes("--execute");
const scope = exactScope();
if (!execute) {
  console.log(JSON.stringify({
    contract: "sellerpilot-elevenst-alimi-get-only/1",
    mode: "dry-run",
    scope,
    officialOptionalFilters: { status: null, orderNo: null },
    providerRequestsPlanned: 1,
    providerRequestsPerformed: 0,
    providerMutationPerformed: false,
  }));
  process.exit(0);
}

const managementToken = keychainSecret("Supabase CLI", "supabase");
let serviceRole = text(process.env.SUPABASE_SECRET_KEY) || await managementServiceRole(managementToken);
let apiKey = "";
try {
  if (!managementToken || !serviceRole) throw new Error("ELEVENST_VAULT_ACCESS_UNAVAILABLE");
  const credential = await activeCredentialMetadata(managementToken);
  const service = createClient(SUPABASE_URL, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credential.id });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object" || Array.isArray(decrypted.data)) {
    throw new Error("ELEVENST_VAULT_DECRYPT_FAILED");
  }
  const fingerprint = createHash("sha256").update(jsonbText(decrypted.data)).digest("hex").slice(0, 12).toUpperCase();
  if (fingerprint !== text(credential.fingerprint)) throw new Error("ELEVENST_VAULT_FINGERPRINT_MISMATCH");
  apiKey = text(decrypted.data.api_key);
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey)) throw new Error("ELEVENST_VAULT_API_KEY_SHAPE_INVALID");

  const url = `https://api.11st.co.kr/rest/alimi/getalimilist/${scope.startDate}/${scope.endDate}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      openapikey: apiKey,
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "SellerPilot-11st-Alimi-ReadOnly/1.0",
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const bytes = await response.arrayBuffer();
  console.log(JSON.stringify({
    contract: "sellerpilot-elevenst-alimi-get-only/1",
    mode: "execute",
    checkedAt: new Date().toISOString(),
    scope,
    officialOptionalFilters: { status: null, orderNo: null },
    credential: {
      version: Number(credential.version),
      lineage: text(credential.seller_account_key_source),
      accountVerified: Boolean(credential.seller_account_verified_at),
      lastCheckPassed: text(credential.last_check_status) === "passed",
      fingerprintMatched: true,
      credentialIdSha256: createHash("sha256").update(text(credential.id)).digest("hex"),
    },
    result: safeDiagnostic(response, bytes),
    providerRequestsPerformed: 1,
    providerMutationPerformed: false,
    customerContentLogged: false,
  }));
} finally {
  apiKey = "";
  serviceRole = "";
}
