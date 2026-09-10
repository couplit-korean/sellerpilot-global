import {
  temuReviewAndCreatePrewriteContract,
  type TemuReviewAndCreatePrewriteBinding,
} from "./create-readiness-adapter";
import {
  inspectTemuReviewAndCreateReadiness,
  temuReviewAndCreateRequiredApiScopes,
} from "./review-and-create-readiness";

export const temuReadinessEvidenceMaxAgeMs = 5 * 60_000;

export type TemuReadinessBuilderBlockerCode =
  | "SERVER_CLOCK_INVALID"
  | "SERVICE_APP_ATTESTATION_REQUIRED"
  | "CURRENT_APP_ROW_REQUIRED"
  | "ACTIVE_APP_REQUIRED"
  | "APP_COMPLIANCE_APPROVAL_REQUIRED"
  | "SERVICE_COMPLIANCE_POLICY_REQUIRED"
  | "SERVICE_CREDENTIAL_ATTESTATION_REQUIRED"
  | "ACCOUNT_SUBJECT_MAPPING_REQUIRED"
  | "ACTIVE_CREDENTIAL_REQUIRED"
  | "CREDENTIAL_ACCOUNT_IDENTITY_REQUIRED"
  | "CREDENTIAL_SCOPE_REQUIRED"
  | "SERVICE_PRODUCT_REVISION_REQUIRED"
  | "PRODUCT_REVISION_FINGERPRINT_MISMATCH"
  | "PRODUCT_IDENTITY_MISMATCH"
  | "PRODUCT_CONTENT_REQUIRED"
  | "OFFICIAL_CATEGORY_READBACK_REQUIRED"
  | "CATEGORY_ACCOUNT_OR_REVISION_MISMATCH"
  | "LEAF_CATEGORY_REQUIRED"
  | "CATEGORY_COMPLIANCE_REQUIRED"
  | "APPROVED_ASSET_LINEAGE_REQUIRED"
  | "APPROVED_ASSET_SET_REQUIRED"
  | "STORE_SHIPPING_READBACK_REQUIRED"
  | "NETWORK_EGRESS_ATTESTATION_REQUIRED"
  | "EXACT_DUPLICATE_READ_REQUIRED"
  | "DUPLICATE_READ_SCOPE_MISMATCH"
  | "EXTERNAL_ID_ALREADY_EXISTS"
  | "R11_READINESS_REJECTED";

export type TemuReadinessBuilderBlocker = {
  code: TemuReadinessBuilderBlockerCode;
  area: "app" | "policy" | "credential" | "product" | "category" | "assets" | "shipping" | "egress" | "duplicate_read" | "readiness";
  evidenceRequired: string;
};

export type TemuCreateReadinessServiceInput = {
  nowEpochMs: number;
  expectedPublicationFingerprint: string;
  expectedExternalGoodsId: string;
  expectedExternalSkuId?: string;
  app?: {
    source: "temu_partner_platform_server_attestation";
    observedAtEpochMs: number;
    rowPresent: boolean;
    appId: string | null;
    state: "active" | "inactive" | "unknown";
    complianceState: "approved" | "rejected" | "reviewing" | "unknown";
    rejectionReason: string | null;
  };
  policy?: {
    source: "sellerpilot_compliance_policy_registry";
    cloudProviders: readonly string[];
    cloudDataFlowDocumented: boolean;
    retentionAndDeletionDocumented: boolean;
    incidentResponseDocumented: boolean;
    authorizationMode: "manual_access_token" | "authorization_callback" | "unknown";
    authorizationCallbackImplemented: boolean;
    authorizationCallbackEvidence: string | null;
    eventWebhookClaimed: boolean;
    eventWebhookImplemented: boolean;
  };
  credential?: {
    source: "temu_fresh_token_info_attestation";
    observedAtEpochMs: number;
    active: boolean;
    mallId: string | null;
    regionId: string | null;
    verifiedApiScopes: readonly string[];
  };
  accountBinding?: {
    source: "temu_partner_token_account_mapping_v1";
    observedAtEpochMs: number;
    partnerAccountSubject: string;
    tokenIdentitySubject: string;
    mallId: string;
    regionId: string;
    productRevisionFingerprint: string;
    evidenceSha256: string;
  };
  product?: {
    source: "sellerpilot_exact_product_revision";
    productId: string | null;
    ledgerId: string | null;
    sellerSku: string | null;
    revisionFingerprint: string;
    locale: "ko-KR" | "unknown";
    language: "ko" | "unknown";
    localizedTitleVerified: boolean;
    localizedDescriptionVerified: boolean;
    localizedBulletPointsVerified: boolean;
    saleUnitCount: number | null;
    innerPackCount: number | null;
    inventoryQuantity: number | null;
    priceAmount: string | null;
    priceCurrency: string | null;
    packageWeightGrams: number | null;
    packageLengthCm: number | null;
    packageWidthCm: number | null;
    packageHeightCm: number | null;
  };
  category?: {
    source: "temu_official_category_compliance_readback";
    mallId: string;
    productRevisionFingerprint: string;
    categoryId: string | null;
    leafCategoryVerified: boolean;
    categoryRecommendationVerified: boolean;
    categoryAttributesVerified: boolean;
    categoryComplianceVerified: boolean;
    certificationDecisionVerified: boolean;
  };
  assets?: {
    source: "sellerpilot_approved_asset_lineage";
    productId: string;
    productRevisionFingerprint: string;
    representativeImages: readonly string[];
    detailImages: readonly string[];
  };
  shipping?: {
    source: "temu_store_shipping_readback";
    mallId: string;
    storeDefaultShippingVerified: boolean;
  };
  egress?: {
    source: "sellerpilot_server_egress_attestation";
    observedAtEpochMs: number;
    endpointHost: string;
    state: "static_ip_verified" | "provider_confirmed_no_allowlist" | "blocked_until_stable_ip" | "unknown";
  };
  duplicateRead?: {
    source: "temu_official_exact_duplicate_read";
    observedAtEpochMs: number;
    mallId: string;
    productRevisionFingerprint: string;
    externalGoodsId: string;
    externalSkuId: string;
    goodsReadComplete: boolean;
    skuReadComplete: boolean;
    goodsEmpty: boolean;
    skuEmpty: boolean;
    continuationPresent: boolean;
    existingGoodsRecoveryUsed: boolean;
  };
};

function text(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function current(nowEpochMs: number, observedAtEpochMs: number | undefined) {
  return Number.isFinite(observedAtEpochMs)
    && observedAtEpochMs !== undefined
    && observedAtEpochMs <= nowEpochMs
    && nowEpochMs - observedAtEpochMs <= temuReadinessEvidenceMaxAgeMs;
}

function approvedHttpsImages(images: readonly string[], exactCount: number) {
  return images.length === exactCount
    && new Set(images).size === exactCount
    && images.every((image) => /^https:\/\//u.test(image));
}

function add(
  blockers: TemuReadinessBuilderBlocker[],
  code: TemuReadinessBuilderBlockerCode,
  area: TemuReadinessBuilderBlocker["area"],
  evidenceRequired: string,
) {
  blockers.push({ code, area, evidenceRequired });
}

export function buildTemuReviewAndCreatePrewriteBinding(
  input: TemuCreateReadinessServiceInput,
): {
  ok: boolean;
  binding: TemuReviewAndCreatePrewriteBinding | null;
  blockers: TemuReadinessBuilderBlocker[];
} {
  const blockers: TemuReadinessBuilderBlocker[] = [];
  if (!Number.isFinite(input.nowEpochMs) || input.nowEpochMs < 0) {
    add(blockers, "SERVER_CLOCK_INVALID", "readiness", "유효한 서버 현재 시각");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.expectedPublicationFingerprint)) {
    add(blockers, "PRODUCT_REVISION_FINGERPRINT_MISMATCH", "product", "64자리 lowercase SHA-256 publication fingerprint");
  }
  if (!text(input.expectedExternalGoodsId)) {
    add(blockers, "PRODUCT_IDENTITY_MISMATCH", "product", "비어 있지 않은 canonical externalGoodsId");
  }

  const app = input.app;
  if (!app
    || app.source !== "temu_partner_platform_server_attestation"
    || !current(input.nowEpochMs, app.observedAtEpochMs)) {
    add(blockers, "SERVICE_APP_ATTESTATION_REQUIRED", "app", "5분 이내 서버 소유 Partner Platform 앱 상태 attestation");
  } else {
    if (!app.rowPresent || !text(app.appId)) {
      add(blockers, "CURRENT_APP_ROW_REQUIRED", "app", "현재 계정에서 확인되는 exact Temu app row와 appId");
    }
    if (app.state !== "active") {
      add(blockers, "ACTIVE_APP_REQUIRED", "app", "현재 app row의 Active 상태");
    }
    if (app.complianceState !== "approved") {
      add(blockers, "APP_COMPLIANCE_APPROVAL_REQUIRED", "app", "현재 app row의 Compliance Approved 상태");
    }
  }

  const policy = input.policy;
  if (!policy || policy.source !== "sellerpilot_compliance_policy_registry") {
    add(blockers, "SERVICE_COMPLIANCE_POLICY_REQUIRED", "policy", "서버 정책 registry의 Vercel/Supabase 흐름·보관삭제·사고대응·인증방식");
  }

  const credential = input.credential;
  if (!credential
    || credential.source !== "temu_fresh_token_info_attestation"
    || !current(input.nowEpochMs, credential.observedAtEpochMs)) {
    add(blockers, "SERVICE_CREDENTIAL_ATTESTATION_REQUIRED", "credential", "5분 이내 fresh token-info 서버 attestation");
  } else {
    if (!credential.active) {
      add(blockers, "ACTIVE_CREDENTIAL_REQUIRED", "credential", "활성 운영 credential");
    }
    if (!/^\d+$/u.test(credential.mallId ?? "")
      || !/^\d+$/u.test(credential.regionId ?? "")) {
      add(blockers, "CREDENTIAL_ACCOUNT_IDENTITY_REQUIRED", "credential", "fresh token-info의 exact mallId와 regionId");
    }
    const scopes = new Set(credential.verifiedApiScopes);
    if (temuReviewAndCreateRequiredApiScopes.some((scope) => !scopes.has(scope))) {
      add(blockers, "CREDENTIAL_SCOPE_REQUIRED", "credential", "r11 CREATE/category/compliance 전체 scope");
    }
  }

  const accountBinding = input.accountBinding;
  if (!accountBinding
    || accountBinding.source !== "temu_partner_token_account_mapping_v1"
    || !current(input.nowEpochMs, accountBinding.observedAtEpochMs)
    || !/^temu-account:sha256:[a-f0-9]{64}$/u.test(
      accountBinding.partnerAccountSubject,
    )
    || !/^temu:sha256:[a-f0-9]{64}$/u.test(
      accountBinding.tokenIdentitySubject,
    )
    || !/^[a-f0-9]{64}$/u.test(accountBinding.evidenceSha256)
    || accountBinding.productRevisionFingerprint
      !== input.expectedPublicationFingerprint
    || !credential
    || accountBinding.mallId !== credential.mallId
    || accountBinding.regionId !== credential.regionId) {
    add(blockers, "ACCOUNT_SUBJECT_MAPPING_REQUIRED", "credential",
      "5분 이내 Partner account subject와 signed token identity의 서버 소유 mapping receipt");
  }

  const product = input.product;
  if (!product || product.source !== "sellerpilot_exact_product_revision") {
    add(blockers, "SERVICE_PRODUCT_REVISION_REQUIRED", "product", "서버 원장의 exact product revision");
  } else {
    if (product.revisionFingerprint !== input.expectedPublicationFingerprint) {
      add(blockers, "PRODUCT_REVISION_FINGERPRINT_MISMATCH", "product", "publication fingerprint와 동일한 product revision");
    }
    if (!text(product.productId) || !text(product.ledgerId)
      || !text(product.sellerSku)) {
      add(blockers, "PRODUCT_IDENTITY_MISMATCH", "product", "현재 productId·ledgerId·canonical sellerSku");
    }
    if (product.locale !== "ko-KR" || product.language !== "ko"
      || !product.localizedTitleVerified
      || !product.localizedDescriptionVerified
      || !product.localizedBulletPointsVerified) {
      add(blockers, "PRODUCT_CONTENT_REQUIRED", "product", "동일 revision의 ko-KR/ko 제목·설명·bullet");
    }
  }

  const category = input.category;
  if (!category || category.source !== "temu_official_category_compliance_readback") {
    add(blockers, "OFFICIAL_CATEGORY_READBACK_REQUIRED", "category", "Temu 공식 leaf category/property/spec/size/template/compliance readback");
  } else {
    if (!credential || category.mallId !== credential.mallId
      || category.productRevisionFingerprint !== input.expectedPublicationFingerprint) {
      add(blockers, "CATEGORY_ACCOUNT_OR_REVISION_MISMATCH", "category", "credential mall과 동일 product revision에 결속된 category readback");
    }
    if (!/^\d+$/u.test(category.categoryId ?? "")
      || !category.leafCategoryVerified
      || !category.categoryRecommendationVerified
      || !category.categoryAttributesVerified) {
      add(blockers, "LEAF_CATEGORY_REQUIRED", "category", "공식 leaf category와 필수 attributes 검증");
    }
    if (!category.categoryComplianceVerified
      || !category.certificationDecisionVerified) {
      add(blockers, "CATEGORY_COMPLIANCE_REQUIRED", "category", "공식 compliance rules와 인증서 필요·면제 판정");
    }
  }

  const assets = input.assets;
  if (!assets || assets.source !== "sellerpilot_approved_asset_lineage") {
    add(blockers, "APPROVED_ASSET_LINEAGE_REQUIRED", "assets", "서버 승인 asset lineage");
  } else if (!product || assets.productId !== product.productId
    || assets.productRevisionFingerprint !== input.expectedPublicationFingerprint
    || !approvedHttpsImages(assets.representativeImages, 1)
    || !approvedHttpsImages(assets.detailImages, 8)
    || assets.detailImages.includes(assets.representativeImages[0])) {
    add(blockers, "APPROVED_ASSET_SET_REQUIRED", "assets", "동일 product revision의 서로 다른 HTTPS 대표1장과 상세8장");
  }

  const shipping = input.shipping;
  if (!shipping || shipping.source !== "temu_store_shipping_readback"
    || !credential || shipping.mallId !== credential.mallId
    || !shipping.storeDefaultShippingVerified) {
    add(blockers, "STORE_SHIPPING_READBACK_REQUIRED", "shipping", "동일 mall의 store-default 배송·창고·배송비·반품 readback");
  }

  const egress = input.egress;
  if (!egress || egress.source !== "sellerpilot_server_egress_attestation"
    || !current(input.nowEpochMs, egress.observedAtEpochMs)
    || egress.endpointHost !== "openapi-b-global.temu.com"
    || !["static_ip_verified", "provider_confirmed_no_allowlist"].includes(egress.state)) {
    add(blockers, "NETWORK_EGRESS_ATTESTATION_REQUIRED", "egress", "5분 이내 GLOBAL endpoint 송신 IP/allowlist 서버 attestation");
  }

  const duplicateRead = input.duplicateRead;
  if (!duplicateRead
    || duplicateRead.source !== "temu_official_exact_duplicate_read"
    || !current(input.nowEpochMs, duplicateRead.observedAtEpochMs)
    || !duplicateRead.goodsReadComplete
    || !duplicateRead.skuReadComplete
    || duplicateRead.continuationPresent) {
    add(blockers, "EXACT_DUPLICATE_READ_REQUIRED", "duplicate_read", "5분 이내 complete exact goods/SKU read와 continuation 없음");
  } else {
    if (!credential || duplicateRead.mallId !== credential.mallId
      || duplicateRead.productRevisionFingerprint !== input.expectedPublicationFingerprint
      || duplicateRead.externalGoodsId !== input.expectedExternalGoodsId
      || duplicateRead.externalSkuId !== (input.expectedExternalSkuId
        ?? input.expectedExternalGoodsId)) {
      add(blockers, "DUPLICATE_READ_SCOPE_MISMATCH", "duplicate_read", "동일 mall·revision·external goods/SKU identity의 exact read");
    }
    if (!duplicateRead.goodsEmpty || !duplicateRead.skuEmpty
      || duplicateRead.existingGoodsRecoveryUsed) {
      add(blockers, "EXTERNAL_ID_ALREADY_EXISTS", "duplicate_read", "기존 goods 회복을 사용하지 않은 goods/SKU exact empty result");
    }
  }

  if (blockers.length > 0 || !app || !policy || !credential || !accountBinding || !product
    || !category || !assets || !shipping || !egress || !duplicateRead) {
    return { ok: false, binding: null, blockers };
  }

  const appEvidence = {
    currentAppState: app.state,
    currentComplianceState: app.complianceState,
    rejectionReason: app.rejectionReason,
    cloudProviders: policy.cloudProviders,
    cloudDataFlowDocumented: policy.cloudDataFlowDocumented,
    retentionAndDeletionDocumented: policy.retentionAndDeletionDocumented,
    incidentResponseDocumented: policy.incidentResponseDocumented,
    authorizationMode: policy.authorizationMode,
    authorizationCallbackImplemented: policy.authorizationCallbackImplemented,
    authorizationCallbackEvidence: policy.authorizationCallbackEvidence,
    eventWebhookClaimed: policy.eventWebhookClaimed,
    eventWebhookImplemented: policy.eventWebhookImplemented,
  } as const;
  const createEvidence = {
    operatingCredentialPresent: credential.active,
    verifiedApiScopes: credential.verifiedApiScopes,
    networkEgress: egress.state,
    productId: product.productId,
    ledgerId: product.ledgerId,
    sellerSku: product.sellerSku,
    locale: product.locale,
    language: product.language,
    localizedTitleVerified: product.localizedTitleVerified,
    localizedDescriptionVerified: product.localizedDescriptionVerified,
    localizedBulletPointsVerified: product.localizedBulletPointsVerified,
    categoryId: category.categoryId,
    categoryRecommendationVerified: category.categoryRecommendationVerified,
    categoryAttributesVerified: category.categoryAttributesVerified,
    categoryComplianceVerified: category.categoryComplianceVerified,
    certificationDecisionVerified: category.certificationDecisionVerified,
    saleUnitCount: product.saleUnitCount,
    innerPackCount: product.innerPackCount,
    inventoryQuantity: product.inventoryQuantity,
    priceAmount: product.priceAmount,
    priceCurrency: product.priceCurrency,
    packageWeightGrams: product.packageWeightGrams,
    packageLengthCm: product.packageLengthCm,
    packageWidthCm: product.packageWidthCm,
    packageHeightCm: product.packageHeightCm,
    approvedRepresentativeImageCount: assets.representativeImages.length,
    approvedDetailImageCount: assets.detailImages.length,
    storeDefaultShippingVerified: shipping.storeDefaultShippingVerified,
    duplicateGoodsReadComplete: duplicateRead.goodsReadComplete
      && duplicateRead.goodsEmpty,
    duplicateSkuReadComplete: duplicateRead.skuReadComplete
      && duplicateRead.skuEmpty,
  } as const;
  const readiness = inspectTemuReviewAndCreateReadiness({
    app: appEvidence,
    create: createEvidence,
  });
  if (!readiness.createPrewriteReady) {
    add(blockers, "R11_READINESS_REJECTED", "readiness",
      [...readiness.appIssues, ...readiness.createIssues]
        .map((issue) => issue.code).join(", ") || "r11 readiness 승인 상태");
    return { ok: false, binding: null, blockers };
  }

  return {
    ok: true,
    blockers,
    binding: {
      version: temuReviewAndCreatePrewriteContract,
      publicationFingerprint: input.expectedPublicationFingerprint,
      externalGoodsId: input.expectedExternalGoodsId,
      accountBinding,
      app: appEvidence,
      create: createEvidence,
    },
  };
}
