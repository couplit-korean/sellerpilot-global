import type { CsOperationResult } from "./contracts";
const replyMutationSteps = new Set(["inquiry-reply", "setinquirymessage", "cscenter.setinquirymessage"]);
export function csCompletionStatus(result: CsOperationResult): "succeeded" | "failed" | "reconciliation_required" {
  if (!result.ok && result.steps.some(step => step.data?.sellerpilotReconciliationRequired === true)) return "reconciliation_required";
  if (!result.ok && result.operation === "inquiries.reply" && result.steps.some(step => replyMutationSteps.has(step.name.trim().toLowerCase())
    && (step.ok || step.data?.sellerpilotMutation === "accepted" || step.status === 408 || (step.status >= 500 && step.status <= 599)))) return "reconciliation_required";
  return result.ok ? "succeeded" : "failed";
}
