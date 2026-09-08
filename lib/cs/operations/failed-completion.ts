import { buildGatewayWorkerFailedCompletionPayload } from "../../channels/cs/elevenst/worker-completion";
import type { CsOperationResult } from "./contracts";

type Input = {
  job: { id: string; channel: string; operation: string };
  claimToken: string;
  error: string;
  result?: CsOperationResult | null;
  credentialRefresh?: unknown;
  retryContinuation?: unknown;
};
export function buildCsFailedCompletionPayload(input: Input) {
  const payload = buildGatewayWorkerFailedCompletionPayload(input);
  const result = input.result;
  // Preserve the case/dispute envelope for the dedicated validated ledger path.
  if (input.job.channel === "ebay" && input.job.operation === "inquiries.list"
      && result?.channel === "ebay" && result.operation === "inquiries.list" && !result.ok
      && result.steps.length === 1 && result.steps[0]?.name === "ebay-case-dispute-history-page") {
    return { ...payload, result };
  }
  return payload;
}
