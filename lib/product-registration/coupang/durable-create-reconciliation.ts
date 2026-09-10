import { createHash } from "node:crypto";
import { coupangRequest, textValue, type RemoteResponse, type SecretPayload } from "../../channels/protocols";
import { pathSegment } from "../../channels/operation-values";
import { compileCoupangOptionItems } from "./option-items";
import { assertCoupangGeneralCreateRequiredFields } from "./create-required-fields";
import { verifyCoupangCreateReadback } from "./create-readback";
import {
  listingPublicationReadbackExpectation,
  readCoupangListingPublicationState,
} from "../../channels/listing-publication-readback";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateFulfillsOperation,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "../../channels/listing-publication-state";

export const coupangDurableCreateReconciliationContract =
  "coupang_durable_create_reconciliation_v1" as const;

type UnknownRecord = Record<string, unknown>;

export type CoupangDurableCreateReconciliationArguments = {
  contract: typeof coupangDurableCreateReconciliationContract;
  sourceJobId: string;
  sourceAttemptId: string;
  listingId: string;
  sourceProductId: string;
  sourceRequestSha256: string;
  expectedVendorId: string;
  expectedCredentialId: string;
  expectedCredentialVersion: number;
  expectedCredentialFingerprint: string;
  expectedCredentialVaultSecretId: string;
  expectedCredentialSecretSha256: string;
  expectedCredentialSellerAccountKeySource: string;
  expectedOfficialSourceSnapshotId: string;
  expectedOfficialSourceSnapshotDigestSha256: string;
  expectedTransmissionId: string;
  expectedTransmissionDigestSha256: string;
  expectedProviderBodySealId: string;
  expectedProviderBodySha256: string;
  expectedSellerSkus: string[];
  sourceArguments: UnknownRecord;
};

export type CoupangDurableCreateReconciliationResult = {
  ok: true;
  channel: "coupang";
  operation: "listing.lineage.verify";
  verificationStatus: "verified";
  publicationStateContract?: "verified_remote_state_v1";
  publicationIntent?: ListingPublicationIntent;
  publicationFulfilled?: boolean;
  remoteState?: VerifiedListingRemoteState;
  evidence: {
    expectedRemoteId: string;
    verifiedRemoteId: string;
    market: "KR";
    targetId: string;
    evidenceVersion: "provider_listing_readback_rebind_v1";
    sourceJobId: string;
    sourceAttemptId: string;
    listingId: string;
    sourceRequestSha256: string;
    sellerSkus: string[];
    vendorId: string;
    sellerProductItemIds: string[];
    itemBindings: Array<{
      sellerSku: string;
      sellerProductItemId: string;
    }>;
    reconciliationContract: typeof coupangDurableCreateReconciliationContract;
  };
  steps: Array<{
    name: string;
    ok: true;
    status: number;
    data: Record<string, string | number | boolean>;
  }>;
  safeMessage: string;
};

export type CoupangDurableCreateReconciliationDependencies = {
  request: typeof coupangRequest;
};

const defaultDependencies: CoupangDurableCreateReconciliationDependencies = {
  request: coupangRequest,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function requiredUuid(value: unknown, name: string) {
  const normalized = String(value ?? "").trim();
  if (!uuidPattern.test(normalized)) {
    throw new Error(`COUPANG_CREATE_RECONCILIATION_ARGUMENT_INVALID:${name}`);
  }
  return normalized;
}

function lookupHasContinuation(data: UnknownRecord) {
  const nextToken = data.nextToken;
  const hasNext = data.hasNext;
  return (hasNext !== undefined && hasNext !== false)
    || (nextToken !== undefined && nextToken !== null && String(nextToken).trim() !== "");
}

function transientReadback(remote: RemoteResponse) {
  const status = remote.response.status;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function compiledSourceBody(sourceArguments: UnknownRecord) {
  const facts = recordValue(sourceArguments.facts);
  const body = compileCoupangOptionItems(
    structuredClone(recordValue(sourceArguments.body)),
    Object.hasOwn(facts, "coupangOptionRows") ? facts.coupangOptionRows : [],
    sourceArguments.sellerpilotCoupangBaseSku,
  );
  assertCoupangGeneralCreateRequiredFields(body);
  return body;
}

function sellerSkusFromBody(body: UnknownRecord) {
  const items = Array.isArray(body.items) ? body.items.map(recordValue) : [];
  const sellerSkus = items.map((item) => String(item.externalVendorSku ?? "").trim());
  if (!sellerSkus.length
    || sellerSkus.some((sellerSku) => !sellerSku)
    || new Set(sellerSkus).size !== sellerSkus.length) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_SOURCE_SKU_INVALID");
  }
  return sellerSkus;
}

function exactLookupRemoteId(remote: RemoteResponse, sellerSku: string, vendorId: string) {
  if (transientReadback(remote)) {
    throw new Error(`LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR:coupangExternalSku:${remote.response.status}`);
  }
  if (!remote.response.ok
    || remote.data.code !== "SUCCESS"
    || !Array.isArray(remote.data.data)
    || remote.data.data.length !== 1
    || lookupHasContinuation(remote.data)) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_AMBIGUOUS");
  }
  const match = recordValue(remote.data.data[0]);
  const remoteIdText = String(match.sellerProductId ?? "").trim();
  const remoteId = Number(remoteIdText);
  const returnedSku = String(match.externalVendorSku ?? "").trim();
  if (String(match.vendorId ?? "").trim() !== vendorId
    || !/^\d+$/u.test(remoteIdText)
    || !Number.isSafeInteger(remoteId)
    || remoteId <= 0
    || (returnedSku && returnedSku !== sellerSku)) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_IDENTITY_MISMATCH");
  }
  return remoteIdText;
}

export async function executeCoupangDurableCreateReconciliation(
  input: {
    payload: SecretPayload;
    arguments: CoupangDurableCreateReconciliationArguments;
  },
  dependencies: CoupangDurableCreateReconciliationDependencies = defaultDependencies,
): Promise<CoupangDurableCreateReconciliationResult> {
  const sourceJobId = requiredUuid(input.arguments.sourceJobId, "sourceJobId");
  const sourceAttemptId = requiredUuid(input.arguments.sourceAttemptId, "sourceAttemptId");
  const listingId = requiredUuid(input.arguments.listingId, "listingId");
  requiredUuid(input.arguments.sourceProductId, "sourceProductId");
  requiredUuid(input.arguments.expectedCredentialId, "expectedCredentialId");
  requiredUuid(input.arguments.expectedCredentialVaultSecretId, "expectedCredentialVaultSecretId");
  requiredUuid(input.arguments.expectedOfficialSourceSnapshotId, "expectedOfficialSourceSnapshotId");
  requiredUuid(input.arguments.expectedTransmissionId, "expectedTransmissionId");
  requiredUuid(input.arguments.expectedProviderBodySealId, "expectedProviderBodySealId");
  if (!Number.isSafeInteger(input.arguments.expectedCredentialVersion)
      || input.arguments.expectedCredentialVersion < 1
      || !String(input.arguments.expectedCredentialFingerprint ?? "").trim()
      || !String(input.arguments.expectedCredentialSellerAccountKeySource ?? "").trim()
      || ![
        input.arguments.expectedCredentialSecretSha256,
        input.arguments.expectedOfficialSourceSnapshotDigestSha256,
        input.arguments.expectedTransmissionDigestSha256,
        input.arguments.expectedProviderBodySha256,
      ].every((value) => sha256Pattern.test(String(value ?? "")))) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_CREDENTIAL_BINDING_INVALID");
  }
  const sourceRequestSha256 = String(input.arguments.sourceRequestSha256 ?? "").trim();
  if (input.arguments.contract !== coupangDurableCreateReconciliationContract
    || !sha256Pattern.test(sourceRequestSha256)) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_CONTRACT_INVALID");
  }
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId || vendorId !== String(input.arguments.expectedVendorId ?? "").trim()) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_VENDOR_MISMATCH");
  }
  if (sha256(input.payload) !== input.arguments.expectedCredentialSecretSha256) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_CREDENTIAL_SECRET_MISMATCH");
  }

  const body = compiledSourceBody(input.arguments.sourceArguments);
  const sellerSkus = sellerSkusFromBody(body);
  if (!Array.isArray(input.arguments.expectedSellerSkus)
    || input.arguments.expectedSellerSkus.length !== sellerSkus.length
    || input.arguments.expectedSellerSkus.some((value, index) => value !== sellerSkus[index])) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_SOURCE_SKU_MISMATCH");
  }
  const lookupSteps: CoupangDurableCreateReconciliationResult["steps"] = [];
  let sellerProductId = "";
  for (const sellerSku of sellerSkus) {
    const remote = await dependencies.request({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/external-vendor-sku-codes/${pathSegment(sellerSku)}`,
    });
    const foundRemoteId = exactLookupRemoteId(remote, sellerSku, vendorId);
    if (sellerProductId && sellerProductId !== foundRemoteId) {
      throw new Error("COUPANG_CREATE_RECONCILIATION_AMBIGUOUS");
    }
    sellerProductId = foundRemoteId;
    lookupSteps.push({
      name: `coupang-create-reconciliation-sku-readback:${lookupSteps.length + 1}`,
      ok: true,
      status: remote.response.status,
      data: {
        sellerpilotVerification: "COUPANG_EXTERNAL_VENDOR_SKU_EXACT",
        sellerProductId,
      },
    });
  }

  const sellerProductRemote = await dependencies.request({
    payload: input.payload,
    method: "GET",
    path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${pathSegment(sellerProductId)}`,
  });
  if (transientReadback(sellerProductRemote)) {
    throw new Error(`LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR:coupangSellerProduct:${sellerProductRemote.response.status}`);
  }
  const sellerProduct = recordValue(sellerProductRemote.data.data);
  const identity = verifyCoupangCreateReadback({
    requestBody: { ...body, vendorId },
    sellerProduct,
    expectedVendorId: vendorId,
    expectedSellerProductId: sellerProductId,
  });
  if (!sellerProductRemote.response.ok
    || sellerProductRemote.data.code !== "SUCCESS"
    || !identity.ok) {
    throw new Error(`COUPANG_CREATE_RECONCILIATION_READBACK_MISMATCH:${identity.code}`);
  }
  const observedSellerProductItemIds = Array.isArray(sellerProduct.items)
    ? sellerProduct.items.map(recordValue)
      .map((item) => String(item.sellerProductItemId ?? "").trim())
    : [];
  if (observedSellerProductItemIds.length !== sellerSkus.length
    || observedSellerProductItemIds.some((itemId) => !/^\d+$/u.test(itemId))
    || new Set(observedSellerProductItemIds).size !== observedSellerProductItemIds.length) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_ITEM_ID_MISMATCH");
  }
  const observedItemsBySku = new Map(
    (Array.isArray(sellerProduct.items) ? sellerProduct.items.map(recordValue) : [])
      .map((item) => [
        String(item.externalVendorSku ?? "").trim(),
        String(item.sellerProductItemId ?? "").trim(),
      ] as const),
  );
  const itemBindings = sellerSkus.map((sellerSku) => ({
    sellerSku,
    sellerProductItemId: observedItemsBySku.get(sellerSku) ?? "",
  }));
  if (itemBindings.some((binding) => !/^\d+$/u.test(binding.sellerProductItemId))) {
    throw new Error("COUPANG_CREATE_RECONCILIATION_ITEM_ID_MISMATCH");
  }
  const sellerProductItemIds = itemBindings.map((binding) => binding.sellerProductItemId);

  const publicationIntent = listingPublicationIntentFromArguments(
    input.arguments.sourceArguments,
  );
  const publicationExpectation = listingPublicationReadbackExpectation(
    input.arguments.sourceArguments,
  );
  let publicationState: VerifiedListingRemoteState | undefined;
  const publicationSteps: CoupangDurableCreateReconciliationResult["steps"] = [];
  if (input.arguments.sourceArguments.publicationStateContract === "verified_remote_state_v1"
      && publicationIntent
      && publicationExpectation) {
    let sellerProductReadbackReused = false;
    const publication = await readCoupangListingPublicationState({
      operation: "listing.create",
      intent: publicationIntent,
      remoteId: sellerProductId,
      expected: publicationExpectation,
      readSellerProduct: async () => {
        if (!sellerProductReadbackReused) {
          sellerProductReadbackReused = true;
          return sellerProductRemote;
        }
        return dependencies.request({
          payload: input.payload,
          method: "GET",
          path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${pathSegment(sellerProductId)}`,
        });
      },
      readVendorItem: (vendorItemId) => dependencies.request({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(vendorItemId)}/inventories`,
      }),
    });
    publicationState = publication.state;
    if (!publicationState) {
      throw new Error(`LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR:coupangPublication:${publication.failureCode ?? "unverified"}`);
    }
    publication.vendorItemReadbacks.forEach(({ vendorItemId, remote }, index) => {
      publicationSteps.push({
        name: `coupang-create-reconciliation-vendor-item-readback:${index + 1}`,
        ok: true,
        status: remote.response.status,
        data: { sellerpilotVendorItemId: vendorItemId },
      });
    });
  }

  return {
    ok: true,
    channel: "coupang",
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    ...(publicationState && publicationIntent
      ? {
        publicationStateContract: "verified_remote_state_v1" as const,
        publicationIntent,
        publicationFulfilled: listingRemoteStateFulfillsOperation(
          "listing.create",
          publicationState,
          publicationIntent,
        ),
        remoteState: publicationState,
      }
      : {}),
    evidence: {
      expectedRemoteId: sellerProductId,
      verifiedRemoteId: sellerProductId,
      market: "KR",
      targetId: vendorId,
      evidenceVersion: "provider_listing_readback_rebind_v1",
      sourceJobId,
      sourceAttemptId,
      listingId,
      sourceRequestSha256,
      sellerSkus,
      vendorId,
      sellerProductItemIds,
      itemBindings,
      reconciliationContract: coupangDurableCreateReconciliationContract,
    },
    steps: [
      ...lookupSteps,
      {
        name: "coupang-create-reconciliation-product-readback",
        ok: true,
        status: sellerProductRemote.response.status,
        data: {
          sellerpilotVerification: identity.code,
          sellerProductId,
          sellerSkuCount: sellerSkus.length,
          sellerProductItemIdCount: sellerProductItemIds.length,
        },
      },
      ...publicationSteps,
    ],
    safeMessage: "쿠팡 CREATE 결과를 판매자 SKU와 상품 ID의 공식 GET으로 복구했습니다.",
  };
}
