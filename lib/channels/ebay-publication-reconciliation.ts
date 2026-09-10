import {
  fetchEbayTradingUserIdentity,
  ebayRequest,
  runWithProviderReadOnlyTransport,
  textValue,
} from "./protocols";
import { assertProviderAccountIdentity } from "./provider-account-identity";
import { ebayExactReconciliationOffer } from "./ebay-create-preflight";
import { ebayListingResultWithPublicationReadback } from "../product-registration/channels/ebay";
import { step, type ChannelOperationStep } from "./operation-step";
import { result } from "../product-registration/execution-shared";
import type { ExecuteInput } from "../product-registration/execution-shared";
import {
  ebayPublicationReconciliationBindingSchema,
} from "./ebay-publication-reconciliation-contract";
export {
  EBAY_PUBLICATION_RECONCILIATION_CLAIM_MODE,
  EBAY_PUBLICATION_RECONCILIATION_CLAIM_RPC,
  EBAY_PUBLICATION_RECONCILIATION_CONTRACT,
  ebayPublicationReconciliationBindingSchema,
  type EbayPublicationReconciliationBinding,
} from "./ebay-publication-reconciliation-contract";

function exactText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function assertEbayPublicationReconciliationBinding(
  input: ExecuteInput,
  bindingValue: unknown,
) {
  const parsed = ebayPublicationReconciliationBindingSchema.safeParse(bindingValue);
  if (!parsed.success) {
    throw new Error("EBAY_PUBLICATION_RECONCILIATION_BINDING_INVALID");
  }
  const binding = parsed.data;
  const expectedFingerprint = exactText(
    input.arguments.publicationExpectedFingerprint,
  ).toLowerCase();
  const sku = exactText(input.arguments.sku);
  const offerId = exactText(input.arguments.offerId);
  const marketplaceId = exactText(
    input.arguments.marketplaceId ?? record(input.arguments.offer).marketplaceId,
  ).toUpperCase();
  if (
    input.channel !== "ebay" ||
    input.operation !== "listing.create" ||
    sku !== binding.sku ||
    (Boolean(offerId) && offerId !== binding.offerId) ||
    marketplaceId !== binding.marketplaceId ||
    expectedFingerprint !== binding.requestFingerprint ||
    input.arguments.publicationStateContract !== "verified_remote_state_v1" ||
    input.arguments.publicationIntent !== "live"
  ) {
    throw new Error("EBAY_PUBLICATION_RECONCILIATION_BINDING_INVALID");
  }
  return binding;
}

/**
 * Recover a remotely published eBay listing after SellerPilot completion was
 * lost. Provider-read-only: Trading GetUser, then Inventory/Offer GET. Fresh
 * CREATE response loss may omit offerId; exact SKU+marketplace GET finds it.
 */
export async function executeEbayPublicationReconciliation(
  input: ExecuteInput,
  bindingValue: unknown,
) {
  const binding = assertEbayPublicationReconciliationBinding(input, bindingValue);
  const providerAccount = await runWithProviderReadOnlyTransport(() =>
    fetchEbayTradingUserIdentity({
      environment: input.environment,
      accessToken: textValue(input.payload, "access_token"),
    }),
  );
  assertProviderAccountIdentity(input.payload, providerAccount.identity);

  let offerId = binding.offerId;
  const recoverySteps: ChannelOperationStep[] = [{
    name: "ebay-publication-reconciliation-account-readback",
    ok: true,
    status: 200,
    data: {
      sellerpilotVerification: "EBAY_PROVIDER_ACCOUNT_IDENTITY_VERIFIED",
      recoveryContract: binding.contract,
      sourceJobId: binding.sourceJobId,
      attemptId: binding.attemptId,
      credentialId: binding.credentialId,
      lastStage: binding.lastStage,
      providerMutationPerformed: false,
    },
  }];
  if (!offerId) {
    const [inventoryReadback, offersReadback] = await Promise.all([
      ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(binding.sku)}`,
      }),
      ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/inventory/v1/offer",
        query: new URLSearchParams({
          sku: binding.sku,
          marketplace_id: binding.marketplaceId,
          limit: "200",
        }),
      }),
    ]);
    recoverySteps.push(step("ebay-stage-recovery-inventory-get", inventoryReadback));
    recoverySteps.push(step("ebay-stage-recovery-offer-collection-get", offersReadback));
    const exact = ebayExactReconciliationOffer(
      offersReadback,
      binding.sku,
      binding.marketplaceId,
      String(record(input.arguments.offer).format ?? "FIXED_PRICE"),
    );
    offerId = exact && typeof exact.offerId === "string" ? exact.offerId.trim() : null;
    recoverySteps.push({
      name: "ebay-stage-recovery-exact-offer-binding",
      ok: Boolean(offerId),
      status: offerId ? 200 : 409,
      data: {
        sku: binding.sku,
        marketplaceId: binding.marketplaceId,
        offerId,
        providerMutationPerformed: false,
      },
    });
    if (!inventoryReadback.response.ok || !offerId) {
      return result(input, recoverySteps, binding.sku);
    }
  }

  return ebayListingResultWithPublicationReadback(
    input,
    recoverySteps,
    offerId,
    offerId,
  );
}
