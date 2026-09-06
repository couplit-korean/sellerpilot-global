import { createHmac, timingSafeEqual } from "node:crypto";
import { parseLazadaImPush, type LazadaImInquiry } from "./lazada-im";
import { activeLazadaSellerIdForMarket, activeProductionLazadaCredentialEnvelope } from "./lazada-target-lineage";

type LazadaInquiryIngestArguments = {
  p_credential_id: string;
  p_channel: "lazada";
  p_inquiries: LazadaImInquiry[];
};

type LazadaInquiryIngestRpc = (
  arguments_: LazadaInquiryIngestArguments,
) => PromiseLike<{ data?: unknown; error: unknown }>;

export type LazadaInquiryIngestResult =
  | { ok: true }
  | { ok: false; status: 500 | 503; partial?: boolean };

export async function lazadaQuarantineReady(
  inquiries: ReadonlyArray<{ orderingStatus?: "unverified" | "conflict" }>,
  verify?: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<boolean> {
  if (!inquiries.some((inquiry) => inquiry.orderingStatus)) return true;
  if (!verify) return false;
  try {
    const result = await verify();
    return !result.error && result.data === true;
  } catch { return false; }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseLazadaImWebhookBody(raw: string): Record<string, unknown> | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!record(payload)) return null;
  if (typeof payload.data !== "string") return payload;

  let data: unknown;
  try {
    data = JSON.parse(payload.data) as unknown;
  } catch {
    return null;
  }
  return record(data) ? { ...payload, data } : null;
}

export async function persistLazadaImInquiry(
  credentialId: string,
  inquiry: LazadaImInquiry,
  ingest: LazadaInquiryIngestRpc,
  verifyQuarantine?: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<LazadaInquiryIngestResult> {
  if (!credentialId.trim()) return { ok: false, status: 503 };
  try {
    if (!await lazadaQuarantineReady([inquiry], verifyQuarantine)) return { ok: false, status: 503 };
    const { data, error } = await ingest({
      p_credential_id: credentialId,
      p_channel: "lazada",
      p_inquiries: [inquiry],
    });
    if (error || !record(data) || data.contract !== "lazada_ingest_v2") return { ok: false, status: 500 };
    return data.status === "complete" ? { ok: true } : { ok: false, status: 503, partial: true };
  } catch {
    return { ok: false, status: 500 };
  }
}

function webhookText(value: unknown): string {
  return typeof value === "string" ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
}

// Official LPM docId=120168, updated 2024-07-19: Verify sends a genuinely
// signed POST, not a GET challenge. Sign the original UTF-8 body, including
// its timestamp when present; no reserialization or invented version fields.
export function authenticateLazadaImWebhook(
  raw: string,
  authorization: string | null,
  credential: unknown,
  requestedAppKey: string | null = null,
): { ok: true } | { ok: false; status: 401 | 503 } {
  const secret = record(credential) && record(credential.secret_payload) ? credential.secret_payload : null;
  const appKey = webhookText(secret?.im_app_key);
  const appSecret = webhookText(secret?.im_app_secret);
  // Never fall back to Commerce or environment keys on this IM endpoint.
  if (!appKey || !appSecret) return { ok: false, status: 503 };
  if (requestedAppKey !== null && requestedAppKey !== appKey) return { ok: false, status: 401 };
  const signature = (authorization ?? "").replace(/^sha256[=\s]+/i, "").trim();
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, status: 401 };
  const expected = createHmac("sha256", appSecret).update(`${appKey}${raw}`, "utf8").digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return { ok: false, status: 401 };
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { return { ok: true }; }
  // LPM omits app_key normally. Any supplied signed app_key must agree.
  if (record(body) && "app_key" in body && webhookText(body.app_key) !== appKey) return { ok: false, status: 401 };
  return { ok: true };
}

// Only call after authenticating the original body. App authentication alone
// cannot assign a message to whichever owner the active RPC returns.
export function boundLazadaImCredentialId(credential: unknown, payload: Record<string, unknown>): string {
  const envelope = activeProductionLazadaCredentialEnvelope(credential);
  if (!envelope) return ""; // Never synthesize provider_account_subject/owner.
  const sellerId = webhookText(payload.seller_id);
  if (!/^[1-9][0-9]{0,31}$/.test(sellerId)) return "";
  const data = record(payload.data) ? payload.data : {};
  // Official IM message docId=121553: seller_id at root, site_id in data.
  const countries = [payload.site, data.site_id].filter((value) => value !== undefined)
    .map((value) => webhookText(value).toLowerCase().replace(/^lazada[_-]/, ""));
  if (!countries.length || countries.some((country) => !/^(id|my|ph|sg|th|vn)$/.test(country))) return "";
  const country = countries[0];
  if (countries.some((value) => value !== country)
      || webhookText(envelope.secretPayload.country).toLowerCase() !== country
      || activeLazadaSellerIdForMarket(envelope.secretPayload, country) !== sellerId) return "";
  return envelope.credentialId;
}

export type LazadaImWebhookSelection =
  | { ok: true; kind: "ignored" }
  | { ok: true; kind: "inquiry"; credentialId: string; inquiry: LazadaImInquiry }
  | { ok: false; status: 400 | 401 | 503 };

export function selectLazadaImWebhookRoute(
  raw: string,
  authorization: string | null,
  candidateResult: unknown,
  requestedAppKey: string | null = null,
): LazadaImWebhookSelection {
  // Refuse old contracts, partial lists and malformed rows before considering
  // any match. Never report success using only a bounded prefix of candidates.
  if (!record(candidateResult) || candidateResult.contract !== "lazada_im_webhook_candidates_v1"
      || candidateResult.limit !== 32 || candidateResult.overflow !== false
      || !Array.isArray(candidateResult.candidates) || candidateResult.candidates.length > 32) return { ok: false, status: 503 };
  const candidates: unknown[] = candidateResult.candidates;
  if (candidates.some((value) => !record(value) || !webhookText(value.credential_id)
      || !record(value.secret_payload) || !webhookText(value.secret_payload.im_app_key)
      || !webhookText(value.secret_payload.im_app_secret))) return { ok: false, status: 503 };
  const verified = candidates.filter((value) => authenticateLazadaImWebhook(raw, authorization, value, requestedAppKey).ok);
  if (!verified.length) return { ok: false, status: 401 };
  const verifiedAppKeys = new Set(verified.map((value) => {
    const row = value as { secret_payload: Record<string, unknown> };
    return webhookText(row.secret_payload.im_app_key);
  }));
  if (verifiedAppKeys.size !== 1) return { ok: false, status: 503 };
  const payload = parseLazadaImWebhookBody(raw);
  if (!payload) return { ok: false, status: 400 };
  const inquiry = parseLazadaImPush(payload);
  // Verify authenticates an app, not a seller. Shared-app duplicates are fine
  // here: a signed non-message probe has no customer persistence or owner.
  if (!inquiry) return { ok: true, kind: "ignored" };
  const boundIds = verified.map((value) => boundLazadaImCredentialId(value, payload)).filter(Boolean);
  // Count credential rows, not distinct owners/app keys; duplicate matching
  // credentials (even for one seller) are ambiguous and must not ingest.
  if (boundIds.length !== 1) return { ok: false, status: 503 };
  return { ok: true, kind: "inquiry", credentialId: boundIds[0], inquiry };
}
