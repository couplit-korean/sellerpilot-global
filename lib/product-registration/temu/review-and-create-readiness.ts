import {
  temuCategoryRequiredApiScopes,
  temuCreateRequiredApiScopes,
} from "./account-identity";

export const temuProductPreparationApiScopes = [
  "bg.local.goods.cats.get",
  "bg.local.goods.property.get",
  "bg.local.goods.size.element.get",
  "bg.local.goods.spec.id.get",
  "bg.local.goods.template.get",
  "bg.freight.template.list.query",
  "bg.local.goods.compliance.rules.get",
  "bg.local.goods.compliance.extra.template.get",
  "bg.local.goods.compliance.property.check",
] as const;

export const temuReviewAndCreateRequiredApiScopes = [
  ...temuCreateRequiredApiScopes,
  ...temuCategoryRequiredApiScopes,
  ...temuProductPreparationApiScopes,
] as const;

export type TemuReadinessIssueCode =
  | "CURRENT_APP_STATE_UNVERIFIED"
  | "COMPLIANCE_REJECTION_REASON_UNVERIFIED"
  | "CLOUD_DATA_FLOW_UNVERIFIED"
  | "DATA_RETENTION_UNVERIFIED"
  | "INCIDENT_RESPONSE_UNVERIFIED"
  | "AUTHORIZATION_CALLBACK_UNVERIFIED"
  | "WEBHOOK_CLAIM_CONTRADICTS_IMPLEMENTATION"
  | "OPERATING_CREDENTIAL_MISSING"
  | "API_SCOPE_UNVERIFIED"
  | "NETWORK_EGRESS_UNVERIFIED"
  | "PRODUCT_IDENTITY_UNVERIFIED"
  | "LOCALE_CONTENT_UNVERIFIED"
  | "CATEGORY_UNVERIFIED"
  | "CATEGORY_ATTRIBUTES_UNVERIFIED"
  | "CATEGORY_COMPLIANCE_UNVERIFIED"
  | "SALE_UNIT_MISMATCH"
  | "PRICE_UNVERIFIED"
  | "STOCK_UNVERIFIED"
  | "PACKAGE_UNVERIFIED"
  | "APPROVED_REPRESENTATIVE_IMAGE_REQUIRED"
  | "APPROVED_DETAIL_IMAGES_REQUIRED"
  | "STORE_DEFAULT_SHIPPING_UNVERIFIED"
  | "DUPLICATE_READ_UNVERIFIED";

export type TemuReadinessIssue = {
  area: "app_review" | "authorization" | "product" | "category" | "assets" | "shipping" | "duplicate_read";
  code: TemuReadinessIssueCode;
  evidenceRequired: string;
};

export type TemuAppReviewEvidence = {
  currentAppState: "active" | "inactive" | "unknown";
  currentComplianceState: "approved" | "rejected" | "reviewing" | "unknown";
  rejectionReason: string | null;
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

export type TemuCreateEvidence = {
  operatingCredentialPresent: boolean;
  verifiedApiScopes: readonly string[];
  networkEgress:
    | "static_ip_verified"
    | "provider_confirmed_no_allowlist"
    | "blocked_until_stable_ip"
    | "unknown";
  productId: string | null;
  ledgerId: string | null;
  sellerSku: string | null;
  locale: "ko-KR" | "unknown";
  language: "ko" | "unknown";
  localizedTitleVerified: boolean;
  localizedDescriptionVerified: boolean;
  localizedBulletPointsVerified: boolean;
  categoryId: string | null;
  categoryRecommendationVerified: boolean;
  categoryAttributesVerified: boolean;
  categoryComplianceVerified: boolean;
  certificationDecisionVerified: boolean;
  saleUnitCount: number | null;
  innerPackCount: number | null;
  inventoryQuantity: number | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  packageWeightGrams: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
  approvedRepresentativeImageCount: number;
  approvedDetailImageCount: number;
  storeDefaultShippingVerified: boolean;
  duplicateGoodsReadComplete: boolean;
  duplicateSkuReadComplete: boolean;
};

function text(value: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function positive(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function addIssue(
  issues: TemuReadinessIssue[],
  area: TemuReadinessIssue["area"],
  code: TemuReadinessIssueCode,
  evidenceRequired: string,
) {
  issues.push({ area, code, evidenceRequired });
}

export function inspectTemuReviewAndCreateReadiness(input: {
  app: TemuAppReviewEvidence;
  create: TemuCreateEvidence;
}) {
  const appIssues: TemuReadinessIssue[] = [];
  const createIssues: TemuReadinessIssue[] = [];
  const app = input.app;
  const create = input.create;

  if (app.currentAppState === "unknown" || app.currentComplianceState === "unknown") {
    addIssue(appIssues, "app_review", "CURRENT_APP_STATE_UNVERIFIED", "현재 Partner Platform의 App 상태와 Compliance 상태 화면");
  }
  if (app.currentComplianceState === "rejected" && !text(app.rejectionReason)) {
    addIssue(appIssues, "app_review", "COMPLIANCE_REJECTION_REASON_UNVERIFIED", "Rejected 상세 사유 원문과 해당 설문 항목");
  }
  const providers = new Set(app.cloudProviders.map((provider) => provider.trim()).filter(Boolean));
  if (!app.cloudDataFlowDocumented || !providers.has("Vercel") || !providers.has("Supabase")) {
    addIssue(appIssues, "app_review", "CLOUD_DATA_FLOW_UNVERIFIED", "Vercel 실행과 Supabase DB/Auth/Vault/Storage 간 실제 데이터 흐름");
  }
  if (!app.retentionAndDeletionDocumented) {
    addIssue(appIssues, "app_review", "DATA_RETENTION_UNVERIFIED", "Temu 데이터의 보관기간과 삭제 절차 문서");
  }
  if (!app.incidentResponseDocumented) {
    addIssue(appIssues, "app_review", "INCIDENT_RESPONSE_UNVERIFIED", "침해사고 탐지·통보·차단·복구 담당과 절차 문서");
  }
  if (app.authorizationMode === "authorization_callback"
    && (!app.authorizationCallbackImplemented || !text(app.authorizationCallbackEvidence))) {
    addIssue(appIssues, "authorization", "AUTHORIZATION_CALLBACK_UNVERIFIED", "등록된 redirect URL과 code 교환 callback의 배포·수신 증거");
  }
  if (app.authorizationMode === "unknown") {
    addIssue(appIssues, "authorization", "AUTHORIZATION_CALLBACK_UNVERIFIED", "Manual Access Token 또는 Authorization Callback 중 실제 사용할 방식");
  }
  if (app.eventWebhookClaimed && !app.eventWebhookImplemented) {
    addIssue(appIssues, "authorization", "WEBHOOK_CLAIM_CONTRADICTS_IMPLEMENTATION", "구현·배포·서명검증·재전송 처리가 확인된 Temu 이벤트 webhook");
  }

  if (!create.operatingCredentialPresent) {
    addIssue(createIssues, "authorization", "OPERATING_CREDENTIAL_MISSING", "활성 App에서 발급된 운영 Access Token의 서버 Vault 저장과 fresh token-info 결속");
  }
  const verifiedScopes = new Set(create.verifiedApiScopes);
  const missingScopes = temuReviewAndCreateRequiredApiScopes.filter((scope) => !verifiedScopes.has(scope));
  if (missingScopes.length > 0) {
    addIssue(createIssues, "authorization", "API_SCOPE_UNVERIFIED", `fresh token-info에 필요한 scope: ${missingScopes.join(", ")}`);
  }
  if (![
    "static_ip_verified",
    "provider_confirmed_no_allowlist",
  ].includes(create.networkEgress)) {
    addIssue(createIssues, "authorization", "NETWORK_EGRESS_UNVERIFIED", "Temu가 관측하는 운영 송신 IP와 allowlist 요구의 일치 증거");
  }
  if (!text(create.productId) || !text(create.ledgerId) || !text(create.sellerSku)) {
    addIssue(createIssues, "product", "PRODUCT_IDENTITY_UNVERIFIED", "동일 상품 revision의 productId, ledgerId, sellerSku");
  }
  if (create.locale !== "ko-KR" || create.language !== "ko"
    || !create.localizedTitleVerified
    || !create.localizedDescriptionVerified
    || !create.localizedBulletPointsVerified) {
    addIssue(createIssues, "product", "LOCALE_CONTENT_UNVERIFIED", "한국 마켓용 ko-KR 제목·설명·bullet과 body.language=ko의 동일 revision 결속");
  }
  if (!text(create.categoryId) || !create.categoryRecommendationVerified) {
    addIssue(createIssues, "category", "CATEGORY_UNVERIFIED", "동일 credential lineage로 조회한 Temu leaf category 또는 검증된 추천 결과");
  }
  if (!create.categoryAttributesVerified) {
    addIssue(createIssues, "category", "CATEGORY_ATTRIBUTES_UNVERIFIED", "선택 category의 공식 property/spec/size/template 응답과 필수값");
  }
  if (!create.categoryComplianceVerified || !create.certificationDecisionVerified) {
    addIssue(createIssues, "category", "CATEGORY_COMPLIANCE_UNVERIFIED", "선택 category의 compliance rules와 인증서 필요·면제 판정 근거");
  }
  if (create.saleUnitCount !== 1 || create.inventoryQuantity !== 1
    || create.innerPackCount !== 6) {
    addIssue(createIssues, "product", "SALE_UNIT_MISMATCH", "외부 판매단위 315g x 1개와 내부 52.5g x 6봉을 분리한 SKU/재고 입력");
  }
  if (!text(create.priceAmount)
    || !/^\d+(?:\.\d+)?$/u.test(create.priceAmount ?? "")
    || Number(create.priceAmount) <= 0
    || create.priceCurrency !== "KRW") {
    addIssue(createIssues, "product", "PRICE_UNVERIFIED", "양수 KRW 판매가와 승인된 가격 원장");
  }
  if (!Number.isSafeInteger(create.inventoryQuantity) || (create.inventoryQuantity ?? -1) < 0) {
    addIssue(createIssues, "product", "STOCK_UNVERIFIED", "0 이상의 정수 재고와 현재 원장 시각");
  }
  if (![create.packageWeightGrams, create.packageLengthCm, create.packageWidthCm, create.packageHeightCm].every(positive)) {
    addIssue(createIssues, "product", "PACKAGE_UNVERIFIED", "양수 무게(g)와 길이·너비·높이(cm)");
  }
  if (create.approvedRepresentativeImageCount !== 1) {
    addIssue(createIssues, "assets", "APPROVED_REPRESENTATIVE_IMAGE_REQUIRED", "현재 승인 revision에 결속된 대표 이미지 정확히 1장");
  }
  if (create.approvedDetailImageCount !== 8) {
    addIssue(createIssues, "assets", "APPROVED_DETAIL_IMAGES_REQUIRED", "현재 승인 revision에 결속된 서로 다른 상세 이미지 정확히 8장");
  }
  if (!create.storeDefaultShippingVerified) {
    addIssue(createIssues, "shipping", "STORE_DEFAULT_SHIPPING_UNVERIFIED", "현재 mall의 기본 배송 서비스·창고·배송비/반품 정책 확인");
  }
  if (!create.duplicateGoodsReadComplete || !create.duplicateSkuReadComplete) {
    addIssue(createIssues, "duplicate_read", "DUPLICATE_READ_UNVERIFIED", "단일 CREATE 직전 externalGoodsId와 externalSkuId의 완전한 exact 빈 결과");
  }

  return {
    appSubmissionPrepared: appIssues.length === 0,
    createPrewriteReady: app.currentAppState === "active"
      && app.currentComplianceState === "approved"
      && appIssues.length === 0
      && createIssues.length === 0,
    appIssues,
    createIssues,
    missingScopes,
    authorizationContract: app.authorizationMode === "manual_access_token"
      ? "no_callback_claimed" as const
      : app.authorizationMode === "authorization_callback"
        ? "callback_requires_deployed_evidence" as const
        : "authorization_mode_unverified" as const,
    webhookContract: app.eventWebhookClaimed
      ? "webhook_requires_deployed_evidence" as const
      : "no_webhook_claimed" as const,
  };
}
