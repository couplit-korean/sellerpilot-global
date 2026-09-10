import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  readEbayPaymentDisputesPage,
  readEbayResolutionCasesPage,
} from "../lib/channels/cs/ebay/cases-disputes.ts";
import { ebayVerifiedMessageAccountIdentifiers } from "../lib/channels/ebay-message-pages.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const execute = process.argv.includes("--execute-get-only");

if (!execute) {
  console.log(JSON.stringify({
    contract: "sellerpilot_ebay_case_dispute_get_only_v1",
    mode: "dry_run",
    providerMethods: ["GET"],
    reads: ["payment_dispute_summary", "casemanagement/search in <=31-day windows"],
    forbidden: ["credential refresh", "provider mutation", "production database write", "raw customer output"],
    executeWith: "node --import tsx scripts/cs-ebay-cases-disputes-get-only.mjs --execute-get-only",
  }));
  process.exit(0);
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

function text(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof value[key] === "string" ? value[key].trim() : "";
}

async function serviceRoleFromManagement(accessToken) {
  if (!accessToken) return "";
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return "";
  const keys = await response.json().catch(() => null);
  if (!Array.isArray(keys)) return "";
  const service = keys.find(item => item && (item.name === "service_role" || item.id === "service_role"));
  return text(service, "api_key");
}

async function vaultedCredential() {
  const managementToken = keychainSecret("Supabase CLI", "supabase");
  const serviceRole = String(process.env.SUPABASE_SECRET_KEY ?? "").trim()
    || await serviceRoleFromManagement(managementToken);
  if (!serviceRole || !managementToken) throw new Error("EBAY_VAULT_ACCESS_UNAVAILABLE");
  const query = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementToken}`, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      query: "select id::text as id from sellerpilot_private.channel_credentials where channel = 'ebay' and status = 'active' and environment = 'production'",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!query.ok) throw new Error(`EBAY_VAULT_METADATA_HTTP_${query.status}`);
  const body = await query.json().catch(() => null);
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  if (rows.length !== 1 || !text(rows[0], "id")) throw new Error("EBAY_ACTIVE_CREDENTIAL_NOT_UNIQUE");
  const credentialId = text(rows[0], "id");
  const service = createClient(SUPABASE_URL, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
  if (decrypted.error || !decrypted.data || Array.isArray(decrypted.data) || typeof decrypted.data !== "object") {
    throw new Error("EBAY_VAULT_DECRYPT_FAILED");
  }
  const payload = { ...decrypted.data };
  if (!text(payload, "access_token")) throw new Error("EBAY_VAULT_ACCESS_TOKEN_MISSING");
  return { credentialId, payload };
}

async function paymentDisputeSummary(payload) {
  const ids = new Set();
  let offset = 0;
  let pages = 0;
  let total = null;
  while (pages < 100) {
    const page = await readEbayPaymentDisputesPage({ payload, environment: "production", offset, limit: 200 });
    pages += 1;
    if (page.availability !== "readable") return {
      availability: page.availability, httpStatus: page.httpStatus,
      total: null, uniqueCount: null, pages,
    };
    total = page.total;
    for (const row of page.entries) ids.add(row.paymentDisputeId);
    if (page.nextOffset === null) return {
      availability: "readable", httpStatus: 200, total,
      uniqueCount: ids.size, pages,
    };
    offset = page.nextOffset;
  }
  throw new Error("EBAY_PAYMENT_DISPUTE_PAGE_LIMIT");
}

async function resolutionCaseHistory(payload, now = new Date()) {
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 18);
  const identifiers = ebayVerifiedMessageAccountIdentifiers(payload);
  const ids = new Set();
  const windows = [];
  let cursor = from;
  let totalPages = 0;
  while (cursor.getTime() < now.getTime()) {
    const end = new Date(Math.min(cursor.getTime() + 30 * 86_400_000, now.getTime()));
    let offset = 0;
    let pages = 0;
    let observed = 0;
    let declaredTotal = null;
    let availability = "readable";
    let httpStatus = 200;
    let hasContinuation = false;
    while (pages < 100) {
      const page = await readEbayResolutionCasesPage({
        payload,
        environment: "production",
        startTime: cursor.toISOString(),
        endTime: end.toISOString(),
        offset,
        limit: 200,
        verifiedSellerIdentifiers: identifiers,
      });
      pages += 1;
      totalPages += 1;
      availability = page.availability;
      httpStatus = page.httpStatus;
      if (page.availability !== "readable") {
        hasContinuation = false;
        break;
      }
      declaredTotal = page.total;
      observed += page.entries.length;
      for (const row of page.entries) ids.add(row.caseId);
      if (page.nextOffset === null) {
        hasContinuation = false;
        break;
      }
      hasContinuation = true;
      offset = page.nextOffset;
    }
    if (pages >= 100 && hasContinuation) throw new Error("EBAY_RESOLUTION_CASE_PAGE_LIMIT");
    windows.push({
      from: cursor.toISOString(), to: end.toISOString(), availability, httpStatus,
      pages, observed, declaredTotal,
    });
    if (availability !== "readable") return {
      availability, httpStatus, from: from.toISOString(), to: now.toISOString(),
      checkedWindows: windows.length, totalPages, uniqueCount: null, windows,
    };
    cursor = new Date(end.getTime() + 1);
  }
  return {
    availability: "readable", httpStatus: 200, from: from.toISOString(), to: now.toISOString(),
    checkedWindows: windows.length, totalPages, uniqueCount: ids.size, windows,
  };
}

async function safeResolutionPaginationMetadata(payload, now = new Date()) {
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 18);
  const to = new Date(Math.min(from.getTime() + 30 * 86_400_000, now.getTime()));
  const target = new URL("https://api.ebay.com/post-order/v2/casemanagement/search");
  target.search = new URLSearchParams({
    case_creation_date_range_from: from.toISOString(),
    case_creation_date_range_to: to.toISOString(),
    limit: "200",
    offset: "0",
    sort: "Descending",
  }).toString();
  const response = await fetch(target, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `IAF ${text(payload, "access_token")}`,
      "x-ebay-c-marketplace-id": text(payload, "marketplace_id") || "EBAY_US",
    },
  });
  const body = await response.json().catch(() => null);
  const pagination = body && typeof body === "object" && !Array.isArray(body)
    && body.paginationOutput && typeof body.paginationOutput === "object" && !Array.isArray(body.paginationOutput)
    ? body.paginationOutput
    : null;
  const primitive = value => typeof value === "string" || typeof value === "number" ? value : null;
  return {
    httpStatus: response.status,
    membersCount: body && typeof body === "object" && !Array.isArray(body) && Array.isArray(body.members)
      ? body.members.length : null,
    pagination: pagination ? {
      limit: primitive(pagination.limit),
      offset: primitive(pagination.offset),
      totalEntries: primitive(pagination.totalEntries),
      totalPages: primitive(pagination.totalPages),
    } : null,
    totalNumberOfCases: body && typeof body === "object" && !Array.isArray(body)
      ? primitive(body.totalNumberOfCases) : null,
  };
}

let payload;
try {
  const credential = await vaultedCredential();
  payload = credential.payload;
  const [paymentDisputes, resolutionCases] = await Promise.all([
    paymentDisputeSummary(payload),
    resolutionCaseHistory(payload),
  ]);
  console.log(JSON.stringify({
    contract: "sellerpilot_ebay_case_dispute_get_only_v1",
    mode: "executed_get_only",
    checkedAt: new Date().toISOString(),
    environment: "production",
    marketplaceId: text(payload, "marketplace_id") || "EBAY_US",
    accountBinding: "single active provider-certified credential; identifier omitted",
    paymentDisputes,
    resolutionCases,
    mutations: 0,
  }));
} catch (error) {
  const reason = error instanceof Error
      && (/^[A-Z0-9_.:-]{1,120}$/.test(error.message)
        || /^EBAY_CASE_DISPUTE_CONTRACT_INVALID:[A-Za-z0-9_.-]{1,80}$/.test(error.message))
    ? error.message
    : "EBAY_CASE_DISPUTE_GET_ONLY_FAILED";
  const diagnostics = payload && reason === "EBAY_CASE_DISPUTE_CONTRACT_INVALID:casePagination"
    ? await safeResolutionPaginationMetadata(payload).catch(() => null)
    : null;
  console.log(JSON.stringify({
    contract: "sellerpilot_ebay_case_dispute_get_only_v1",
    status: "unverified",
    reason,
    ...(diagnostics ? { safePaginationDiagnostics: diagnostics } : {}),
  }));
  process.exitCode = 2;
} finally {
  if (payload) payload.access_token = "";
}
