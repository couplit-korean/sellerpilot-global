import { createHash } from "node:crypto";

import type { RemoteResponse, SecretPayload } from "../../channels/protocols";
import { inspectTemuGeneralCreateBody } from "./create-contract";
import {
  readTemuAccountIdentityBinding,
  temuAccountIdentitySubject,
} from "./account-identity";
import {
  collectTemuAuthoritativeReadinessInput,
  temuSystemAuthoritativeClock,
  type TemuAuthoritativeClock,
} from "./authoritative-source-collector";
import {
  createTemuAuthoritativeProviderReadAdapter,
} from "./authoritative-provider-read-adapter";
import {
  createTemuAuthoritativePreparationReadAdapter,
  temuCategoryPreparationPlanSha256,
  type TemuCategoryPreparationPlan,
  type TemuPreparationReadMethod,
} from "./authoritative-preparation-read-adapter";
import { createTemuAuthoritativeLedgerReadAdapter } from "./authoritative-ledger-read-adapter";
import { buildTemuReviewAndCreatePrewriteBinding } from "./create-readiness-builder";
import {
  bindTemuCreateAuthoritativeSourceBeforeClaim,
  recordTemuCreateAuthoritativeSource,
  TEMU_CREATE_APP_GATE_READ_RPC,
  TemuCreateSourceLedgerError,
  type TemuCreateSourceBinding,
  type TemuCreateSourceLedgerRpc,
} from "./create-authoritative-source-ledger";
import { temuProductRevisionFingerprint } from "./product-revision";

export const TEMU_CREATE_SOURCE_CONTEXT_RPC =
  "sellerpilot_service_temu_create_source_context_v1";

type UnknownRecord = Record<string, unknown>;
type ProviderRequest = (input: { payload: SecretPayload; type: string;
  arguments?: Record<string, unknown> }) => Promise<RemoteResponse>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord : null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exactContext(value: unknown) {
  const context = record(value);
  if (!context || context.contract !== "temu_create_source_context_v1"
    || context.status !== "ready"
    || !text(context.productUpdatedAt)
    || !/^[1-9]\d{0,31}$/u.test(String(context.productRevision ?? ""))
    || !Number.isSafeInteger(number(context.credentialVersion))
    || !/^[a-f0-9]{64}$/u.test(String(context.credentialFingerprint ?? ""))
    || context.credentialEnvironment !== "production"
    || !Number.isSafeInteger(number(context.currentSourceRevision))) {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }
  return context;
}

function exactAppGate(value: unknown) {
  const app = record(value);
  if (!app || app.contract !== "temu_verified_create_app_gate_v1") {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  }
  if (app.status !== "allowed") {
    if (app.appState === "inactive") {
      throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_INACTIVE");
    }
    if (app.complianceState !== "approved") {
      throw new TemuCreateSourceLedgerError("TEMU_CREATE_COMPLIANCE_NOT_APPROVED");
    }
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  }
  if (!text(app.appId)
    || !/^temu-account:sha256:[a-f0-9]{64}$/u.test(
      String(app.partnerAccountSubject ?? ""),
    )) throw new TemuCreateSourceLedgerError("TEMU_CREATE_APP_GATE_UNAVAILABLE");
  return app;
}

function assignment(context: UnknownRecord) {
  const matches = Array.isArray(context.assignments)
    ? context.assignments.map(record).filter((value): value is UnknownRecord =>
      Boolean(value && value.channel === "temu" && value.market === "KR"
        && value.status === "confirmed"))
    : [];
  if (matches.length !== 1) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_SOURCE_UNAVAILABLE",
  );
  return matches[0];
}

export function normalizeTemuCreateBodyFromServerContext(input: {
  argumentsValue: UnknownRecord;
  publishContext: UnknownRecord;
}) {
  const selected = assignment(input.publishContext);
  const categoryPath = Array.isArray(selected.categoryPath)
    ? selected.categoryPath.map(text).filter((value): value is string => Boolean(value))
    : [];
  const body = record(input.argumentsValue.body);
  const goodsBasic = record(body?.goodsBasic);
  if (!body || !goodsBasic || categoryPath.length < 1) {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }
  const normalizedGoodsBasic = structuredClone(goodsBasic);
  // General Create accepts an external category name/path, while the exact
  // numeric leaf ID remains in the official preparation plan and evidence.
  normalizedGoodsBasic.extCatName = categoryPath.join(" / ");
  delete normalizedGoodsBasic.costTemplate;
  return { ...structuredClone(input.argumentsValue), body: {
    ...structuredClone(body), goodsBasic: normalizedGoodsBasic,
  }};
}

function categoryPlan(input: { context: UnknownRecord; body: UnknownRecord }) {
  const selected = assignment(input.context);
  const metadata = record(selected.officialMetadata);
  const configured = record(metadata?.temuCategoryPreparationPlan);
  const goodsBasic = record(input.body.goodsBasic);
  const attributes = Array.isArray(input.body.attributes)
    ? input.body.attributes.map(record).filter((value): value is UnknownRecord => Boolean(value))
    : [];
  if (!configured || !goodsBasic) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_SOURCE_UNAVAILABLE",
  );
  return {
    categoryId: String(selected.categoryId ?? ""),
    parentCategoryId: String(configured.parentCategoryId ?? ""),
    language: "ko",
    goodsName: String(goodsBasic.goodsName ?? ""),
    goodsDescription: String(goodsBasic.goodsDesc ?? ""),
    goodsProperties: attributes.map((value) => ({
      propName: String(value.name ?? ""),
      values: Array.isArray(value.value) ? value.value.map(String) : [],
    })),
    normalProperties: Array.isArray(configured.normalProperties)
      ? configured.normalProperties : [],
    selectedSpecIds: Array.isArray(configured.selectedSpecIds)
      ? configured.selectedSpecIds : [],
    resolvedSizeElementIds: Array.isArray(configured.resolvedSizeElementIds)
      ? configured.resolvedSizeElementIds : [],
  } as TemuCategoryPreparationPlan;
}

export async function recordAndReadTemuCreateSource(input: {
  rpc: TemuCreateSourceLedgerRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  requestFingerprint: string;
  recordParameters: Record<string, unknown>;
}) {
  const readback = () => bindTemuCreateAuthoritativeSourceBeforeClaim({
    rpc: input.rpc, ownerId: input.ownerId, productId: input.productId,
    credentialId: input.credentialId,
    requestFingerprint: input.requestFingerprint,
  });
  try {
    await recordTemuCreateAuthoritativeSource({ rpc: input.rpc,
      parameters: input.recordParameters });
    return await readback();
  } catch (recordOrReadError) {
    // A lost record response is reconciled only by the exact request-bound
    // fresh readback. No second append and no provider mutation is attempted.
    try {
      return await readback();
    } catch {
      throw recordOrReadError;
    }
  }
}

export async function produceTemuCreateAuthoritativeSourceBeforeClaim(input: {
  rpc: TemuCreateSourceLedgerRpc;
  ownerId: string;
  productId: string;
  credentialId: string;
  requestFingerprint: string;
  argumentsValue: UnknownRecord;
  publishContext: UnknownRecord;
  credentialMetadata: UnknownRecord;
  decryptCredential: () => Promise<SecretPayload>;
  providerRequest?: ProviderRequest;
  clock?: TemuAuthoritativeClock;
}): Promise<{ sourceBinding: TemuCreateSourceBinding;
  prewriteBinding: NonNullable<ReturnType<typeof buildTemuReviewAndCreatePrewriteBinding>["binding"]> }> {
  const clock = input.clock ?? temuSystemAuthoritativeClock;
  const scope = { p_owner_id: input.ownerId, p_product_id: input.productId,
    p_credential_id: input.credentialId };

  // Deliberately the first dependency. A blocked UI observation performs no
  // decrypt, official provider GET, source append, claim, or enqueue.
  const gateResult = await input.rpc(TEMU_CREATE_APP_GATE_READ_RPC, scope)
    .catch(() => ({ data: null, error: { message: "unavailable" } }));
  if (gateResult.error) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_APP_GATE_UNAVAILABLE",
  );
  const appGate = exactAppGate(gateResult.data);

  const contextResult = await input.rpc(TEMU_CREATE_SOURCE_CONTEXT_RPC, scope);
  if (contextResult.error) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_SOURCE_UNAVAILABLE",
  );
  const sourceContext = exactContext(contextResult.data);
  if (number(input.credentialMetadata.version) !== number(sourceContext.credentialVersion)
    || input.credentialMetadata.fingerprint !== sourceContext.credentialFingerprint
    || input.credentialMetadata.environment !== "production") {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }

  const payload = await input.decryptCredential();
  const identity = readTemuAccountIdentityBinding(payload);
  const body = record(input.argumentsValue.body);
  const inspection = inspectTemuGeneralCreateBody(body);
  if (!identity || !body || !inspection.ok || !inspection.externalGoodsId
    || inspection.externalSkuIds.length !== 1) {
    throw new TemuCreateSourceLedgerError("TEMU_CREATE_SOURCE_UNAVAILABLE");
  }
  const externalGoodsId = inspection.externalGoodsId;
  const externalSkuId = inspection.externalSkuIds[0];
  const productFingerprint = temuProductRevisionFingerprint(input.publishContext);
  const ledger = createTemuAuthoritativeLedgerReadAdapter({
    rpc: input.rpc as never, ownerId: input.ownerId, productId: input.productId,
    accountSubject: String(appGate.partnerAccountSubject), mallId: identity.mallId,
    regionId: identity.regionId, productRevisionFingerprint: productFingerprint,
    clock,
  });
  const plan = categoryPlan({ context: input.publishContext, body });
  const planDigest = temuCategoryPreparationPlanSha256(plan);
  const provider = createTemuAuthoritativeProviderReadAdapter({
    payload, expectedMallId: identity.mallId, expectedRegionId: identity.regionId,
    productRevisionFingerprint: productFingerprint, externalGoodsId,
    externalSkuId, createBody: body, request: input.providerRequest, clock,
  });
  const preparation = createTemuAuthoritativePreparationReadAdapter({
    payload, expectedAccountSubject: String(appGate.partnerAccountSubject),
    expectedMallId: identity.mallId, expectedRegionId: identity.regionId,
    productRevisionFingerprint: productFingerprint, externalGoodsId,
    category: plan,
    categoryBinding: { source: "sellerpilot_exact_product_revision_category_plan_v1",
      productRevisionFingerprint: productFingerprint,
      categoryPlanSha256: planDigest },
    readCurrentAppSnapshot: ledger.readCurrentAppSnapshot,
    readCurrentShippingSnapshot: ledger.readCurrentShippingSnapshot,
    ...(input.providerRequest ? { request: input.providerRequest as (value: {
      payload: SecretPayload; type: TemuPreparationReadMethod;
      arguments?: Record<string, unknown> }) => Promise<RemoteResponse> } : {}),
    clock,
  });
  let categoryEvidence: Awaited<ReturnType<typeof preparation.readLeafCategoryCompliance>> | null = null;
  const shippingSnapshot = await ledger.readCurrentShippingSnapshot();
  const egressSnapshot = await ledger.readGlobalEgressAttestation({
    endpointHost: "openapi-b-global.temu.com",
  });
  const wrappedCategory: typeof preparation.readLeafCategoryCompliance = async (value) => {
    categoryEvidence = await preparation.readLeafCategoryCompliance(value);
    return categoryEvidence;
  };
  const product = record(input.publishContext.product) ?? {};
  const selected = assignment(input.publishContext);
  const metadata = record(selected.officialMetadata) ?? {};
  const policy = record(metadata.temuCompliancePolicy);
  const sku = Array.isArray(body.skuList) ? record(body.skuList[0]) : null;
  const price = record(sku?.price); const basePrice = record(price?.basePrice);
  const pack = record(sku?.packageInfo); const goodsBasic = record(body.goodsBasic)!;
  const nowEpochMs = clock.nowEpochMs();
  const tokenSubject = temuAccountIdentitySubject(identity);
  const mappingCore = { source: "temu_partner_token_account_mapping_v1" as const,
    observedAtEpochMs: nowEpochMs,
    partnerAccountSubject: String(appGate.partnerAccountSubject),
    tokenIdentitySubject: tokenSubject, mallId: identity.mallId,
    regionId: identity.regionId,
    productRevisionFingerprint: productFingerprint };
  const collected = await collectTemuAuthoritativeReadinessInput({
    request: {
      nowEpochMs, expectedAppId: String(appGate.appId),
      expectedPublicationFingerprint: productFingerprint,
      expectedExternalGoodsId: externalGoodsId,
      expectedExternalSkuId: externalSkuId,
      expectedCategoryPlanSha256: planDigest,
      accountMapping: { ...mappingCore, evidenceSha256: digest(mappingCore) },
      policy: policy as never,
      product: {
        source: "sellerpilot_exact_product_revision", productId: input.productId,
        ledgerId: text(product.externalCode), sellerSku: externalGoodsId,
        revisionFingerprint: productFingerprint, locale: "ko-KR", language: "ko",
        localizedTitleVerified: Boolean(text(goodsBasic.goodsName)),
        localizedDescriptionVerified: Boolean(text(goodsBasic.goodsDesc)),
        localizedBulletPointsVerified: Array.isArray(goodsBasic.bulletPoints)
          && goodsBasic.bulletPoints.length > 0,
        saleUnitCount: number(metadata.temuSaleUnitCount),
        innerPackCount: number(metadata.temuInnerPackCount),
        inventoryQuantity: number(sku?.quantity),
        priceAmount: text(basePrice?.amount), priceCurrency: text(basePrice?.currency),
        packageWeightGrams: number(pack?.weight), packageLengthCm: number(pack?.length),
        packageWidthCm: number(pack?.width), packageHeightCm: number(pack?.height),
      },
      assets: { source: "sellerpilot_approved_asset_lineage",
        productId: input.productId, productRevisionFingerprint: productFingerprint,
        representativeImages: goodsBasic.goodsCarouselImage as string[],
        detailImages: goodsBasic.detailImage as string[] },
    },
    dependencies: { ...provider, ...preparation,
      readLeafCategoryCompliance: wrappedCategory,
      readGlobalEgressAttestation: ledger.readGlobalEgressAttestation },
    clock,
  });
  if (!collected.ok || !collected.serviceInput || !categoryEvidence
    || !shippingSnapshot) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_SOURCE_UNAVAILABLE",
  );
  const prewrite = buildTemuReviewAndCreatePrewriteBinding(collected.serviceInput);
  if (!prewrite.ok || !prewrite.binding) throw new TemuCreateSourceLedgerError(
    "TEMU_CREATE_SOURCE_UNAVAILABLE",
  );
  const exactCategoryEvidence = categoryEvidence as Awaited<ReturnType<
    typeof preparation.readLeafCategoryCompliance
  >>;
  const evidence = {
    contract: "temu_create_authoritative_source_v1",
    requestFingerprint: input.requestFingerprint,
    product: { productId: input.productId,
      revisionFingerprint: productFingerprint },
    credential: { credentialId: input.credentialId,
      version: number(sourceContext.credentialVersion), active: true },
    account: { partnerAccountSubject: appGate.partnerAccountSubject,
      tokenIdentitySubject: tokenSubject, mallId: identity.mallId,
      regionId: identity.regionId },
    app: { appId: appGate.appId, state: "active", complianceState: "approved" },
    category: { categoryPlanSha256: planDigest,
      requestEvidenceSha256: exactCategoryEvidence.requestEvidenceSha256,
      responseEvidenceSha256: exactCategoryEvidence.responseEvidenceSha256,
      leafCategoryVerified: exactCategoryEvidence.leafCategoryVerified,
      categoryRecommendationVerified: exactCategoryEvidence.categoryRecommendationVerified,
      categoryAttributesVerified: exactCategoryEvidence.categoryAttributesVerified,
      categoryComplianceVerified: exactCategoryEvidence.categoryComplianceVerified,
      certificationDecisionVerified: exactCategoryEvidence.certificationDecisionVerified },
    shipping: { defaultTemplateId: shippingSnapshot.defaultTemplateId,
      storeDefaultShippingVerified: collected.serviceInput.shipping?.storeDefaultShippingVerified,
      warehouseVerified: shippingSnapshot.warehouseVerified,
      feeRuleVerified: shippingSnapshot.feeRuleVerified,
      returnPolicyVerified: shippingSnapshot.returnPolicyVerified },
    egress: { endpointHost: egressSnapshot.endpointHost, state: egressSnapshot.state },
    assets: collected.serviceInput.assets,
    duplicateRead: collected.serviceInput.duplicateRead,
  };
  const observedAt = new Date(collected.serviceInput.nowEpochMs).toISOString();
  const sourceRevision = Number(sourceContext.currentSourceRevision) + 1;
  const recordParameters = {
    ...scope, p_source_revision: sourceRevision,
    p_product_revision: sourceContext.productRevision,
    p_product_revision_fingerprint: productFingerprint,
    p_product_updated_at: sourceContext.productUpdatedAt,
    p_credential_version: sourceContext.credentialVersion,
    p_credential_fingerprint: sourceContext.credentialFingerprint,
    p_partner_account_subject: appGate.partnerAccountSubject,
    p_token_identity_subject: tokenSubject, p_mall_id: identity.mallId,
    p_region_id: identity.regionId, p_request_fingerprint: input.requestFingerprint,
    p_category_plan_sha256: planDigest,
    p_category_request_sha256: exactCategoryEvidence.requestEvidenceSha256,
    p_category_response_sha256: exactCategoryEvidence.responseEvidenceSha256,
    p_observed_at: observedAt,
    p_expires_at: new Date(collected.serviceInput.nowEpochMs + 4 * 60_000).toISOString(),
    p_evidence_sha256: digest(evidence), p_evidence: evidence,
    p_expected_current_source_id: sourceContext.currentSourceId ?? null,
  };
  const sourceBinding: TemuCreateSourceBinding =
    await recordAndReadTemuCreateSource({
      rpc: input.rpc, ownerId: input.ownerId, productId: input.productId,
      credentialId: input.credentialId,
      requestFingerprint: input.requestFingerprint, recordParameters,
    });
  return { sourceBinding, prewriteBinding: prewrite.binding };
}
