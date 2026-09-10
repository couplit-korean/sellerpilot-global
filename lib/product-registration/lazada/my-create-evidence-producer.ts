import {
  lazadaMyDeliveryPolicyContract,
  lazadaMyEnglishContentApprovalContract,
  lazadaMyEnglishContentSha256,
  lazadaMyRequiredCommerceScopes,
  lazadaMyReturnPolicyContract,
} from "./my-create-readiness";
import {
  assertLazadaMyListingCreateContext,
} from "./listing-create-context";
import type {
  LazadaMyCreateApprovedOperatorEvidence,
  LazadaMyCreateServerEvidence,
} from "./my-create-readiness-builder";
import {
  normalizeLazadaProviderAccountIdentity,
  readProviderAccountIdentity,
} from "../../channels/provider-account-identity";

type UnknownRecord = Record<string, unknown>;

export const lazadaMyCreateEvidenceProducerContract =
  "lazada_my_create_evidence_producer_v1" as const;
export const lazadaMyCreateEvidenceBlockerContract =
  "lazada_my_create_evidence_blocker_v1" as const;

export type LazadaMyCreateEvidenceKey = Readonly<{
  source: "sellerpilot-server-listing-claim";
  operation: "listing.create";
  productId: string;
  credentialId: string;
  targetId: string;
  revision: string;
  observedAt: string;
}>;

type BoundRow = Readonly<{
  productId: string;
  credentialId: string;
  targetId: string;
  revision: string;
  observedAt: string;
}>;

export type LazadaMyCreateProductSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-product-create-context";
  argumentsValue: UnknownRecord;
}>;

export type LazadaMyCreateCredentialSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-active-vault-credential";
  channel: "lazada";
  environment: "production";
  status: "active";
  version: number;
  lastRotatedAt: string;
  sellerAccountKeySource: "provider_certified_v1";
  sellerAccountVerifiedAt: string;
  secretPayload: UnknownRecord;
}>;

export type LazadaMyCreateOAuthSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-oauth-callback-lineage";
  appKey: string;
  country: "my";
  redirectUri: string;
  responseType: "code";
  authorizationState: string;
  callbackState: string;
  callbackClaimed: true;
  oauthComplete: true;
  completedAt: string;
}>;

export type LazadaMyCreateTargetSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-current-target-discovery";
  shortCode: string;
  marketCode: "MY";
  locale: "ms-MY";
  language: "Bahasa Melayu";
  currency: "MYR";
  remoteStatus: "ACTIVE";
  verifiedAt: string;
}>;

export type LazadaMyCreateCommerceAppSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-commerce-app-attestation";
  appKey: string;
  appName: string;
  status: "Online";
  authorizationKind: "seller";
  scopes: readonly string[];
  verifiedAt: string;
}>;

export type LazadaMyCreateApprovalSnapshot = BoundRow & Readonly<{
  source: "sellerpilot-rpc-approved-operator-evidence";
  deliveryPolicy: unknown;
  returnPolicy: unknown;
  englishContentApproval: unknown;
}>;

export type LazadaMyCreateEvidenceProducerDependencies = Readonly<{
  assertRevisionCurrent: (key: LazadaMyCreateEvidenceKey) => Promise<void>;
  loadProductSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateProductSnapshot | null>;
  loadCredentialSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateCredentialSnapshot | null>;
  loadOAuthSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateOAuthSnapshot | null>;
  loadTargetSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateTargetSnapshot | null>;
  loadCommerceAppSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateCommerceAppSnapshot | null>;
  loadApprovalSnapshot: (
    key: LazadaMyCreateEvidenceKey,
  ) => Promise<LazadaMyCreateApprovalSnapshot | null>;
}>;

export type LazadaMyCreateEvidenceBlocker = Readonly<{
  contract: typeof lazadaMyCreateEvidenceBlockerContract;
  productId: string;
  credentialId: string;
  targetId: string;
  revision: string;
  stage:
    | "selection"
    | "revision"
    | "product"
    | "credential"
    | "oauth"
    | "target"
    | "commerce_app"
    | "approval";
  code: string;
  sellerpilotNoProviderRequestConfirmed: true;
  sellerpilotNoCreateConfirmed: true;
}>;

type ProducerSuccess = Readonly<{
  ok: true;
  contract: typeof lazadaMyCreateEvidenceProducerContract;
  key: LazadaMyCreateEvidenceKey;
  builderInput: Readonly<{
    evidence: LazadaMyCreateServerEvidence;
    operatorEvidence: LazadaMyCreateApprovedOperatorEvidence;
  }>;
}>;

type ProducerFailure = Readonly<{
  ok: false;
  blocker: LazadaMyCreateEvidenceBlocker;
}>;

class EvidenceError extends Error {
  constructor(
    readonly stage: LazadaMyCreateEvidenceBlocker["stage"],
    code: string,
  ) {
    super(code);
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function exactIso(value: unknown) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return normalized && Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : "";
}

function uuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(text(value));
}

function validRevision(value: unknown) {
  const normalized = text(value);
  return normalized.length >= 8 && normalized.length <= 160
    && /^[A-Za-z0-9._:-]+$/u.test(normalized);
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{2,159}$/u.test(message) ? message : fallback;
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): unknown => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return item;
    for (const child of Object.values(item as UnknownRecord)) freeze(child);
    return Object.freeze(item);
  };
  return freeze(clone) as T;
}

function assertKey(key: LazadaMyCreateEvidenceKey) {
  if (key.source !== "sellerpilot-server-listing-claim"
      || key.operation !== "listing.create"
      || !uuid(key.productId)
      || !uuid(key.credentialId)
      || !/^\d+$/u.test(key.targetId)
      || !validRevision(key.revision)
      || exactIso(key.observedAt) !== key.observedAt) {
    throw new EvidenceError(
      "selection",
      "LAZADA_MY_CREATE_SERVER_SELECTION_INVALID",
    );
  }
}

function assertBoundRow(
  key: LazadaMyCreateEvidenceKey,
  row: BoundRow | null,
  stage: LazadaMyCreateEvidenceBlocker["stage"],
) {
  if (!row
      || row.productId !== key.productId
      || row.credentialId !== key.credentialId
      || row.targetId !== key.targetId
      || row.revision !== key.revision
      || row.observedAt !== key.observedAt) {
    throw new EvidenceError(
      stage,
      `LAZADA_MY_CREATE_${stage.toUpperCase()}_SNAPSHOT_MISSING_OR_STALE`,
    );
  }
}

function assertCredential(input: {
  key: LazadaMyCreateEvidenceKey;
  row: LazadaMyCreateCredentialSnapshot;
}) {
  const { key, row } = input;
  const rotatedAt = Date.parse(row.lastRotatedAt);
  const accountVerifiedAt = Date.parse(row.sellerAccountVerifiedAt);
  const observedAt = Date.parse(key.observedAt);
  let identity: ReturnType<typeof normalizeLazadaProviderAccountIdentity>;
  try {
    identity = normalizeLazadaProviderAccountIdentity(row.secretPayload);
  } catch {
    throw new EvidenceError("credential", "LAZADA_MY_CREATE_CREDENTIAL_IDENTITY_INVALID");
  }
  const stored = readProviderAccountIdentity(row.secretPayload, "lazada");
  const my = identity.countryUserInfo.find((country) => country.country === "my");
  if (row.source !== "sellerpilot-rpc-active-vault-credential"
      || row.credentialId !== key.credentialId
      || row.channel !== "lazada"
      || row.environment !== "production"
      || row.status !== "active"
      || !Number.isSafeInteger(row.version) || row.version < 1
      || row.sellerAccountKeySource !== "provider_certified_v1"
      || !Number.isFinite(rotatedAt)
      || !Number.isFinite(accountVerifiedAt)
      || rotatedAt > observedAt
      || accountVerifiedAt < rotatedAt
      || accountVerifiedAt > observedAt
      || !stored || stored.subject !== identity.identity.subject
      || identity.accountPlatform !== "seller_center"
      || text(row.secretPayload.country).toLowerCase() !== "my"
      || my?.seller_id !== key.targetId
      || !text(my.short_code)) {
    throw new EvidenceError("credential", "LAZADA_MY_CREATE_CREDENTIAL_LINEAGE_INVALID");
  }
  return { my, rotatedAt };
}

function assertOAuth(input: {
  key: LazadaMyCreateEvidenceKey;
  row: LazadaMyCreateOAuthSnapshot;
  credential: LazadaMyCreateCredentialSnapshot;
}) {
  const { key, row, credential } = input;
  const completedAt = Date.parse(row.completedAt);
  const rotatedAt = Date.parse(credential.lastRotatedAt);
  if (row.source !== "sellerpilot-rpc-oauth-callback-lineage"
      || row.credentialId !== key.credentialId
      || row.appKey !== text(credential.secretPayload.app_key)
      || row.country !== "my"
      || row.responseType !== "code"
      || !/^https:\/\//u.test(row.redirectUri)
      || !row.authorizationState
      || row.callbackState !== row.authorizationState
      || row.callbackClaimed !== true
      || row.oauthComplete !== true
      || !Number.isFinite(completedAt)
      || completedAt > rotatedAt
      || rotatedAt - completedAt > 5 * 60 * 1_000) {
    throw new EvidenceError("oauth", "LAZADA_MY_CREATE_OAUTH_LINEAGE_INVALID");
  }
}

function assertTarget(input: {
  key: LazadaMyCreateEvidenceKey;
  row: LazadaMyCreateTargetSnapshot;
  shortCode: string;
  rotatedAt: number;
}) {
  const { key, row } = input;
  const verifiedAt = Date.parse(row.verifiedAt);
  if (row.source !== "sellerpilot-rpc-current-target-discovery"
      || row.credentialId !== key.credentialId
      || row.targetId !== key.targetId
      || row.shortCode !== input.shortCode
      || row.marketCode !== "MY"
      || row.locale !== "ms-MY"
      || row.language !== "Bahasa Melayu"
      || row.currency !== "MYR"
      || row.remoteStatus !== "ACTIVE"
      || row.verifiedAt !== key.observedAt
      || !Number.isFinite(verifiedAt)
      || verifiedAt < input.rotatedAt) {
    throw new EvidenceError("target", "LAZADA_MY_CREATE_TARGET_LINEAGE_INVALID");
  }
}

function assertCommerceApp(input: {
  key: LazadaMyCreateEvidenceKey;
  row: LazadaMyCreateCommerceAppSnapshot;
  appKey: string;
}) {
  const { key, row } = input;
  const scopes = new Set(row.scopes.map((scope) => text(scope)));
  if (row.source !== "sellerpilot-rpc-commerce-app-attestation"
      || row.appKey !== input.appKey
      || row.appName !== "Couplit Commerce"
      || row.status !== "Online"
      || row.authorizationKind !== "seller"
      || row.verifiedAt !== key.observedAt
      || row.scopes.some((scope) => !text(scope))
      || lazadaMyRequiredCommerceScopes.some((scope) => !scopes.has(scope))) {
    throw new EvidenceError("commerce_app", "LAZADA_MY_CREATE_COMMERCE_APP_ATTESTATION_INVALID");
  }
}

function assertApprovals(input: {
  key: LazadaMyCreateEvidenceKey;
  row: LazadaMyCreateApprovalSnapshot;
  argumentsValue: UnknownRecord;
}) {
  const { key, row } = input;
  const delivery = record(row.deliveryPolicy);
  const returns = record(row.returnPolicy);
  const english = record(row.englishContentApproval);
  const product = record(record(record(input.argumentsValue.request).Request).Product);
  const attributes = record(product.Attributes);
  if (row.source !== "sellerpilot-rpc-approved-operator-evidence"
      || row.productId !== key.productId
      || row.credentialId !== key.credentialId
      || row.targetId !== key.targetId
      || delivery.contract !== lazadaMyDeliveryPolicyContract
      || delivery.credentialId !== key.credentialId
      || delivery.sellerId !== key.targetId
      || delivery.market !== "MY"
      || delivery.approvedForCreate !== true
      || delivery.verifiedAt !== key.observedAt
      || !text(delivery.shipmentProvider)
      || !["economy", "standard", "express"].includes(text(delivery.deliveryOption).toLowerCase())
      || !["Yes", "No"].includes(text(delivery.deliveryOptionSof))
      || text(attributes.delivery_option_sof) !== text(delivery.deliveryOptionSof)
      || returns.contract !== lazadaMyReturnPolicyContract
      || returns.credentialId !== key.credentialId
      || returns.sellerId !== key.targetId
      || returns.market !== "MY"
      || returns.source !== "lazada-seller-center"
      || returns.approvedForCreate !== true
      || returns.verifiedAt !== key.observedAt
      || !text(returns.returnCondition)
      || english.contract !== lazadaMyEnglishContentApprovalContract
      || english.credentialId !== key.credentialId
      || english.sellerId !== key.targetId
      || english.market !== "MY"
      || english.languageCode !== "en_US"
      || english.approvedForCreate !== true
      || english.approvedAt !== key.observedAt
      || english.contentSha256 !== lazadaMyEnglishContentSha256(input.argumentsValue)) {
    throw new EvidenceError("approval", "LAZADA_MY_CREATE_APPROVAL_LINEAGE_INVALID");
  }
}

function blocker(
  key: LazadaMyCreateEvidenceKey,
  error: EvidenceError,
): ProducerFailure {
  return { ok: false, blocker: Object.freeze({
    contract: lazadaMyCreateEvidenceBlockerContract,
    productId: text(key.productId),
    credentialId: text(key.credentialId),
    targetId: text(key.targetId),
    revision: text(key.revision),
    stage: error.stage,
    code: safeCode(error, "LAZADA_MY_CREATE_SERVER_EVIDENCE_UNAVAILABLE"),
    sellerpilotNoProviderRequestConfirmed: true,
    sellerpilotNoCreateConfirmed: true,
  }) };
}

/**
 * Loads server/RPC evidence only. It exposes no provider transport, OAuth
 * exchange, browser state, or mutation callback. A success DTO is intended to
 * feed buildLazadaMyCreateReadinessInput directly and only in memory.
 */
export async function produceLazadaMyCreateEvidence(input: {
  key: LazadaMyCreateEvidenceKey;
  dependencies: LazadaMyCreateEvidenceProducerDependencies;
}): Promise<ProducerSuccess | ProducerFailure> {
  const key = frozenClone(input.key);
  try {
    assertKey(key);
    try {
      await input.dependencies.assertRevisionCurrent(key);
    } catch (error) {
      throw new EvidenceError(
        "revision",
        safeCode(error, "LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE"),
      );
    }
    const [product, credential, oauth, target, app, approval] =
      await Promise.all([
        input.dependencies.loadProductSnapshot(key),
        input.dependencies.loadCredentialSnapshot(key),
        input.dependencies.loadOAuthSnapshot(key),
        input.dependencies.loadTargetSnapshot(key),
        input.dependencies.loadCommerceAppSnapshot(key),
        input.dependencies.loadApprovalSnapshot(key),
      ]);
    assertBoundRow(key, product, "product");
    assertBoundRow(key, credential, "credential");
    assertBoundRow(key, oauth, "oauth");
    assertBoundRow(key, target, "target");
    assertBoundRow(key, app, "commerce_app");
    assertBoundRow(key, approval, "approval");
    if (product.source !== "sellerpilot-rpc-product-create-context"
        || product.productId !== key.productId) {
      throw new EvidenceError("product", "LAZADA_MY_CREATE_PRODUCT_SNAPSHOT_INVALID");
    }
    let context: ReturnType<typeof assertLazadaMyListingCreateContext>;
    try {
      context = assertLazadaMyListingCreateContext(product.argumentsValue);
    } catch {
      throw new EvidenceError("product", "LAZADA_MY_CREATE_PRODUCT_CONTEXT_INVALID");
    }
    if (context.productId !== key.productId
        || context.sellerId !== key.targetId
        || context.market !== "MY"
        || context.locale !== "ms-MY"
        || context.sellerModeVerifiedAt !== key.observedAt) {
      throw new EvidenceError("product", "LAZADA_MY_CREATE_PRODUCT_LINEAGE_INVALID");
    }
    const productPayload = record(record(record(
      product.argumentsValue.request,
    ).Request).Product);
    if (text(product.argumentsValue.remoteId)
        || text(product.argumentsValue.itemId)
        || text(productPayload.ItemId)
        || text(productPayload.AssociatedSku)) {
      throw new EvidenceError("product", "LAZADA_MY_CREATE_HISTORICAL_ITEM_FORBIDDEN");
    }
    const credentialIdentity = assertCredential({ key, row: credential });
    assertOAuth({ key, row: oauth, credential });
    assertTarget({
      key,
      row: target,
      shortCode: credentialIdentity.my.short_code ?? "",
      rotatedAt: credentialIdentity.rotatedAt,
    });
    assertCommerceApp({
      key,
      row: app,
      appKey: text(credential.secretPayload.app_key),
    });
    assertApprovals({ key, row: approval, argumentsValue: product.argumentsValue });
    try {
      await input.dependencies.assertRevisionCurrent(key);
    } catch (error) {
      throw new EvidenceError(
        "revision",
        safeCode(error, "LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE"),
      );
    }

    const evidence: LazadaMyCreateServerEvidence = frozenClone({
      revision: key.revision,
      observedAt: key.observedAt,
      source: "sellerpilot-server-create-context",
      expected: {
        appKey: app.appKey,
        appName: app.appName,
        redirectUri: oauth.redirectUri,
        credentialId: key.credentialId,
        sellerId: key.targetId,
        shortCode: target.shortCode,
      },
      commerceApp: {
        appKey: app.appKey,
        appName: app.appName,
        status: app.status,
        authorizationKind: app.authorizationKind,
        scopes: [...app.scopes],
        evidenceSource: "lazada-open-platform-console",
        verifiedAt: app.verifiedAt,
      },
      authorization: {
        clientId: oauth.appKey,
        redirectUri: oauth.redirectUri,
        responseType: oauth.responseType,
        country: oauth.country,
        state: oauth.authorizationState,
      },
      callback: {
        clientId: oauth.appKey,
        redirectUri: oauth.redirectUri,
        country: oauth.country,
        state: oauth.callbackState,
        credentialId: oauth.credentialId,
      },
      scope: {
        uiCredentialId: key.credentialId,
        routeCredentialId: key.credentialId,
        workerCredentialId: key.credentialId,
        operation: "listing.create",
        country: "my",
        market: "MY",
      },
      credential: credential.secretPayload,
      credentialRotatedAt: credential.lastRotatedAt,
      target: {
        credentialId: target.credentialId,
        targetId: target.targetId,
        shortCode: target.shortCode,
        marketCode: target.marketCode,
        locale: target.locale,
        language: target.language,
        currency: target.currency,
        verifiedAt: target.verifiedAt,
      },
      argumentsValue: product.argumentsValue,
      oauthEvidence: {
        revision: key.revision,
        source: "sellerpilot-server-oauth-lineage",
        credentialId: oauth.credentialId,
        appKey: oauth.appKey,
        country: "my",
        completedAt: oauth.completedAt,
      },
      targetEvidence: {
        revision: key.revision,
        source: "sellerpilot-server-target",
        credentialId: target.credentialId,
        sellerId: target.targetId,
        market: "MY",
        verifiedAt: target.verifiedAt,
      },
    });
    const operatorEvidence: LazadaMyCreateApprovedOperatorEvidence =
      frozenClone({
        revision: key.revision,
        source: "sellerpilot-approved-operator-evidence",
        deliveryPolicy: approval.deliveryPolicy,
        returnPolicy: approval.returnPolicy,
        englishContentApproval: approval.englishContentApproval,
      });
    return Object.freeze({
      ok: true,
      contract: lazadaMyCreateEvidenceProducerContract,
      key,
      builderInput: Object.freeze({ evidence, operatorEvidence }),
    });
  } catch (error) {
    const failure = error instanceof EvidenceError
      ? error
      : new EvidenceError(
        "selection",
        safeCode(error, "LAZADA_MY_CREATE_SERVER_EVIDENCE_UNAVAILABLE"),
      );
    return blocker(key, failure);
  }
}
