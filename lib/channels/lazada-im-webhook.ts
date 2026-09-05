import type { LazadaImInquiry } from "./lazada-im";

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
