import type { SupabaseClient } from "@supabase/supabase-js";

import { smartstoreManualAdoptionPreparationSchema } from "./server-smartstore-manual-adoption";

export const smartstoreManualAdoptionUpdateArgument =
  "sellerpilotSmartstoreManualAdoption";

export type SmartstoreManualAdoptionUpdateBinding = {
  contract: "smartstore_manual_adoption_verified_v1";
  status: "verified";
  attestationId: string;
  receiptId: string;
  sourceJobId: string;
  listingId: string;
  originProductNo: string;
  channelProductNo: string;
  sellerSku: string;
  approvalRevision: number;
  contentSha256: string;
  manifestDigest: string;
};

export class SmartstoreManualAdoptionUpdateBindingError extends Error {
  readonly code: string;
  readonly unavailable: boolean;

  constructor(code: string, unavailable = false) {
    super(code);
    this.name = "SmartstoreManualAdoptionUpdateBindingError";
    this.code = code;
    this.unavailable = unavailable;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function hasClientSmartstoreManualAdoptionUpdateMarker(
  argumentsValue: Record<string, unknown>,
) {
  return Object.hasOwn(argumentsValue, smartstoreManualAdoptionUpdateArgument);
}

export function isSmartstoreManualAdoptionListing(value: unknown) {
  const listing = record(value);
  return listing.channel === "smartstore"
    && listing.status === "published"
    && listing.requestedPublicationIntent === "live"
    && listing.remoteVisibility === "live"
    && Boolean(exactText(listing.remoteId))
    && Boolean(exactText(listing.marketplaceSku));
}

export async function readSmartstoreManualAdoptionUpdateBinding(input: {
  serviceClient: SupabaseClient;
  actorId: string;
  productId: string;
  credentialId: string;
  listing: Record<string, unknown>;
}): Promise<SmartstoreManualAdoptionUpdateBinding | null> {
  if (!isSmartstoreManualAdoptionListing(input.listing)) {
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_LISTING_NOT_VERIFIED",
    );
  }

  const { data, error } = await input.serviceClient.rpc(
    "sellerpilot_service_prepare_smartstore_manual_adoption",
    { p_actor: input.actorId, p_product_id: input.productId },
  );
  if (error) {
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_BINDING_UNAVAILABLE",
      true,
    );
  }
  const preparation = smartstoreManualAdoptionPreparationSchema.safeParse(data);
  if (!preparation.success) {
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_BINDING_CONTRACT_INVALID",
      true,
    );
  }
  const value = preparation.data;
  if (value.status !== "already_verified") {
    if (!value.attestationId && !value.receiptId && !value.originProductNo
        && !value.channelProductNo && value.normalUpdateEligible === false) {
      return null;
    }
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_VERIFIED_BINDING_STALE",
    );
  }
  if (value.status !== "already_verified"
      || value.normalUpdateEligible !== true
      || value.contentVerified !== true
      || value.apiCreateSucceeded !== false
      || value.providerMutationPerformed !== false
      || value.productId !== input.productId
      || value.listingId !== input.listing.id
      || value.credentialId !== input.credentialId
      || value.originProductNo !== exactText(input.listing.remoteId)
      || value.sellerSku !== exactText(input.listing.marketplaceSku)
      || !value.attestationId
      || !value.receiptId
      || !value.originProductNo
      || !value.channelProductNo) {
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_CURRENT_TUPLE_MISMATCH",
    );
  }

  return {
    contract: "smartstore_manual_adoption_verified_v1",
    status: "verified",
    attestationId: value.attestationId,
    receiptId: value.receiptId,
    sourceJobId: value.sourceJobId,
    listingId: value.listingId,
    originProductNo: value.originProductNo,
    channelProductNo: value.channelProductNo,
    sellerSku: value.sellerSku,
    approvalRevision: value.approvalRevision,
    contentSha256: value.contentSha256,
    manifestDigest: value.manifestDigest,
  };
}

export function bindSmartstoreManualAdoptionUpdateArguments(
  argumentsValue: Record<string, unknown>,
  binding: SmartstoreManualAdoptionUpdateBinding,
) {
  if (hasClientSmartstoreManualAdoptionUpdateMarker(argumentsValue)) {
    throw new SmartstoreManualAdoptionUpdateBindingError(
      "SMARTSTORE_MANUAL_ADOPTION_CLIENT_MARKER_FORBIDDEN",
    );
  }
  return {
    ...argumentsValue,
    [smartstoreManualAdoptionUpdateArgument]: structuredClone(binding),
  };
}
