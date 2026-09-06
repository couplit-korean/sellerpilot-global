import { SHOPEE_OAUTH_OPERATION } from "./shopee-oauth-executor-readiness";
import {
  isSmartstoreLocalReadOperation,
  SMARTSTORE_LOCAL_READ_OPERATIONS,
} from "./smartstore-local-read-routing";

export const LOCAL_GATEWAY_RECOVERY_CLAIM_MODE = "local_recovery" as const;
export const LOCAL_GATEWAY_RECOVERY_RPC_NAME =
  "sellerpilot_claim_local_gateway_recovery_job" as const;
export const LOCAL_GATEWAY_RECOVERY_LANE_GUC =
  "sellerpilot.local_gateway_recovery_lane" as const;
export const LOCAL_GATEWAY_RECOVERY_LANE_ENABLED = "enabled" as const;
export const LOCAL_GATEWAY_RECOVERY_SHOPEE_CHANNEL = "shopee" as const;
export const LOCAL_GATEWAY_RECOVERY_SMARTSTORE_CHANNEL = "smartstore" as const;

export const LOCAL_GATEWAY_RECOVERY_SMARTSTORE_OPERATIONS =
  SMARTSTORE_LOCAL_READ_OPERATIONS;

export type LocalGatewayRecoveryClaimMode =
  typeof LOCAL_GATEWAY_RECOVERY_CLAIM_MODE;

export type ChannelGatewayClaimMode =
  | "default"
  | LocalGatewayRecoveryClaimMode;

export function isLocalGatewayRecoveryAllowedTuple(
  channel: string,
  operation: string,
): boolean {
  if (
    channel === LOCAL_GATEWAY_RECOVERY_SHOPEE_CHANNEL
    && operation === SHOPEE_OAUTH_OPERATION
  ) {
    return true;
  }
  return channel === LOCAL_GATEWAY_RECOVERY_SMARTSTORE_CHANNEL
    && isSmartstoreLocalReadOperation(operation);
}

export function parseChannelGatewayClaimMode(
  mode: unknown,
): ChannelGatewayClaimMode | "invalid" {
  if (mode === undefined) return "default";
  if (mode === LOCAL_GATEWAY_RECOVERY_CLAIM_MODE) {
    return LOCAL_GATEWAY_RECOVERY_CLAIM_MODE;
  }
  return "invalid";
}
