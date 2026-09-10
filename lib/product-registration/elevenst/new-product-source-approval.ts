import { createHash } from "node:crypto";
import { z } from "zod";
import {
  elevenstProviderAvailabilityReceiptContract,
  elevenstSellerIdentityReceiptContract,
  type ElevenstNoticeInput,
  type ElevenstNoticeSourceKind,
} from "../../channels/elevenst-new-product-input";
import {
  elevenstProcessedFoodCategoryId,
  elevenstProcessedFoodNotificationFields,
  elevenstProcessedFoodProductNameNoticeCode,
  elevenstSaleDateRange,
} from "../../channels/elevenst-listing";
import {
  buildElevenstNewProductArgumentsFromServerSources,
  elevenstNewProductAvailabilitySourceContract,
  elevenstNewProductCredentialSourceContract,
  elevenstNewProductNoticeSourceContract,
  elevenstNewProductPolicySourceContract,
  elevenstNewProductSellerSourceContract,
  elevenstNewProductServerSourceContract,
  elevenstNewProductSourceDigest,
} from "./new-product-input-source";

export const elevenstNewProductSourceApprovalContract =
  "sellerpilot_elevenst_new_product_source_approval_v1" as const;
export const elevenstNewProductSourceApprovalWriterRpc =
  "sellerpilot_service_approve_elevenst_new_product_source" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const noticeSourceKind = z.enum([
  "product_label",
  "manufacturer_document",
  "seller_declaration",
  "sellerpilot_approved_fact",
]);
const noticeSchema = z.object({
  code: z.string().regex(/^\d{5,12}$/u),
  value: z.string().trim().min(1).max(2_000),
  sourceKind: noticeSourceKind,
  sourceSha256: sha256,
  capturedAt: timestamp,
}).strict();
const availabilitySchema = z.object({
  contract: z.literal(elevenstProviderAvailabilityReceiptContract),
  state: z.enum(["available", "scheduled_maintenance", "unavailable"]),
  observedAt: timestamp,
  maintenance: z.object({ startsAt: timestamp, endsAt: timestamp }).strict().optional(),
}).strict();

export const elevenstNewProductSourceApprovalRequestSchema = z.object({
  contract: z.literal(elevenstNewProductSourceApprovalContract),
  approvalRequestId: z.string().uuid(),
  productId: z.string().uuid(),
  credentialId: z.string().uuid(),
  market: z.string().trim().min(1).max(32),
  targetId: z.string().trim().min(1).max(160),
  notices: z.array(noticeSchema).length(10),
  sellerOfficeAccountSha256: sha256,
  sellerVerifiedAt: timestamp,
  availability: availabilitySchema,
  shipping: z.object({
    shippingFeeKrw: z.literal(3_000),
    bundleDeliveryCode: z.enum(["Y", "N"]),
    outboundAddressId: z.string().trim().regex(/^[1-9]\d{0,19}$/u),
    returnAddressId: z.string().trim().regex(/^[1-9]\d{0,19}$/u),
  }).strict(),
  returns: z.object({
    returnFeeKrw: z.number().int().min(0).max(9_999_990).multipleOf(10),
    exchangeFeeKrw: z.number().int().min(0).max(9_999_990).multipleOf(10),
    asDetail: z.string().trim().min(1).max(2_000),
    returnExchangeDetail: z.string().trim().min(1).max(2_000),
  }).strict(),
}).strict().superRefine((value, context) => {
  const expectedCodes = elevenstProcessedFoodNotificationFields
    .map(({ code }) => code)
    .filter((code) => code !== elevenstProcessedFoodProductNameNoticeCode);
  if (value.notices.length !== expectedCodes.length
    || value.notices.some((notice, index) => notice.code !== expectedCodes[index])) {
    context.addIssue({
      code: "custom",
      path: ["notices"],
      message: "The ten manual notice codes must use the official order.",
    });
  }
});

export type ElevenstNewProductSourceApprovalRequest = z.infer<
  typeof elevenstNewProductSourceApprovalRequestSchema
>;

export type ElevenstNewProductSourceAutomaticContext = {
  actorId: string;
  ownerId: string;
  productId: string;
  productUpdatedAt: string;
  productRevision: number;
  productApprovalRevision: number;
  productName: string;
  sellerProductCode: string;
  inventoryQuantity: number;
  credentialId: string;
  credentialVersion: number;
  credentialSellerIdSha256: string;
  draftVersion: number;
  approvedPriceKrw: number;
  approvedQuantity: number;
  brand: string;
  countryOfOrigin: string;
  conditionCode: "01" | "02";
  productImageUrls: string[];
  detailImageUrls: string[];
  detailManifestDigest: string;
};

export type ElevenstNewProductSourceApprovalPayload = {
  contract: typeof elevenstNewProductSourceApprovalContract;
  approvalRequestId: string;
  actorId: string;
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  credentialId: string;
  credentialVersion: number;
  productUpdatedAt: string;
  productRevision: number;
  productApprovalRevision: number;
  draftVersion: number;
  detailManifestDigest: string;
  providerProduct: Record<string, unknown>;
  providerProductSha256: string;
  notices: ElevenstNoticeInput[];
  sellerReceipt: Record<string, unknown>;
  availabilityReceipt: Record<string, unknown>;
  policySource: Record<string, unknown>;
  policySourceRevision: number;
  policyApprovalRevision: number;
};

function textSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function noticeInputs(
  request: ElevenstNewProductSourceApprovalRequest,
  context: ElevenstNewProductSourceAutomaticContext,
  approvedAt: string,
): ElevenstNoticeInput[] {
  return request.notices.map((notice) => ({
    code: notice.code,
    required: true,
    value: notice.value,
    source: {
      kind: notice.sourceKind as ElevenstNoticeSourceKind,
      productId: context.productId,
      revision: context.draftVersion,
      sourceSha256: notice.sourceSha256,
      capturedAt: notice.capturedAt,
    },
    approval: {
      productId: context.productId,
      categoryId: elevenstProcessedFoodCategoryId,
      fieldCode: notice.code,
      revision: context.draftVersion,
      sourceSha256: notice.sourceSha256,
      valueSha256: textSha256(notice.value.trim()),
      approvedAt,
    },
  }));
}

function providerProduct(
  context: ElevenstNewProductSourceAutomaticContext,
  now: Date,
) {
  const salePeriod = elevenstSaleDateRange(now);
  return {
    selMthdCd: "01",
    dispCtgrNo: elevenstProcessedFoodCategoryId,
    prdTypCd: "01",
    prdNm: context.productName,
    brand: context.brand,
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: context.countryOfOrigin,
    sellerPrdCd: context.sellerProductCode,
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: context.conditionCode,
    minorSelCnYn: "Y",
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    ...salePeriod,
    selPrc: String(context.approvedPriceKrw),
    prdSelQty: String(context.approvedQuantity),
    dlvCnAreaCd: "01",
    dlvWyCd: "01",
  };
}

export async function buildElevenstNewProductSourceApproval(
  rawRequest: unknown,
  automatic: ElevenstNewProductSourceAutomaticContext,
  now = new Date(),
): Promise<{
  payload: ElevenstNewProductSourceApprovalPayload;
  preparedArguments: Record<string, unknown>;
}> {
  const request = elevenstNewProductSourceApprovalRequestSchema.parse(rawRequest);
  if (request.productId !== automatic.productId
    || request.credentialId !== automatic.credentialId
    || automatic.productRevision !== automatic.productApprovalRevision
    || automatic.productRevision < 1
    || automatic.draftVersion < 1
    || automatic.inventoryQuantity !== automatic.approvedQuantity
    || automatic.approvedPriceKrw < 1
    || automatic.approvedPriceKrw % 10 !== 0
    || automatic.productImageUrls.length !== 4
    || automatic.detailImageUrls.length !== 8
    || !/^[a-f0-9]{64}$/u.test(automatic.detailManifestDigest)) {
    throw new Error("ELEVENST_NEW_PRODUCT_APPROVAL_AUTOMATIC_CONTEXT_INVALID");
  }
  const approvedAt = now.toISOString();
  const product = providerProduct(automatic, now);
  const notices = noticeInputs(request, automatic, approvedAt);
  const sellerReceipt = {
    contract: elevenstSellerIdentityReceiptContract,
    credentialId: automatic.credentialId,
    credentialVersion: automatic.credentialVersion,
    environment: "production",
    sellerIdSha256: automatic.credentialSellerIdSha256,
    sellerOfficeAccountSha256: request.sellerOfficeAccountSha256,
    ownershipRevision: automatic.draftVersion,
    verifiedAt: request.sellerVerifiedAt,
  };
  const htmlDetail = `<section>${automatic.detailImageUrls
    .map((url) => `<img src="${url}">`)
    .join("")}</section>`;
  const policySource = {
    shipping: {
      shippingFeeKrw: request.shipping.shippingFeeKrw,
      deliveryCostBasisCode: "02",
      paymentTypeCode: "03",
      bundleDeliveryCode: request.shipping.bundleDeliveryCode,
      outboundAddressId: request.shipping.outboundAddressId,
      returnAddressId: request.shipping.returnAddressId,
    },
    returns: request.returns,
    content: {
      htmlDetail,
      htmlDetailSha256: textSha256(htmlDetail),
      productImageUrls: automatic.productImageUrls,
      detailImageUrls: automatic.detailImageUrls,
      imageUrlsSha256: elevenstNewProductSourceDigest({
        productImageUrls: automatic.productImageUrls,
        detailImageUrls: automatic.detailImageUrls,
      }),
    },
  };
  const productSource = {
    contract: elevenstNewProductServerSourceContract,
    current: true,
    ownerId: automatic.ownerId,
    productId: automatic.productId,
    categoryId: elevenstProcessedFoodCategoryId,
    revision: automatic.productRevision,
    approvalRevision: automatic.productApprovalRevision,
    providerProduct: product,
    providerProductSha256: elevenstNewProductSourceDigest(product),
  };
  const sources = {
    product: productSource,
    credential: {
      contract: elevenstNewProductCredentialSourceContract,
      current: true,
      ownerId: automatic.ownerId,
      credentialId: automatic.credentialId,
      credentialVersion: automatic.credentialVersion,
      channel: "elevenst",
      environment: "production",
      status: "active",
    },
    notices: {
      contract: elevenstNewProductNoticeSourceContract,
      current: true,
      ownerId: automatic.ownerId,
      productId: automatic.productId,
      categoryId: elevenstProcessedFoodCategoryId,
      productRevision: automatic.productRevision,
      notices,
    },
    seller: {
      contract: elevenstNewProductSellerSourceContract,
      current: true,
      ownerId: automatic.ownerId,
      productId: automatic.productId,
      credentialId: automatic.credentialId,
      credentialVersion: automatic.credentialVersion,
      receipt: sellerReceipt,
    },
    availability: {
      contract: elevenstNewProductAvailabilitySourceContract,
      current: true,
      ownerId: automatic.ownerId,
      productId: automatic.productId,
      credentialId: automatic.credentialId,
      credentialVersion: automatic.credentialVersion,
      receipt: request.availability,
    },
    policy: {
      contract: elevenstNewProductPolicySourceContract,
      current: true,
      ownerId: automatic.ownerId,
      productId: automatic.productId,
      categoryId: elevenstProcessedFoodCategoryId,
      productRevision: automatic.productRevision,
      sourceRevision: automatic.draftVersion,
      approvalRevision: automatic.draftVersion,
      approvedAt,
      ...policySource,
    },
  };
  const prepared = await buildElevenstNewProductArgumentsFromServerSources({
    ownerId: automatic.ownerId,
    productId: automatic.productId,
    categoryId: elevenstProcessedFoodCategoryId,
    credentialId: automatic.credentialId,
    credentialVersion: automatic.credentialVersion,
    environment: "production",
    arguments: {},
    now,
  }, {
    readProductSource: async () => sources.product,
    readCredentialSource: async () => sources.credential,
    readNoticeSource: async () => sources.notices,
    readSellerSource: async () => sources.seller,
    readAvailabilitySource: async () => sources.availability,
    readPolicySource: async () => sources.policy,
  });
  if (!prepared.ok) {
    const error = new Error("ELEVENST_NEW_PRODUCT_APPROVAL_INPUT_BLOCKED");
    Object.assign(error, { blockers: prepared.blockers });
    throw error;
  }

  return {
    preparedArguments: prepared.arguments,
    payload: {
      contract: elevenstNewProductSourceApprovalContract,
      approvalRequestId: request.approvalRequestId,
      actorId: automatic.actorId,
      ownerId: automatic.ownerId,
      productId: automatic.productId,
      categoryId: elevenstProcessedFoodCategoryId,
      credentialId: automatic.credentialId,
      credentialVersion: automatic.credentialVersion,
      productUpdatedAt: automatic.productUpdatedAt,
      productRevision: automatic.productRevision,
      productApprovalRevision: automatic.productApprovalRevision,
      draftVersion: automatic.draftVersion,
      detailManifestDigest: automatic.detailManifestDigest,
      providerProduct: product,
      providerProductSha256: productSource.providerProductSha256,
      notices,
      sellerReceipt,
      availabilityReceipt: request.availability,
      policySource,
      policySourceRevision: automatic.draftVersion,
      policyApprovalRevision: automatic.draftVersion,
    },
  };
}
