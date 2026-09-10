import type { ActiveChannelKey } from "../../channels/catalog";
import type { ChannelOperationStep } from "../../channels/operation-step";
import type { GatewayReadRetryContinuation } from "../../channels/gateway-readback-contract";

export const csOperationNames = ["inquiries.list", "inquiries.reply"] as const;
export type CsOperationName = (typeof csOperationNames)[number];
export function isCsOperation(operation: string): operation is CsOperationName {
  return operation === "inquiries.list" || operation === "inquiries.reply";
}

export type CsRetryContinuation = GatewayReadRetryContinuation;

export type CsRuntimeAccountContext = {
  credentialId: string;
  sellerAccountKey: string;
  environment: "sandbox" | "production";
  expectedRegion: string;
  now: string;
};

// Readers accept historical transport envelopes; the executor returns CsOperationName.
export type CsOperationResult<Operation extends string = string> = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: Operation;
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuation?: { reason: "page_cap_reached"; arguments: Record<string, unknown> };
  retryContinuation?: CsRetryContinuation;
  safeMessage: string;
};
export type CsExecuteInput = {
  channel: ActiveChannelKey;
  operation: CsOperationName;
  payload: Record<string, unknown>;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  runtimeContext?: {
    temuBuyerChat?: {
      evidence: unknown;
      expected: CsRuntimeAccountContext;
    };
  };
};
