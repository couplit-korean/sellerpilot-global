import { createHash } from "node:crypto";
import {
  normalizedListingPublicationText,
  parseListingPublicationAssetBinding,
} from "./listing-publication-content";
import { externalDetailDigest } from "../external-detail-copy";
import {
  qoo10ListingCreateFulfillmentEvidence,
  qoo10ListingCreateFulfillmentEvidenceArgument,
  type Qoo10ListingCreateFulfillmentEvidence,
} from "./qoo10-listing-create-fulfillment-evidence";

export const qoo10ListingCreateApprovalBindingContract =
  "sellerpilot_qoo10_listing_create_approval_v1" as const;
export const qoo10ListingCreateApprovalBindingArgument =
  "sellerpilotQoo10CreateApprovalBinding" as const;

type UnknownRecord = Record<string, unknown>;

export type Qoo10ListingCreateApprovalBinding = {
  contract: typeof qoo10ListingCreateApprovalBindingContract;
  approvalRevision: number;
  approvalContentSha256: string;
  approvedDetailPageVersion: number;
  approvedManifestDigest: string;
  japaneseDocumentSha256: string;
  englishDocumentSha256: string;
  sellerIdDigest: string;
  sellerAccountIdentityDigest: string;
  testItemCode: string;
  testItemSellerCodeDigest: string;
  dispatchPlaceId: string;
  returnPolicyId: string;
  fulfillmentEvidenceRevision: string;
  fulfillmentEvidenceObservedAt: string;
  fulfillmentEvidenceExpiresAt: string;
  fulfillmentEvidenceDigest: string;
  dispatchPlaceDigest: string;
  returnPolicyDigest: string;
  approvalPayloadDigest: string;
};

export type Qoo10ListingCreateFulfillmentApproval =
  Qoo10ListingCreateFulfillmentEvidence;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const row = record(value);
  if (row) {
    return `{${Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function digestText(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : "";
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function approvalAssets(argumentsValue: UnknownRecord) {
  const prepared = parseListingPublicationAssetBinding(
    argumentsValue.sellerpilotPublicationAssetBinding,
  );
  if (prepared) {
    return {
      version: prepared.approvedDetailPageVersion,
      manifestDigest: prepared.approvedManifestDigest,
      roles: prepared.approvedDetailImages.map((image) => image.role),
      sourceSha256s: prepared.approvedDetailImages.map(
        (image) => image.approvedSourceSha256 ?? "",
      ),
    };
  }
  const assets = record(argumentsValue.sellerpilotAssets);
  const version = Number(assets?.approvedDetailPageVersion);
  const manifestDigest = digestText(assets?.detailImageManifestDigest);
  const roles = strings(assets?.detailImageRoles);
  const sourceSha256s = strings(assets?.approvedDetailImageSha256s)
    .map((value) => value.toLowerCase());
  if (!Number.isSafeInteger(version) || version < 1
      || !manifestDigest
      || roles.length !== 8 || new Set(roles).size !== 8
      || sourceSha256s.length !== 8 || new Set(sourceSha256s).size !== 8
      || sourceSha256s.some((value) => !digestText(value))) return null;
  return { version, manifestDigest, roles, sourceSha256s };
}

function shippingProjection(argumentsValue: UnknownRecord) {
  const assets = record(argumentsValue.sellerpilotAssets);
  const shipping = record(assets?.shipping);
  if (!shipping) return null;
  const shippingFeeKrw = Number(shipping.shippingFeeKrw);
  const shippingRule = text(shipping.shippingRule);
  const packagingRule = text(shipping.packagingRule);
  if (!Number.isSafeInteger(shippingFeeKrw) || shippingFeeKrw < 0
      || shipping.policyReview !== "확인"
      || (shippingRule && shipping.shippingRuleReview !== "확인")
      || (packagingRule && shipping.packagingRuleReview !== "확인")) return null;
  return {
    shippingFeeKrw,
    shippingRule,
    packagingRule,
    policyReview: "확인",
    shippingRuleReview: shippingRule ? "확인" : "",
    packagingRuleReview: packagingRule ? "확인" : "",
  };
}

function externalApproval(argumentsValue: UnknownRecord) {
  const external = record(argumentsValue.sellerpilotExternalDetail);
  const allDocuments = record(external?.allLocaleDocumentSha256);
  const approvalRevision = Number(external?.approvalRevision);
  const approvalContentSha256 = digestText(external?.contentSha256);
  const japaneseDocumentSha256 = digestText(external?.documentSha256);
  const englishDocumentSha256 = digestText(allDocuments?.en);
  const japaneseIndexSha256 = digestText(allDocuments?.ja);
  const imageSha256s = strings(external?.imageSha256s)
    .map((value) => value.toLowerCase());
  const exportSha256 = digestText(external?.exportSha256);
  if (!external
      || external.contract !== "sellerpilot_external_detail_channel_v1"
      || external.channel !== "qoo10" || external.market !== "JP"
      || external.locale !== "ja-JP" || external.language !== "ja"
      || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1
      || !approvalContentSha256 || !japaneseDocumentSha256
      || japaneseIndexSha256 !== japaneseDocumentSha256
      || !englishDocumentSha256
      || imageSha256s.length !== 8 || new Set(imageSha256s).size !== 8
      || imageSha256s.some((value) => !digestText(value))
      || !digestText(external.requestSha256)
      || !exportSha256
      || externalDetailDigest({
        title: external.title,
        html: external.html,
        plain: external.plain,
        sections: external.sections,
      }) !== exportSha256) return null;
  return {
    approvalRevision,
    approvalContentSha256,
    japaneseDocumentSha256,
    englishDocumentSha256,
    version: Number(external.version),
    productId: text(external.productId).toLowerCase(),
    requestSha256: digestText(external.requestSha256),
    exportSha256,
    title: text(external.title),
    html: text(external.html),
    imageSha256s,
  };
}

function normalizedApprovedDescription(value: unknown) {
  return normalizedListingPublicationText(
    text(value).replace(/\{\{SELLERPILOT_IMAGE:detail-[a-z0-9-]+\}\}/gu, ""),
  );
}

function approvalProjection(argumentsValue: UnknownRecord, now: Date = new Date()) {
  const external = externalApproval(argumentsValue);
  const assets = approvalAssets(argumentsValue);
  const shipping = shippingProjection(argumentsValue);
  const context = record(argumentsValue.sellerpilotQoo10CreateContext);
  const params = record(argumentsValue.params);
  const fulfillment = qoo10ListingCreateFulfillmentEvidence(
    argumentsValue[qoo10ListingCreateFulfillmentEvidenceArgument],
    now,
  );
  if (!external || !assets || !shipping || !context || !params || !fulfillment
      || external.version !== assets.version
      || external.productId !== text(context.productId).toLowerCase()
      || external.title !== text(params.ItemTitle)
      || normalizedApprovedDescription(external.html)
        !== normalizedApprovedDescription(params.ItemDescription)
      || !sameOrderedValues(external.imageSha256s, assets.sourceSha256s)
      || text(params.SellerCode) !== text(context.sku)
      || text(params.ShippingNo) === ""
      || (text(params.ShippingNo) === "0" && shipping.shippingFeeKrw !== 0)) {
    return null;
  }
  return {
    approval: {
      revision: external.approvalRevision,
      contentSha256: external.approvalContentSha256,
      requestSha256: external.requestSha256,
      exportSha256: external.exportSha256,
      japaneseDocumentSha256: external.japaneseDocumentSha256,
      englishDocumentSha256: external.englishDocumentSha256,
      detailPageVersion: assets.version,
      manifestDigest: assets.manifestDigest,
      imageRoles: assets.roles,
      imageSourceSha256s: assets.sourceSha256s,
    },
    identity: {
      productId: text(context.productId).toLowerCase(),
      sellerCode: text(params.SellerCode),
      market: context.market,
      locale: context.locale,
    },
    catalog: {
      categoryCode: text(params.SecondSubCat),
      manufactureNo: text(params.ManufactureNo),
      brandNo: text(params.BrandNo),
      productionPlaceType: text(params.ProductionPlaceType),
      productionPlace: text(params.ProductionPlace),
    },
    content: {
      itemTitle: text(params.ItemTitle),
      descriptionTextDigest: digest(normalizedApprovedDescription(params.ItemDescription)),
    },
    commerce: {
      retailPrice: text(params.RetailPrice),
      itemPrice: text(params.ItemPrice),
      itemQty: text(params.ItemQty),
      availableDateType: text(params.AvailableDateType),
      availableDateValue: text(params.AvailableDateValue),
      additionalOption: text(params.AdditionalOption),
      itemType: text(params.ItemType),
    },
    fulfillment: {
      shippingNo: text(params.ShippingNo),
      ...shipping,
      sellerIdDigest: fulfillment.sellerIdDigest,
      sellerAccountIdentityDigest: fulfillment.sellerAccountIdentityDigest,
      testItemCode: fulfillment.testItemCode,
      testItemSellerCodeDigest: fulfillment.testItemSellerCodeDigest,
      dispatchPlaceId: fulfillment.dispatchPlaceId,
      returnPolicyId: fulfillment.returnPolicyId,
      dispatchPlaceDigest: fulfillment.dispatchPlaceDigest,
      returnPolicyDigest: fulfillment.returnPolicyDigest,
      evidenceRevision: fulfillment.evidenceRevision,
      evidenceObservedAt: fulfillment.evidenceObservedAt,
      evidenceExpiresAt: fulfillment.evidenceExpiresAt,
      evidenceDigest: fulfillment.evidenceDigest,
    },
  };
}

export function bindQoo10ListingCreateApproval(
  argumentsValue: UnknownRecord,
  fulfillment: Qoo10ListingCreateFulfillmentApproval,
  now: Date = new Date(),
) {
  // The caller must derive fulfillment digests from the authenticated Qoo10
  // seller account. The binding itself is then included in the server-owned
  // request fingerprint before a gateway job can reach this worker gate.
  const trustedFulfillment = qoo10ListingCreateFulfillmentEvidence(fulfillment, now);
  if (!trustedFulfillment) {
    throw new Error("QOO10_CREATE_FULFILLMENT_EVIDENCE_INVALID");
  }
  const boundArguments = {
    ...argumentsValue,
    [qoo10ListingCreateFulfillmentEvidenceArgument]: trustedFulfillment,
  };
  const projection = approvalProjection(boundArguments, now);
  if (!projection) throw new Error("QOO10_CREATE_APPROVAL_SOURCE_INVALID");
  return {
    ...boundArguments,
    [qoo10ListingCreateApprovalBindingArgument]: {
      contract: qoo10ListingCreateApprovalBindingContract,
      approvalRevision: projection.approval.revision,
      approvalContentSha256: projection.approval.contentSha256,
      approvedDetailPageVersion: projection.approval.detailPageVersion,
      approvedManifestDigest: projection.approval.manifestDigest,
      japaneseDocumentSha256: projection.approval.japaneseDocumentSha256,
      englishDocumentSha256: projection.approval.englishDocumentSha256,
      sellerIdDigest: projection.fulfillment.sellerIdDigest,
      sellerAccountIdentityDigest:
        projection.fulfillment.sellerAccountIdentityDigest,
      testItemCode: projection.fulfillment.testItemCode,
      testItemSellerCodeDigest:
        projection.fulfillment.testItemSellerCodeDigest,
      dispatchPlaceId: projection.fulfillment.dispatchPlaceId,
      returnPolicyId: projection.fulfillment.returnPolicyId,
      fulfillmentEvidenceRevision: projection.fulfillment.evidenceRevision,
      fulfillmentEvidenceObservedAt: projection.fulfillment.evidenceObservedAt,
      fulfillmentEvidenceExpiresAt: projection.fulfillment.evidenceExpiresAt,
      fulfillmentEvidenceDigest: projection.fulfillment.evidenceDigest,
      dispatchPlaceDigest: projection.fulfillment.dispatchPlaceDigest,
      returnPolicyDigest: projection.fulfillment.returnPolicyDigest,
      approvalPayloadDigest: digest(projection),
    } satisfies Qoo10ListingCreateApprovalBinding,
  };
}

export function qoo10ListingCreateApprovalBinding(
  argumentsValue: UnknownRecord,
  now: Date = new Date(),
): Qoo10ListingCreateApprovalBinding | null {
  const binding = record(
    argumentsValue[qoo10ListingCreateApprovalBindingArgument],
  );
  if (!binding || binding.contract !== qoo10ListingCreateApprovalBindingContract) {
    return null;
  }
  const parsed: Qoo10ListingCreateApprovalBinding = {
    contract: qoo10ListingCreateApprovalBindingContract,
    approvalRevision: Number(binding.approvalRevision),
    approvalContentSha256: digestText(binding.approvalContentSha256),
    approvedDetailPageVersion: Number(binding.approvedDetailPageVersion),
    approvedManifestDigest: digestText(binding.approvedManifestDigest),
    japaneseDocumentSha256: digestText(binding.japaneseDocumentSha256),
    englishDocumentSha256: digestText(binding.englishDocumentSha256),
    sellerIdDigest: digestText(binding.sellerIdDigest),
    sellerAccountIdentityDigest: digestText(binding.sellerAccountIdentityDigest),
    testItemCode: text(binding.testItemCode),
    testItemSellerCodeDigest: digestText(binding.testItemSellerCodeDigest),
    dispatchPlaceId: text(binding.dispatchPlaceId),
    returnPolicyId: text(binding.returnPolicyId),
    fulfillmentEvidenceRevision: digestText(binding.fulfillmentEvidenceRevision),
    fulfillmentEvidenceObservedAt: text(binding.fulfillmentEvidenceObservedAt),
    fulfillmentEvidenceExpiresAt: text(binding.fulfillmentEvidenceExpiresAt),
    fulfillmentEvidenceDigest: digestText(binding.fulfillmentEvidenceDigest),
    dispatchPlaceDigest: digestText(binding.dispatchPlaceDigest),
    returnPolicyDigest: digestText(binding.returnPolicyDigest),
    approvalPayloadDigest: digestText(binding.approvalPayloadDigest),
  };
  const requiredDigests = [
    parsed.approvalContentSha256,
    parsed.approvedManifestDigest,
    parsed.japaneseDocumentSha256,
    parsed.englishDocumentSha256,
    parsed.sellerIdDigest,
    parsed.sellerAccountIdentityDigest,
    parsed.testItemSellerCodeDigest,
    parsed.fulfillmentEvidenceRevision,
    parsed.fulfillmentEvidenceDigest,
    parsed.dispatchPlaceDigest,
    parsed.returnPolicyDigest,
    parsed.approvalPayloadDigest,
  ];
  if (!Number.isSafeInteger(parsed.approvalRevision)
      || parsed.approvalRevision < 1
      || !Number.isSafeInteger(parsed.approvedDetailPageVersion)
      || parsed.approvedDetailPageVersion < 1
      || requiredDigests.some((value) => !value)) {
    return null;
  }
  const projection = approvalProjection(argumentsValue, now);
  if (!projection
      || parsed.approvalRevision !== projection.approval.revision
      || parsed.approvalContentSha256 !== projection.approval.contentSha256
      || parsed.approvedDetailPageVersion !== projection.approval.detailPageVersion
      || parsed.approvedManifestDigest !== projection.approval.manifestDigest
      || parsed.japaneseDocumentSha256 !== projection.approval.japaneseDocumentSha256
      || parsed.englishDocumentSha256 !== projection.approval.englishDocumentSha256
      || parsed.sellerIdDigest !== projection.fulfillment.sellerIdDigest
      || parsed.sellerAccountIdentityDigest
        !== projection.fulfillment.sellerAccountIdentityDigest
      || parsed.testItemCode !== projection.fulfillment.testItemCode
      || parsed.testItemSellerCodeDigest
        !== projection.fulfillment.testItemSellerCodeDigest
      || parsed.dispatchPlaceId !== projection.fulfillment.dispatchPlaceId
      || parsed.returnPolicyId !== projection.fulfillment.returnPolicyId
      || parsed.fulfillmentEvidenceRevision !== projection.fulfillment.evidenceRevision
      || parsed.fulfillmentEvidenceObservedAt !== projection.fulfillment.evidenceObservedAt
      || parsed.fulfillmentEvidenceExpiresAt !== projection.fulfillment.evidenceExpiresAt
      || parsed.fulfillmentEvidenceDigest !== projection.fulfillment.evidenceDigest
      || parsed.dispatchPlaceDigest !== projection.fulfillment.dispatchPlaceDigest
      || parsed.returnPolicyDigest !== projection.fulfillment.returnPolicyDigest
      || parsed.approvalPayloadDigest !== digest(projection)) return null;
  return parsed;
}
