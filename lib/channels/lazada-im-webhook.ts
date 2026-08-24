import type { LazadaImInquiry } from "./lazada-im";

type LazadaInquiryIngestArguments = {
  p_credential_id: string;
  p_channel: "lazada";
  p_inquiries: LazadaImInquiry[];
};

type LazadaInquiryIngestRpc = (
  arguments_: LazadaInquiryIngestArguments,
) => PromiseLike<{ error: unknown }>;

export type LazadaInquiryIngestResult =
  | { ok: true }
  | { ok: false; status: 500 | 503 };

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
): Promise<LazadaInquiryIngestResult> {
  if (!credentialId.trim()) return { ok: false, status: 503 };
  try {
    const { error } = await ingest({
      p_credential_id: credentialId,
      p_channel: "lazada",
      p_inquiries: [inquiry],
    });
    return error ? { ok: false, status: 500 } : { ok: true };
  } catch {
    return { ok: false, status: 500 };
  }
}
