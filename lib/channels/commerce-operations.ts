import { assertNoRetiredProductRecovery } from "./retired-product-recovery";
import { productChannelAdapters } from "../product-registration/channel-adapters";
import { qoo10S1ActivationArgument } from "./qoo10-listing-activation";
import {
  listingUpdateRemoteIdentity,
  prepareListingUpdateArguments,
} from "./listing-update";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "./listing-publication-state";
import { executeListingPublicationVerification } from "./listing-publication-verification";
import { temuContainmentDiscoveryBinding } from "./provider-temu-publication-readback";
import {
  type ExecuteInput,
  type ChannelOperationResult,
  channelOperationNames,
  ensureProviderSupport,
  result,
} from "../product-registration/execution-shared";
import { executeQoo10 } from "../product-registration/channels/qoo10";
import { executeTemu } from "../product-registration/channels/temu";
export async function executeChannelOperation(input: ExecuteInput): Promise<ChannelOperationResult> {
  if (!(channelOperationNames as readonly string[]).includes(input.operation)) {
    throw new Error(`COMMERCE_OPERATION_UNSUPPORTED:${input.operation}`);
  }
  assertNoRetiredProductRecovery(input.arguments);
  ensureProviderSupport(input.channel, input.operation);
  if (
    input.channel === "qoo10" &&
    Object.hasOwn(input.arguments, qoo10S1ActivationArgument) &&
    input.operation !== "listing.activate"
  ) {
    return executeQoo10(input);
  }
  if (input.operation === "listing.publication.verify" &&
    input.channel === "temu" &&
    (temuContainmentDiscoveryBinding(input.arguments))) {
    return executeTemu(input);
  }
  if (input.operation === "listing.publication.verify") {
    const verification = await executeListingPublicationVerification({
      ...input,
      channel: input.channel,
      operation: input.operation,
      ...(input.shopeeShopCredential
        ? { shopeeShopCredential: input.shopeeShopCredential }
        : {}),
    });
    return result(input, verification.steps, verification.remoteId, undefined, verification.remoteState);
  }
  const requestedPublicationIntent = listingPublicationIntentFromArguments(input.arguments);
  const requestedPublicationStateContract =
    input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion
      ? listingRemoteStateContractVersion
      : undefined;
  const requestedPublicationExpectedFingerprint =
    typeof input.arguments.publicationExpectedFingerprint === "string" &&
      /^[a-f0-9]{64}$/u.test(input.arguments.publicationExpectedFingerprint)
      ? input.arguments.publicationExpectedFingerprint
      : undefined;
  const requestedPublicationExpectedLocale =
    typeof input.arguments.publicationExpectedLocale === "string"
      ? input.arguments.publicationExpectedLocale
      : undefined;
  const requestedPublicationExpectedImageCount =
    typeof input.arguments.publicationExpectedImageCount === "number" &&
      Number.isInteger(input.arguments.publicationExpectedImageCount)
      ? input.arguments.publicationExpectedImageCount
      : undefined;
  const safeInput = input.operation === "listing.update"
    ? {
      ...input,
      arguments: {
        ...prepareListingUpdateArguments(input.channel, input.arguments, {
          status: "published",
          remoteId: listingUpdateRemoteIdentity(input.channel, input.arguments),
        }),
        ...(input.channel === "ebay"
          ? {
            offerId: input.arguments.offerId,
            sku: input.arguments.sku,
            marketplaceId: input.arguments.marketplaceId,
          }
          : {}),
        ...(requestedPublicationIntent
          ? { publicationIntent: requestedPublicationIntent }
          : {}),
        ...(requestedPublicationStateContract
          ? { publicationStateContract: requestedPublicationStateContract }
          : {}),
        ...(requestedPublicationExpectedFingerprint
          ? {
            publicationExpectedFingerprint:
              requestedPublicationExpectedFingerprint,
          }
          : {}),
        ...(requestedPublicationExpectedLocale
          ? {
            publicationExpectedLocale: requestedPublicationExpectedLocale,
          }
          : {}),
        ...(requestedPublicationExpectedImageCount === undefined
          ? {}
          : {
            publicationExpectedImageCount:
              requestedPublicationExpectedImageCount,
          }),
      },
    }
    : input;
  return productChannelAdapters[safeInput.channel](safeInput);
}
export {
  channelOperationNames,
  type ChannelOperationName,
  writeChannelOperations,
  type ChannelOperationResult,
  type ExecuteInput,
} from "../product-registration/execution-shared";
export type { ChannelOperationStep } from "./operation-step";
export { channelOperationCapabilities } from "./operation-names";
