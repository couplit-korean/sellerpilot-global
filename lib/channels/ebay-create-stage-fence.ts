import { createHash } from "node:crypto";

import { externalDetailCanonical } from "../external-detail-canonical";
import type { EbayCreatePrewriteEvidence } from "./ebay-create-preflight";
import { ebayCreateProviderRequestBodiesSha256 } from "./ebay-create-preflight";

export const ebayCreateStageFenceContract = "sellerpilot_ebay_create_stage_fence_v1" as const;
export const ebayCreateStageReceiptContract = "sellerpilot_ebay_create_stage_receipt_v1" as const;
export type EbayCreateProviderStage = "inventory" | "offer" | "publish";
export type EbayCreateStageMode = "write" | "readback";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value: unknown) {
  return createHash("sha256").update(
    typeof value === "string" ? value : externalDetailCanonical(value),
  ).digest("hex");
}

export type EbayCreateStageFenceRequest = {
  contract: typeof ebayCreateStageFenceContract;
  stage: EbayCreateProviderStage;
  mode: EbayCreateStageMode;
  prewriteReceiptSha256: string;
  previousStageReceiptSha256: string | null;
  remoteAction: EbayCreatePrewriteEvidence["action"];
  remoteOfferId: string | null;
  providerRequestMethod: "GET" | "POST" | "PUT";
  providerRequestPath: string;
  providerAccountSubjectSha256: string | null;
  credential: {
    id: string;
    version: number;
    fingerprint: string;
  };
  approval: {
    productId: string;
    importId: string;
    approvalRevision: number;
    contentSha256: string;
    requestSha256: string;
    revisionSha256: string;
    inventoryQuantity: number;
    priceUsd: string;
    currency: string;
    categoryAssignmentRevisionSha256: string;
    categoryAssignment: {
      id: string;
      confirmedAt: string;
      updatedAt: string;
    };
    ledgerSnapshot: {
      contract: "sellerpilot_ebay_create_ledger_snapshot_v1";
      productUpdatedAt: string;
      productSku: string;
      availableQuantity: number;
      priceUsd: string;
      draftId: string;
      draftVersion: number;
      draftUpdatedAt: string;
      draftDataSha256: string;
    };
    providerRequestBodiesSha256: {
      inventory: string;
      offer: string;
      publish: string;
    };
  };
  stageProviderRequestBodySha256: string;
  tuple: {
    sku: string;
    marketplaceId: string;
    categoryId: string;
    aspects: Record<string, unknown>;
    aspectsSha256: string;
    quantity: number;
    priceUsd: string;
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
    merchantLocationKey: string;
    normalizedImageObjectPaths: string[];
    normalizedImageContentSha256s: string[];
  };
};

export type EbayCreateStageFenceReceipt = {
  contract: typeof ebayCreateStageReceiptContract;
  status: "staged" | "replayed";
  stage: EbayCreateProviderStage;
  prewriteReceiptSha256: string;
  previousStageReceiptSha256: string | null;
  stageReceiptSha256: string;
};

export function ebayCreateStageFenceRequest(input: {
  arguments: Record<string, unknown>;
  evidence: EbayCreatePrewriteEvidence;
  stage: EbayCreateProviderStage;
  mode: EbayCreateStageMode;
  previousStageReceiptSha256?: string;
  providerRequestBody: string;
}): EbayCreateStageFenceRequest {
  const offer = record(input.arguments.offer);
  const inventoryItem = record(input.arguments.inventoryItem);
  const product = record(inventoryItem.product);
  const availability = record(inventoryItem.availability);
  const approval = record(input.arguments.sellerpilotEbayCreateApproval);
  const external = record(input.arguments.sellerpilotExternalDetail);
  const assets = record(input.arguments.sellerpilotPublicationAssetBinding);
  const credential = record(input.arguments.sellerpilotEbayCredentialIncarnation);
  const policies = record(offer.listingPolicies);
  const price = record(record(offer.pricingSummary).price);
  const providerRequestBodiesSha256 = ebayCreateProviderRequestBodiesSha256(input.arguments);
  const ledgerSnapshot = record(approval.ledgerSnapshot);
  const transport = Array.isArray(assets.providerTransportImages)
    ? assets.providerTransportImages.map(record)
    : [];
  const credentialId = text(credential.id);
  const credentialVersion = Number(credential.version);
  const credentialFingerprint = text(credential.fingerprint);
  if (!/^[0-9a-f-]{36}$/iu.test(credentialId)
      || !Number.isSafeInteger(credentialVersion)
      || credentialVersion < 1
      || !/^[a-f0-9]{12,64}$/iu.test(credentialFingerprint)) {
    throw new Error("EBAY_CREATE_CREDENTIAL_INCARNATION_REQUIRED");
  }
  const stageProviderRequestBodySha256 = sha256(input.providerRequestBody);
  const expectedBodySha256 = input.mode === "readback"
    ? sha256("")
    : providerRequestBodiesSha256[input.stage];
  if (stageProviderRequestBodySha256 !== expectedBodySha256) {
    throw new Error("EBAY_CREATE_TRANSPORT_BODY_SEAL_MISMATCH");
  }
  const remoteOfferId = input.evidence.offerId;
  const providerRequestMethod = input.mode === "readback"
    ? "GET"
    : input.stage === "inventory" ? "PUT" : "POST";
  const providerRequestPath = input.stage === "inventory"
    ? `/sell/inventory/v1/inventory_item/${encodeURIComponent(text(input.arguments.sku))}`
    : input.stage === "offer" && input.mode === "write"
      ? "/sell/inventory/v1/offer"
      : remoteOfferId
        ? `/sell/inventory/v1/offer/${encodeURIComponent(remoteOfferId)}${input.stage === "publish" && input.mode === "write" ? "/publish" : ""}`
        : "";
  if (!providerRequestPath) throw new Error("EBAY_CREATE_TRANSPORT_IDENTITY_REQUIRED");
  return {
    contract: ebayCreateStageFenceContract,
    stage: input.stage,
    mode: input.mode,
    prewriteReceiptSha256: input.evidence.receiptSha256,
    previousStageReceiptSha256: input.previousStageReceiptSha256 ?? null,
    remoteAction: input.evidence.action,
    remoteOfferId,
    providerRequestMethod,
    providerRequestPath,
    providerAccountSubjectSha256: input.evidence.providerAccountSubjectSha256,
    credential: {
      id: credentialId,
      version: credentialVersion,
      fingerprint: credentialFingerprint,
    },
    approval: {
      productId: text(external.productId),
      importId: text(external.importId),
      approvalRevision: Number(approval.approvalRevision),
      contentSha256: text(approval.contentSha256).toLowerCase(),
      requestSha256: text(external.requestSha256).toLowerCase(),
      revisionSha256: text(approval.revisionSha256).toLowerCase(),
      inventoryQuantity: Number(approval.inventoryQuantity),
      priceUsd: text(approval.priceUsd),
      currency: text(approval.currency).toUpperCase(),
      categoryAssignmentRevisionSha256: text(
        approval.categoryAssignmentRevisionSha256,
      ).toLowerCase(),
      categoryAssignment: {
        id: text(record(approval.categoryAssignment).id).toLowerCase(),
        confirmedAt: text(record(approval.categoryAssignment).confirmedAt),
        updatedAt: text(record(approval.categoryAssignment).updatedAt),
      },
      ledgerSnapshot: {
        contract: "sellerpilot_ebay_create_ledger_snapshot_v1",
        productUpdatedAt: text(ledgerSnapshot.productUpdatedAt),
        productSku: text(ledgerSnapshot.productSku),
        availableQuantity: Number(ledgerSnapshot.availableQuantity),
        priceUsd: text(ledgerSnapshot.priceUsd),
        draftId: text(ledgerSnapshot.draftId).toLowerCase(),
        draftVersion: Number(ledgerSnapshot.draftVersion),
        draftUpdatedAt: text(ledgerSnapshot.draftUpdatedAt),
        draftDataSha256: text(ledgerSnapshot.draftDataSha256).toLowerCase(),
      },
      providerRequestBodiesSha256,
    },
    stageProviderRequestBodySha256,
    tuple: {
      sku: text(input.arguments.sku),
      marketplaceId: text(offer.marketplaceId).toUpperCase(),
      categoryId: text(offer.categoryId),
      aspects: record(product.aspects),
      aspectsSha256: sha256(record(product.aspects)),
      quantity: Number(record(availability.shipToLocationAvailability).quantity),
      priceUsd: text(price.value),
      fulfillmentPolicyId: text(policies.fulfillmentPolicyId),
      paymentPolicyId: text(policies.paymentPolicyId),
      returnPolicyId: text(policies.returnPolicyId),
      merchantLocationKey: text(offer.merchantLocationKey),
      normalizedImageObjectPaths: transport.map((image) => text(image.objectPath)),
      normalizedImageContentSha256s: transport.map((image) => text(image.contentSha256).toLowerCase()),
    },
  };
}

export function assertEbayCreateStageFenceReceipt(
  request: EbayCreateStageFenceRequest,
  value: unknown,
): asserts value is EbayCreateStageFenceReceipt {
  const receipt = record(value);
  if (receipt.contract !== ebayCreateStageReceiptContract
      || !["staged", "replayed"].includes(text(receipt.status))
      || receipt.stage !== request.stage
      || receipt.prewriteReceiptSha256 !== request.prewriteReceiptSha256
      || !/^[a-f0-9]{64}$/u.test(text(receipt.stageReceiptSha256))
      || (request.previousStageReceiptSha256 !== null
        && (receipt.previousStageReceiptSha256 ?? null)
          !== request.previousStageReceiptSha256)
      || (receipt.previousStageReceiptSha256 !== null
        && !/^[a-f0-9]{64}$/u.test(text(receipt.previousStageReceiptSha256)))) {
    throw new Error("EBAY_CREATE_STAGE_FENCE_RECEIPT_INVALID");
  }
}
