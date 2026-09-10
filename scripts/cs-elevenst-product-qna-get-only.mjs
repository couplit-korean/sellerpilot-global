import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { executeChannelOperation } from "../lib/channels/operations.ts";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const SELLER_ID = "couplit";
const SELLER_NAME = "커플릿";
const STATUSES = ["00", "01", "02"];
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
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
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
  if (end < start || end - start > 6 * DAY_MS) {
    throw new Error("ELEVENST_QNA_SEVEN_DAY_SCOPE_REQUIRED");
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
                     seller_account_key_source, seller_account_verified_at, expires_at,
                     last_check_status, last_checked_at
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
  if (rows.length !== 1 || !text(rows[0]?.id)) {
    throw new Error("ELEVENST_ACTIVE_CREDENTIAL_NOT_UNIQUE");
  }
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

function xmlValue(xml, tags) {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      `<(?:[\\w.-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
      "i",
    ).exec(xml);
    const decoded = match?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
      .replace(/<[^>]*>/gu, " ")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&amp;/gu, "&")
      .replace(/&quot;/gu, "\"")
      .replace(/&#39;/gu, "'");
    const value = decoded
      ? stripControlCharacters(decoded)
      .replace(/\s+/gu, " ")
      .trim()
      : "";
    if (value) return value;
  }
  return "";
}

async function safeProviderDiagnostic(response) {
  const bytes = await response.arrayBuffer();
  const contentType = text(response.headers.get("content-type")).toLowerCase();
  const xml = new TextDecoder(/charset\s*=\s*["']?utf-?8/u.test(contentType) ? "utf-8" : "euc-kr").decode(bytes);
  const root = /^(?:\s*<\?xml[^>]*>\s*)?<((?:[\w.-]+:)?[A-Za-z_][\w.:-]*)\b/u.exec(xml)?.[1] ?? "";
  const resultCode = xmlValue(xml, ["result_code", "resultCode", "ResultCode", "ErrorCode"]);
  const resultText = resultCode
    ? xmlValue(xml, ["result_text", "resultText", "resultMessage", "ResultMessage", "ErrorMessage", "message", "AuthMessage"])
    : "";
  return {
    documentRoot: root.slice(0, 80) || null,
    bodyBytes: bytes.byteLength,
    bodySha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    resultCode: resultCode.slice(0, 80) || null,
    resultText: resultText.slice(0, 160) || null,
  };
}

function safeWindowSummary(status, operation, normalized, diagnostic) {
  const step = operation.steps.find((value) => value.name === "inquiries");
  const rows = Array.isArray(step?.data?.productQnas) ? step.data.productQnas : [];
  const boardIds = rows.map((row) => text(row?.brdInfoNo)).filter(Boolean);
  const productIds = rows.map((row) => text(row?.brdInfoClfNo)).filter(Boolean);
  const answeredRows = rows.filter((row) => text(row?.answerYn).toUpperCase() === "Y").length;
  const unansweredRows = rows.filter((row) => text(row?.answerYn).toUpperCase() === "N").length;
  return {
    answerStatus: status,
    httpStatus: step?.status ?? null,
    accepted: operation.ok === true && step?.ok === true,
    resultCode: text(step?.data?.resultCode) || null,
    resultMessage: text(step?.data?.resultMessage).slice(0, 160) || null,
    providerDiagnostic: diagnostic,
    providerRows: rows.length,
    uniqueBoards: new Set(boardIds).size,
    uniqueProducts: new Set(productIds).size,
    answeredRows,
    unansweredRows,
    normalizedEvents: normalized.length,
    duplicateProviderRows: rows.length - new Set(boardIds).size,
    customerContentLogged: false,
    boardIds,
  };
}

function statusPartitionCheck(summaries) {
  const all = new Set(summaries.find((value) => value.answerStatus === "00")?.boardIds ?? []);
  const answered = new Set(summaries.find((value) => value.answerStatus === "01")?.boardIds ?? []);
  const unanswered = new Set(summaries.find((value) => value.answerStatus === "02")?.boardIds ?? []);
  const union = new Set([...answered, ...unanswered]);
  return {
    allEqualsAnsweredPlusUnanswered: all.size === union.size && [...all].every((id) => union.has(id)),
    answeredUnansweredDisjoint: [...answered].every((id) => !unanswered.has(id)),
  };
}

const execute = process.argv.includes("--execute");
const scope = exactScope();
if (!execute) {
  console.log(JSON.stringify({
    contract: "sellerpilot-elevenst-product-qna-get-only/1",
    mode: "dry-run",
    scope: { ...scope, statuses: STATUSES },
    providerRequestsPlanned: 3,
    providerRequestsPerformed: 0,
    providerMutationPerformed: false,
  }));
  process.exit(0);
}

const managementToken = keychainSecret("Supabase CLI", "supabase");
let serviceRole = text(process.env.SUPABASE_SECRET_KEY) || await managementServiceRole(managementToken);
let payload = null;
let originalFetch = null;
try {
  if (!managementToken || !serviceRole) throw new Error("ELEVENST_VAULT_ACCESS_UNAVAILABLE");
  const credential = await activeCredentialMetadata(managementToken);
  const service = createClient(SUPABASE_URL, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: credential.id,
  });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object" || Array.isArray(decrypted.data)) {
    throw new Error("ELEVENST_VAULT_DECRYPT_FAILED");
  }
  const vaultFingerprint = createHash("sha256")
    .update(jsonbText(decrypted.data))
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  if (vaultFingerprint !== text(credential.fingerprint)) {
    throw new Error("ELEVENST_VAULT_FINGERPRINT_MISMATCH");
  }
  const apiKey = text(decrypted.data.api_key);
  if (!/^[A-Za-z0-9]{32}$/.test(apiKey)) throw new Error("ELEVENST_VAULT_API_KEY_SHAPE_INVALID");
  payload = { api_key: apiKey };

  const summaries = [];
  originalFetch = globalThis.fetch;
  for (const status of STATUSES) {
    let diagnostic = null;
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (String(input).startsWith("https://api.11st.co.kr/rest/prodqnaservices/prodqnalist/")
          && String(init?.method ?? "GET").toUpperCase() === "GET") {
        diagnostic = await safeProviderDiagnostic(response.clone());
      }
      return response;
    };
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "inquiries.list",
      payload,
      arguments: {
        startDate: scope.startDate,
        endDate: scope.endDate,
        answerStatus: status,
      },
      environment: "production",
    });
    const normalized = operation.ok
      ? normalizeChannelInquiries("elevenst", operation, new Date().toISOString())
      : [];
    summaries.push(safeWindowSummary(status, operation, normalized, diagnostic));
  }
  globalThis.fetch = originalFetch;
  const partition = statusPartitionCheck(summaries);
  console.log(JSON.stringify({
    contract: "sellerpilot-elevenst-product-qna-get-only/1",
    mode: "execute",
    checkedAt: new Date().toISOString(),
    scope: { ...scope, statuses: STATUSES },
    credential: {
      version: Number(credential.version),
      lineage: text(credential.seller_account_key_source),
      accountVerified: Boolean(credential.seller_account_verified_at),
      lastCheckPassed: text(credential.last_check_status) === "passed",
      fingerprintMatched: true,
      credentialIdSha256: createHash("sha256").update(text(credential.id)).digest("hex"),
    },
    results: summaries.map((summary) => Object.fromEntries(
      Object.entries(summary).filter(([key]) => key !== "boardIds"),
    )),
    partition,
    providerRequestsPerformed: summaries.length,
    providerMutationPerformed: false,
    customerContentLogged: false,
  }));
} finally {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (payload) payload.api_key = "";
  serviceRole = "";
}
