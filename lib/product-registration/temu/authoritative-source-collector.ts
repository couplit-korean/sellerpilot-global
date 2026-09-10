import {
  temuReadinessEvidenceMaxAgeMs,
  type TemuCreateReadinessServiceInput,
} from "./create-readiness-builder";
import { temuReviewAndCreateRequiredApiScopes } from "./review-and-create-readiness";

export type TemuAuthoritativeCollectorBlockerCode =
  | "SERVER_INPUT_INVALID"
  | "SERVICE_POLICY_INVALID"
  | "PRODUCT_REVISION_INVALID"
  | "APP_READ_FAILED"
  | "APP_READ_STALE"
  | "CURRENT_APP_ROW_REQUIRED"
  | "APP_ACTIVE_REQUIRED"
  | "APP_COMPLIANCE_APPROVAL_REQUIRED"
  | "APP_ACCOUNT_MAPPING_REQUIRED"
  | "TOKEN_INFO_READ_FAILED"
  | "TOKEN_INFO_STALE"
  | "ACTIVE_CREDENTIAL_REQUIRED"
  | "TOKEN_ACCOUNT_IDENTITY_INVALID"
  | "TOKEN_ACCOUNT_MAPPING_MISMATCH"
  | "TOKEN_SCOPE_INCOMPLETE"
  | "CATEGORY_READ_FAILED"
  | "CATEGORY_READ_STALE"
  | "CATEGORY_SCOPE_MISMATCH"
  | "CATEGORY_EVIDENCE_MISMATCH"
  | "CATEGORY_INCOMPLETE"
  | "SHIPPING_READ_FAILED"
  | "SHIPPING_READ_STALE"
  | "SHIPPING_SCOPE_MISMATCH"
  | "SHIPPING_INCOMPLETE"
  | "EGRESS_READ_FAILED"
  | "EGRESS_READ_STALE"
  | "EGRESS_INCOMPLETE"
  | "GOODS_DUPLICATE_READ_FAILED"
  | "SKU_DUPLICATE_READ_FAILED"
  | "DUPLICATE_READ_STALE"
  | "DUPLICATE_READ_SCOPE_MISMATCH"
  | "DUPLICATE_READ_INCOMPLETE"
  | "EXTERNAL_ID_ALREADY_EXISTS";

export type TemuAuthoritativeCollectorBlocker = {
  area: "input" | "app" | "credential" | "category" | "shipping" | "egress" | "duplicate_read";
  code: TemuAuthoritativeCollectorBlockerCode;
  evidenceRequired: string;
};

export type TemuOfficialAppRow = {
  appId: string;
  state: "active" | "inactive" | "unknown";
  complianceState: "approved" | "rejected" | "reviewing" | "unknown";
  rejectionReason: string | null;
};

export type TemuOfficialExactDuplicateRead = {
  observedAtEpochMs: number;
  mallId: string;
  productRevisionFingerprint: string;
  externalId: string;
  items: readonly unknown[];
  total: number | null;
  continuationToken: unknown;
};

export type TemuAuthoritativeClock = {
  nowEpochMs: () => number;
};

export const temuSystemAuthoritativeClock: TemuAuthoritativeClock =
  Object.freeze({ nowEpochMs: Date.now });

export type TemuAuthoritativeReadDependencies = {
  readAppRows: (input: {
    expectedAppId: string;
  }) => Promise<{
    observedAtEpochMs: number;
    accountSubject: string;
    rows: readonly TemuOfficialAppRow[];
  }>;
  readTokenInfo: () => Promise<{
    observedAtEpochMs: number;
    active: boolean;
    mallId: string | null;
    regionId: string | null;
    subject: string | null;
    apiScopes: readonly string[];
  }>;
  readLeafCategoryCompliance: (input: {
    mallId: string;
    productRevisionFingerprint: string;
    externalGoodsId: string;
  }) => Promise<{
    observedAtEpochMs: number;
    mallId: string;
    productRevisionFingerprint: string;
    categoryId: string | null;
    categoryPlanSha256: string;
    requestEvidenceSha256: string;
    responseEvidenceSha256: string;
    leafCategoryVerified: boolean;
    categoryRecommendationVerified: boolean;
    categoryAttributesVerified: boolean;
    categoryComplianceVerified: boolean;
    certificationDecisionVerified: boolean;
  }>;
  readStoreShipping: (input: {
    mallId: string;
  }) => Promise<{
    observedAtEpochMs: number;
    mallId: string;
    storeDefaultShippingVerified: boolean;
  }>;
  readGlobalEgressAttestation: (input: {
    endpointHost: "openapi-b-global.temu.com";
  }) => Promise<{
    observedAtEpochMs: number;
    endpointHost: string;
    state: "static_ip_verified" | "provider_confirmed_no_allowlist" | "blocked_until_stable_ip" | "unknown";
  }>;
  readExactGoods: (input: {
    mallId: string;
    productRevisionFingerprint: string;
    externalGoodsId: string;
  }) => Promise<TemuOfficialExactDuplicateRead>;
  readExactSku: (input: {
    mallId: string;
    productRevisionFingerprint: string;
    externalSkuId: string;
  }) => Promise<TemuOfficialExactDuplicateRead>;
};

export type CollectTemuAuthoritativeReadinessInput = {
  nowEpochMs: number;
  expectedAppId: string;
  expectedPublicationFingerprint: string;
  expectedExternalGoodsId: string;
  expectedExternalSkuId?: string;
  expectedCategoryPlanSha256: string;
  accountMapping: {
    source: "temu_partner_token_account_mapping_v1";
    observedAtEpochMs: number;
    partnerAccountSubject: string;
    tokenIdentitySubject: string;
    mallId: string;
    regionId: string;
    productRevisionFingerprint: string;
    evidenceSha256: string;
  };
  policy: TemuCreateReadinessServiceInput["policy"];
  product: TemuCreateReadinessServiceInput["product"];
  assets: TemuCreateReadinessServiceInput["assets"];
};

function text(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function fresh(nowEpochMs: number, observedAtEpochMs: number) {
  return Number.isFinite(observedAtEpochMs)
    && observedAtEpochMs <= nowEpochMs
    && nowEpochMs - observedAtEpochMs <= temuReadinessEvidenceMaxAgeMs;
}

function add(
  blockers: TemuAuthoritativeCollectorBlocker[],
  area: TemuAuthoritativeCollectorBlocker["area"],
  code: TemuAuthoritativeCollectorBlockerCode,
  evidenceRequired: string,
) {
  blockers.push({ area, code, evidenceRequired });
}

function failed(blockers: TemuAuthoritativeCollectorBlocker[]) {
  return {
    ok: false as const,
    serviceInput: null,
    blockers,
  };
}

function exactEmptyRead(input: {
  read: TemuOfficialExactDuplicateRead;
  nowEpochMs: number;
  mallId: string;
  fingerprint: string;
  externalId: string;
}) {
  const scopeMatches = input.read.mallId === input.mallId
    && input.read.productRevisionFingerprint === input.fingerprint
    && input.read.externalId === input.externalId;
  const complete = fresh(input.nowEpochMs, input.read.observedAtEpochMs)
    && scopeMatches
    && Array.isArray(input.read.items)
    && Number.isSafeInteger(input.read.total)
    && input.read.total !== null
    && input.read.total >= input.read.items.length
    && (input.read.continuationToken === null
      || input.read.continuationToken === undefined);
  return {
    fresh: fresh(input.nowEpochMs, input.read.observedAtEpochMs),
    scopeMatches,
    complete,
    empty: complete && input.read.total === 0 && input.read.items.length === 0,
  };
}

export async function collectTemuAuthoritativeReadinessInput(input: {
  request: CollectTemuAuthoritativeReadinessInput;
  dependencies: TemuAuthoritativeReadDependencies;
  clock: TemuAuthoritativeClock;
}): Promise<{
  ok: boolean;
  serviceInput: TemuCreateReadinessServiceInput | null;
  blockers: TemuAuthoritativeCollectorBlocker[];
}> {
  const request = input.request;
  const blockers: TemuAuthoritativeCollectorBlocker[] = [];
  const currentNow = (lowerBound: number) => {
    const observed = input.clock.nowEpochMs();
    return Number.isFinite(observed) && observed >= lowerBound
      ? observed
      : Number.NaN;
  };
  if (!Number.isFinite(request.nowEpochMs)
    || request.nowEpochMs < 0
    || !text(request.expectedAppId)
    || !/^[a-f0-9]{64}$/u.test(request.expectedPublicationFingerprint)
    || !/^[a-f0-9]{64}$/u.test(request.expectedCategoryPlanSha256)
    || !text(request.expectedExternalGoodsId)
    || !text(request.expectedExternalSkuId ?? request.expectedExternalGoodsId)) {
    add(blockers, "input", "SERVER_INPUT_INVALID", "서버 현재 시각, exact appId, 64hex revision fingerprint와 canonical externalGoodsId");
  }
  if (!request.policy
    || request.policy.source !== "sellerpilot_compliance_policy_registry") {
    add(blockers, "input", "SERVICE_POLICY_INVALID", "서버 compliance policy registry 객체");
  }
  if (!request.product
    || request.product.source !== "sellerpilot_exact_product_revision"
    || request.product.revisionFingerprint !== request.expectedPublicationFingerprint
    || !text(request.product.sellerSku)
    || !request.assets
    || request.assets.source !== "sellerpilot_approved_asset_lineage"
    || request.assets.productId !== request.product?.productId
    || request.assets.productRevisionFingerprint !== request.expectedPublicationFingerprint) {
    add(blockers, "input", "PRODUCT_REVISION_INVALID", "동일 product/revision/fingerprint의 서버 product와 승인 asset lineage");
  }
  if (blockers.length > 0) return failed(blockers);

  const requestNowEpochMs = currentNow(request.nowEpochMs);
  if (!Number.isFinite(requestNowEpochMs)) {
    add(blockers, "input", "SERVER_INPUT_INVALID",
      "request 시각 이후로 단조 증가하는 동일 서버 clock");
    return failed(blockers);
  }

  const mapping = request.accountMapping;
  if (!mapping
    || mapping.source !== "temu_partner_token_account_mapping_v1"
    || !/^temu-account:sha256:[a-f0-9]{64}$/u.test(
      mapping.partnerAccountSubject,
    )
    || !/^temu:sha256:[a-f0-9]{64}$/u.test(mapping.tokenIdentitySubject)
    || !/^\d+$/u.test(mapping.mallId)
    || !/^\d+$/u.test(mapping.regionId)
    || mapping.productRevisionFingerprint
      !== request.expectedPublicationFingerprint
    || !/^[a-f0-9]{64}$/u.test(mapping.evidenceSha256)) {
    add(blockers, "app", "APP_ACCOUNT_MAPPING_REQUIRED",
      "Partner account subject와 signed token identity의 서버 소유 mapping receipt");
    return failed(blockers);
  }

  let appRead: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readAppRows"]>>;
  try {
    appRead = await input.dependencies.readAppRows({
      expectedAppId: request.expectedAppId,
    });
  } catch {
    add(blockers, "app", "APP_READ_FAILED", "Partner Platform app row readback");
    return failed(blockers);
  }
  const appNowEpochMs = currentNow(requestNowEpochMs);
  if (!Number.isFinite(appNowEpochMs)
    || !fresh(appNowEpochMs, appRead.observedAtEpochMs)) {
    add(blockers, "app", "APP_READ_STALE", "5분 이내 Partner Platform app row readback");
  }
  const appRows = appRead.rows.filter((row) => row.appId === request.expectedAppId);
  if (appRead.accountSubject !== mapping.partnerAccountSubject
    || !fresh(appNowEpochMs, mapping.observedAtEpochMs)) {
    add(blockers, "app", "APP_ACCOUNT_MAPPING_REQUIRED",
      "현재 app snapshot subject와 5분 이내 account mapping receipt");
  }
  if (appRows.length !== 1) {
    add(blockers, "app", "CURRENT_APP_ROW_REQUIRED", "현재 계정의 exact app row 정확히 1개");
  }
  const app = appRows.length === 1 ? appRows[0] : null;
  if (app && app.state !== "active") {
    add(blockers, "app", "APP_ACTIVE_REQUIRED", "현재 app row의 Active 상태");
  }
  if (app && app.complianceState !== "approved") {
    add(blockers, "app", "APP_COMPLIANCE_APPROVAL_REQUIRED", "현재 app row의 Compliance Approved 상태");
  }
  if (blockers.length > 0 || !app) return failed(blockers);

  let token: Awaited<ReturnType<TemuAuthoritativeReadDependencies["readTokenInfo"]>>;
  try {
    token = await input.dependencies.readTokenInfo();
  } catch {
    add(blockers, "credential", "TOKEN_INFO_READ_FAILED", "공식 token-info readback");
    return failed(blockers);
  }
  const tokenNowEpochMs = currentNow(appNowEpochMs);
  if (!Number.isFinite(tokenNowEpochMs)
    || !fresh(tokenNowEpochMs, token.observedAtEpochMs)) {
    add(blockers, "credential", "TOKEN_INFO_STALE", "5분 이내 token-info readback");
  }
  if (!token.active) {
    add(blockers, "credential", "ACTIVE_CREDENTIAL_REQUIRED", "활성 운영 token");
  }
  if (!/^\d+$/u.test(token.mallId ?? "")
    || !/^\d+$/u.test(token.regionId ?? "")) {
    add(blockers, "credential", "TOKEN_ACCOUNT_IDENTITY_INVALID", "token-info의 numeric mallId와 regionId");
  }
  if (token.subject !== mapping.tokenIdentitySubject
    || token.mallId !== mapping.mallId
    || token.regionId !== mapping.regionId) {
    add(blockers, "credential", "TOKEN_ACCOUNT_MAPPING_MISMATCH",
      "app subject mapping과 동일한 signed token subject·mall·region");
  }
  const tokenScopes = new Set(token.apiScopes);
  if (temuReviewAndCreateRequiredApiScopes.some((scope) =>
    !tokenScopes.has(scope))) {
    add(blockers, "credential", "TOKEN_SCOPE_INCOMPLETE", "r11 CREATE/category/compliance 전체 scope");
  }
  if (blockers.length > 0 || !token.mallId || !token.regionId) {
    return failed(blockers);
  }

  const scope = {
    mallId: token.mallId,
    productRevisionFingerprint: request.expectedPublicationFingerprint,
    externalGoodsId: request.expectedExternalGoodsId,
  };
  const expectedExternalSkuId = request.expectedExternalSkuId
    ?? request.expectedExternalGoodsId;
  const settled = await Promise.allSettled([
    input.dependencies.readLeafCategoryCompliance(scope),
    input.dependencies.readStoreShipping({ mallId: token.mallId }),
    input.dependencies.readGlobalEgressAttestation({
      endpointHost: "openapi-b-global.temu.com",
    }),
    input.dependencies.readExactGoods(scope),
    input.dependencies.readExactSku({
      mallId: token.mallId,
      productRevisionFingerprint: request.expectedPublicationFingerprint,
      externalSkuId: expectedExternalSkuId,
    }),
  ] as const);

  const [categoryResult, shippingResult, egressResult, goodsResult, skuResult] = settled;
  const evidenceNowEpochMs = currentNow(tokenNowEpochMs);
  if (!Number.isFinite(evidenceNowEpochMs)) {
    add(blockers, "input", "SERVER_INPUT_INVALID", "provider 응답 이후의 유효한 서버 시각");
    return failed(blockers);
  }
  if (categoryResult.status === "rejected") {
    add(blockers, "category", "CATEGORY_READ_FAILED", "공식 leaf category와 compliance readback");
  }
  if (shippingResult.status === "rejected") {
    add(blockers, "shipping", "SHIPPING_READ_FAILED", "store-default shipping readback");
  }
  if (egressResult.status === "rejected") {
    add(blockers, "egress", "EGRESS_READ_FAILED", "GLOBAL endpoint egress attestation");
  }
  if (goodsResult.status === "rejected") {
    add(blockers, "duplicate_read", "GOODS_DUPLICATE_READ_FAILED", "externalGoodsId exact read");
  }
  if (skuResult.status === "rejected") {
    add(blockers, "duplicate_read", "SKU_DUPLICATE_READ_FAILED", "externalSkuId exact read");
  }
  if (blockers.length > 0) return failed(blockers);

  const category = categoryResult.status === "fulfilled"
    ? categoryResult.value
    : null;
  const shipping = shippingResult.status === "fulfilled"
    ? shippingResult.value
    : null;
  const egress = egressResult.status === "fulfilled"
    ? egressResult.value
    : null;
  const goods = goodsResult.status === "fulfilled" ? goodsResult.value : null;
  const sku = skuResult.status === "fulfilled" ? skuResult.value : null;
  if (!category || !shipping || !egress || !goods || !sku) {
    return failed(blockers);
  }

  if (!fresh(evidenceNowEpochMs, category.observedAtEpochMs)) {
    add(blockers, "category", "CATEGORY_READ_STALE", "5분 이내 category/compliance readback");
  }
  if (category.mallId !== token.mallId
    || category.productRevisionFingerprint !== request.expectedPublicationFingerprint) {
    add(blockers, "category", "CATEGORY_SCOPE_MISMATCH", "동일 mall/product revision의 category readback");
  }
  if (category.categoryPlanSha256 !== request.expectedCategoryPlanSha256
    || !/^[a-f0-9]{64}$/u.test(category.requestEvidenceSha256)
    || !/^[a-f0-9]{64}$/u.test(category.responseEvidenceSha256)) {
    add(blockers, "category", "CATEGORY_EVIDENCE_MISMATCH",
      "현재 product revision category plan과 exact request/response evidence digest");
  }
  if (!/^\d+$/u.test(category.categoryId ?? "")
    || !category.leafCategoryVerified
    || !category.categoryRecommendationVerified
    || !category.categoryAttributesVerified
    || !category.categoryComplianceVerified
    || !category.certificationDecisionVerified) {
    add(blockers, "category", "CATEGORY_INCOMPLETE", "공식 leaf category, 필수 attributes, compliance와 certification 판정");
  }

  if (!fresh(evidenceNowEpochMs, shipping.observedAtEpochMs)) {
    add(blockers, "shipping", "SHIPPING_READ_STALE", "5분 이내 store shipping readback");
  }
  if (shipping.mallId !== token.mallId) {
    add(blockers, "shipping", "SHIPPING_SCOPE_MISMATCH", "token mall과 동일한 shipping readback");
  }
  if (!shipping.storeDefaultShippingVerified) {
    add(blockers, "shipping", "SHIPPING_INCOMPLETE", "store-default 배송·창고·배송비·반품 확인");
  }

  if (!fresh(evidenceNowEpochMs, egress.observedAtEpochMs)) {
    add(blockers, "egress", "EGRESS_READ_STALE", "5분 이내 GLOBAL endpoint egress attestation");
  }
  if (egress.endpointHost !== "openapi-b-global.temu.com"
    || !["static_ip_verified", "provider_confirmed_no_allowlist"].includes(
      egress.state,
    )) {
    add(blockers, "egress", "EGRESS_INCOMPLETE", "Temu GLOBAL endpoint의 실제 IP/allowlist 증거");
  }

  const goodsRead = exactEmptyRead({
    read: goods,
    nowEpochMs: evidenceNowEpochMs,
    mallId: token.mallId,
    fingerprint: request.expectedPublicationFingerprint,
    externalId: request.expectedExternalGoodsId,
  });
  const skuRead = exactEmptyRead({
    read: sku,
    nowEpochMs: evidenceNowEpochMs,
    mallId: token.mallId,
    fingerprint: request.expectedPublicationFingerprint,
    externalId: expectedExternalSkuId,
  });
  if (!goodsRead.fresh || !skuRead.fresh) {
    add(blockers, "duplicate_read", "DUPLICATE_READ_STALE", "5분 이내 exact goods/SKU read");
  }
  if (!goodsRead.scopeMatches || !skuRead.scopeMatches) {
    add(blockers, "duplicate_read", "DUPLICATE_READ_SCOPE_MISMATCH", "동일 mall/revision/external goods·SKU IDs");
  }
  if (!goodsRead.complete || !skuRead.complete) {
    add(blockers, "duplicate_read", "DUPLICATE_READ_INCOMPLETE", "명시 total과 continuation 없는 complete goods/SKU read");
  } else if (!goodsRead.empty || !skuRead.empty) {
    add(blockers, "duplicate_read", "EXTERNAL_ID_ALREADY_EXISTS", "goods/SKU exact empty 결과");
  }
  if (blockers.length > 0) return failed(blockers);

  return {
    ok: true,
    blockers,
    serviceInput: {
      nowEpochMs: evidenceNowEpochMs,
      expectedPublicationFingerprint: request.expectedPublicationFingerprint,
      expectedExternalGoodsId: request.expectedExternalGoodsId,
      expectedExternalSkuId,
      app: {
        source: "temu_partner_platform_server_attestation",
        observedAtEpochMs: appRead.observedAtEpochMs,
        rowPresent: true,
        appId: app.appId,
        state: app.state,
        complianceState: app.complianceState,
        rejectionReason: app.rejectionReason,
      },
      policy: request.policy,
      credential: {
        source: "temu_fresh_token_info_attestation",
        observedAtEpochMs: token.observedAtEpochMs,
        active: token.active,
        mallId: token.mallId,
        regionId: token.regionId,
        verifiedApiScopes: token.apiScopes,
      },
      accountBinding: {
        ...mapping,
      },
      product: request.product,
      category: {
        source: "temu_official_category_compliance_readback",
        mallId: category.mallId,
        productRevisionFingerprint: category.productRevisionFingerprint,
        categoryId: category.categoryId,
        leafCategoryVerified: category.leafCategoryVerified,
        categoryRecommendationVerified:
          category.categoryRecommendationVerified,
        categoryAttributesVerified: category.categoryAttributesVerified,
        categoryComplianceVerified: category.categoryComplianceVerified,
        certificationDecisionVerified:
          category.certificationDecisionVerified,
      },
      assets: request.assets,
      shipping: {
        source: "temu_store_shipping_readback",
        mallId: shipping.mallId,
        storeDefaultShippingVerified:
          shipping.storeDefaultShippingVerified,
      },
      egress: {
        source: "sellerpilot_server_egress_attestation",
        observedAtEpochMs: egress.observedAtEpochMs,
        endpointHost: egress.endpointHost,
        state: egress.state,
      },
      duplicateRead: {
        source: "temu_official_exact_duplicate_read",
        observedAtEpochMs: Math.min(
          goods.observedAtEpochMs,
          sku.observedAtEpochMs,
        ),
        mallId: token.mallId,
        productRevisionFingerprint: request.expectedPublicationFingerprint,
        externalGoodsId: request.expectedExternalGoodsId,
        externalSkuId: expectedExternalSkuId,
        goodsReadComplete: goodsRead.complete,
        skuReadComplete: skuRead.complete,
        goodsEmpty: goodsRead.empty,
        skuEmpty: skuRead.empty,
        continuationPresent: false,
        existingGoodsRecoveryUsed: false,
      },
    },
  };
}
