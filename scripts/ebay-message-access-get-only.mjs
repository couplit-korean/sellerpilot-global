import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  probeEbayMessageAccess,
  probeEbayTradingMyMessages,
} from "../lib/channels/ebay-message-history.ts";
import { ebayTradingRequest, ebayTradingXmlEscape } from "../lib/channels/protocols.ts";
import { executeChannelOperation } from "../lib/channels/operations.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;


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
      scopes: textField(decrypted.data, "scopes"),
    },
  };
}

async function probeEbayAsqRetainedHistory(payload, now = new Date()) {
  const retainedStart = new Date(now.getTime() - 365 * 86_400_000);
  const windows = [];
  let start = retainedStart;
  while (start.getTime() <= now.getTime()) {
    const end = new Date(Math.min(start.getTime() + 30 * 86_400_000 - 1, now.getTime()));
    const body = `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><MailMessageType>AskSellerQuestion</MailMessageType><StartCreationTime>${ebayTradingXmlEscape(start.toISOString())}</StartCreationTime><EndCreationTime>${ebayTradingXmlEscape(end.toISOString())}</EndCreationTime><Pagination><EntriesPerPage>25</EntriesPerPage><PageNumber>1</PageNumber></Pagination></GetMemberMessagesRequest>`;
    const remote = await ebayTradingRequest({
      payload,
      environment: "production",
      callName: "GetMemberMessages",
      marketplaceId: textField(payload, "marketplace_id") || "EBAY_US",
      body,
    });
    const pagination = remote.data.paginationResult;
    const total = pagination && typeof pagination === "object" && !Array.isArray(pagination)
      ? pagination.totalNumberOfEntries
      : null;
    const pages = pagination && typeof pagination === "object" && !Array.isArray(pagination)
      ? pagination.totalNumberOfPages
      : null;
    if (remote.response.status !== 200 || remote.data.code !== "SUCCESS"
        || !Number.isSafeInteger(total) || total < 0
        || !Number.isSafeInteger(pages) || pages < 0) {
      return {
        status: remote.response.status === 401 || remote.response.status === 403
          ? "authorization_required"
          : "unverified",
        checkedWindows: windows.length,
        total: null,
      };
    }
    windows.push({ from: start.toISOString(), to: end.toISOString(), total });
    start = new Date(end.getTime() + 1);
  }
  return {
    status: "readable",
    checkedWindows: windows.length,
    from: retainedStart.toISOString(),
    to: now.toISOString(),
    total: windows.reduce((sum, window) => sum + window.total, 0),
    nonEmptyWindows: windows.filter((window) => window.total > 0).length,
  };
}

async function probeEbayMailboxRange(payload, start, end) {
  let argumentsValue = {
    kind: "mailbox",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    folderId: 0,
    pageNumber: 1,
    entriesPerPage: 25,
    marketplaceId: textField(payload, "marketplace_id") || "EBAY_US",
  };
  let pages = 0;
  let messages = 0;
  let asqEchoes = 0;
  let memberMessages = 0;
  let platformMessages = 0;
  let mediaMessages = 0;
  const messageKeys = [];
  while (pages < 50) {
    const result = await executeChannelOperation({
      channel: "ebay",
      operation: "inquiries.list",
      payload,
      arguments: argumentsValue,
      environment: "production",
    });
    if (!result.ok) {
      const code = String(result.steps.find((entry) => !entry.ok)?.data?.code ?? "provider_rejected");
      const header = result.steps.find((entry) => entry.name === "inquiries")?.data;
      const pagination = header?.paginationResult && typeof header.paginationResult === "object"
        && !Array.isArray(header.paginationResult) ? header.paginationResult : {};
      return {
        status: "unverified",
        pages,
        messages: null,
        reason: /^[A-Z0-9_.-]{1,80}$/i.test(code) ? code : "provider_rejected",
        observedHeaderCount: Array.isArray(header?.myMessages) ? header.myMessages.length : null,
        observedTotalPages: Number.isSafeInteger(pagination.totalNumberOfPages) ? pagination.totalNumberOfPages : null,
        observedTotalEntries: Number.isSafeInteger(pagination.totalNumberOfEntries) ? pagination.totalNumberOfEntries : null,
        messageKeys,
      };
    }
    const page = result.steps.find((entry) => entry.name === "inquiries");
    const rows = Array.isArray(page?.data?.myMessages) ? page.data.myMessages : [];
    pages += 1;
    messages += rows.length;
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw;
      const asqEcho = textField(row, "messageType") === "AskSellerQuestion"
        && Boolean(textField(row, "externalMessageId"));
      const classification = asqEcho
        ? "asq_echo"
        : row.responseEnabled === true && textField(row, "sender")
          ? "member"
          : "platform";
      const hasMedia = Array.isArray(row.media) && row.media.length > 0;
      if (classification === "asq_echo") asqEchoes += 1;
      else if (classification === "member") memberMessages += 1;
      else platformMessages += 1;
      if (hasMedia) mediaMessages += 1;
      messageKeys.push({ id: textField(row, "messageId"), classification, hasMedia });
    }
    if (!result.continuation) return {
      status: "readable",
      pages,
      messages,
      asqEchoes,
      memberMessages,
      platformMessages,
      mediaMessages,
      fullyPaginated: true,
      messageKeys,
    };
    argumentsValue = result.continuation.arguments;
  }
  return { status: "unverified", pages, messages: null, reason: "page_limit_reached", messageKeys };
}

async function probeEbayMailboxImport(payload, now = new Date()) {
  const start = new Date(now.getTime() - 6 * 86_400_000);
  const result = await probeEbayMailboxRange(payload, start, now);
  const publicResult = { ...result };
  delete publicResult.messageKeys;
  return publicResult;
}

async function probeEbayMailboxRetainedHistory(payload, now = new Date()) {
  const retainedStart = new Date(now.getTime() - 365 * 86_400_000);
  const unique = new Map();
  let checkedWindows = 0;
  let pages = 0;
  let observations = 0;
  let start = retainedStart;
  while (start.getTime() <= now.getTime()) {
    const end = new Date(Math.min(start.getTime() + 30 * 86_400_000 - 1, now.getTime()));
    const result = await probeEbayMailboxRange(payload, start, end);
    checkedWindows += 1;
    pages += result.pages;
    if (result.status !== "readable" || !result.fullyPaginated) {
      return {
        status: "unverified",
        checkedWindows,
        pages,
        messages: null,
        reason: result.reason || "mailbox_window_incomplete",
      };
    }
    for (const message of result.messageKeys) {
      observations += 1;
      if (!message.id) {
        return { status: "unverified", checkedWindows, pages, messages: null, reason: "message_identity_missing" };
      }
      const previous = unique.get(message.id);
      if (previous && (previous.classification !== message.classification || previous.hasMedia !== message.hasMedia)) {
        return { status: "unverified", checkedWindows, pages, messages: null, reason: "message_identity_conflict" };
      }
      unique.set(message.id, message);
    }
    start = new Date(end.getTime() + 1);
  }
  const messages = [...unique.values()];
  return {
    status: "readable",
    checkedWindows,
    from: retainedStart.toISOString(),
    to: now.toISOString(),
    pages,
    messages: messages.length,
    duplicateObservations: observations - messages.length,
    asqEchoes: messages.filter((message) => message.classification === "asq_echo").length,
    memberMessages: messages.filter((message) => message.classification === "member").length,
    platformMessages: messages.filter((message) => message.classification === "platform").length,
    mediaMessages: messages.filter((message) => message.hasMedia).length,
    fullyPaginated: true,
  };
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
    hint: "Decrypt the already-vaulted eBay access_token in-process. Do not print it. Existing access token only; no refresh, sends, mark-read changes, or gateway jobs.",
  }));
  process.exit(2);
}

if (!payload) {
  console.log(JSON.stringify({
    blocked: "EBAY_CREDENTIALS_UNAVAILABLE_WITHOUT_EXPOSURE",
    bridge: [
      "Prefer already-vaulted eBay access_token. Do not print tokens.",
      "In-process: SUPABASE_SECRET_KEY in env, or Keychain svce='Supabase CLI' acct='supabase' for Management API service_role, then sellerpilot_decrypt_credential.",
      "Then: node --import tsx scripts/ebay-message-access-get-only.mjs",
      "Do not refresh OAuth, send messages, update read status, or enqueue jobs.",
    ],
  }));
  process.exit(2);
}

try {
  let stage = "summary_probes";
  try {
    const [commerce, trading, asqRetainedHistory] = await Promise.all([
      probeEbayMessageAccess({ payload, environment: "production" }),
      probeEbayTradingMyMessages({ payload, environment: "production" }),
      probeEbayAsqRetainedHistory(payload),
    ]);
    stage = "mailbox_import";
    const mailboxImport = await probeEbayMailboxImport(payload);
    stage = "mailbox_retained_history";
    const mailboxRetainedHistory = await probeEbayMailboxRetainedHistory(payload);
    console.log(JSON.stringify({
      contract: "ebay_message_access_probe_v3",
      checkedAt: new Date().toISOString(),
      credentialSource,
      credentialBound: Boolean(credentialId),
      commerce,
      trading,
      asqRetainedHistory,
      mailboxImport,
      mailboxRetainedHistory,
    }));
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_.:-]{1,100}$/i.test(error.message)
      ? error.message
      : "probe_transport_or_contract_failed";
    console.log(JSON.stringify({ contract: "ebay_message_access_probe_v3", status: "unverified", stage, reason: code }));
    process.exitCode = 2;
  }
} catch {
  console.log(JSON.stringify({ contract: "ebay_message_access_probe_v3", status: "unverified", reason: "probe_transport_or_contract_failed" }));
  process.exitCode = 2;
} finally {
  if (payload) payload.access_token = "";
}
