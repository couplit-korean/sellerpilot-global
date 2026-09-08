import { executeShippingOperation } from "./execute";
import {
  isShippingOperation,
  type ShippingOperationResult,
  type ShippingExecuteInput,
} from "./contracts";
import type { ProviderExecutionInput } from "../channels/provider-execution-contract";
import {
  ensureShopeeAccessToken,
  ensureLazadaAccessToken,
  ensureEbayAccessToken,
  textValue,
  runWithChannelRequestSignal,
  runWithProviderTransportContext,
} from "../channels/protocols";
type ProviderExecutor = (
  input: ShippingExecuteInput,
) => Promise<ShippingOperationResult>;
export const serverlessShippingMatrix = {
  "orders.list": new Set([
    "qoo10",
    "shopee",
    "lazada",
    "coupang",
    "elevenst",
    "temu",
    "smartstore",
    "ebay",
  ]),
  "orders.get": new Set([
    "qoo10",
    "shopee",
    "lazada",
    "coupang",
    "temu",
    "smartstore",
    "ebay",
  ]),
  "shipment.acknowledge": new Set([
    "qoo10",
    "shopee",
    "lazada",
    "coupang",
    "smartstore",
  ]),
  "shipment.confirm": new Set([
    "qoo10",
    "shopee",
    "lazada",
    "coupang",
    "temu",
    "smartstore",
    "ebay",
  ]),
} as const;
export async function executeShippingProviderJob(
  input: ProviderExecutionInput,
  executor: ProviderExecutor = executeShippingOperation,
): Promise<ShippingOperationResult> {
  const operation = input.job.operation;
  if (
    !isShippingOperation(operation) ||
    !(serverlessShippingMatrix[operation] as ReadonlySet<string>).has(
      input.job.channel,
    )
  )
    throw new Error("SHIPPING_OPERATION_NOT_ALLOWED");
  const execute = () =>
    runWithChannelRequestSignal(input.signal, async () => {
      const raw = input.job.request.arguments;
      const arguments_ =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      let credential = input.job.credential;
      if (input.job.channel === "shopee") {
        await input.hooks.assertLeaseHealthy();
        credential = (
          await ensureShopeeAccessToken(
            credential,
            input.job.environment,
            10 * 60_000,
            String(arguments_.shopId ?? arguments_.shop_id ?? "").trim(),
            input.hooks.beginCredentialMutation,
            input.hooks.stageCredentialRefresh,
            true,
          )
        ).payload;
      } else if (input.job.channel === "lazada") {
        await input.hooks.assertLeaseHealthy();
        credential = {
          ...credential,
          country: String(
            arguments_.country || textValue(credential, "country") || "my",
          ).toLowerCase(),
        };
        credential = (
          await ensureLazadaAccessToken(
            credential,
            undefined,
            input.hooks.beginCredentialMutation,
            input.hooks.stageCredentialRefresh,
            true,
          )
        ).payload;
      } else if (input.job.channel === "ebay") {
        await input.hooks.assertLeaseHealthy();
        credential = (
          await ensureEbayAccessToken(
            credential,
            input.job.environment,
            undefined,
            input.hooks.beginCredentialMutation,
            input.hooks.stageCredentialRefresh,
            true,
          )
        ).payload;
      }
      await input.hooks.assertLeaseHealthy();
      const delayedLazadaBoundary =
        input.job.channel === "lazada" && operation === "shipment.confirm";
      if (operation.startsWith("shipment.") && !delayedLazadaBoundary) {
        await input.hooks.beginProviderMutation();
        await input.hooks.assertLeaseHealthy();
      }
      const result = await executor({
        channel: input.job.channel,
        operation,
        payload: credential,
        arguments: arguments_,
        environment: input.job.environment,
        ...(delayedLazadaBoundary
          ? {
              providerMutationHooks: {
                begin: () => input.hooks.beginProviderMutation({ fresh: true }),
                assertLeaseHealthy: input.hooks.assertLeaseHealthy,
              },
            }
          : {}),
      });
      return result;
    });
  return runWithProviderTransportContext(
    { signal: input.signal, reserve: input.hooks.reserveProviderRequest },
    execute,
  );
}
