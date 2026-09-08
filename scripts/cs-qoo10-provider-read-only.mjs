import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { qoo10Request, runWithProviderReadOnlyTransport } from "../lib/channels/protocols.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const EXPECTED_QSM_SELLER_ID = "zrlawjdgns";
const STATUSES = ["S1", "S2", "S3"];
const DATE_RE = /^\d{8}(?:\d{6})?$/u;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function keychainToken() {
  try {
    return execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textField(value, ...keys) {
  const root = record(value);
  for (const key of keys) {
    const candidate = root[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const text = String(candidate).trim();
      if (text) return text;
    }
  }
  return "";
}

function safeDigest(value) {
  return createHash("sha256").update(`sellerpilot-qoo10-cs-id-v1:${value}`).digest("hex");
}

async function managementJson(token, path, init = {}) {
  const response = await fetch(`https://api.supabase.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`SUPABASE_MANAGEMENT_HTTP_${response.status}`);
  return body;
}

async function activeCredential(token) {
  const body = await managementJson(token, `/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    body: JSON.stringify({
      query: `select id::text as id, channel, environment, status, version,
        expires_at::text as expires_at, last_check_status,
        last_checked_at::text as last_checked_at
      from sellerpilot_private.channel_credentials
      where channel='qoo10' and environment='production' and status='active'`,
    }),
  });
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  if (rows.length !== 1 || !textField(rows[0], "id")) {
    throw new Error("QOO10_ACTIVE_CREDENTIAL_NOT_UNIQUE");
  }
  return rows[0];
}

async function serviceRoleKey(token) {
  const keys = await managementJson(token, `/v1/projects/${PROJECT_REF}/api-keys`);
  const row = Array.isArray(keys)
    ? keys.find((item) => item && (item.name === "service_role" || item.id === "service_role"))
    : null;
  const value = textField(row, "api_key");
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_UNAVAILABLE");
  return value;
}

async function qoo10Payload(serviceRole, credentialId) {
  const service = createClient(SUPABASE_URL, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object" || Array.isArray(decrypted.data)) {
    throw new Error("QOO10_VAULT_DECRYPT_FAILED");
  }
  const apiKey = textField(decrypted.data, "api_key");
  if (!apiKey) throw new Error("QOO10_API_KEY_MISSING");
  return {
    payload: { api_key: apiKey },
    fields: Object.keys(decrypted.data).sort(),
    sellerIdMatchesQsm: textField(decrypted.data, "seller_id") === EXPECTED_QSM_SELLER_ID,
  };
}

function responseRows(data, envelopeKey) {
  const result = record(data).ResultObject;
  if (Array.isArray(result)) return { rows: result, envelope: "array" };
  const wrapped = record(result)[envelopeKey];
  if (Array.isArray(wrapped)) return { rows: wrapped, envelope: envelopeKey };
  throw new Error(`QOO10_RESULT_ROWS_INVALID:${envelopeKey}`);
}

function inquirySummary(status, data) {
  const { rows, envelope } = responseRows(data, "InquiryInfo");
  const typeCounts = {};
  const questions = new Set();
  const sequences = new Set();
  const pairs = new Set();
  const sequencesByQuestion = new Map();
  for (const row of rows) {
    const inquiryType = textField(row, "INQ_TYPE", "inq_type") || "UNKNOWN";
    const questionNo = textField(row, "QUESTION_NO", "question_no");
    const sequenceNo = textField(row, "SEQ_NO", "seq_no");
    typeCounts[inquiryType] = (typeCounts[inquiryType] ?? 0) + 1;
    if (questionNo) questions.add(questionNo);
    if (sequenceNo) sequences.add(sequenceNo);
    if (questionNo && sequenceNo) {
      pairs.add(`${questionNo}:${sequenceNo}`);
      const values = sequencesByQuestion.get(questionNo) ?? new Set();
      values.add(sequenceNo);
      sequencesByQuestion.set(questionNo, values);
    }
  }
  const multiSequenceThreads = [...sequencesByQuestion.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([questionNo, values]) => ({
      questionDigest: safeDigest(questionNo),
      sequenceCount: values.size,
      sequenceDigests: [...values].sort().map(safeDigest),
    }));
  const root = record(data);
  return {
    status,
    resultCode: root.ResultCode ?? null,
    resultMessageCode: textField(root, "ResultMsg", "ResultMessage", "Message") || null,
    envelope,
    rows: rows.length,
    typeCounts,
    uniqueQuestions: questions.size,
    uniqueSequences: sequences.size,
    uniquePairs: pairs.size,
    multiSequenceThreads,
    exposesTotal: Object.keys(root).some((key) => /total|count/i.test(key)),
    exposesPagination: Object.keys(root).some((key) => /page|cursor|next/i.test(key)),
  };
}

function claimSummary(data) {
  const { rows, envelope } = responseRows(data, "ClaimInfo");
  const statusCounts = {};
  const linkedOrders = new Set();
  let rowsWithRequestDate = 0;
  let rowsWithOrder = 0;
  for (const row of rows) {
    const claimStatus = textField(row, "claimStatus", "ClaimStatus") || "UNKNOWN";
    const requestDate = textField(row, "requestDate", "RequestDate");
    const orderNo = textField(row, "orderNo", "OrderNo");
    statusCounts[claimStatus] = (statusCounts[claimStatus] ?? 0) + 1;
    if (requestDate) rowsWithRequestDate += 1;
    if (orderNo) {
      rowsWithOrder += 1;
      linkedOrders.add(orderNo);
    }
  }
  const root = record(data);
  return {
    resultCode: root.ResultCode ?? null,
    resultMessageCode: textField(root, "ResultMsg", "ResultMessage", "Message") || null,
    envelope,
    rows: rows.length,
    statusCounts,
    rowsWithRequestDate,
    rowsWithOrder,
    uniqueOrderDigests: [...linkedOrders].sort().map(safeDigest),
    exposesTotal: Object.keys(root).some((key) => /total|count/i.test(key)),
    exposesPagination: Object.keys(root).some((key) => /page|cursor|next/i.test(key)),
  };
}

async function main() {
  const from = argument("from", "20260809000000");
  const to = argument("to", "20260907235959");
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error("QOO10_PROBE_DATE_INVALID");
  const token = keychainToken();
  if (!token) throw new Error("SUPABASE_MANAGEMENT_SESSION_UNAVAILABLE");
  const credential = await activeCredential(token);
  const serviceRole = await serviceRoleKey(token);
  const secret = await qoo10Payload(serviceRole, textField(credential, "id"));
  const inquiries = [];
  for (const status of STATUSES) {
    const remote = await runWithProviderReadOnlyTransport(() => qoo10Request({
      payload: secret.payload,
      service: "CSCenter",
      method: "GetInquiryMessage",
      params: { search_start_dt: from, search_end_dt: to, proc_status: status },
    }));
    inquiries.push(inquirySummary(status, remote.data));
  }
  const skipClaims = process.argv.includes("--skip-claims");
  const claimsRemote = skipClaims ? null : await runWithProviderReadOnlyTransport(() => qoo10Request({
      payload: secret.payload,
      service: "ShippingBasic",
      method: "GetClaimInfo_V3",
      params: { search_Sdate: from, search_Edate: to, search_condition: "2" },
    }));
  console.log(JSON.stringify({
    contract: "sellerpilot_qoo10_cs_provider_read_only_v1",
    checkedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    range: { from, to, timezone: "Asia/Tokyo", claimSearchCondition: "2" },
    credential: {
      version: credential.version,
      environment: credential.environment,
      status: credential.status,
      expiresAt: credential.expires_at,
      lastCheckStatus: credential.last_check_status,
      lastCheckedAt: credential.last_checked_at,
      secretFields: secret.fields,
      sellerIdMatchesQsm: secret.sellerIdMatchesQsm,
    },
    inquiries,
    claims: claimsRemote ? claimSummary(claimsRemote.data) : { skipped: true },
    rawCustomerContentPersisted: false,
    secretValuesPrinted: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    contract: "sellerpilot_qoo10_cs_provider_read_only_v1",
    status: "unverified",
    reason: error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)
      ? error.message
      : "QOO10_PROBE_FAILED",
  }));
  process.exitCode = 2;
});
