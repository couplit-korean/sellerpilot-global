import type { CsOperationResult } from "../../../cs/operations/contracts.ts";
import {
  assessQoo10HistoryExecution,
  qoo10HistoryArguments,
  qoo10HistoryWindowFromArguments,
} from "./history-runtime.ts";
import { qoo10HistoryWindowKey } from "./history.ts";

export const qoo10HistoryGatewayCompletionContract =
  "sellerpilot-qoo10-history-gateway-completion/1" as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function qoo10HistoryGatewayCompletion(input: {
  arguments: Record<string, unknown>;
  result: CsOperationResult;
  observedRowLimit?: number | null;
}) {
  const marker = record(input.arguments.sellerpilotHistoryWindow);
  if (!marker) return null;
  const window = qoo10HistoryWindowFromArguments(input.arguments);
  if (input.result.channel !== "qoo10" || input.result.operation !== "inquiries.list") {
    throw new Error("QOO10_HISTORY_GATEWAY_RESULT_INVALID");
  }
  const assessment = assessQoo10HistoryExecution({
    window,
    execution: input.result,
    observedRowLimit: input.observedRowLimit,
  });
  const refinementRequests = assessment.refinement.map((child) => ({
    periodicKey: qoo10HistoryWindowKey(child),
    arguments: qoo10HistoryArguments(child),
  }));
  const state = assessment.coverage.completeness.state === "complete"
    ? "complete" as const
    : refinementRequests.length
      ? "refining" as const
      : "gap" as const;
  return Object.freeze({
    contractVersion: qoo10HistoryGatewayCompletionContract,
    windowKey: qoo10HistoryWindowKey(window),
    state,
    coverage: Object.freeze({ ...assessment.coverage }),
    refinementRequests: Object.freeze(refinementRequests.map((request) => Object.freeze(request))),
  });
}

export function qoo10HistoryGatewayRpcArguments(input: {
  tokenHash: string;
  jobId: string;
  claimToken: string;
  completion: NonNullable<ReturnType<typeof qoo10HistoryGatewayCompletion>>;
}) {
  return {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
    p_completion: input.completion,
  };
}
