import type { ShippingOperationResult } from "./contracts";
const mutationSteps: Record<string, ReadonlySet<string>> = {
  "shipment.acknowledge": new Set([
    "seller-check",
    "pack",
    "acknowledgement",
    "confirm",
  ]),
  "shipment.confirm": new Set([
    "setsendinginfo",
    "shipment.confirm",
    "pack",
    "ready-to-ship",
    "invoice",
    "dispatch",
    "shipment-confirm",
    "shipping-fulfillment",
  ]),
};
export function shippingCompletionStatus(
  result: ShippingOperationResult,
): "succeeded" | "failed" | "reconciliation_required" {
  if (
    !result.ok &&
    result.steps.some(
      (step) =>
        step.data?.sellerpilotReconciliationRequired === true ||
        (mutationSteps[result.operation]?.has(step.name.trim().toLowerCase()) &&
          (step.ok ||
            step.data?.sellerpilotMutation === "accepted" ||
            step.status === 408 ||
            (step.status >= 500 && step.status <= 599))),
    )
  )
    return "reconciliation_required";
  return !result.ok && result.operation === "orders.list"
    ? "failed"
    : "succeeded";
}
