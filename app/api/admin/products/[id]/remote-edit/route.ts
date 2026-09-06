import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { activeChannelKeys, type ActiveChannelKey } from "../../../../../../lib/channels/catalog";
import {
  bindQoo10RollbackUpdateRecoveryArguments,
  centralProductEditFieldSupport,
  channelProductEditFieldSupport,
  listingUpdateServerCandidate,
  listingUpdateMutablePaths,
  listingUpdateRemoteIdentity,
  legacyEbayListingUpdateCandidate,
  prepareListingUpdateArguments,
  productEditRemotePlan,
  qoo10RollbackListingUpdateCandidate,
  remoteProductEditIdempotencyKey,
  type ListingUpdateReference,
  type Qoo10RollbackUpdateRecoveryBinding,
} from "../../../../../../lib/channels/listing-update";
import { channelOperationRelease } from "../../../../../../lib/channels/operation-availability";
import { coupangExactQaRecoveryCandidate } from "../../../../../../lib/channels/coupang-exact-qa-recovery";
import {
  ebayExactExistingQaRecoveryBindingValue,
  ebayExactExistingQaRecoveryCandidate,
  ebayExactExistingQaRecoveryIdentity,
} from "../../../../../../lib/channels/ebay-exact-existing-qa-recovery";
import { elevenstExactExistingPublicationCandidate } from "../../../../../../lib/channels/elevenst-exact-existing-publication";
import { lazadaKrwMyrPricePolicyFromArguments } from "../../../../../../lib/channels/lazada-price-policy";
import { lazadaRequestedUpdateQuantity } from "../../../../../../lib/channels/lazada-listing-update";
import {
  lazadaExactExistingPublicationCandidate,
  lazadaExactExistingPublicationIdentity,
} from "../../../../../../lib/channels/lazada-exact-existing-identity";
import { lazadaExactRemoteEditReadinessBlock } from "../../../../../../lib/channels/lazada-exact-remote-edit-readiness";
import {
  smartstoreExactQaReadinessBlock,
  smartstoreExactQaRecoveryCandidate,
  smartstoreExactQaRecoveryIdentity,
} from "../../../../../../lib/channels/smartstore-exact-qa-recovery";
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
} from "../../../../../../lib/channels/serverless-static-egress";
import { hasClientSmartstoreManualAdoptionUpdateMarker } from "../../../../../../lib/server-smartstore-adoption-update-binding";
import {
  smartstoreContentRepairArgument,
  smartstoreContentRepairTransmissionArgument,
} from "../../../../../../lib/channels/smartstore-content-repair-contract";

export const runtime = "nodejs";
export const maxDuration = 120;

const productIdSchema = z.string().uuid();
const remoteEditSchema = z.object({
  credentialId: z.string().uuid(),
  listingId: z.string().uuid(),
  mutationId: z.string().uuid(),
  // This endpoint is deliberately limited to the released field mapper below.
  // Lazada MY may include one preflight-bound SKU price and quantity; every
  // other price, option, and sale-configuration write remains separate.
  operation: z.literal("listing.update"),
  confirmWrite: z.literal(true),
  arguments: z.record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= 128_000, "payload too large"),
});

const qoo10RollbackIdentitySchema = z.object({
  status: z.literal("allowed"),
  contract: z.literal("qoo10_create_rollback_confirmation_v1"),
  listingId: z.string().uuid(),
  remoteId: z.string().regex(/^\d{9,10}$/u),
  providerStatus: z.literal("S1"),
  sourceJobId: z.string().uuid(),
  expectedState: z.object({
    categoryCode: z.string().regex(/^\d{9}$/u),
    retailPriceJpy: z.number().int().min(1).max(999_999_999),
    sellPriceJpy: z.number().int().min(1).max(999_999_999),
    quantity: z.number().int().min(1).max(99_999_999),
    shippingNo: z.string().regex(/^\d{1,20}$/u),
    biContentsNo: z.number().int().min(100_000).max(Number.MAX_SAFE_INTEGER),
  }).strict().refine(
    (value) => value.retailPriceJpy >= value.sellPriceJpy,
    "Qoo10 retail price must not be below its sell price",
  ),
}).strict();

type ListingRecord = Record<string, unknown> & {
  id: string;
  channel: ActiveChannelKey;
};

type ListingAvailabilityBlock = {
  mode: string;
  reason: string;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function listingRecords(value: unknown): ListingRecord[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const listing = recordValue(item);
      const id = typeof listing.id === "string" ? listing.id : "";
      const channel = typeof listing.channel === "string" && activeChannelKeys.includes(listing.channel as ActiveChannelKey)
        ? listing.channel as ActiveChannelKey
        : null;
      return id && channel ? [{ ...listing, id, channel }] : [];
    })
    : [];
}

function listingReference(listing: ListingRecord): ListingUpdateReference {
  return {
    listingId: listing.id,
    status: typeof listing.status === "string" ? listing.status : "",
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    marketplaceSku: typeof listing.marketplaceSku === "string"
      ? listing.marketplaceSku
      : null,
    failureClass: listing.failureClass === "retryable" || listing.failureClass === "external_action"
      ? listing.failureClass
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string"
      ? listing.remoteVisibility
      : null,
    providerStatus: typeof listing.providerStatus === "string"
      ? listing.providerStatus
      : null,
  };
}

function listingExecutionBlock(
  listing: ListingRecord,
  allowVerifiedLegacyEbayUpdate = false,
  allowExactEbayUpdate = false,
) {
  const status = typeof listing.status === "string" ? listing.status : "";
  const failureClass = typeof listing.failureClass === "string" ? listing.failureClass : "";
  if (status === "queued" || status === "publishing") {
    return {
      status: 202,
      mode: "listing_update_in_progress",
      message: "이 상품·채널의 기존 원격 작업이 진행 중이므로 새 쓰기를 실행하지 않았습니다.",
    };
  }
  const allowExactCoupangRecovery = coupangExactQaRecoveryCandidate({
    channel: listing.channel,
    listingId: listing.id,
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    status,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string" ? listing.remoteVisibility : null,
    providerStatus: typeof listing.providerStatus === "string" ? listing.providerStatus : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    failureClass,
  });
  const allowExactElevenstRecovery = elevenstExactExistingPublicationCandidate({
    channel: listing.channel,
    listingId: listing.id,
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    marketplaceSku: typeof listing.marketplaceSku === "string" ? listing.marketplaceSku : null,
    status,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string" ? listing.remoteVisibility : null,
    providerStatus: typeof listing.providerStatus === "string" ? listing.providerStatus : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    failureClass,
  });
  const allowExactLazadaRecovery = lazadaExactExistingPublicationCandidate({
    channel: listing.channel,
    listingId: listing.id,
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    status,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string" ? listing.remoteVisibility : null,
    providerStatus: typeof listing.providerStatus === "string" ? listing.providerStatus : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    failureClass,
  });
  const allowExactSmartstoreRecovery = smartstoreExactQaRecoveryCandidate({
    channel: listing.channel,
    listingId: listing.id,
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    status,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string" ? listing.remoteVisibility : null,
    providerStatus: typeof listing.providerStatus === "string" ? listing.providerStatus : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    failureClass,
  });
  if (failureClass === "external_action"
      && !allowVerifiedLegacyEbayUpdate
      && !allowExactEbayUpdate
      && !allowExactCoupangRecovery
      && !allowExactElevenstRecovery
      && !allowExactLazadaRecovery
      && !allowExactSmartstoreRecovery) {
    return {
      status: 409,
      mode: "external_reconciliation_required",
      message: "이전 원격 작업 결과를 판매자센터에서 확인하기 전에는 새 상품 수정을 실행할 수 없습니다.",
    };
  }
  if (!["published", "paused", "failed"].includes(status)) {
    return {
      status: 409,
      mode: "published_listing_required",
      message: "검증된 공개 상품 또는 안전한 비공개 상품만 원격 수정할 수 있습니다.",
    };
  }
  if (!listingUpdateServerCandidate(listing.channel, listingReference(listing))) {
    return {
      status: 409,
      mode: "published_remote_identity_required",
      message: "게시 원장의 원격 상품 ID와 검증된 공개 상태를 확인하지 못해 수정을 차단했습니다.",
    };
  }
  return null;
}

function listingAvailability(
  listing: ListingRecord,
  productId: string,
  readinessBlock: ListingAvailabilityBlock | null = null,
) {
  const release = channelOperationRelease(listing.channel, "listing.update");
  const reference = listingReference(listing);
  const allowExactEbayUpdate = productId === ebayExactExistingQaRecoveryIdentity.productId
    && ebayExactExistingQaRecoveryCandidate({
      channel: listing.channel,
      listingId: listing.id,
      remoteId: reference.remoteId,
      marketplaceSku: reference.marketplaceSku,
      status: reference.status,
      requestedPublicationIntent: reference.requestedPublicationIntent,
      remoteVisibility: reference.remoteVisibility,
      providerStatus: reference.providerStatus,
      publishedAt: reference.publishedAt,
      failureClass: reference.failureClass,
    });
  const executionBlock = listingExecutionBlock(listing, false, allowExactEbayUpdate);
  const remotePlan = productEditRemotePlan(listing.channel, release.available);
  return {
    listingId: listing.id,
    channel: listing.channel,
    market: typeof listing.market === "string" ? listing.market : "",
    targetId: typeof listing.targetId === "string" ? listing.targetId : "",
    status: typeof listing.status === "string" ? listing.status : "",
    remoteIdPresent: Boolean(listingReference(listing).remoteId?.trim()),
    runnable: release.available && executionBlock === null && readinessBlock === null,
    mode: release.available
      ? readinessBlock?.mode ?? executionBlock?.mode ?? release.mode
      : release.mode,
    reason: release.available
      ? readinessBlock?.reason ?? executionBlock?.message ?? release.reason
      : release.reason,
    fields: channelProductEditFieldSupport(listing.channel),
    remotePlan,
  };
}

async function productContext(request: Request, productId: string) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return { response: admin } as const;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_product_publish_context", {
    p_product_id: productId,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return {
      response: NextResponse.json({ message: "상품 게시 원장을 불러오지 못했습니다." }, { status: error ? 503 : 404 }),
    } as const;
  }
  return { admin, context: data as Record<string, unknown> } as const;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  const loaded = await productContext(request, productId.data);
  if ("response" in loaded) return loaded.response;
  const listings = listingRecords(loaded.context.listings);
  const credentialId = new URL(request.url).searchParams.get("credentialId");
  const exactLazadaListing = listings.find((listing) => (
    productId.data === lazadaExactExistingPublicationIdentity.productId
      && lazadaExactExistingPublicationCandidate({
        channel: listing.channel,
        listingId: listing.id,
        remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
        status: typeof listing.status === "string" ? listing.status : null,
        requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
          ? listing.requestedPublicationIntent
          : null,
        remoteVisibility: typeof listing.remoteVisibility === "string"
          ? listing.remoteVisibility
          : null,
        providerStatus: typeof listing.providerStatus === "string"
          ? listing.providerStatus
          : null,
        publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
        failureClass: typeof listing.failureClass === "string" ? listing.failureClass : null,
      })
  ));
  let exactLazadaReadinessBlock: ListingAvailabilityBlock | null = null;
  if (exactLazadaListing) {
    const { data: preparationData, error: preparationError } = await loaded.admin.serviceClient.rpc(
      "sellerpilot_service_prepare_exact_lazada_live_adoption",
      { p_listing_id: exactLazadaListing.id },
    );
    const preparation = recordValue(preparationData);
    const targetId = typeof exactLazadaListing.targetId === "string"
      ? exactLazadaListing.targetId.trim()
      : "";
    const mayReadProviderIdentity = preparation.status === "already_bound"
      && productIdSchema.safeParse(credentialId).success
      && /^\d+$/u.test(targetId);
    const providerIdentityResult = mayReadProviderIdentity
      ? await loaded.admin.serviceClient.rpc(
          "sellerpilot_service_get_lazada_exact_update_id",
          {
            p_listing_id: exactLazadaListing.id,
            p_credential_id: credentialId,
            p_product_id: productId.data,
            p_market: lazadaExactExistingPublicationIdentity.market,
            p_target_id: targetId,
          },
        )
      : { data: null, error: null };
    exactLazadaReadinessBlock = lazadaExactRemoteEditReadinessBlock({
      credentialId,
      targetId,
      preparationData,
      preparationError: Boolean(preparationError),
      providerIdentityData: providerIdentityResult.data,
      providerIdentityError: Boolean(providerIdentityResult.error),
    });
  }
  const exactSmartstoreListing = listings.find((listing) => (
    productId.data === smartstoreExactQaRecoveryIdentity.productId
      && smartstoreExactQaRecoveryCandidate({
        channel: listing.channel,
        listingId: listing.id,
        remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
        status: typeof listing.status === "string" ? listing.status : null,
        requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
          ? listing.requestedPublicationIntent
          : null,
        remoteVisibility: typeof listing.remoteVisibility === "string"
          ? listing.remoteVisibility
          : null,
        providerStatus: typeof listing.providerStatus === "string"
          ? listing.providerStatus
          : null,
        publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
        failureClass: typeof listing.failureClass === "string" ? listing.failureClass : null,
      })
  ));
  let exactSmartstoreReadinessBlock: ListingAvailabilityBlock | null = null;
  if (exactSmartstoreListing) {
    if (credentialId !== smartstoreExactQaRecoveryIdentity.credentialId) {
      exactSmartstoreReadinessBlock = smartstoreExactQaReadinessBlock({ credentialId });
    } else {
      const [identityResult, staticEgressResult] = await Promise.all([
        loaded.admin.serviceClient.rpc(
          "sellerpilot_service_get_smartstore_exact_qa_recovery_identity",
          {
            p_listing_id: exactSmartstoreListing.id,
            p_credential_id: credentialId,
            p_product_id: productId.data,
            p_market: typeof exactSmartstoreListing.market === "string"
              ? exactSmartstoreListing.market
              : "",
            p_target_id: typeof exactSmartstoreListing.targetId === "string"
              ? exactSmartstoreListing.targetId
              : "",
          },
        ),
        loaded.admin.serviceClient.rpc("sellerpilot_service_serverless_static_egress_status"),
      ]);
      const staticEgressStatus = recordValue(staticEgressResult.data);
      exactSmartstoreReadinessBlock = smartstoreExactQaReadinessBlock({
        credentialId,
        identity: identityResult.data,
        identityError: Boolean(identityResult.error),
        environmentStaticEgressReady: hasServerlessStaticEgressFor(
          configuredServerlessStaticEgressChannels(),
          ["smartstore"],
        ),
        databaseStaticEgressReady: staticEgressStatus.smartstore === true,
        staticEgressError: Boolean(staticEgressResult.error),
      });
    }
  }
  return NextResponse.json({
    productId: productId.data,
    centralFields: centralProductEditFieldSupport(),
    listings: listings.map((listing) => (
      listingAvailability(
        listing,
        productId.data,
        listing.id === exactSmartstoreListing?.id
          ? exactSmartstoreReadinessBlock
          : listing.id === exactLazadaListing?.id
            ? exactLazadaReadinessBlock
            : null,
      )
    )),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = remoteEditSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success) {
    const message = !productId.success
      ? "상품 ID 형식이 올바르지 않습니다."
      : !body.success
        ? body.error.issues[0]?.message ?? "원격 상품 수정 요청값을 확인해 주세요."
        : "원격 상품 수정 요청값을 확인해 주세요.";
    return NextResponse.json({
      message,
    }, { status: 400 });
  }
  if (hasClientSmartstoreManualAdoptionUpdateMarker(body.data.arguments)) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "smartstore_manual_adoption_marker_server_owned",
      message: "스마트스토어 기존 상품 연결 증거는 서버 원장에서만 추가할 수 있습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (Object.hasOwn(body.data.arguments, smartstoreContentRepairArgument)
      || Object.hasOwn(body.data.arguments, smartstoreContentRepairTransmissionArgument)) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "smartstore_content_repair_marker_server_owned",
      message: "스마트스토어 승인 내용 복구 증거와 수정값은 서버 원장에서만 추가할 수 있습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const loaded = await productContext(request, productId.data);
  if ("response" in loaded) return loaded.response;
  const listing = listingRecords(loaded.context.listings).find((item) => item.id === body.data.listingId);
  if (!listing) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "listing_identity_mismatch",
      message: "요청한 상품 게시 원장이 이 중앙 상품에 속하지 않아 수정을 차단했습니다.",
    }, { status: 409 });
  }

  const release = channelOperationRelease(listing.channel, body.data.operation);
  if (!release.available) {
    const remotePlan = productEditRemotePlan(listing.channel, false);
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: release.mode,
      centralWritePerformed: false,
      remoteWritePerformed: false,
      manualRequired: true,
      remotePlan,
      message: `${release.reason} ${remotePlan.message}`,
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const reference = listingReference(listing);
  const exactEbayCandidate = productId.data === ebayExactExistingQaRecoveryIdentity.productId
    && ebayExactExistingQaRecoveryCandidate({
      channel: listing.channel,
      listingId: listing.id,
      remoteId: reference.remoteId,
      marketplaceSku: reference.marketplaceSku,
      status: reference.status,
      requestedPublicationIntent: reference.requestedPublicationIntent,
      remoteVisibility: reference.remoteVisibility,
      providerStatus: reference.providerStatus,
      publishedAt: reference.publishedAt,
      failureClass: reference.failureClass,
    });
  let boundQoo10RollbackUpdateRecovery: Qoo10RollbackUpdateRecoveryBinding | null = null;
  if (qoo10RollbackListingUpdateCandidate(listing.channel, reference)) {
    const { data: identityData, error: identityError } = await loaded.admin.serviceClient.rpc(
      "sellerpilot_service_get_qoo10_rollback_update_identity",
      {
        p_listing_id: listing.id,
        p_credential_id: body.data.credentialId,
        p_product_id: productId.data,
        p_market: typeof listing.market === "string" ? listing.market : "",
        p_target_id: typeof listing.targetId === "string" ? listing.targetId : "",
      },
    );
    const identity = qoo10RollbackIdentitySchema.safeParse(identityData);
    if (identityError
        || !identity.success
        || identity.data.listingId !== listing.id
        || identity.data.remoteId !== reference.remoteId) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        mode: "qoo10_rollback_identity_required",
        message: "Qoo10 판매중지 롤백과 원격 상품 결속을 독립 조회로 확정하기 전에는 기존 상품을 수정할 수 없습니다.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    boundQoo10RollbackUpdateRecovery = identity.data;
  }
  let verifiedExactEbayUpdate = false;
  if (exactEbayCandidate) {
    const { data: identityData, error: identityError } = await loaded.admin.serviceClient.rpc(
      "sellerpilot_service_get_ebay_exact_qa_recovery_identity",
      {
        p_listing_id: listing.id,
        p_credential_id: body.data.credentialId,
        p_product_id: productId.data,
        p_market: typeof listing.market === "string" ? listing.market : "",
        p_target_id: typeof listing.targetId === "string" ? listing.targetId : "",
      },
    );
    const identity = ebayExactExistingQaRecoveryBindingValue(identityData);
    if (identityError) {
      console.error("ebay_exact_existing_identity_rpc_failed", {
        code: typeof identityError.code === "string" ? identityError.code : "unknown",
      });
      return NextResponse.json({
        ok: false,
        status: "blocked",
        mode: "ebay_exact_existing_identity_rpc_failed",
        message: "eBay exact QA 운영 결속 조회가 실패해 원격 수정을 실행하지 않았습니다.",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (!identity) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        mode: "ebay_exact_existing_identity_contract_required",
        message: "eBay exact QA 상품·offer·SKU·운영 인증정보 결속값이 현재 원장과 일치하지 않아 원격 수정을 실행하지 않았습니다.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (identity.credentialId !== body.data.credentialId) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        mode: "ebay_exact_existing_credential_stale",
        message: "eBay 운영 인증정보가 갱신되었습니다. 상품 화면을 새로고침한 뒤 다시 확인해 주세요.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    verifiedExactEbayUpdate = true;
  }
  let verifiedLegacyEbayUpdate = false;
  if (!exactEbayCandidate && legacyEbayListingUpdateCandidate(listing.channel, reference)) {
    const { data: identityData, error: identityError } = await loaded.admin.serviceClient.rpc(
      "sellerpilot_service_get_ebay_listing_update_identity",
      {
        p_listing_id: listing.id,
        p_credential_id: body.data.credentialId,
        p_product_id: productId.data,
        p_market: typeof listing.market === "string" ? listing.market : "",
        p_target_id: typeof listing.targetId === "string" ? listing.targetId : "",
      },
    );
    const identity = recordValue(identityData);
    verifiedLegacyEbayUpdate = !identityError
      && identity.status === "allowed"
      && identity.contract === "ebay_listing_identity_v1"
      && identity.listingId === reference.remoteId
      && identity.sku === reference.marketplaceSku
      && identity.marketplaceId === String(listing.targetId ?? "").trim().toUpperCase()
      && typeof identity.offerId === "string"
      && identity.offerId.trim().length > 0;
  }

  const executionBlock = listingExecutionBlock(
    listing,
    verifiedLegacyEbayUpdate,
    verifiedExactEbayUpdate,
  );
  if (executionBlock) {
    return NextResponse.json({
      ok: false,
      status: executionBlock.status === 202 ? "in_progress" : "blocked",
      inProgress: executionBlock.status === 202,
      mode: executionBlock.mode,
      message: executionBlock.message,
    }, { status: executionBlock.status, headers: { "cache-control": "no-store, max-age=0" } });
  }

  let argumentsValue: Record<string, unknown>;
  try {
    argumentsValue = prepareListingUpdateArguments(listing.channel, body.data.arguments, listingReference(listing));
    if (listingUpdateRemoteIdentity(listing.channel, argumentsValue) !== listingReference(listing).remoteId) {
      throw new Error("LISTING_UPDATE_IDENTITY_MISMATCH");
    }
    if (boundQoo10RollbackUpdateRecovery) {
      argumentsValue = bindQoo10RollbackUpdateRecoveryArguments(
        argumentsValue,
        boundQoo10RollbackUpdateRecovery,
      );
    }
  } catch {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "published_remote_identity_required",
      message: "게시 원장의 원격 상품 ID로 안전한 수정 요청을 만들지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const mutablePaths = listingUpdateMutablePaths(listing.channel, argumentsValue);
  if (!mutablePaths.length) {
    const remotePlan = productEditRemotePlan(listing.channel, true);
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "mutable_content_required",
      centralWritePerformed: false,
      remoteWritePerformed: false,
      manualRequired: true,
      remotePlan,
      message: "이 채널에서 자동 수정 가능한 상품명·설명·필수정보·이미지·검증된 가격·재고 값이 요청에 없습니다. 중앙 원장 저장값은 유지되며 미지원 판매구성·가격·옵션 등은 외부 채널 수동 반영이 필요합니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const lazadaPricePolicy = listing.channel === "lazada"
    ? lazadaKrwMyrPricePolicyFromArguments(argumentsValue)
    : null;
  if (listing.channel === "lazada") {
    const manualFields = recordValue(loaded.context.manualFields);
    const sourceCurrency = typeof manualFields.currency === "string"
      ? manualFields.currency.trim().toUpperCase()
      : "";
    const sourcePrice = Number(manualFields.sellingPrice);
    const sourceStock = Number(manualFields.stock);
    const requestedStock = lazadaRequestedUpdateQuantity(argumentsValue);
    if (!lazadaPricePolicy
        || sourceCurrency !== lazadaPricePolicy.sourceCurrency
        || !Number.isFinite(sourcePrice)
        || Math.abs(sourcePrice - lazadaPricePolicy.sourcePriceKrw) > 0.000_001
        || !Number.isSafeInteger(sourceStock)
        || sourceStock < 0
        || requestedStock === null
        || requestedStock !== sourceStock) {
      return NextResponse.json({
        ok: false,
        status: "blocked",
        mode: "lazada_krw_myr_price_policy_required",
        message: "중앙 상품 원장의 KRW 판매가·재고와 최신 MYR 환율로 고정한 최종 금액이 일치하지 않아 Lazada 수정을 차단했습니다.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  const listingCurrency = typeof listing.currency === "string" ? listing.currency.trim().toUpperCase() : "";
  const listingPrice = typeof listing.price === "number" || typeof listing.price === "string"
    ? Number(listing.price)
    : Number.NaN;
  const currency = lazadaPricePolicy?.targetCurrency ?? listingCurrency;
  const price = lazadaPricePolicy?.targetPriceMyr ?? listingPrice;
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(price) || price < 0) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      mode: "listing_commerce_values_required",
      message: "게시 원장에 저장된 통화·가격을 확인하지 못해 임의 값으로 상품 원장을 갱신하지 않았습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const idempotencyKey = remoteProductEditIdempotencyKey({
    productId: productId.data,
    listingId: listing.id,
    mutationId: body.data.mutationId,
  });
  const operationRequest = {
    credentialId: body.data.credentialId,
    channel: listing.channel,
    operation: "listing.update" as const,
    idempotencyKey,
    confirmWrite: true,
    productId: productId.data,
    resourceListingId: listing.id,
    currency,
    price,
    market: typeof listing.market === "string" ? listing.market : "",
    targetId: typeof listing.targetId === "string" ? listing.targetId : "",
    arguments: argumentsValue,
  };

  try {
    const response = await fetch(new URL("/api/admin/channel-operations", request.url), {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(operationRequest),
      cache: "no-store",
      signal: AbortSignal.timeout(58_000),
    });
    const responseText = await response.text();
    return new NextResponse(responseText, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      status: "in_progress",
      inProgress: true,
      retrySafe: true,
      idempotencyKey,
      message: "원격 수정 응답 대기시간을 넘겼습니다. 같은 mutationId로 다시 확인하면 동일 작업을 재사용하며 새 원격 쓰기를 만들지 않습니다.",
    }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
