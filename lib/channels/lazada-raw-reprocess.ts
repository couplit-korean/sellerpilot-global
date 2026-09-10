import { z } from "zod";
import {
  lazadaQuarantineReady,
  parseLazadaImWebhookBody,
} from "./lazada-im-webhook";
import {
  normalizeLazadaImHistory,
  parseLazadaImPush,
  type LazadaImInquiry,
} from "./lazada-im";

export const LAZADA_IM_RAW_PARSER_VERSION = "lazada-im-parser/2" as const;

const claimSchema = z.object({
  contract: z.literal("lazada_im_raw_claim_v1"),
  claimToken: z.string().uuid(),
  receipts: z.array(z.object({
    id: z.string().uuid(),
    credentialId: z.string().uuid(),
    sourceKind: z.enum(["webhook", "history_page"]),
    rawBody: z.string().min(2).max(256_000),
    parserVersion: z.string().regex(/^lazada-im-parser\/[1-9][0-9]{0,5}$/),
    attemptCount: z.number().int().min(1).max(5),
    expiresAt: z.string().datetime({ offset: true }),
    claimToken: z.string().uuid(),
  }).strict()).max(25),
}).strict();

type RpcResult = { data: unknown; error: unknown };
export type LazadaRawReprocessRpc = (
  name: string,
  arguments_: Record<string, unknown>,
) => PromiseLike<RpcResult>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseObjectBody(rawBody: string) {
  const parsed = JSON.parse(rawBody) as unknown;
  const body = record(parsed);
  if (!body) throw new Error("RAW_BODY_INVALID");
  return body;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function normalizeClaimedLazadaRawReceipt(receipt: {
  sourceKind: "webhook" | "history_page";
  rawBody: string;
}): LazadaImInquiry[] {
  const body = parseObjectBody(receipt.rawBody);
  if (receipt.sourceKind === "webhook") {
    const webhookBody = parseLazadaImWebhookBody(receipt.rawBody);
    if (!webhookBody) throw new Error("RAW_WEBHOOK_BODY_INVALID");
    const inquiry = parseLazadaImPush(webhookBody);
    return inquiry ? [inquiry] : [];
  }
  const session = record(body.sellerpilotSession);
  const sessionId = text(session?.session_id ?? session?.sessionId);
  if (!sessionId) return [];
  return normalizeLazadaImHistory([{
    name: `inquiries-message:${sessionId}:reprocess`,
    data: body,
  }], undefined);
}

function safeFailureCode(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
  return /^[A-Z]/.test(normalized) ? normalized : "RAW_REPROCESS_FAILED";
}

async function complete(
  rpc: LazadaRawReprocessRpc,
  receipt: z.infer<typeof claimSchema>["receipts"][number],
  outcome: "normalized" | "unsupported" | "retry",
  errorCode: string | null,
): Promise<"pending" | "normalized" | "unsupported" | "failed" | null> {
  try {
    const result = await rpc("sellerpilot_service_complete_lazada_im_raw_v1", {
      p_id: receipt.id,
      p_claim_token: receipt.claimToken,
      p_outcome: outcome,
      p_parser_version: LAZADA_IM_RAW_PARSER_VERSION,
      p_error_code: errorCode,
    });
    const value = record(result.data);
    const status = String(value?.status);
    return !result.error && value?.contract === "lazada_im_raw_complete_v1"
      && value.id === receipt.id
      && ["pending", "normalized", "unsupported", "failed"].includes(status)
      ? status as "pending" | "normalized" | "unsupported" | "failed"
      : null;
  } catch {
    return null;
  }
}

export type LazadaRawReprocessSummary = {
  claimed: number;
  normalized: number;
  unsupported: number;
  retried: number;
  failed: number;
  claimFailed: boolean;
};

export async function reprocessPendingLazadaRawReceipts(
  rpc: LazadaRawReprocessRpc,
  limit = 5,
): Promise<LazadaRawReprocessSummary> {
  const summary: LazadaRawReprocessSummary = {
    claimed: 0,
    normalized: 0,
    unsupported: 0,
    retried: 0,
    failed: 0,
    claimFailed: false,
  };
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return { ...summary, claimFailed: true };

  let claimed: z.infer<typeof claimSchema>;
  try {
    const result = await rpc("sellerpilot_service_claim_lazada_im_raw_v1", {
      p_limit: limit,
      p_lease_seconds: 120,
    });
    const parsed = claimSchema.safeParse(result.data);
    if (result.error || !parsed.success
        || parsed.data.receipts.some((receipt) => receipt.claimToken !== parsed.data.claimToken)) {
      return { ...summary, claimFailed: true };
    }
    claimed = parsed.data;
  } catch {
    return { ...summary, claimFailed: true };
  }
  summary.claimed = claimed.receipts.length;

  for (const receipt of claimed.receipts) {
    let inquiries: LazadaImInquiry[];
    try {
      inquiries = normalizeClaimedLazadaRawReceipt(receipt);
    } catch (error) {
      const code = error instanceof Error ? safeFailureCode(error.message) : "RAW_PARSE_FAILED";
      if (await complete(rpc, receipt, "unsupported", code) === "unsupported") summary.unsupported += 1;
      else summary.failed += 1;
      continue;
    }
    if (!inquiries.length) {
      if (await complete(rpc, receipt, "unsupported", "RAW_EVENT_NOT_PROJECTABLE") === "unsupported") summary.unsupported += 1;
      else summary.failed += 1;
      continue;
    }
    try {
      const v3Ready = await rpc("sellerpilot_service_lazada_im_ingest_ready_v3", {
        p_credential_id: receipt.credentialId,
      });
      if (v3Ready.error || v3Ready.data !== true) {
        if (await complete(rpc, receipt, "retry", "RAW_INGEST_V3_UNAVAILABLE") === "pending") summary.retried += 1;
        else summary.failed += 1;
        continue;
      }
      if (!await lazadaQuarantineReady(inquiries, () => rpc(
        "sellerpilot_service_lazada_quarantine_ready_v3",
        {},
      ))) {
        if (await complete(rpc, receipt, "retry", "RAW_QUARANTINE_UNAVAILABLE") === "pending") summary.retried += 1;
        else summary.failed += 1;
        continue;
      }
      const ingestion = await rpc("sellerpilot_service_ingest_lazada_inquiries_v3", {
        p_credential_id: receipt.credentialId,
        p_inquiries: inquiries,
      });
      const result = record(ingestion.data);
      if (ingestion.error || result?.contract !== "lazada_ingest_v3" || result.status !== "complete") {
        if (await complete(rpc, receipt, "retry", "RAW_INGEST_UNAVAILABLE") === "pending") summary.retried += 1;
        else summary.failed += 1;
        continue;
      }
      if (await complete(rpc, receipt, "normalized", null) === "normalized") summary.normalized += 1;
      else summary.failed += 1;
    } catch {
      if (await complete(rpc, receipt, "retry", "RAW_REPROCESS_UNAVAILABLE") === "pending") summary.retried += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
