import type { ChannelOperationName } from "../channels/operation-names";
import type {
  ActiveChannelKey,
  ChannelCapabilityKey,
} from "../channels/catalog";
import type { ChannelOperationStep } from "../channels/operation-step";
import type { SecretPayload } from "../channels/protocols";
export const shippingOperationNames = [
  "orders.list",
  "orders.get",
  "shipment.acknowledge",
  "shipment.confirm",
] as const;
export type ShippingOperationName = (typeof shippingOperationNames)[number];
export function isShippingOperation(
  value: string,
): value is ShippingOperationName {
  return (shippingOperationNames as readonly string[]).includes(value);
}
export const shippingOperationCapabilities: Record<
  ShippingOperationName,
  ChannelCapabilityKey
> = {
  "orders.list": "orders",
  "orders.get": "orders",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};
export type ShippingOperationResult = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuation?: {
    reason: "page_cap_reached";
    arguments: Record<string, unknown>;
  };
  safeMessage: string;
};
export type ShippingExecuteInput = {
  channel: ActiveChannelKey;
  operation: ShippingOperationName;
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  providerMutationHooks?: {
    begin: () => Promise<void>;
    assertLeaseHealthy: () => Promise<void>;
  };
};
