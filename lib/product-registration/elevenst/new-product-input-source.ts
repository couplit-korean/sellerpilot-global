import { createHash } from "node:crypto";
import {
  elevenstNewProductInputContract,
  resolveElevenstNewProductInput,
  type ElevenstNoticeInput,
  type ElevenstProviderAvailabilityReceipt,
  type ElevenstSellerIdentityReceipt,
} from "../../channels/elevenst-new-product-input";
import {
  elevenstProcessedFoodCategoryId,
} from "../../channels/elevenst-listing";
import {
  buildElevenstNewProductInputExecutionReceipt,
  elevenstNewProductInputReceiptArgument,
} from "./new-product-input-execution";

export const elevenstNewProductServerSourceContract =
  "sellerpilot_elevenst_new_product_server_source_v1" as const;
export const elevenstNewProductNoticeSourceContract =
  "sellerpilot_elevenst_new_product_notice_source_v1" as const;
export const elevenstNewProductCredentialSourceContract =
  "sellerpilot_elevenst_new_product_credential_source_v1" as const;
export const elevenstNewProductSellerSourceContract =
  "sellerpilot_elevenst_new_product_seller_source_v1" as const;
export const elevenstNewProductAvailabilitySourceContract =
  "sellerpilot_elevenst_new_product_availability_source_v1" as const;
export const elevenstNewProductPolicySourceContract =
  "sellerpilot_elevenst_new_product_policy_source_v1" as const;

type ExactSourceKey = {
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  credentialId: string;
  credentialVersion: number;
  environment: "production";
};

export type ElevenstNewProductServerSource = {
  contract: typeof elevenstNewProductServerSourceContract;
  current: true;
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  revision: number;
  approvalRevision: number;
  providerProduct: Record<string, unknown>;
  providerProductSha256: string;
};

export type ElevenstNewProductNoticeSource = {
  contract: typeof elevenstNewProductNoticeSourceContract;
  current: true;
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  productRevision: number;
  notices: ElevenstNoticeInput[];
};

export type ElevenstNewProductCredentialSource = {
  contract: typeof elevenstNewProductCredentialSourceContract;
  current: true;
  ownerId: string;
  credentialId: string;
  credentialVersion: number;
  channel: "elevenst";
  environment: "production";
  status: "active";
};

export type ElevenstNewProductSellerSource = {
  contract: typeof elevenstNewProductSellerSourceContract;
  current: true;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  receipt: ElevenstSellerIdentityReceipt;
};

export type ElevenstNewProductAvailabilitySource = {
  contract: typeof elevenstNewProductAvailabilitySourceContract;
  current: true;
  ownerId: string;
  productId: string;
  credentialId: string;
  credentialVersion: number;
  receipt: ElevenstProviderAvailabilityReceipt;
};

export type ElevenstNewProductPolicySource = {
  contract: typeof elevenstNewProductPolicySourceContract;
  current: true;
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  productRevision: number;
  sourceRevision: number;
  approvalRevision: number;
  approvedAt: string;
  shipping: {
    shippingFeeKrw: number;
    deliveryCostBasisCode: "02";
    paymentTypeCode: "03";
    bundleDeliveryCode: "Y" | "N";
    outboundAddressId: string;
    returnAddressId: string;
  };
  returns: {
    returnFeeKrw: number;
    exchangeFeeKrw: number;
    asDetail: string;
    returnExchangeDetail: string;
  };
  content: {
    htmlDetail: string;
    htmlDetailSha256: string;
    productImageUrls: string[];
    detailImageUrls: string[];
    imageUrlsSha256: string;
  };
};

export type ElevenstNewProductSourceDependencies = {
  readProductSource: (key: ExactSourceKey) => Promise<unknown>;
  readCredentialSource: (key: ExactSourceKey) => Promise<unknown>;
  readNoticeSource: (key: ExactSourceKey) => Promise<unknown>;
  readSellerSource: (key: ExactSourceKey) => Promise<unknown>;
  readAvailabilitySource: (key: ExactSourceKey) => Promise<unknown>;
  readPolicySource: (key: ExactSourceKey) => Promise<unknown>;
};

export type ElevenstNewProductSourceBlocker = {
  code: string;
  path: string;
  required: true;
  message: string;
};

export type ElevenstNewProductSourceBuildResult =
  | {
    ok: true;
    arguments: Record<string, unknown>;
    productRevision: number;
    policyApprovalRevision: number;
  }
  | {
    ok: false;
    errorCode: "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_BLOCKED";
    blockers: ElevenstNewProductSourceBlocker[];
    sanitizedArguments: Record<string, unknown>;
  };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const numericIdPattern = /^[1-9]\d{0,19}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function text(value: unknown, maximum = 2_000) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  const containsControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 && ![9, 10, 13].includes(code)) || code === 127;
  });
  return normalized && normalized.length <= maximum && !containsControlCharacter
    ? normalized
    : "";
}

function parsedTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value);
  if (object) {
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function elevenstNewProductSourceDigest(value: unknown) {
  return sha256(canonicalJson(value));
}

function blocker(code: string, path: string, message: string): ElevenstNewProductSourceBlocker {
  return { code, path, required: true, message };
}

function sanitizeBrowserArguments(argumentsValue: Record<string, unknown>) {
  const sanitized = structuredClone(argumentsValue);
  delete sanitized[elevenstNewProductInputReceiptArgument];
  const product = record(sanitized.product);
  if (product) delete product.ProductNotification;
  return sanitized;
}

function exactSourceIdentity(value: Record<string, unknown>, key: ExactSourceKey) {
  return value.ownerId === key.ownerId
    && value.productId === key.productId
    && value.categoryId === key.categoryId;
}

function validUrlList(value: unknown, exactLength: number) {
  if (!Array.isArray(value) || value.length !== exactLength) return null;
  const urls = value.map((item) => text(item, 2_048));
  if (urls.some((url) => !/^https:\/\/[^\s]+$/u.test(url)) || new Set(urls).size !== urls.length) return null;
  return urls;
}

function validTenWonAmount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) % 10 === 0;
}

function productSourceBlockers(value: unknown, key: ExactSourceKey) {
  const blockers: ElevenstNewProductSourceBlocker[] = [];
  const source = record(value);
  const providerProduct = record(source?.providerProduct);
  if (!source
    || source.contract !== elevenstNewProductServerSourceContract
    || source.current !== true
    || !exactSourceIdentity(source, key)
    || !positiveInteger(source.revision)
    || !positiveInteger(source.approvalRevision)
    || !providerProduct
    || typeof source.providerProductSha256 !== "string"
    || !sha256Pattern.test(source.providerProductSha256)
    || source.providerProductSha256 !== elevenstNewProductSourceDigest(providerProduct)) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_SOURCE_INVALID",
      "productSource",
      "현재 owner/product/category에 결속된 승인 Product source가 없습니다.",
    ));
    return { blockers, source: null, providerProduct: null };
  }
  if (String(providerProduct.dispCtgrNo ?? "") !== key.categoryId
    || !text(providerProduct.prdNm)
    || !text(providerProduct.sellerPrdCd)
    || !/^\d+$/u.test(String(providerProduct.selPrc ?? ""))
    || !/^\d+$/u.test(String(providerProduct.prdSelQty ?? ""))) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_PROVIDER_PRODUCT_INVALID",
      "productSource.providerProduct",
      "승인 Product의 category/name/SKU/price/inventory 계약이 불완전합니다.",
    ));
  }
  return {
    blockers,
    source: source as unknown as ElevenstNewProductServerSource,
    providerProduct,
  };
}

function noticeSourceBlockers(value: unknown, key: ExactSourceKey, productRevision: number) {
  const source = record(value);
  if (!source
    || source.contract !== elevenstNewProductNoticeSourceContract
    || source.current !== true
    || !exactSourceIdentity(source, key)
    || source.productRevision !== productRevision
    || !Array.isArray(source.notices)) {
    return [blocker(
      "ELEVENST_NEW_PRODUCT_NOTICE_SOURCE_INVALID",
      "noticeSource",
      "현재 상품 revision에 결속된 11번가 고시 source가 없습니다.",
    )];
  }
  return [];
}

function credentialSourceBlockers(value: unknown, key: ExactSourceKey) {
  const source = record(value);
  if (!source
    || source.contract !== elevenstNewProductCredentialSourceContract
    || source.current !== true
    || source.ownerId !== key.ownerId
    || source.credentialId !== key.credentialId
    || source.credentialVersion !== key.credentialVersion
    || source.channel !== "elevenst"
    || source.environment !== key.environment
    || source.status !== "active") {
    return [blocker(
      "ELEVENST_NEW_PRODUCT_CREDENTIAL_SOURCE_INVALID",
      "credentialSource",
      "현재 owner의 active 11번가 credential ID/version source가 없습니다.",
    )];
  }
  return [];
}

function sellerSourceBlockers(value: unknown, key: ExactSourceKey) {
  const source = record(value);
  const receipt = record(source?.receipt);
  if (!source
    || source.contract !== elevenstNewProductSellerSourceContract
    || source.current !== true
    || source.ownerId !== key.ownerId
    || source.productId !== key.productId
    || source.credentialId !== key.credentialId
    || source.credentialVersion !== key.credentialVersion
    || !receipt
    || receipt.credentialId !== key.credentialId
    || receipt.credentialVersion !== key.credentialVersion
    || receipt.environment !== key.environment) {
    return [blocker(
      "ELEVENST_NEW_PRODUCT_SELLER_SOURCE_INVALID",
      "sellerSource",
      "현재 owner/product/credential revision에 결속된 seller ownership source가 없습니다.",
    )];
  }
  return [];
}

function availabilitySourceBlockers(value: unknown, key: ExactSourceKey) {
  const source = record(value);
  const receipt = record(source?.receipt);
  if (!source
    || source.contract !== elevenstNewProductAvailabilitySourceContract
    || source.current !== true
    || source.ownerId !== key.ownerId
    || source.productId !== key.productId
    || source.credentialId !== key.credentialId
    || source.credentialVersion !== key.credentialVersion
    || !receipt) {
    return [blocker(
      "ELEVENST_NEW_PRODUCT_AVAILABILITY_SOURCE_INVALID",
      "availabilitySource",
      "현재 product/credential revision에 결속된 provider availability source가 없습니다.",
    )];
  }
  return [];
}

function policySourceBlockers(
  value: unknown,
  key: ExactSourceKey,
  productRevision: number,
  nowMs: number,
) {
  const blockers: ElevenstNewProductSourceBlocker[] = [];
  const source = record(value);
  const shipping = record(source?.shipping);
  const returns = record(source?.returns);
  const content = record(source?.content);
  const approvedAt = parsedTime(source?.approvedAt);
  const productImages = validUrlList(content?.productImageUrls, 4);
  const detailImages = validUrlList(content?.detailImageUrls, 8);
  const htmlDetail = text(content?.htmlDetail, 250_000);
  if (!source
    || source.contract !== elevenstNewProductPolicySourceContract
    || source.current !== true
    || !exactSourceIdentity(source, key)
    || source.productRevision !== productRevision
    || !positiveInteger(source.sourceRevision)
    || !positiveInteger(source.approvalRevision)
    || approvedAt === null
    || approvedAt > nowMs) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_POLICY_SOURCE_INVALID",
      "policySource",
      "현재 상품 revision에 결속된 승인 배송·반품·상세 source가 없습니다.",
    ));
    return { blockers, source: null };
  }
  if (!shipping
    || shipping.shippingFeeKrw !== 3_000
    || shipping.deliveryCostBasisCode !== "02"
    || shipping.paymentTypeCode !== "03"
    || (shipping.bundleDeliveryCode !== "Y" && shipping.bundleDeliveryCode !== "N")
    || !numericIdPattern.test(text(shipping.outboundAddressId))
    || !numericIdPattern.test(text(shipping.returnAddressId))) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_SHIPPING_SOURCE_INVALID",
      "policySource.shipping",
      "유료배송 3000원과 출고·반품 주소의 승인 source가 불완전합니다.",
    ));
  }
  if (!returns
    || !validTenWonAmount(returns.returnFeeKrw)
    || !validTenWonAmount(returns.exchangeFeeKrw)
    || !text(returns.asDetail)
    || !text(returns.returnExchangeDetail)) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_RETURN_SOURCE_INVALID",
      "policySource.returns",
      "반품·교환 비용과 안내의 승인 source가 불완전합니다.",
    ));
  }
  const imageDigest = elevenstNewProductSourceDigest({ productImageUrls: productImages, detailImageUrls: detailImages });
  if (!content
    || !htmlDetail
    || !productImages
    || !detailImages
    || typeof content.htmlDetailSha256 !== "string"
    || content.htmlDetailSha256 !== sha256(htmlDetail)
    || typeof content.imageUrlsSha256 !== "string"
    || content.imageUrlsSha256 !== imageDigest
    || detailImages.some((url) => !htmlDetail.includes(url))) {
    blockers.push(blocker(
      "ELEVENST_NEW_PRODUCT_CONTENT_SOURCE_INVALID",
      "policySource.content",
      "승인 상세 HTML, 상품 이미지 4장, 상세 이미지 8장의 source/hash가 불완전합니다.",
    ));
  }
  return {
    blockers,
    source: source as unknown as ElevenstNewProductPolicySource,
  };
}

export async function buildElevenstNewProductArgumentsFromServerSources(input: {
  ownerId: string;
  productId: string;
  categoryId: typeof elevenstProcessedFoodCategoryId;
  credentialId: string;
  credentialVersion: number;
  environment: "production";
  arguments: Record<string, unknown>;
  now?: Date;
}, dependencies: ElevenstNewProductSourceDependencies): Promise<ElevenstNewProductSourceBuildResult> {
  const sanitizedArguments = sanitizeBrowserArguments(input.arguments);
  if (!uuidPattern.test(input.ownerId)
    || !uuidPattern.test(input.productId)
    || input.categoryId !== elevenstProcessedFoodCategoryId
    || !uuidPattern.test(input.credentialId)
    || !positiveInteger(input.credentialVersion)
    || input.environment !== "production") {
    return {
      ok: false,
      errorCode: "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_BLOCKED",
      blockers: [blocker(
        "ELEVENST_NEW_PRODUCT_SOURCE_REQUEST_INVALID",
        "request",
        "exact owner/product/category/credential production 요청이 필요합니다.",
      )],
      sanitizedArguments,
    };
  }
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("ELEVENST_NEW_PRODUCT_SOURCE_NOW_INVALID");
  const key: ExactSourceKey = {
    ownerId: input.ownerId,
    productId: input.productId,
    categoryId: input.categoryId,
    credentialId: input.credentialId,
    credentialVersion: input.credentialVersion,
    environment: input.environment,
  };
  let values: unknown[];
  try {
    values = await Promise.all([
      dependencies.readProductSource(key),
      dependencies.readCredentialSource(key),
      dependencies.readNoticeSource(key),
      dependencies.readSellerSource(key),
      dependencies.readAvailabilitySource(key),
      dependencies.readPolicySource(key),
    ]);
  } catch {
    return {
      ok: false,
      errorCode: "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_BLOCKED",
      blockers: [blocker(
        "ELEVENST_NEW_PRODUCT_SOURCE_READ_FAILED",
        "dependencies",
        "서버 source read가 실패하여 CREATE를 시작하지 않습니다.",
      )],
      sanitizedArguments,
    };
  }
  const productCheck = productSourceBlockers(values[0], key);
  const productRevision = productCheck.source?.revision ?? 0;
  const blockers = [
    ...productCheck.blockers,
    ...credentialSourceBlockers(values[1], key),
    ...noticeSourceBlockers(values[2], key, productRevision),
    ...sellerSourceBlockers(values[3], key),
    ...availabilitySourceBlockers(values[4], key),
  ];
  const policyCheck = policySourceBlockers(values[5], key, productRevision, nowMs);
  blockers.push(...policyCheck.blockers);
  const noticeSource = record(values[2]);
  const sellerSource = record(values[3]);
  const availabilitySource = record(values[4]);
  if (blockers.length > 0
    || !productCheck.source
    || !productCheck.providerProduct
    || !policyCheck.source
    || !noticeSource
    || !sellerSource
    || !availabilitySource) {
    return { ok: false, errorCode: "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_BLOCKED", blockers, sanitizedArguments };
  }
  const policy = policyCheck.source;
  const product = structuredClone(productCheck.providerProduct);
  delete product.ProductNotification;
  const productImages = policy.content.productImageUrls;
  for (const index of [1, 2, 3, 4]) {
    product[`prdImage0${index}`] = productImages[index - 1];
  }
  Object.assign(product, {
    dlvCstInstBasiCd: policy.shipping.deliveryCostBasisCode,
    dlvCst1: String(policy.shipping.shippingFeeKrw),
    dlvCstPayTypCd: policy.shipping.paymentTypeCode,
    bndlDlvCnYn: policy.shipping.bundleDeliveryCode,
    addrSeqOut: policy.shipping.outboundAddressId,
    addrSeqIn: policy.shipping.returnAddressId,
    rtngdDlvCst: String(policy.returns.returnFeeKrw),
    exchDlvCst: String(policy.returns.exchangeFeeKrw),
    asDetail: policy.returns.asDetail,
    rtngExchDetail: policy.returns.returnExchangeDetail,
    htmlDetail: policy.content.htmlDetail,
  });
  const preflight = resolveElevenstNewProductInput({
    contract: elevenstNewProductInputContract,
    product: {
      id: input.productId,
      name: String(product.prdNm),
      approvalRevision: productCheck.source.approvalRevision,
    },
    categoryId: input.categoryId,
    notices: noticeSource.notices as ElevenstNoticeInput[],
    sellerIdentity: sellerSource.receipt as ElevenstSellerIdentityReceipt,
    providerAvailability: availabilitySource.receipt as ElevenstProviderAvailabilityReceipt,
  }, now);
  if (!preflight.canCreate || !preflight.productNotification) {
    return {
      ok: false,
      errorCode: "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_BLOCKED",
      blockers: preflight.blockers.map((item) => blocker(item.code, item.path, item.message)),
      sanitizedArguments,
    };
  }
  product.ProductNotification = preflight.productNotification;
  const receipt = buildElevenstNewProductInputExecutionReceipt({
    preflight,
    productId: input.productId,
    product,
    credentialId: input.credentialId,
    credentialVersion: input.credentialVersion,
    environment: input.environment,
    productApprovalRevision: productCheck.source.approvalRevision,
    sellerIdentityOwnershipRevision: (sellerSource.receipt as ElevenstSellerIdentityReceipt).ownershipRevision,
    providerAvailabilityObservedAt: (availabilitySource.receipt as ElevenstProviderAvailabilityReceipt).observedAt,
    issuedAt: now,
  });
  const existingAssets = record(sanitizedArguments.sellerpilotAssets) ?? {};
  return {
    ok: true,
    arguments: {
      ...sanitizedArguments,
      product,
      sellerpilotAssets: {
        ...existingAssets,
        shipping: { shippingFeeKrw: policy.shipping.shippingFeeKrw },
      },
      [elevenstNewProductInputReceiptArgument]: receipt,
    },
    productRevision,
    policyApprovalRevision: policy.approvalRevision,
  };
}

export async function gateElevenstNewProductCreateBeforeClaim<T>(input: Parameters<typeof buildElevenstNewProductArgumentsFromServerSources>[0], dependencies: ElevenstNewProductSourceDependencies, onReady: (argumentsValue: Record<string, unknown>) => Promise<T>): Promise<ElevenstNewProductSourceBuildResult | T> {
  const prepared = await buildElevenstNewProductArgumentsFromServerSources(input, dependencies);
  if (!prepared.ok) return prepared;
  return onReady(prepared.arguments);
}
