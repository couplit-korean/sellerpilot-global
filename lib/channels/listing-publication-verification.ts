import { createHash } from "node:crypto";
import { z } from "zod";
import type { ActiveChannelKey } from "./catalog";
import { assertProviderAccountIdentity } from "./provider-account-identity";
import { elevenstVerifiedListingRemoteState } from "./elevenst-listing-publication";
import {
  readCoupangListingPublicationState,
  readEbayListingPublicationState,
  readSmartstoreListingPublicationState,
} from "./listing-publication-readback";
import {
  parseListingPublicationAssetBinding,
  verifyListingPublicationContent,
} from "./listing-publication-content";
import {
  verifiedListingRemoteStateSchema,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";
import type { ChannelOperationStep } from "./operations";
import {
  coupangRequest,
  ebayRequest,
  ebayTradingRequest,
  ebayTradingXmlEscape,
  elevenstSellerXmlRequest,
  fetchEbayTradingUserIdentity,
  naverRequest,
  qoo10Request,
  readStoredNaverAccessToken,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";
import { readLazadaListingPublicationState } from "./provider-lazada-publication-readback";
import {
  readShopeeGlobalListingPublicationState,
  readShopeeListingPublicationState,
} from "./provider-shopee-publication-readback";
import { qoo10ResultMessage } from "./qoo10";
import {
  normalizeQoo10ListingPublicationReadback,
  qoo10VerifiedListingRemoteState,
} from "./qoo10-listing-publication";
import {
  qoo10ListingCreateExpectation,
  qoo10DetailImageUrls,
  qoo10SellerAccountIdentityDigestFromReadback,
} from "./qoo10-listing-create-preflight";
import {
  qoo10RollbackUpdateRecoveryBinding,
} from "./listing-update";
import {
  qoo10ExactRecoveryContentRemoteState,
  qoo10ExactSuccessResultCode,
  qoo10ProviderDetailHtmlEquivalent,
  qoo10ProviderKeywordMatches,
  qoo10CriticalReadbackAliasesConsistent,
} from "./qoo10-listing-activation";

type PublicationChannel = Exclude<ActiveChannelKey, "temu">;
type SourceOperation = "listing.create" | "listing.update";
type UnknownRecord = Record<string, unknown>;

export const listingPublicationVerificationSourceContract =
  "listing_publication_verification_source_v1" as const;

export const listingPublicationVerificationSourceSchema = z.object({
  contract: z.literal(listingPublicationVerificationSourceContract),
  verificationJobId: z.string().uuid(),
  sourceJobId: z.string().uuid(),
  sourceOperation: z.enum(["listing.create", "listing.update"]),
  sourceArguments: z.record(z.string(), z.unknown()),
  sourceResponsePayload: z.record(z.string(), z.unknown()),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedRemoteId: z.string().trim().min(1).max(240),
  expectedLocale: z.string().trim().min(2).max(35),
  expectedImageCount: z.literal(8),
  market: z.string().max(80),
  targetId: z.string().max(160),
}).strict().superRefine((value, context) => {
  try {
    if (Buffer.byteLength(JSON.stringify(value.sourceArguments), "utf8") > 128_000) {
      context.addIssue({
        code: "custom",
        path: ["sourceArguments"],
        message: "publication source arguments are too large",
      });
    }
    if (Buffer.byteLength(JSON.stringify(value.sourceResponsePayload), "utf8") > 1_000_000) {
      context.addIssue({
        code: "custom",
        path: ["sourceResponsePayload"],
        message: "publication source response is too large",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      path: ["sourceArguments"],
      message: "publication source arguments must be serializable",
    });
  }
});

export type ListingPublicationVerificationSource = z.infer<
  typeof listingPublicationVerificationSourceSchema
>;

type VerificationInput = {
  channel: PublicationChannel;
  operation: "listing.publication.verify";
  payload: SecretPayload;
  shopeeShopCredential?: SecretPayload;
  arguments: UnknownRecord;
  environment: "sandbox" | "production";
};

export type ListingPublicationVerificationExecution = {
  steps: ChannelOperationStep[];
  remoteId: string;
  remoteState?: VerifiedListingRemoteState;
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function requestIdentifier(data: UnknownRecord) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = exactText(data[key]);
    if (value) return value.slice(0, 160);
  }
  return undefined;
}

function providerStep(name: string, remote: RemoteResponse): ChannelOperationStep {
  const resultCode = remote.data.ResultCode ?? remote.data.ErrorCode;
  const commonCode = remote.data.code;
  const shopeeError = remote.data.error;
  const normalizedCommonCode = commonCode == null ? "" : String(commonCode).toUpperCase();
  const commonCodeAccepted = !normalizedCommonCode
    || ["0", "SUCCESS", "SUCCES", "OK"].includes(normalizedCommonCode)
    || /^2\d\d$/u.test(normalizedCommonCode);
  return {
    name,
    ok: remote.response.ok
      && (resultCode == null || String(resultCode) === "0")
      && commonCodeAccepted
      && (shopeeError == null || String(shopeeError) === ""),
    status: remote.response.status,
    ...(requestIdentifier(remote.data) ? { requestId: requestIdentifier(remote.data) } : {}),
    data: remote.data,
  };
}

function sourceContext(input: VerificationInput) {
  const source = listingPublicationVerificationSourceSchema.safeParse(
    input.arguments.sellerpilotPublicationSource,
  );
  const remoteId = exactText(input.arguments.remoteId);
  const expectedLocale = exactText(input.arguments.publicationExpectedLocale);
  const expectedFingerprint = exactText(input.arguments.publicationExpectedFingerprint);
  const expectedImageCount = input.arguments.publicationExpectedImageCount;
  const market = exactText(input.arguments.market);
  const targetId = exactText(input.arguments.targetId);
  const sourceJobId = exactText(input.arguments.publicationReviewSourceJobId);
  if (input.arguments.sellerpilotReadOnly !== true
      || input.arguments.publicationIntent !== "live"
      || input.arguments.publicationStateContract !== "verified_remote_state_v1"
      || input.arguments.publicationExpectedImageCount !== 8
      || !remoteId
      || !expectedLocale
      || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)
      || !source.success
      || source.data.sourceJobId !== sourceJobId
      || source.data.expectedRemoteId !== remoteId
      || source.data.expectedLocale !== expectedLocale
      || source.data.expectedImageCount !== expectedImageCount
      || source.data.sourceFingerprint !== expectedFingerprint
      || source.data.market !== market
      || source.data.targetId !== targetId) {
    throw new Error("LISTING_PUBLICATION_VERIFY_SOURCE_CONTEXT_INVALID");
  }
  const sourceArguments = source.data.sourceArguments;
  const legacyElevenstSnapshotAttestation = recordValue(
    sourceArguments.sellerpilotElevenstLegacySnapshotAttestation,
  );
  const legacyElevenstSnapshot = input.channel === "elevenst"
    && input.arguments.sellerpilotElevenstSnapshotRecovery
      === "elevenst_exact_legacy_snapshot_recovery_v1"
    && input.arguments.sellerpilotSnapshotOnly === true;
  const validLegacyElevenstSnapshot = legacyElevenstSnapshot
    && legacyElevenstSnapshotAttestation.contract
      === "elevenst_exact_legacy_source_attestation_v1"
    && legacyElevenstSnapshotAttestation.snapshotOnly === true
    && legacyElevenstSnapshotAttestation.approvedContentVerified === false
    && legacyElevenstSnapshotAttestation.publicationReviewAllowed === false
    && /^[a-f0-9]{64}$/u.test(exactText(
      legacyElevenstSnapshotAttestation.sourceRequestSha256,
    ))
    && /^[a-f0-9]{64}$/u.test(exactText(
      legacyElevenstSnapshotAttestation.sourceResponseSha256,
    ))
    && exactText(legacyElevenstSnapshotAttestation.approvedManifestDigest)
      === exactText(input.arguments.approvedManifestDigest)
    && Number(legacyElevenstSnapshotAttestation.approvedDetailPageVersion)
      === Number(input.arguments.approvedDetailPageVersion)
    && Number.isSafeInteger(Number(input.arguments.approvedDetailPageVersion))
    && Number(input.arguments.approvedDetailPageVersion) > 0
    && Object.keys(recordValue(sourceArguments.product)).length > 0
    && sourceArguments.publicationIntent === undefined
    && sourceArguments.publicationStateContract === undefined
    && sourceArguments.publicationExpectedLocale === undefined
    && sourceArguments.publicationExpectedFingerprint === undefined
    && sourceArguments.publicationExpectedImageCount === undefined
    && sourceArguments.sellerpilotPublicationAssetBinding === undefined
    && Object.keys(recordValue(source.data.sourceResponsePayload.remoteState)).length === 0;
  const qoo10RecoveryBinding = input.channel === "qoo10"
    ? qoo10RollbackUpdateRecoveryBinding(sourceArguments)
    : null;
  const sourceResponse = source.data.sourceResponsePayload;
  const sourceSteps = responseSteps(sourceResponse);
  const exactQoo10S1Recovery = input.channel === "qoo10"
    && input.arguments.sellerpilotQoo10ExactS1Recovery === "qoo10_exact_s1_verifier_v1"
    && source.data.sourceOperation === "listing.update"
    && Boolean(qoo10RecoveryBinding)
    && qoo10RecoveryBinding?.remoteId === remoteId
    && exactText(recordValue(sourceArguments.params).ItemCode) === remoteId
    && sourceResponse.channel === "qoo10"
    && sourceResponse.operation === "listing.update"
    && exactText(sourceResponse.remoteId) === remoteId
    && sourceSteps.filter((item) => exactText(item.name) === "qoo10-rollback-pre-activation-readback").length === 1
    && sourceSteps.every((item) => ![
      "qoo10-rollback-recovery-activate",
      "qoo10-s1-activation",
    ].includes(exactText(item.name)))
    && sourceArguments.publicationIntent === "live"
    && sourceArguments.publicationStateContract === "verified_remote_state_v1"
    && sourceArguments.publicationExpectedLocale === expectedLocale
    && sourceArguments.publicationExpectedFingerprint === expectedFingerprint
    && sourceArguments.publicationExpectedImageCount === 8;
  if (!validLegacyElevenstSnapshot && !exactQoo10S1Recovery && (sourceArguments.publicationIntent !== "live"
      || sourceArguments.publicationStateContract !== "verified_remote_state_v1"
      || sourceArguments.publicationExpectedLocale !== expectedLocale
      || sourceArguments.publicationExpectedFingerprint !== expectedFingerprint
      || sourceArguments.publicationExpectedImageCount !== 8
      || !parseListingPublicationAssetBinding(
        sourceArguments.sellerpilotPublicationAssetBinding,
      )
      || recordValue(recordValue(source.data.sourceResponsePayload.remoteState).evidence)
        .publicationAssetBinding === undefined)) {
    throw new Error("LISTING_PUBLICATION_VERIFY_SOURCE_BINDING_INVALID");
  }
  return {
    source: source.data,
    remoteId,
    legacyElevenstSnapshot: validLegacyElevenstSnapshot,
    exactQoo10S1Recovery,
    expected: {
      locale: expectedLocale,
      fingerprint: expectedFingerprint,
      imageCount: 8,
    },
  };
}

const elevenstLegacySnapshotImmutableFields = [
  "sellerPrdCd",
  "dispCtgrNo",
  "selMthdCd",
  "prdTypCd",
  "rmaterialTypCd",
  "orgnTypCd",
  "suplDtyfrPrdClfCd",
  "forAbrdBuyClf",
  "minorSelCnYn",
  "selPrdClfCd",
  "dlvCnAreaCd",
  "dlvWyCd",
  "dlvCstInstBasiCd",
  "bndlDlvCnYn",
  "dlvCstPayTypCd",
] as const;

function elevenstLegacySnapshotImmutableProductMatches(
  sourceProductValue: unknown,
  remoteProductValue: unknown,
) {
  const sourceProduct = recordValue(sourceProductValue);
  const remoteProduct = recordValue(remoteProductValue);
  if (!exactText(sourceProduct.sellerPrdCd)
      || !exactText(sourceProduct.dispCtgrNo)) return false;
  if (elevenstLegacySnapshotImmutableFields.some((field) =>
    exactText(remoteProduct[field]) !== exactText(sourceProduct[field]))) return false;
  return JSON.stringify(remoteProduct.ProductCertGroup ?? null)
    === JSON.stringify(sourceProduct.ProductCertGroup ?? null);
}

function sourceSellerCode(argumentsValue: UnknownRecord) {
  return exactText(recordValue(argumentsValue.params).SellerCode);
}

function sourceElevenstSellerCode(argumentsValue: UnknownRecord) {
  return exactText(recordValue(argumentsValue.product).sellerPrdCd);
}

function sourceShopeeArguments(
  argumentsValue: UnknownRecord,
  immutableGlobalItemId = "",
) {
  const source = structuredClone(argumentsValue);
  if (immutableGlobalItemId) source.globalItemId = immutableGlobalItemId;
  return source;
}

function immutableSourceResources(source: ListingPublicationVerificationSource) {
  const state = recordValue(source.sourceResponsePayload.remoteState);
  const resources = recordValue(state.resources);
  if (!Object.keys(resources).length) {
    throw new Error("LISTING_PUBLICATION_VERIFY_SOURCE_REMOTE_STATE_INVALID");
  }
  return resources;
}

function responseSteps(responsePayload: UnknownRecord) {
  return Array.isArray(responsePayload.steps)
    ? responsePayload.steps.map(recordValue)
    : [];
}

function qoo10SourceMainImageContentId(
  source: ListingPublicationVerificationSource,
  remoteId: string,
) {
  const matches = responseSteps(source.sourceResponsePayload).filter((item) =>
    exactText(item.name) === "SetNewGoods"
    && item.ok === true
    && Number(item.status) >= 200
    && Number(item.status) < 300);
  if (matches.length !== 1) return "";
  const data = recordValue(matches[0]?.data);
  const resultObject = recordValue(data.ResultObject);
  const resultRemoteId = exactText(resultObject.GdNo);
  const contentId = exactText(resultObject.BIContentsNo);
  return exactText(data.ResultCode) === "0"
    && resultRemoteId === remoteId
    && /^[1-9]\d{5,19}$/u.test(contentId)
    ? contentId
    : "";
}

function sourceRemotePayload(
  channel: PublicationChannel,
  source: ListingPublicationVerificationSource,
) {
  const steps = responseSteps(source.sourceResponsePayload);
  const matchingData = (names: RegExp) => {
    const matched = [...steps].reverse().find((item) => names.test(exactText(item.name)));
    return recordValue(matched?.data);
  };
  if (channel === "qoo10") {
    return matchingData(/^GetItemDetailInfo-publication-readback$/u);
  }
  if (channel === "elevenst") {
    return matchingData(/^(?:product-publication-readback|listing-readback)$/u);
  }
  if (channel === "shopee") {
    return matchingData(/^(?:local-item-publication-readback|published-item-readback(?:-\d+)?|listing-readback)$/u);
  }
  if (channel === "lazada") return matchingData(/^listing-readback$/u);
  if (channel === "coupang") {
    return matchingData(/^seller-product-publication-readback$/u);
  }
  if (channel === "smartstore") {
    return matchingData(/^origin-product-publication-readback$/u);
  }
  return {
    offer: matchingData(/^offer-publication-readback$/u),
    inventoryItem: matchingData(/^inventory-item-publication-readback$/u),
  };
}

function qoo10ExactRecoveryItems(
  value: unknown,
  remoteId: string,
  depth = 0,
  found: UnknownRecord[] = [],
) {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) qoo10ExactRecoveryItems(item, remoteId, depth + 1, found);
    return found;
  }
  const record = recordValue(value);
  if (!Object.keys(record).length) return found;
  const identities = ["ItemNo", "ItemCode", "GdNo"]
    .filter((key) => Object.hasOwn(record, key))
    .map((key) => typeof record[key] === "string" || typeof record[key] === "number"
      ? String(record[key])
      : "");
  if (identities.length > 0 && identities.every((identity) => identity === remoteId)) found.push(record);
  for (const nested of Object.values(record)) {
    qoo10ExactRecoveryItems(nested, remoteId, depth + 1, found);
  }
  return found;
}

function qoo10ExactRecoveryField(record: UnknownRecord, aliases: readonly string[]) {
  const normalized = new Set(aliases.map((alias) => alias.toLowerCase()));
  const value = Object.entries(record).find(([key]) => normalized.has(key.toLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verificationStep(input: {
  source: ListingPublicationVerificationSource;
  remoteState?: VerifiedListingRemoteState | null;
  content: ReturnType<typeof verifyListingPublicationContent>;
}) {
  const verified = Boolean(input.remoteState && input.content.verified);
  return {
    name: "publication-content-verification",
    ok: verified,
    status: verified ? 200 : 422,
    data: {
      sellerpilotVerification: verified
        ? "LISTING_PUBLICATION_CONTENT_VERIFIED"
        : "LISTING_PUBLICATION_CONTENT_UNVERIFIED",
      sourceJobId: input.source.sourceJobId,
      sourceOperation: input.source.sourceOperation,
      sourceFingerprintVerified: true,
      titleVerified: input.content.titleVerified,
      descriptionVerified: input.content.descriptionVerified,
      titleLanguageVerified: input.content.titleLanguageVerified,
      descriptionLanguageVerified: input.content.descriptionLanguageVerified,
      languageContentVerified: input.content.languageContentVerified,
      detailImageCountVerified: input.content.detailImageCountVerified,
      approvedManifestDigestVerified: input.content.approvedManifestDigestVerified,
      sourceIdentityVerified: input.content.sourceIdentityVerified,
      contentDigestVerified: input.content.contentDigestVerified,
      sourceDetailImageCount: input.content.sourceDetailImageCount,
      sourceReadbackDetailImageCount: input.content.sourceReadbackDetailImageCount,
      remoteDetailImageCount: input.content.remoteDetailImageCount,
      sourceContentDigest: input.content.sourceContentDigest,
      remoteContentDigest: input.content.remoteContentDigest,
      sourceImageDigest: input.content.sourceImageDigest,
      remoteImageDigest: input.content.remoteImageDigest,
      remoteProjectionDigest: input.content.remoteProjectionDigest,
      providerImageSurface: input.content.providerImageSurface,
      providerImageContract: input.content.providerImageContract,
      representativeImageVerified: input.content.representativeImageVerified,
      providerBodyDetailImagesVerified: input.content.providerImageSurface === "detail_content",
      mismatchFields: input.content.mismatchFields,
    },
  } satisfies ChannelOperationStep;
}

function boundRemoteState(
  source: ListingPublicationVerificationSource,
  remoteState: VerifiedListingRemoteState | null | undefined,
  content: ReturnType<typeof verifyListingPublicationContent>,
) {
  if (!remoteState || !content.verified) return undefined;
  const parsed = verifiedListingRemoteStateSchema.safeParse({
    ...remoteState,
    evidence: {
      ...remoteState.evidence,
      sourceJobId: source.sourceJobId,
      sourceOperation: source.sourceOperation,
      sourceFingerprintVerified: true,
      sourceContentVerified: true,
      contentVerified: true,
      languageContentVerified: true,
      titleLanguageVerified: true,
      descriptionLanguageVerified: true,
      titleVerified: true,
      descriptionVerified: true,
      detailImageCountVerified: true,
      approvedManifestDigestVerified: true,
      sourceIdentityVerified: true,
      contentDigestVerified: true,
      sourceContentDigest: content.sourceContentDigest,
      remoteContentDigest: content.remoteContentDigest,
      sourceImageDigest: content.sourceImageDigest,
      remoteImageDigest: content.remoteImageDigest,
      remoteProjectionDigest: content.remoteProjectionDigest,
      providerImageSurface: content.providerImageSurface,
      providerImageContract: content.providerImageContract,
      representativeImageVerified: content.representativeImageVerified,
      providerBodyDetailImagesVerified: content.providerImageSurface === "detail_content",
      fingerprintBinding: "source_request_fingerprint_v1",
    },
  });
  return parsed.success ? parsed.data : undefined;
}

function verifiedExecution(input: {
  channel: PublicationChannel;
  source: ListingPublicationVerificationSource;
  remoteId: string;
  expectedLocale: string;
  steps: ChannelOperationStep[];
  remoteState?: VerifiedListingRemoteState | null;
  remotePayload: UnknownRecord;
}): ListingPublicationVerificationExecution {
  const content = verifyListingPublicationContent({
    channel: input.channel,
    expectedLocale: input.expectedLocale,
    expectedImageCount: 8,
    remoteId: input.remoteId,
    sourceArguments: input.source.sourceArguments,
    sourceResponsePayload: input.source.sourceResponsePayload,
    sourceRemotePayload: sourceRemotePayload(input.channel, input.source),
    remotePayload: input.remotePayload,
    remoteResources: input.remoteState?.resources,
  });
  const remoteState = boundRemoteState(input.source, input.remoteState, content);
  return {
    remoteId: input.remoteId,
    steps: [
      ...input.steps,
      verificationStep({ source: input.source, remoteState, content }),
    ],
    ...(remoteState ? { remoteState } : {}),
  };
}

export async function executeListingPublicationVerification(
  input: VerificationInput,
): Promise<ListingPublicationVerificationExecution> {
  const { source, remoteId, expected, legacyElevenstSnapshot, exactQoo10S1Recovery } = sourceContext(input);
  const sourceOperation = source.sourceOperation as SourceOperation;
  const sourceArguments = source.sourceArguments;

  if (input.channel === "qoo10") {
    const strictCreateSource = sourceOperation === "listing.create"
      && Object.hasOwn(sourceArguments, "sellerpilotQoo10CreateContext");
    const strictExpectation = strictCreateSource
      ? qoo10ListingCreateExpectation({ arguments: sourceArguments, payload: input.payload })
      : null;
    const [remote, sellerIdentityRemote] = await Promise.all([
      qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: remoteId, SellerCode: sourceSellerCode(sourceArguments) },
      }),
      strictExpectation?.ok
        ? qoo10Request({
            payload: input.payload,
            service: "ItemsLookup",
            method: "GetItemDetailInfo",
            version: "1.2",
            params: { ItemCode: strictExpectation.expectation.testItemCode, SellerCode: "" },
          })
        : Promise.resolve(null),
    ]);
    const sourceRemoteState = recordValue(source.sourceResponsePayload.remoteState);
    const sourceEvidence = recordValue(sourceRemoteState.evidence);
    const expectedSellerAccountIdentityDigest = exactText(sourceEvidence.sellerAccountIdentityDigest);
    const sellerIdentity = strictExpectation?.ok && sellerIdentityRemote
      ? qoo10SellerAccountIdentityDigestFromReadback({
          remote: sellerIdentityRemote,
          expectation: strictExpectation.expectation,
        })
      : null;
    const sellerIdentityStep: ChannelOperationStep | null = sellerIdentity?.step
      ? { ...sellerIdentity.step }
      : null;
    const currentSellerAccountIdentityDigest = sellerIdentity?.identityDigest ?? "";
    if (sellerIdentityStep) {
      sellerIdentityStep.name = "qoo10-account-item-identity-reverification";
      sellerIdentityStep.ok = sellerIdentityStep.ok
        && /^[a-f0-9]{64}$/u.test(expectedSellerAccountIdentityDigest)
        && currentSellerAccountIdentityDigest === expectedSellerAccountIdentityDigest;
      sellerIdentityStep.data = {
        ...sellerIdentityStep.data,
        sourceSellerAccountIdentityDigestVerified: sellerIdentityStep.ok,
      };
    }
    const strictIdentityVerified = !strictCreateSource
      || Boolean(strictExpectation?.ok && sellerIdentityStep?.ok);
    const expectedRepresentativeImageContentId = strictCreateSource
      ? qoo10SourceMainImageContentId(source, remoteId)
      : "";
    const verifiedReadbackState = qoo10VerifiedListingRemoteState({
      operation: sourceOperation,
      remoteId,
      resultObject: remote.data.ResultObject,
      expectedLocale: expected.locale,
      expectedFingerprint: expected.fingerprint,
      expectedImageCount: expected.imageCount,
      ...(sourceSellerCode(sourceArguments)
        ? { expectedSellerCode: sourceSellerCode(sourceArguments) }
        : {}),
      ...(strictExpectation?.ok
        ? {
            expectedCreate: strictExpectation.expectation,
            expectedSellerAccountIdentityDigest: strictIdentityVerified
              ? currentSellerAccountIdentityDigest
              : "",
            ...(expectedRepresentativeImageContentId
              ? { expectedRepresentativeImageContentId }
              : {}),
          }
        : {}),
    });
    const remoteState = strictIdentityVerified ? verifiedReadbackState : null;
    const readbackStep = providerStep("GetItemDetailInfo-publication-reverification", remote);
    if (exactQoo10S1Recovery) {
      const recovery = qoo10RollbackUpdateRecoveryBinding(sourceArguments)!;
      const params = recordValue(sourceArguments.params);
      const sourceTitle = qoo10ExactRecoveryField(params, ["ItemTitle"]);
      const sourceKeyword = qoo10ExactRecoveryField(params, ["Keyword"]);
      const sourceDetailHtml = qoo10ExactRecoveryField(params, ["ItemDescription"]);
      const sourceDetailImageUrls = qoo10DetailImageUrls(sourceDetailHtml);
      const matches = qoo10ExactRecoveryItems(remote.data.ResultObject, remoteId);
      const item = matches.length === 1 ? matches[0] : {};
      const remoteTitle = qoo10ExactRecoveryField(item, ["ItemTitle"]);
      const remoteKeyword = qoo10ExactRecoveryField(item, ["Keyword", "Keywords"]);
      const remoteDetailHtml = qoo10ExactRecoveryField(item, ["ItemDetail", "ItemDescription", "Description"]);
      const remoteDetailImageUrls = qoo10DetailImageUrls(remoteDetailHtml);
      const sourceSellerCodeValue = qoo10ExactRecoveryField(params, ["SellerCode"]);
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: "listing.update",
        remoteId,
        resultObject: remote.data.ResultObject,
        expectedLocale: expected.locale,
        expectedFingerprint: expected.fingerprint,
        expectedImageCount: expected.imageCount,
        ...(sourceSellerCodeValue ? { expectedSellerCode: sourceSellerCodeValue } : {}),
        expectedRecovery: {
          ...recovery.expectedState,
          detailImageUrls: sourceDetailImageUrls,
        },
      });
      const mutableChecks = {
        exactItemVerified: matches.length === 1,
        criticalAliasesConsistent: matches.length === 1
          && qoo10CriticalReadbackAliasesConsistent(item),
        s1Verified: publication.providerStatus.trim().toUpperCase() === "S1"
          && publication.remoteState?.visibility === "non_public",
        titleVerified: Boolean(sourceTitle) && remoteTitle === sourceTitle,
        promotionNameVerified: qoo10ExactRecoveryField(item, ["PromotionName", "PromotionNm"])
          === qoo10ExactRecoveryField(params, ["PromotionName"]),
        industrialCodeVerified: qoo10ExactRecoveryField(item, ["IndustrialCode", "barcode", "gtin"])
          === qoo10ExactRecoveryField(params, ["IndustrialCode"]),
        keywordVerified: qoo10ProviderKeywordMatches(sourceKeyword, remoteKeyword, sourceTitle),
        detailHtmlVerified: qoo10ProviderDetailHtmlEquivalent(
          sourceDetailHtml,
          remoteDetailHtml,
        ),
        orderedDetailImagesVerified: sourceDetailImageUrls.length === 8
          && remoteDetailImageUrls.length === 8
          && remoteDetailImageUrls.every((url, index) => url === sourceDetailImageUrls[index]),
        originTypeVerified: qoo10ExactRecoveryField(item, ["ProductionPlaceType", "OriginType"])
          === qoo10ExactRecoveryField(params, ["ProductionPlaceType"]),
        originCodeVerified: qoo10ExactRecoveryField(item, ["ProductionPlace", "Origin", "OriginCode"])
          === qoo10ExactRecoveryField(params, ["ProductionPlace"]),
        adultYnVerified: qoo10ExactRecoveryField(item, ["AdultYN", "AdultYn", "AdultFlag"])
          === qoo10ExactRecoveryField(params, ["AdultYN"]),
      };
      const exactContentVerified = Boolean(publication.remoteState)
        && Object.values(mutableChecks).every(Boolean);
      const boundS1State = exactContentVerified && publication.remoteState
        ? qoo10ExactRecoveryContentRemoteState({
            remoteState: publication.remoteState,
            title: remoteTitle,
            keyword: remoteKeyword,
            detailHtml: remoteDetailHtml,
            detailImageUrls: remoteDetailImageUrls,
            sourceJobId: source.sourceJobId,
            sourceOperation: "listing.update",
          })
        : undefined;
      const exactProviderSuccess = remote.response.ok && qoo10ExactSuccessResultCode(remote.data);
      readbackStep.ok = exactProviderSuccess && Boolean(boundS1State);
      readbackStep.data = {
        ...readbackStep.data,
        sellerpilotVerification: exactProviderSuccess && boundS1State
          ? "QOO10_EXACT_S1_RECOVERY_REVERIFIED"
          : "QOO10_EXACT_S1_RECOVERY_UNVERIFIED",
        sellerpilotPublicationChecks: publication.checks,
        sellerpilotMutableChecks: mutableChecks,
        sellerpilotExactResultCodeVerified: exactProviderSuccess,
      };
      const activationExpectation = boundS1State
        ? {
            expectedState: {
              ...recovery.expectedState,
              originType: qoo10ExactRecoveryField(params, ["ProductionPlaceType"]),
              originCode: qoo10ExactRecoveryField(params, ["ProductionPlace"]),
              adultYn: qoo10ExactRecoveryField(params, ["AdultYN"]),
            },
            expectedTitle: remoteTitle,
            expectedKeyword: remoteKeyword,
            expectedPromotionName: qoo10ExactRecoveryField(params, ["PromotionName"]),
            expectedIndustrialCode: qoo10ExactRecoveryField(params, ["IndustrialCode"]),
            expectedDetailHtmlSha256: sha256(remoteDetailHtml),
            expectedDetailImageUrls: remoteDetailImageUrls,
            ...(sourceSellerCodeValue ? { expectedSellerCode: sourceSellerCodeValue } : {}),
          }
        : undefined;
      const exactStep: ChannelOperationStep = {
        name: "qoo10-exact-s1-recovery-verification",
        ok: Boolean(exactProviderSuccess && boundS1State && activationExpectation),
        status: exactProviderSuccess && boundS1State ? 200 : 422,
        data: {
          ...remote.data,
          sellerpilotVerification: exactProviderSuccess && boundS1State
            ? "QOO10_EXACT_S1_RECOVERY_VERIFIED"
            : "QOO10_EXACT_S1_RECOVERY_UNVERIFIED",
          sellerpilotPublicationChecks: publication.checks,
          sellerpilotMutableChecks: mutableChecks,
          sellerpilotExactResultCodeVerified: exactProviderSuccess,
          ...(exactProviderSuccess && boundS1State ? { remoteState: boundS1State } : {}),
          ...(exactProviderSuccess && activationExpectation
            ? { sellerpilotQoo10ActivationExpectation: activationExpectation }
            : { sellerpilotReconciliationRequired: true }),
        },
      };
      return {
        remoteId,
        steps: [readbackStep, exactStep],
        ...(exactProviderSuccess && boundS1State ? { remoteState: boundS1State } : {}),
      };
    }
    readbackStep.ok = readbackStep.ok && Boolean(remoteState);
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: remoteState
        ? "QOO10_PUBLICATION_STATE_REVERIFIED"
        : "QOO10_PUBLICATION_STATE_UNVERIFIED",
      ...(remoteState ? {} : { providerMessage: qoo10ResultMessage(remote.data) }),
    };
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps: [...(sellerIdentityStep ? [sellerIdentityStep] : []), readbackStep],
      remoteState,
      remotePayload: remote.data,
    });
  }

  if (input.channel === "elevenst") {
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "GET",
      path: `/rest/prodmarketservice/prodmarket/${pathSegment(remoteId)}`,
    });
    const product = recordValue(remote.data.product);
    const remoteState = elevenstVerifiedListingRemoteState({
      operation: sourceOperation,
      remoteId,
      product,
      expectedLocale: expected.locale,
      expectedFingerprint: expected.fingerprint,
      expectedImageCount: legacyElevenstSnapshot ? 0 : expected.imageCount,
      ...(sourceElevenstSellerCode(sourceArguments)
        ? { expectedSellerProductCode: sourceElevenstSellerCode(sourceArguments) }
        : {}),
      verifyFullProductSnapshot:
        legacyElevenstSnapshot
        || input.arguments.sellerpilotElevenstSnapshotRecovery
          === "elevenst_exact_snapshot_recovery_v1",
    });
    const readbackStep = providerStep("product-publication-reverification", remote);
    const immutableSourceFieldsVerified = legacyElevenstSnapshot
      ? elevenstLegacySnapshotImmutableProductMatches(
          recordValue(sourceArguments.product),
          product,
        )
      : true;
    readbackStep.ok = readbackStep.ok
      && remote.data.accepted === true
      && Boolean(remoteState)
      && immutableSourceFieldsVerified;
    if (legacyElevenstSnapshot) {
      const attestation = recordValue(
        sourceArguments.sellerpilotElevenstLegacySnapshotAttestation,
      );
      const snapshotState = verifiedListingRemoteStateSchema.safeParse(
        remoteState && immutableSourceFieldsVerified
          ? {
              ...remoteState,
              evidence: {
                ...remoteState.evidence,
                snapshotOnly: true,
                approvedContentVerified: false,
                approvedImageCountVerified: false,
                publicationReviewCreated: false,
                legacySourceAttested: true,
                freshFullProductReadback: true,
                immutableSourceFieldsVerified: true,
                sourceJobId: source.sourceJobId,
                sourceOperation: source.sourceOperation,
                approvedManifestDigest: exactText(
                  attestation.approvedManifestDigest,
                ),
                approvedDetailPageVersion: Number(
                  attestation.approvedDetailPageVersion,
                ),
                observedDetailImageCount: remoteState.imageCount,
              },
            }
          : null,
      );
      return {
        remoteId,
        steps: [readbackStep],
        ...(snapshotState.success ? { remoteState: snapshotState.data } : {}),
      };
    }
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps: [readbackStep],
      remoteState,
      remotePayload: remote.data,
    });
  }

  if (input.channel === "shopee") {
    const immutableResources = immutableSourceResources(source);
    const immutableLocalItemId = exactText(immutableResources.localItemId);
    const immutableShopId = exactText(immutableResources.shopId);
    const immutableGlobalItemId = exactText(immutableResources.globalItemId);
    const sourcePublish = recordValue(sourceArguments.publish);
    const sourceShopId = exactText(sourcePublish.shop_id)
      || exactText(sourceArguments.shopId)
      || exactText(sourceArguments.shop_id);
    const globalProduct = sourceArguments.globalProduct === true || Boolean(immutableGlobalItemId);
    if (immutableLocalItemId !== remoteId
        || !immutableShopId
        || immutableShopId !== source.targetId
        || (sourceShopId && sourceShopId !== immutableShopId)) {
      throw new Error("SHOPEE_PUBLICATION_VERIFY_IMMUTABLE_IDENTITY_INVALID");
    }
    const mutationArguments = sourceShopeeArguments(sourceArguments, immutableGlobalItemId);
    if (globalProduct) {
      if (!immutableGlobalItemId || !input.shopeeShopCredential) {
        throw new Error("SHOPEE_GLOBAL_PUBLICATION_VERIFY_CREDENTIALS_REQUIRED");
      }
      const readback = await readShopeeGlobalListingPublicationState({
        merchantPayload: input.payload,
        shopPayload: input.shopeeShopCredential,
        environment: input.environment,
        operation: sourceOperation,
        globalItemId: immutableGlobalItemId,
        localItemId: immutableLocalItemId,
        shopId: immutableShopId,
        mutationArguments,
        expectedLocale: expected.locale,
        expectedFingerprint: expected.fingerprint,
        expectedImageCount: expected.imageCount,
      });
      const globalStep = providerStep("global-item-publication-reverification", readback.globalItemRemote);
      globalStep.ok = globalStep.ok && readback.globalIdentityVerified;
      globalStep.data = {
        ...globalStep.data,
        sellerpilotVerification: readback.globalIdentityVerified
          ? "SHOPEE_GLOBAL_ITEM_IDENTITY_REVERIFIED"
          : "SHOPEE_GLOBAL_ITEM_IDENTITY_UNVERIFIED",
      };
      const linkageStep = providerStep("global-to-local-publication-reverification", readback.publishedLinkRemote);
      linkageStep.ok = linkageStep.ok && readback.publishedLinkageVerified;
      linkageStep.data = {
        ...linkageStep.data,
        sellerpilotVerification: readback.publishedLinkageVerified
          ? "SHOPEE_GLOBAL_TO_LOCAL_LINK_REVERIFIED"
          : "SHOPEE_GLOBAL_TO_LOCAL_LINK_UNVERIFIED",
      };
      const localStep = providerStep("local-item-publication-reverification", readback.localItemRemote);
      localStep.ok = localStep.ok && Boolean(readback.remoteState);
      localStep.data = {
        ...localStep.data,
        sellerpilotPublicationChecks: readback.checks,
        providerStatus: readback.providerStatus,
        actualImageCount: readback.imageCount,
      };
      return verifiedExecution({
        channel: input.channel,
        source,
        remoteId,
        expectedLocale: expected.locale,
        steps: [globalStep, linkageStep, localStep],
        remoteState: readback.remoteState,
        remotePayload: readback.localItemRemote.data,
      });
    }
    const readback = await readShopeeListingPublicationState({
      payload: input.payload,
      environment: input.environment,
      operation: sourceOperation,
      remoteId,
      mutationArguments,
      expectedLocale: expected.locale,
      expectedFingerprint: expected.fingerprint,
      expectedImageCount: expected.imageCount,
    });
    const readbackStep = providerStep("listing-publication-reverification", readback.remote);
    readbackStep.ok = readbackStep.ok && Boolean(readback.remoteState);
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotPublicationChecks: readback.checks,
      providerStatus: readback.providerStatus,
      actualImageCount: readback.imageCount,
    };
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps: [readbackStep],
      remoteState: readback.remoteState,
      remotePayload: readback.remote.data,
    });
  }

  if (input.channel === "lazada") {
    const readback = await readLazadaListingPublicationState({
      payload: input.payload,
      operation: sourceOperation,
      remoteId,
      mutationArguments: sourceArguments,
      expectedLocale: expected.locale,
      expectedFingerprint: expected.fingerprint,
      expectedImageCount: expected.imageCount,
      // Lazada replaces approved source URLs with provider-owned slatic URLs
      // before the write. The independent verifier binds content against the
      // immutable first readback and provider asset evidence below instead of
      // repeating the mutation-time literal source URL comparison.
      contentVerificationMode: "immutable_source_readback",
      immutableSourceRemoteData: sourceRemotePayload("lazada", source),
    });
    const readbackStep = providerStep("listing-publication-reverification", readback.remote);
    readbackStep.ok = readbackStep.ok && Boolean(readback.remoteState);
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotPublicationChecks: readback.checks,
      providerStatus: readback.providerStatus,
      actualImageCount: readback.imageCount,
    };
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps: [readbackStep],
      remoteState: readback.remoteState,
      remotePayload: readback.remote.data,
    });
  }

  if (input.channel === "coupang") {
    const readback = await readCoupangListingPublicationState({
      operation: sourceOperation,
      intent: "live",
      remoteId,
      expected,
      readSellerProduct: (sellerProductId) => coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${pathSegment(sellerProductId)}`,
      }),
      readVendorItem: (vendorItemId) => coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(vendorItemId)}/inventories`,
      }),
    });
    const steps: ChannelOperationStep[] = [];
    if (readback.sellerProductReadback) {
      steps.push(providerStep("seller-product-publication-reverification", readback.sellerProductReadback));
    }
    for (const { vendorItemId, remote } of readback.vendorItemReadbacks) {
      const itemStep = providerStep("vendor-item-publication-reverification", remote);
      itemStep.data = { ...itemStep.data, sellerpilotVendorItemId: vendorItemId };
      steps.push(itemStep);
    }
    if (!readback.state && steps.length) steps.at(-1)!.ok = false;
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps,
      remoteState: readback.state,
      remotePayload: readback.sellerProductReadback?.data ?? {},
    });
  }

  if (input.channel === "smartstore") {
    const accessToken = readStoredNaverAccessToken(input.payload);
    if (!accessToken) {
      throw new Error("LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED");
    }
    const readOriginProduct = (originProductNo: string) => naverRequest({
      accessToken,
      method: "GET",
      path: `/v2/products/origin-products/${pathSegment(originProductNo)}`,
    });
    const readback = await readSmartstoreListingPublicationState({
      operation: sourceOperation,
      intent: "live",
      remoteId,
      expected,
      readOriginProduct,
      readChannelProduct: (channelProductNo) => naverRequest({
        accessToken,
        method: "GET",
        path: `/v2/products/channel-products/${pathSegment(channelProductNo)}`,
      }),
    });
    const readbackStep = providerStep(
      "origin-product-publication-reverification",
      readback.originProductReadback,
    );
    readbackStep.ok = readbackStep.ok && Boolean(readback.state);
    const steps = [readbackStep];
    if (readback.channelProductReadback) {
      steps.push(providerStep(
        "channel-product-publication-reverification",
        readback.channelProductReadback,
      ));
    }
    return verifiedExecution({
      channel: input.channel,
      source,
      remoteId,
      expectedLocale: expected.locale,
      steps,
      remoteState: readback.state,
      remotePayload: {
        ...readback.originProductReadback.data,
        smartstoreChannelProduct: readback.channelProductReadback?.data.smartstoreChannelProduct,
      },
    });
  }

  const immutableResources = immutableSourceResources(source);
  const offerId = exactText(immutableResources.offerId);
  const listingId = exactText(immutableResources.listingId);
  const sku = exactText(immutableResources.sku);
  const marketplaceId = exactText(immutableResources.marketplaceId).toUpperCase();
  const sourceOffer = recordValue(sourceArguments.offer);
  const sourceSku = exactText(sourceArguments.sku)
    || exactText(recordValue(sourceArguments.inventoryItem).sku);
  if (!offerId
      || !listingId
      || !sku
      || !marketplaceId
      || remoteId !== listingId
      || source.targetId.toUpperCase() !== marketplaceId
      || (sourceSku && sourceSku !== sku)
      || exactText(sourceOffer.marketplaceId).toUpperCase() !== marketplaceId) {
    throw new Error("EBAY_PUBLICATION_VERIFY_IMMUTABLE_IDENTITY_INVALID");
  }

  const providerAccount = await fetchEbayTradingUserIdentity({
    environment: input.environment,
    accessToken: textValue(input.payload, "access_token"),
  });
  assertProviderAccountIdentity(input.payload, providerAccount.identity);
  const accountStep: ChannelOperationStep = {
    name: "provider-account-publication-reverification",
    ok: true,
    status: 200,
    data: {
      sellerpilotVerification: "EBAY_PROVIDER_ACCOUNT_IDENTITY_REVERIFIED",
      providerUserIdPresent: Boolean(providerAccount.userId),
    },
  };
  const readback = await readEbayListingPublicationState({
    operation: sourceOperation,
    intent: "live",
    remoteId,
    offerId,
    expected,
    readOffer: (readbackOfferId) => ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/offer/${pathSegment(readbackOfferId)}`,
    }),
    readInventoryItem: (sku) => ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${pathSegment(sku)}`,
    }),
  });
  const getItemXml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(listingId)}</ItemID><SKU>${ebayTradingXmlEscape(sku)}</SKU><OutputSelector>ItemID</OutputSelector><OutputSelector>SKU</OutputSelector><OutputSelector>Site</OutputSelector></GetItemRequest>`;
  const listingIdentityRemote = await ebayTradingRequest({
    payload: input.payload,
    environment: input.environment,
    callName: "GetItem",
    marketplaceId,
    body: getItemXml,
  });
  const tradingItem = recordValue(listingIdentityRemote.data.item);
  const tradingIdentityVerified = listingIdentityRemote.response.ok
    && ["Success", "Warning"].includes(exactText(listingIdentityRemote.data.Ack))
    && exactText(tradingItem.itemId) === listingId
    && exactText(tradingItem.sku) === sku;
  const steps = [
    accountStep,
    providerStep("offer-publication-reverification", readback.offerReadback),
  ];
  if (readback.inventoryItemReadback) {
    steps.push(providerStep("inventory-item-publication-reverification", readback.inventoryItemReadback));
  }
  const listingIdentityStep = providerStep(
    "listing-identity-publication-reverification",
    listingIdentityRemote,
  );
  listingIdentityStep.ok = listingIdentityStep.ok && tradingIdentityVerified;
  listingIdentityStep.data = {
    ...listingIdentityStep.data,
    sellerpilotVerification: tradingIdentityVerified
      ? "EBAY_LISTING_SKU_IDENTITY_REVERIFIED"
      : "EBAY_LISTING_SKU_IDENTITY_UNVERIFIED",
  };
  steps.push(listingIdentityStep);
  const remoteState = tradingIdentityVerified ? readback.state : undefined;
  if (!remoteState) steps.at(-1)!.ok = false;
  return verifiedExecution({
    channel: input.channel,
    source,
    remoteId,
    expectedLocale: expected.locale,
    steps,
    remoteState,
    remotePayload: {
      offer: readback.offerReadback.data,
      inventoryItem: readback.inventoryItemReadback?.data ?? {},
    },
  });
}
