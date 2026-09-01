import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  channelOperationCapabilities,
  channelOperationNames,
  executeChannelOperation,
  writeChannelOperations,
} from "../../../../lib/channels/operations";
import { channelCatalog } from "../../../../lib/channels/catalog";
import {
  ChannelGatewayInProgressError,
  ChannelGatewayCredentialUnattestedError,
  ChannelGatewayListingAlreadyPublishedError,
  ChannelGatewayListingBlockedError,
  ChannelGatewayReconciliationRequiredError,
  ChannelGatewayRemoteFailedError,
  executeViaChannelGateway,
} from "../../../../lib/channels/gateway";
import { channelOperationRelease } from "../../../../lib/channels/operation-availability";
import { missingEbayListingCreateConfiguration } from "../../../../lib/channels/ebay-listing-configuration";
import {
  assertEbayExactExistingQaProviderCopyRequest,
  bindEbayExactNoEffectRetryArguments,
  bindEbayExactExistingQaRecoveryArguments,
  ebayExactNoEffectRetryArgument,
  ebayExactExistingQaClientBuyerCopySupplied,
  ebayExactExistingQaCentralProductVerified,
  ebayExactExistingQaCreateForbidden,
  ebayExactExistingQaRecoveryArgument,
  ebayExactExistingQaRecoveryBindingValue,
  ebayExactExistingQaRecoveryCandidate,
  ebayExactExistingQaRecoveryIdentity,
  type EbayExactExistingQaRecoveryBinding,
} from "../../../../lib/channels/ebay-exact-existing-qa-recovery";
import { buildQoo10ListingCreateContext } from "../../../../lib/channels/qoo10-listing-create-preflight";
import {
  bindQoo10ExactLocalizationUpdateArguments,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationRequestCandidate,
  qoo10ExactLocalizationUpdateArgument,
} from "../../../../lib/channels/qoo10-exact-localization-recovery";
import {
  bindShopeeSgListingCreateArguments,
  buildShopeeSgListingCreateContext,
  loadAuthoritativeKrwSgdUsdRate,
  shopeeSgArgumentsForFingerprint,
} from "../../../../lib/channels/shopee-sg-listing-create";
import {
  mergeElevenstListingUpdateProduct,
  validateElevenstListingProduct,
} from "../../../../lib/channels/elevenst-listing";
import {
  bindElevenstExactExistingPublication,
  elevenstExactExistingCentralCommerceVerified,
  elevenstExactExistingCentralSkuVerified,
  elevenstExactExistingCreateForbidden,
  elevenstExactExistingPublicationArgument,
  elevenstExactExistingPublicationCandidate,
  elevenstExactExistingPublicationIdentity,
} from "../../../../lib/channels/elevenst-exact-existing-publication";
import {
  bindCoupangExactQaRecoveryArguments,
  bindCoupangExactQaUpdateItemIdentity,
  coupangExactQaCentralSkuVerified,
  coupangExactQaCreateForbidden,
  coupangExactQaRecoveryArgument,
  coupangExactQaRecoveryBindingValue,
  coupangExactQaRecoveryCandidate,
  coupangExactQaRecoveryIdentity,
  type CoupangExactQaRecoveryPhase,
} from "../../../../lib/channels/coupang-exact-qa-recovery";
import {
  assertSmartstoreExactQaUpdateArguments,
  bindSmartstoreExactQaRecoveryArguments,
  smartstoreExactQaApprovedContentRequired,
  smartstoreExactQaCentralSkuVerified,
  smartstoreExactQaCreateForbidden,
  smartstoreExactQaRecoveryArgument,
  smartstoreExactQaRecoveryBindingValue,
  smartstoreExactQaRecoveryCandidate,
  smartstoreExactQaRecoveryIdentity,
} from "../../../../lib/channels/smartstore-exact-qa-recovery";
import {
  bindSmartstoreExactQaRepresentativeFromStorage,
} from "../../../../lib/server-smartstore-exact-representative";
import {
  elevenstExactExistingUpdateProjectionDigestInput,
  elevenstListingUpdateProjectionDigestInput,
  bindQoo10RollbackUpdateRecoveryArguments,
  listingUpdateRemoteIdentity,
  listingUpdateServerCandidate,
  qoo10RollbackListingUpdateCandidate,
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
  type ListingUpdateReference,
  type Qoo10RollbackUpdateRecoveryBinding,
} from "../../../../lib/channels/listing-update";
import { lazadaKrwMyrPricePolicyFromArguments } from "../../../../lib/channels/lazada-price-policy";
import { lazadaRequestedUpdateQuantity } from "../../../../lib/channels/lazada-listing-update";
import {
  lazadaExactExistingCentralSkuVerified,
  lazadaExactExistingCreateForbidden,
  lazadaExactExistingPublicationCandidate,
  lazadaExactExistingPublicationIdentity,
} from "../../../../lib/channels/lazada-exact-existing-identity";
import { applyListingRemediation } from "../../../../lib/channels/listing-remediation";
import {
  listingOperationRequiresVerifiedRemoteState,
  listingOperationUsesPublicationIntent,
  listingExpectedPublicationLocale,
  listingPublicationIntentSchema,
  listingRemoteStateContractVersion,
  persistedListingPublicationReplay,
  verifiedListingPublicationResult,
} from "../../../../lib/channels/listing-publication-state";
import { prepareMarketplaceImages } from "../../../../lib/channels/marketplace-images";
import { marketplaceChannelDetailImageCount } from "../../../../lib/channels/marketplace-image-contract";
import type { ProductDetailImageManifest } from "../../../../lib/product-detail-image-manifest";
import {
  approvedProductDetailManifestFromPublishContext,
  bindMarketplaceArgumentsToApprovedDetailManifest,
  marketplaceArgumentsForApprovedDetailFingerprint,
} from "../../../../lib/server-product-detail-manifest";
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../lib/channels/serverless-static-egress";
import { channelListingRemoteIdentity, channelWriteResource, listingLedgerRemoteIdentity } from "../../../../lib/channels/write-resource";
import { resolveRuntimeReleaseIdentity } from "../../../../lib/internal-scheduler-auth";
import {
  bindTemuCreateAttemptIdentity,
  temuImmutableListingIdentityFromPublishContext,
} from "../../../../lib/channels/provider-temu-publication-readback";
import { parseListingPublicationAssetBinding } from "../../../../lib/channels/listing-publication-content";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const verifiedPublicationReleaseChannels = new Set([
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
]);

function temuActivationAssetBindingMatchesApproved(
  sourceArguments: Record<string, unknown>,
  approved: { version: number; manifest: ProductDetailImageManifest },
) {
  const binding = parseListingPublicationAssetBinding(
    sourceArguments.sellerpilotPublicationAssetBinding,
  );
  return Boolean(
    binding
    && binding.providerImageSurface === "detail_content"
    && binding.approvedDetailPageVersion === approved.version
    && binding.approvedManifestDigest === approved.manifest.digest
    && binding.approvedDetailImages.length === marketplaceChannelDetailImageCount
    && binding.approvedDetailImages.every((image, index) => {
      const expected = approved.manifest.images[index];
      return image.role === expected?.role
        && image.approvedObjectPath === expected.path
        && image.approvedSourceSha256 === expected.sourceSha256;
    }),
  );
}

const requestSchema = z.object({
  credentialId: z.string().uuid(),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]),
  operation: z.enum(channelOperationNames),
  publicationIntent: listingPublicationIntentSchema.optional(),
  idempotencyKey: z.string().trim().min(16).max(160),
  confirmWrite: z.boolean().default(false),
  productId: z.string().uuid().optional(),
  resourceListingId: z.string().uuid().optional(),
  inventoryItemId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  shipmentCarrier: z.string().trim().min(1).max(40).optional(),
  shipmentTracking: z.string().trim().max(100).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  price: z.number().nonnegative().max(999_999_999).optional(),
  market: z.string().trim().max(80).optional().default(""),
  targetId: z.string().trim().max(160).optional().default(""),
  arguments: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 128_000, "payload too large"),
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

type ProductContentMode = "ai_generated" | "manual_mvp";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listingUpdateReferenceFromLedger(listing: Record<string, unknown>): ListingUpdateReference {
  return {
    listingId: typeof listing.id === "string" ? listing.id : null,
    remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
    status: typeof listing.status === "string" ? listing.status : "",
    marketplaceSku: typeof listing.marketplaceSku === "string" ? listing.marketplaceSku : null,
    providerStatus: typeof listing.providerStatus === "string" ? listing.providerStatus : null,
    failureClass: listing.failureClass === "retryable" || listing.failureClass === "external_action"
      ? listing.failureClass
      : null,
    publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
    requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
      ? listing.requestedPublicationIntent
      : null,
    remoteVisibility: typeof listing.remoteVisibility === "string" ? listing.remoteVisibility : null,
    market: typeof listing.market === "string" ? listing.market : null,
    targetId: typeof listing.targetId === "string" ? listing.targetId : null,
  };
}

function qoo10ExactLocalizationRequestCandidateFromLedger(input: {
  channel: string;
  productId: string;
  credentialId: string;
  listing: Record<string, unknown>;
}) {
  const reference = listingUpdateReferenceFromLedger(input.listing);
  return qoo10ExactLocalizationRequestCandidate({
    channel: input.channel,
    productId: input.productId,
    credentialId: input.credentialId,
    listingId: reference.listingId,
    remoteId: reference.remoteId,
    market: reference.market,
    targetId: reference.targetId,
    status: reference.status,
    failureClass: reference.failureClass,
    requestedPublicationIntent: reference.requestedPublicationIntent,
    remoteVisibility: reference.remoteVisibility,
  });
}

function marketplaceContentModeMatchesProduct(
  argumentsValue: Record<string, unknown>,
  productContentMode: ProductContentMode,
) {
  const assets = isRecord(argumentsValue.sellerpilotAssets)
    ? argumentsValue.sellerpilotAssets
    : null;
  if (!assets || assets.contentMode !== productContentMode) return false;

  const preparedMarker = argumentsValue.sellerpilotContentMode;
  if (productContentMode === "manual_mvp") {
    return assets.detailAssetMode === "manual_source"
      && (preparedMarker === undefined || preparedMarker === "manual_mvp");
  }
  return assets.detailAssetMode !== "manual_source"
    && preparedMarker === undefined;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("CHANNEL_ARGUMENT_REQUIRED:")) return `필수 작업값이 누락됐습니다 · ${message.split(":")[1]}`;
  if (message.startsWith("CHANNEL_ARGUMENT_INVALID:")) return `작업값 형식이 올바르지 않습니다 · ${message.split(":")[1]}`;
  if (message.startsWith("CHANNEL_OPERATION_UNSUPPORTED:")) return "해당 채널에서 지원하지 않는 작업입니다.";
  if (message.startsWith("CHANNEL_VENDOR_SPEC_REQUIRED:")) return "판매자 전용 상세 API 명세를 확정한 뒤 사용할 수 있습니다.";
  if (/CREDENTIALS_MISSING|ACCESS_TOKEN_MISSING|TOKEN_EXCHANGE_FAILED|TOKEN_REFRESH_FAILED|REFRESH_TOKEN_EXPIRED|REFRESH_CREDENTIALS_MISSING|CREDENTIAL_REFRESH_STORE_FAILED/.test(message)) return "필수 인증값 또는 OAuth 토큰이 누락됐거나 만료됐습니다.";
  if (message.includes("COUPANG_USABLE_OUTBOUND_MISSING")) return "쿠팡 WING에 사용 가능한 국내 출고지가 없습니다. WING의 출고지 설정을 확인해 주세요.";
  if (message.includes("COUPANG_USABLE_RETURN_CENTER_MISSING")) return "쿠팡 WING에 사용 가능한 국내 반품지와 택배사 설정이 없습니다. WING의 반품지 설정을 확인해 주세요.";
  if (message.includes("COUPANG_RETURN_FEE_MISSING")) return "쿠팡 WING 반품지에 0원보다 큰 반품 배송비가 설정되어 있지 않습니다.";
  if (message.includes("COUPANG_WING_USER_ID_MISSING")) return "쿠팡 API Vault에 WING 로그인 사용자 ID가 없습니다.";
  if (message.includes("MARKETPLACE_DETAIL_IMAGE_REQUIRED")) return `채널용 상세페이지 전용 이미지 ${marketplaceChannelDetailImageCount}장이 모두 생성·검증되지 않아 실제 채널 등록을 차단했습니다. AI 상세 제작을 다시 실행해 주세요.`;
  if (message.includes("MARKETPLACE_IMAGE_")) return "대표 이미지를 1200×1200 JPEG·3MB 이하 영구 공개 경로로 자동 보정하지 못했습니다.";
  if (message.includes("NAVER_AFTER_SERVICE_PHONE_MISSING")) return "네이버 판매자 주소록에서 A/S 연락처를 찾지 못했습니다. API 키의 A/S 전화번호 필드에 실제 연락처를 입력해 주세요.";
  if (message.includes("EBAY_LISTING_CONFIGURATION_REQUIRED")) return "eBay 마켓과 Seller Hub에서 확인한 배송·결제·반품 정책 ID, 재고 위치 키를 명시적으로 입력해 주세요.";
  if (message.startsWith("CHANNEL_GATEWAY_TIMEOUT")) return "Vercel 서버리스 채널 게이트웨이의 응답 제한시간을 초과했습니다. 운영 상태를 확인해 주세요.";
  if (message.startsWith("CHANNEL_WRITE_RESOURCE_")) return "가격·재고·발송 작업의 원격 대상 식별값을 확인하지 못해 실행을 차단했습니다.";
  if (message.startsWith("CHANNEL_GATEWAY_")) return "Vercel 서버리스 채널 게이트웨이에서 안전하게 처리된 오류가 발생했습니다.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "판매채널 응답 제한시간(15초)을 초과했습니다.";
  return "판매채널 작업 중 안전하게 처리된 오류가 발생했습니다.";
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "채널 작업 요청 형식이 올바르지 않습니다." }, { status: 400 });

  const { channel, operation } = parsed.data;
  if (channel === "coupang"
      && operation === "listing.create"
      && coupangExactQaCreateForbidden({
        productId: parsed.data.productId,
        argumentsValue: parsed.data.arguments,
      })) {
    return NextResponse.json({
      message: "이미 존재하는 쿠팡 QA 상품은 신규 등록하지 않고 정확한 기존 상품만 복구 수정해야 합니다.",
      mode: "coupang_exact_existing_listing_update_required",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (channel === "smartstore"
      && operation === "listing.create"
      && smartstoreExactQaCreateForbidden({
        productId: parsed.data.productId,
        argumentsValue: parsed.data.arguments,
      })) {
    return NextResponse.json({
      message: "이미 존재하는 스마트스토어 QA 상품은 신규 등록하지 않고 정확한 기존 원상품만 복구 수정해야 합니다.",
      mode: "smartstore_exact_existing_listing_update_required",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (channel === "lazada"
      && operation === "listing.create"
      && lazadaExactExistingCreateForbidden({
        productId: parsed.data.productId,
        market: parsed.data.market,
        argumentsValue: parsed.data.arguments,
      })) {
    return NextResponse.json({
      message: "이미 존재하는 정확한 Lazada MY 상품은 신규 등록하지 않고 기존 item만 검증·수정해야 합니다.",
      mode: "lazada_exact_existing_duplicate_create_forbidden",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (channel === "ebay"
      && operation === "listing.create"
      && ebayExactExistingQaCreateForbidden({
        productId: parsed.data.productId,
        market: parsed.data.market,
        targetId: parsed.data.targetId,
        argumentsValue: parsed.data.arguments,
      })) {
    return NextResponse.json({
      message: "이미 존재하는 eBay QA 상품은 신규 등록하지 않고 정확한 기존 listing만 복구 수정해야 합니다.",
      mode: "ebay_exact_existing_duplicate_create_forbidden",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (operation === "listing.activate" && channel !== "temu") {
    return NextResponse.json({
      message: "Qoo10 활성화 복구는 직전 S1 검증 원장에 의해 서버에서만 생성됩니다.",
      mode: "server_owned_activation_required",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const capability = channelCatalog[channel].capabilities[channelOperationCapabilities[operation]];
  if (capability.mode === "unsupported") {
    return NextResponse.json({ message: capability.note, mode: capability.mode }, { status: 409 });
  }
  if (capability.mode === "vendor_docs_required") {
    return NextResponse.json({ message: capability.note, mode: "vendor_docs_required" }, { status: 409 });
  }
  if (writeChannelOperations.has(operation) && !parsed.data.confirmWrite) {
    return NextResponse.json({ message: "외부 판매채널을 변경하는 작업은 실행 확인이 필요합니다." }, { status: 428 });
  }
  if (["listing.create", "listing.update", "listing.stop", "listing.activate"].includes(operation) && !parsed.data.productId) {
    return NextResponse.json({
      message: "상품 원장 ID가 없는 상품 등록·수정·판매 중지는 중복 방지를 위해 실행할 수 없습니다.",
    }, { status: 409 });
  }
  if (channel === "elevenst"
      && operation === "listing.create"
      && elevenstExactExistingCreateForbidden({
        productId: parsed.data.productId,
        argumentsValue: parsed.data.arguments,
      })) {
    return NextResponse.json({
      message: "이미 존재하는 정확한 11번가 QA 상품은 신규 등록하지 않고 기존 상품 수정으로만 복구합니다.",
      mode: "elevenst_exact_existing_duplicate_create_forbidden",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (operation === "listing.create" && (parsed.data.currency === undefined || parsed.data.price === undefined)) {
    return NextResponse.json({
      message: "상품 등록 가격과 통화를 확인하지 못해 임의 값으로 판매채널에 전송하지 않았습니다.",
      mode: "listing_commerce_values_required",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const listingBoundOperation = ["listing.update", "listing.stop", "listing.activate", "price.update", "inventory.update"].includes(operation);
  if (listingBoundOperation && (!parsed.data.productId || !parsed.data.resourceListingId)) {
    return NextResponse.json({
      message: "정확한 상품 게시 원장 ID가 없는 원격 상품 변경은 실행할 수 없습니다.",
      mode: "listing_identity_mismatch",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const credentialMetadata = Array.isArray(credentialRows)
    ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId)
    : null;
  if (!credentialMetadata || !("channel" in credentialMetadata) || credentialMetadata.channel !== channel || !("status" in credentialMetadata) || credentialMetadata.status !== "active") {
    return NextResponse.json({ message: "활성 키와 채널 정보가 일치하지 않습니다." }, { status: 409 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const exactSmartstoreContentUpdate = smartstoreExactQaApprovedContentRequired({
    channel,
    operation,
    productId: parsed.data.productId,
    listingId: parsed.data.resourceListingId,
  });
  const contentBoundListingOperation = operation === "listing.create"
    || (operation === "listing.update" && isRecord(parsed.data.arguments.sellerpilotAssets))
    || exactSmartstoreContentUpdate
    || (channel === "temu" && operation === "listing.activate");
  let verifiedPublishContext: Record<string, unknown> | null = null;
  let verifiedProductContentMode: ProductContentMode | null = null;
  let approvedDetailBinding: { version: number; manifest: ProductDetailImageManifest } | null = null;
  let approvedDetailSignedUrls: string[] = [];
  let temuActivationSourceArguments: Record<string, unknown> | null = null;
  let temuActivationClaimIdempotencyKey: string | null = null;
  if (contentBoundListingOperation) {
    const { data: publishContext, error: contextError } = await userClient.rpc(
      "sellerpilot_get_product_publish_context",
      { p_product_id: parsed.data.productId! },
    );
    if (contextError || !isRecord(publishContext)) {
      return NextResponse.json({
        message: "상품 원장의 제작 계보를 확인하지 못해 판매채널 전송을 차단했습니다.",
        mode: "product_content_lineage_unverified",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const contentMode = publishContext.contentMode;
    if (contentMode !== "manual_mvp" && contentMode !== "ai_generated") {
      return NextResponse.json({
        message: "상품 원장의 제작 방식을 확인하지 못해 판매채널 전송을 차단했습니다.",
        mode: "product_content_lineage_unverified",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (channel === "temu" && operation === "listing.activate") {
      const { data: activationContext, error: activationContextError } = await serviceClient.rpc(
        "sellerpilot_service_get_temu_activation_context",
        {
          p_owner_id: userData.user.id,
          p_product_id: parsed.data.productId!,
          p_listing_id: parsed.data.resourceListingId!,
          p_credential_id: parsed.data.credentialId,
          p_market: parsed.data.market,
          p_target_id: parsed.data.targetId,
        },
      );
      const activationRecord = isRecord(activationContext) ? activationContext : null;
      temuActivationSourceArguments = activationRecord && isRecord(activationRecord.arguments)
        ? activationRecord.arguments
        : null;
      temuActivationClaimIdempotencyKey = activationRecord
        && typeof activationRecord.claimIdempotencyKey === "string"
        && /^temu-activation:[a-f0-9]{64}$/u.test(activationRecord.claimIdempotencyKey)
        ? activationRecord.claimIdempotencyKey
        : null;
      if (activationContextError
          || activationRecord?.status !== "allowed"
          || activationRecord.contract !== "temu_verified_non_public_activation_context_v1"
          || !temuActivationSourceArguments
          || !temuActivationClaimIdempotencyKey) {
        return NextResponse.json({
          message: "Temu QA 상품의 검증된 비공개 원장과 최초 등록 계보를 확인하지 못해 공개 승격을 시작하지 않았습니다.",
          mode: "temu_activation_context_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
    }
    const contentArguments = temuActivationSourceArguments ?? parsed.data.arguments;
    if (!marketplaceContentModeMatchesProduct(contentArguments, contentMode)) {
      return NextResponse.json({
        message: "요청한 이미지 제작 방식이 상품 원장의 제작 계보와 일치하지 않습니다.",
        mode: "product_content_mode_mismatch",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const approvedDetail = approvedProductDetailManifestFromPublishContext(publishContext);
    if (!approvedDetail.ok) {
      return NextResponse.json({
        message: "승인된 상세페이지 8장과 현재 운영 이미지 원장이 일치하지 않아 판매채널 전송을 시작하지 않았습니다.",
        mode: "approved_detail_image_manifest_required",
        manifestCode: approvedDetail.code,
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (channel === "temu"
        && operation === "listing.activate"
        && (!temuActivationSourceArguments
          || !temuActivationAssetBindingMatchesApproved(
            temuActivationSourceArguments,
            approvedDetail.value,
          ))) {
      return NextResponse.json({
        message: "Temu QA 등록 당시 승인 이미지 계보와 현재 승인된 상세 이미지 8장이 달라 공개 승격을 시작하지 않았습니다.",
        mode: "temu_activation_asset_manifest_mismatch",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const detailPaths = approvedDetail.value.manifest.images.map((image) => image.path);
    const detailBucket = serviceClient.storage.from("sellerpilot-ai");
    let resolvedSignedUrls: string[] | null = null;
    try {
      const [detailExistence, detailSigning] = await Promise.all([
        Promise.all(detailPaths.map((path) => detailBucket.exists(path))),
        detailBucket.createSignedUrls(detailPaths, 2 * 60 * 60),
      ]);
      const signedUrls = (detailSigning.data ?? []).map((item) => item.signedUrl ?? "");
      if (!detailExistence.some((result) => result.error || result.data !== true)
          && !detailSigning.error
          && signedUrls.length === marketplaceChannelDetailImageCount
          && signedUrls.every((url) => url.startsWith("https://"))
          && new Set(signedUrls).size === marketplaceChannelDetailImageCount) {
        resolvedSignedUrls = signedUrls;
      }
    } catch {
      resolvedSignedUrls = null;
    }
    if (!resolvedSignedUrls) {
      return NextResponse.json({
        message: "승인된 상세 이미지 8장의 운영 저장 경로를 확인하지 못해 판매채널 전송을 시작하지 않았습니다.",
        mode: "approved_detail_image_assets_unavailable",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    approvedDetailBinding = approvedDetail.value;
    approvedDetailSignedUrls = resolvedSignedUrls;
    verifiedPublishContext = publishContext;
    verifiedProductContentMode = contentMode;
  }
  const findProductListingId = async (remoteId?: string) => {
    if (!parsed.data.productId) return "";
    const { data, error } = await userClient.rpc("sellerpilot_get_product_publish_context", {
      p_product_id: parsed.data.productId,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return "";
    const listings = Array.isArray((data as Record<string, unknown>).listings)
      ? ((data as Record<string, unknown>).listings as unknown[])
      : [];
    const exact = listings.find((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const listing = item as Record<string, unknown>;
      return listing.channel === channel
        && String(listing.market ?? "") === parsed.data.market
        && String(listing.targetId ?? "") === parsed.data.targetId
        && (!remoteId || listing.remoteId === remoteId);
    });
    return exact && typeof (exact as Record<string, unknown>).id === "string"
      ? String((exact as Record<string, unknown>).id)
      : "";
  };
  let boundListingCurrency: string | undefined;
  let boundListingPrice: number | undefined;
  let boundListingPublicationIntent: "safe_test" | "live" | undefined;
  let boundEbayListingIdentity: Record<string, string> | null = null;
  let boundEbayExactExistingQaRecovery: EbayExactExistingQaRecoveryBinding | null = null;
  let boundEbayExactNoEffectRetry = false;
  let boundTemuListingIdentity: { goodsId: string; externalGoodsId: string } | null = null;
  let boundQoo10RollbackUpdateRecovery: Qoo10RollbackUpdateRecoveryBinding | null = null;
  let boundQoo10ExactLocalizationUpdate = false;
  let qoo10ExactLocalizationUpdatePermitArmed = false;
  let smartstoreExactQaUpdatePermitArmed = false;
  let exactExistingUpdatePermitArmed = false;
  let boundExactExistingClosedGateUpdateChannel:
    "coupang" | "elevenst" | "ebay" | null = null;
  let boundCoupangExactQaRecoveryPhase: CoupangExactQaRecoveryPhase | null = null;
  let boundElevenstExactExistingPublication = false;
  let boundSmartstoreExactQaRecovery = false;
  let boundLazadaExactLiveUpdate = false;
  if (listingBoundOperation) {
    const productId = parsed.data.productId!;
    const resourceListingId = parsed.data.resourceListingId!;
    let requestedRemoteId = "";
    try {
      requestedRemoteId = operation === "listing.update"
        ? listingUpdateRemoteIdentity(channel, parsed.data.arguments)
        : channelListingRemoteIdentity(
            channel,
            operation,
            operation === "listing.activate" && temuActivationSourceArguments
              ? temuActivationSourceArguments
              : parsed.data.arguments,
          );
    } catch {
      return NextResponse.json({ message: "원격 상품 식별값이 누락됐거나 서로 일치하지 않습니다." }, { status: 409 });
    }
    const publishContextResult = verifiedPublishContext
      ? { data: verifiedPublishContext, error: null }
      : await userClient.rpc("sellerpilot_get_product_publish_context", {
          p_product_id: productId,
        });
    const { data: publishContext, error: contextError } = publishContextResult;
    const contextRecord = publishContext && typeof publishContext === "object" && !Array.isArray(publishContext)
      ? publishContext as Record<string, unknown>
      : {};
    const listings = Array.isArray(contextRecord.listings)
      ? contextRecord.listings.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    const exactListing = !contextError ? listings.find((listing) => {
      const ledgerRemoteIdentity = listingLedgerRemoteIdentity(channel, operation, listing);
      return String(listing.id ?? "") === resourceListingId
        && listing.channel === channel
        && (operation === "listing.update"
          ? listingUpdateServerCandidate(channel, listingUpdateReferenceFromLedger(listing))
            || qoo10ExactLocalizationRequestCandidateFromLedger({
              channel,
              productId,
              credentialId: parsed.data.credentialId,
              listing,
            })
          : operation === "listing.activate"
            ? listing.status === "paused"
              && listing.requestedPublicationIntent === "safe_test"
              && ["non_public", "withdrawn"].includes(String(listing.remoteVisibility ?? ""))
            : ["published", "paused"].includes(String(listing.status ?? "")))
        && ledgerRemoteIdentity === requestedRemoteId
        && String(listing.market ?? "") === parsed.data.market
        && String(listing.targetId ?? "") === parsed.data.targetId;
    }) : null;
    if (!exactListing) {
      return NextResponse.json({
        message: "요청한 원격 상품 ID가 이 상품의 게시 원장과 일치하지 않아 수정을 차단했습니다.",
        mode: "listing_identity_mismatch",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (channel === "temu" && (operation === "listing.stop" || operation === "listing.activate")) {
      const immutableIdentity = temuImmutableListingIdentityFromPublishContext(
        exactListing,
        requestedRemoteId,
      );
      if (!immutableIdentity) {
        return NextResponse.json({
          message: "Temu goodsId와 외부 상품 ID의 불변 결속을 게시 원장에서 확인하지 못해 판매 중지를 시작하지 않았습니다.",
          mode: "temu_immutable_identity_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundTemuListingIdentity = immutableIdentity;
    }
    if (operation === "listing.update") {
      const ledgerIntent = listingPublicationIntentSchema.safeParse(exactListing.requestedPublicationIntent);
      if (!ledgerIntent.success) {
        return NextResponse.json({
          message: "게시 원장의 게시 의도를 확인하지 못해 상품 수정을 차단했습니다.",
          mode: "listing_publication_intent_unverified",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      const nestedIntent = parsed.data.arguments.publicationIntent;
      const suppliedIntent = parsed.data.publicationIntent ?? nestedIntent;
      const parsedSuppliedIntent = suppliedIntent === undefined
        ? null
        : listingPublicationIntentSchema.safeParse(suppliedIntent);
      if ((parsed.data.publicationIntent !== undefined
          && nestedIntent !== undefined
          && parsed.data.publicationIntent !== nestedIntent)
          || (parsedSuppliedIntent && (!parsedSuppliedIntent.success || parsedSuppliedIntent.data !== ledgerIntent.data))) {
        return NextResponse.json({
          message: "상품 수정은 게시 원장의 기존 게시 의도를 변경할 수 없습니다.",
          mode: "listing_publication_intent_mismatch",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundListingPublicationIntent = ledgerIntent.data;
    } else if (operation === "listing.stop"
        && (parsed.data.publicationIntent !== undefined || parsed.data.arguments.publicationIntent !== undefined)) {
      return NextResponse.json({
        message: "판매 중지 작업은 safe/live 게시 의도를 변경하지 않습니다.",
        mode: "listing_stop_publication_intent_forbidden",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (operation === "listing.update" || operation === "listing.stop" || operation === "listing.activate") {
      const ledgerCurrency = String(exactListing.currency ?? "").trim().toUpperCase();
      const ledgerPrice = Number(exactListing.price);
      if (!/^[A-Z]{3}$/.test(ledgerCurrency) || !Number.isFinite(ledgerPrice) || ledgerPrice < 0) {
        return NextResponse.json({
          message: "게시 원장의 통화·가격을 확인하지 못해 임의 값으로 상품 상태를 변경하지 않았습니다.",
          mode: "listing_commerce_values_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundListingCurrency = ledgerCurrency;
      boundListingPrice = ledgerPrice;
      if (channel === "lazada" && operation === "listing.update") {
        const policy = lazadaKrwMyrPricePolicyFromArguments(parsed.data.arguments);
        const manualFields = isRecord(contextRecord.manualFields)
          ? contextRecord.manualFields
          : {};
        const centralCurrency = String(manualFields.currency ?? "").trim().toUpperCase();
        const centralPrice = Number(manualFields.sellingPrice);
        const centralStock = Number(manualFields.stock);
        const requestedStock = lazadaRequestedUpdateQuantity(parsed.data.arguments);
        if (!policy
            || centralCurrency !== policy.sourceCurrency
            || !Number.isFinite(centralPrice)
            || Math.abs(centralPrice - policy.sourcePriceKrw) > 0.000_001
            || !Number.isSafeInteger(centralStock)
            || centralStock < 0
            || requestedStock === null
            || requestedStock !== centralStock) {
          return NextResponse.json({
            message: "중앙 KRW 판매가·재고와 고정된 MYR 최종 금액의 근거가 일치하지 않아 Lazada 상품 수정을 차단했습니다.",
            mode: "lazada_krw_myr_price_policy_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        const exactLazada = lazadaExactExistingPublicationCandidate({
          channel,
          listingId: String(exactListing.id ?? ""),
          remoteId: typeof exactListing.remoteId === "string" ? exactListing.remoteId : null,
          status: String(exactListing.status ?? ""),
          requestedPublicationIntent: typeof exactListing.requestedPublicationIntent === "string"
            ? exactListing.requestedPublicationIntent
            : null,
          remoteVisibility: typeof exactListing.remoteVisibility === "string"
            ? exactListing.remoteVisibility
            : null,
          providerStatus: typeof exactListing.providerStatus === "string" ? exactListing.providerStatus : null,
          publishedAt: typeof exactListing.publishedAt === "string" ? exactListing.publishedAt : null,
          failureClass: typeof exactListing.failureClass === "string" ? exactListing.failureClass : null,
        });
        if (exactLazada
            && (productId !== lazadaExactExistingPublicationIdentity.productId
              || !lazadaExactExistingCentralSkuVerified(contextRecord)
              || centralCurrency !== lazadaExactExistingPublicationIdentity.sourceCurrency
              || centralPrice !== lazadaExactExistingPublicationIdentity.sourcePriceKrw
              || centralStock !== lazadaExactExistingPublicationIdentity.stock)) {
          return NextResponse.json({
            message: "Lazada MY 기존 상품의 중앙 SKU·5,000원·재고 1 결속을 확인하지 못해 수정하지 않았습니다.",
            mode: "lazada_exact_existing_central_contract_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        if (exactLazada) boundLazadaExactLiveUpdate = true;
        boundListingCurrency = policy.targetCurrency;
        boundListingPrice = policy.targetPriceMyr;
      }
    }

    const { data: lineageStatus, error: lineageError } = channel === "temu"
        && operation === "listing.activate"
      ? { data: "allowed", error: null }
      : await serviceClient.rpc(
          "sellerpilot_service_validate_listing_write_lineage",
          {
            p_listing_id: resourceListingId,
            p_credential_id: parsed.data.credentialId,
            p_product_id: productId,
            p_channel: channel,
            p_operation: operation,
            p_market: parsed.data.market,
            p_target_id: parsed.data.targetId,
          },
        );
    if (lineageError || typeof lineageStatus !== "string") {
      return NextResponse.json({
        message: "판매자 계정과 상품 게시 원장의 결속 상태를 확인하지 못했습니다.",
        mode: "lineage_check_unavailable",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (lineageStatus !== "allowed") {
      const message = lineageStatus === "credential_unverified"
        ? "현재 인증정보의 판매자 계보가 아직 검증되지 않아 기존 원격 상품 변경을 차단했습니다."
        : lineageStatus === "legacy_listing_unbound"
          ? "이 기존 상품은 등록 계정 계보가 확인되지 않아 원격 수정·판매 중지를 차단했습니다. 판매자센터에서 먼저 소유권을 조정해 주세요."
          : lineageStatus === "seller_account_mismatch"
            ? "이 상품을 등록한 판매자 계정과 현재 인증정보가 달라 원격 변경을 차단했습니다."
            : "요청한 상품·마켓·상점 원장이 현재 인증정보와 정확히 일치하지 않습니다.";
      return NextResponse.json({ message, mode: lineageStatus }, {
        status: 409,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    const exactCoupangQaListing = channel === "coupang"
      && productId === coupangExactQaRecoveryIdentity.productId
      && resourceListingId === coupangExactQaRecoveryIdentity.listingId
      && requestedRemoteId === coupangExactQaRecoveryIdentity.sellerProductId;
    if (exactCoupangQaListing) {
      if (!coupangExactQaCentralSkuVerified(contextRecord)) {
        return NextResponse.json({
          message: "쿠팡 기존 QA 상품의 중앙 SKU 결속을 확인하지 못해 원격 변경을 시작하지 않았습니다.",
          mode: "coupang_exact_qa_sku_identity_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      if (operation === "listing.update") {
        if (!coupangExactQaRecoveryCandidate({
          channel,
          listingId: String(exactListing.id ?? ""),
          remoteId: String(exactListing.remoteId ?? ""),
          status: String(exactListing.status ?? ""),
          requestedPublicationIntent: String(exactListing.requestedPublicationIntent ?? ""),
          remoteVisibility: String(exactListing.remoteVisibility ?? ""),
          providerStatus: typeof exactListing.providerStatus === "string" ? exactListing.providerStatus : null,
          publishedAt: typeof exactListing.publishedAt === "string" ? exactListing.publishedAt : null,
          failureClass: typeof exactListing.failureClass === "string" ? exactListing.failureClass : null,
        })) {
          return NextResponse.json({
            message: "쿠팡 exact QA 복구 원장의 실패·미확인 상태가 예상값과 달라 수정하지 않았습니다.",
            mode: "coupang_exact_qa_recovery_state_mismatch",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        boundCoupangExactQaRecoveryPhase = "listing.update";
        boundExactExistingClosedGateUpdateChannel = "coupang";
      } else if (operation === "listing.stop") {
        boundCoupangExactQaRecoveryPhase = "listing.stop";
      }
      if (boundCoupangExactQaRecoveryPhase) {
        const { data: exactIdentityData, error: exactIdentityError } = await serviceClient.rpc(
          "sellerpilot_service_get_coupang_exact_qa_recovery_identity",
          {
            p_listing_id: resourceListingId,
            p_credential_id: parsed.data.credentialId,
            p_product_id: productId,
            p_market: parsed.data.market,
            p_target_id: parsed.data.targetId,
            p_phase: boundCoupangExactQaRecoveryPhase,
          },
        );
        const exactIdentity = coupangExactQaRecoveryBindingValue(
          exactIdentityData,
          boundCoupangExactQaRecoveryPhase,
        );
        if (exactIdentityError || !exactIdentity) {
          return NextResponse.json({
            message: "쿠팡 exact QA 상품과 현재 인증정보의 불변 결속을 트랜잭션 원장에서 확인하지 못했습니다.",
            mode: "coupang_exact_qa_atomic_identity_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
      }
    }
    const exactSmartstoreQaListing = channel === "smartstore"
      && operation === "listing.update"
      && productId === smartstoreExactQaRecoveryIdentity.productId
      && resourceListingId === smartstoreExactQaRecoveryIdentity.listingId
      && requestedRemoteId === smartstoreExactQaRecoveryIdentity.originProductNo;
    if (exactSmartstoreQaListing) {
      if (!smartstoreExactQaCentralSkuVerified(contextRecord)
          || !smartstoreExactQaRecoveryCandidate({
            channel,
            listingId: String(exactListing.id ?? ""),
            remoteId: String(exactListing.remoteId ?? ""),
            status: String(exactListing.status ?? ""),
            requestedPublicationIntent: String(
              exactListing.requestedPublicationIntent ?? "",
            ),
            remoteVisibility: String(exactListing.remoteVisibility ?? ""),
            providerStatus: typeof exactListing.providerStatus === "string"
              ? exactListing.providerStatus
              : null,
            publishedAt: typeof exactListing.publishedAt === "string"
              ? exactListing.publishedAt
              : null,
            failureClass: typeof exactListing.failureClass === "string"
              ? exactListing.failureClass
              : null,
          })) {
        return NextResponse.json({
          message: "스마트스토어 exact QA 상품의 중앙 SKU·실패 원장 결속이 예상값과 달라 수정하지 않았습니다.",
          mode: "smartstore_exact_qa_recovery_state_mismatch",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      const { data: exactIdentityData, error: exactIdentityError } =
        await serviceClient.rpc(
          "sellerpilot_service_get_smartstore_exact_qa_recovery_identity",
          {
            p_listing_id: resourceListingId,
            p_credential_id: parsed.data.credentialId,
            p_product_id: productId,
            p_market: parsed.data.market,
            p_target_id: parsed.data.targetId,
          },
        );
      if (exactIdentityError
          || !smartstoreExactQaRecoveryBindingValue(exactIdentityData)) {
        return NextResponse.json({
          message: "스마트스토어 exact QA 원상품과 현재 인증정보의 불변 결속을 트랜잭션 원장에서 확인하지 못했습니다.",
          mode: "smartstore_exact_qa_atomic_identity_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundSmartstoreExactQaRecovery = true;
    }
    const exactQoo10LocalizationTarget = operation === "listing.update"
      && qoo10ExactLocalizationRequestCandidateFromLedger({
        channel,
        productId,
        credentialId: parsed.data.credentialId,
        listing: exactListing,
      });
    if (exactQoo10LocalizationTarget) {
      return NextResponse.json({
        message: "Qoo10 기존 작업의 원격 반영 여부가 아직 확정되지 않았습니다. 판매자센터 readback과 부분 반영 reconciliation을 완료하기 전에는 같은 상품 수정을 다시 전송하지 않습니다.",
        mode: "qoo10_exact_partial_manual_reconciliation_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (operation === "listing.update"
        && qoo10RollbackListingUpdateCandidate(channel, listingUpdateReferenceFromLedger(exactListing))) {
      const { data: identityData, error: identityError } = await serviceClient.rpc(
        "sellerpilot_service_get_qoo10_rollback_update_identity",
        {
          p_listing_id: parsed.data.resourceListingId,
          p_credential_id: parsed.data.credentialId,
          p_product_id: productId,
          p_market: parsed.data.market,
          p_target_id: parsed.data.targetId,
        },
      );
      const identity = qoo10RollbackIdentitySchema.safeParse(identityData);
      if (identityError
          || !identity.success
          || identity.data.listingId !== resourceListingId
          || identity.data.remoteId !== requestedRemoteId) {
        return NextResponse.json({
          message: "Qoo10 판매중지 롤백과 원격 상품 결속을 독립 조회로 확정하기 전에는 기존 상품을 수정할 수 없습니다.",
          mode: "qoo10_rollback_identity_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundQoo10RollbackUpdateRecovery = identity.data;
      const exactIdentity = qoo10ExactLocalizationRecoveryIdentity;
      const exactQoo10RollbackLocalizationTarget = productId === exactIdentity.productId
        && resourceListingId === exactIdentity.listingId
        && parsed.data.credentialId === exactIdentity.credentialId
        && requestedRemoteId === exactIdentity.remoteId;
      if (exactQoo10RollbackLocalizationTarget) {
        if (boundListingCurrency !== exactIdentity.currency
            || boundListingPrice !== exactIdentity.priceJpy
            || identity.data.expectedState.sellPriceJpy !== exactIdentity.priceJpy
            || identity.data.expectedState.retailPriceJpy !== exactIdentity.priceJpy
            || identity.data.expectedState.quantity !== exactIdentity.quantity
            || identity.data.expectedState.shippingNo !== exactIdentity.shippingNo) {
          return NextResponse.json({
            message: "Qoo10 exact 상품의 JPY 1,871·재고 1·배송그룹 결속이 원장과 일치하지 않아 현지화 수정을 시작하지 않았습니다.",
            mode: "qoo10_exact_localization_commerce_contract_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        boundQoo10ExactLocalizationUpdate = true;
      }
    }
    if (operation === "listing.update"
        && channel === "elevenst"
        && elevenstExactExistingPublicationCandidate({
          channel,
          listingId: String(exactListing.id ?? ""),
          remoteId: String(exactListing.remoteId ?? ""),
          marketplaceSku: typeof exactListing.marketplaceSku === "string" ? exactListing.marketplaceSku : null,
          status: String(exactListing.status ?? ""),
          requestedPublicationIntent: typeof exactListing.requestedPublicationIntent === "string"
            ? exactListing.requestedPublicationIntent
            : null,
          remoteVisibility: typeof exactListing.remoteVisibility === "string" ? exactListing.remoteVisibility : null,
          providerStatus: typeof exactListing.providerStatus === "string" ? exactListing.providerStatus : null,
          publishedAt: typeof exactListing.publishedAt === "string" ? exactListing.publishedAt : null,
          failureClass: typeof exactListing.failureClass === "string" ? exactListing.failureClass : null,
        })) {
      if (productId !== elevenstExactExistingPublicationIdentity.productId
          || !elevenstExactExistingCentralSkuVerified(contextRecord)
          || !elevenstExactExistingCentralCommerceVerified(contextRecord)
          || boundListingCurrency !== elevenstExactExistingPublicationIdentity.currency
          || boundListingPrice !== elevenstExactExistingPublicationIdentity.priceKrw) {
        return NextResponse.json({
          message: "11번가 기존 QA 상품의 SKU·5,000원·재고 1 결속을 확인하지 못해 수정하지 않았습니다.",
          mode: "elevenst_exact_existing_central_contract_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      boundElevenstExactExistingPublication = true;
      boundExactExistingClosedGateUpdateChannel = "elevenst";
    }
    if (channel === "ebay" && operation === "listing.update") {
      const exactRecovery = ebayExactExistingQaRecoveryCandidate({
        channel,
        listingId: String(exactListing.id ?? ""),
        remoteId: String(exactListing.remoteId ?? ""),
        marketplaceSku: typeof exactListing.marketplaceSku === "string"
          ? exactListing.marketplaceSku
          : null,
        status: String(exactListing.status ?? ""),
        requestedPublicationIntent: typeof exactListing.requestedPublicationIntent === "string"
          ? exactListing.requestedPublicationIntent
          : null,
        remoteVisibility: typeof exactListing.remoteVisibility === "string"
          ? exactListing.remoteVisibility
          : null,
        providerStatus: typeof exactListing.providerStatus === "string"
          ? exactListing.providerStatus
          : null,
        publishedAt: typeof exactListing.publishedAt === "string"
          ? exactListing.publishedAt
          : null,
        failureClass: typeof exactListing.failureClass === "string"
          ? exactListing.failureClass
          : null,
      });
      if (exactRecovery) {
        if (ebayExactExistingQaClientBuyerCopySupplied(parsed.data.arguments)) {
          return NextResponse.json({
            message: "eBay exact QA 상품의 제목·설명은 검증된 공급자 원문을 보존하므로 브라우저 입력값을 받을 수 없습니다.",
            mode: "ebay_exact_existing_provider_copy_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        const { data: identityData, error: identityError } = await serviceClient.rpc(
          "sellerpilot_service_get_ebay_exact_qa_recovery_identity",
          {
            p_listing_id: resourceListingId,
            p_credential_id: parsed.data.credentialId,
            p_product_id: productId,
            p_market: parsed.data.market,
            p_target_id: parsed.data.targetId,
          },
        );
        const binding = ebayExactExistingQaRecoveryBindingValue(identityData);
        if (identityError
            || !binding
            || binding.credentialId !== parsed.data.credentialId
            || productId !== ebayExactExistingQaRecoveryIdentity.productId
            || requestedRemoteId !== ebayExactExistingQaRecoveryIdentity.publicListingId
            || boundListingCurrency !== ebayExactExistingQaRecoveryIdentity.currency
            || boundListingPrice !== ebayExactExistingQaRecoveryIdentity.priceUsd
            || !ebayExactExistingQaCentralProductVerified(contextRecord, binding)) {
          return NextResponse.json({
            message: "eBay exact QA 상품·SKU·USD 12.90·재고·인증정보 결속을 원장에서 확정하지 못했습니다.",
            mode: "ebay_exact_existing_atomic_identity_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        boundEbayExactExistingQaRecovery = binding;
        boundEbayExactNoEffectRetry = exactListing.failureClass === "retryable";
        boundExactExistingClosedGateUpdateChannel = "ebay";
      } else {
        const { data: identityData, error: identityError } = await serviceClient.rpc(
          "sellerpilot_service_get_ebay_listing_update_identity",
          {
            p_listing_id: resourceListingId,
            p_credential_id: parsed.data.credentialId,
            p_product_id: productId,
            p_market: parsed.data.market,
            p_target_id: parsed.data.targetId,
          },
        );
        const identity = isRecord(identityData) ? identityData : null;
        const offerId = typeof identity?.offerId === "string" ? identity.offerId.trim() : "";
        const sku = typeof identity?.sku === "string" ? identity.sku.trim() : "";
        const listingId = typeof identity?.listingId === "string" ? identity.listingId.trim() : "";
        const marketplaceId = typeof identity?.marketplaceId === "string"
          ? identity.marketplaceId.trim().toUpperCase()
          : "";
        if (identityError
            || identity?.status !== "allowed"
            || identity.contract !== "ebay_listing_identity_v1"
            || !offerId
            || !sku
            || listingId !== requestedRemoteId
            || marketplaceId !== parsed.data.targetId.toUpperCase()) {
          return NextResponse.json({
            message: "eBay offer·SKU·listing·마켓 결속을 독립 조회로 확정하기 전에는 기존 상품을 수정할 수 없습니다.",
            mode: "ebay_immutable_identity_required",
          }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
        }
        boundEbayListingIdentity = { offerId, sku, listingId, marketplaceId };
      }
    }
  }

  const environment = "environment" in credentialMetadata && credentialMetadata.environment === "sandbox" ? "sandbox" : "production";
  const operationRelease = channelOperationRelease(channel, operation, environment);
  if (!operationRelease.available) {
    return NextResponse.json({
      message: operationRelease.reason,
      mode: operationRelease.mode,
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const providerMutationStaticEgressChannel = writeChannelOperations.has(operation)
    && (channel === "coupang" || channel === "elevenst")
    ? channel
    : null;
  if (providerMutationStaticEgressChannel) {
    const [staticEgressStatus, runtimeStatus] = await Promise.all([
      serviceClient.rpc("sellerpilot_service_serverless_static_egress_status"),
      serviceClient.rpc("sellerpilot_service_serverless_cs_wakeup_status"),
    ]);
    const databasePolicy = staticEgressStatus.data
      && typeof staticEgressStatus.data === "object"
      && !Array.isArray(staticEgressStatus.data)
      ? staticEgressStatus.data as Record<string, unknown>
      : {};
    const runtimeState = runtimeStatus.data
      && typeof runtimeStatus.data === "object"
      && !Array.isArray(runtimeStatus.data)
      ? runtimeStatus.data as Record<string, unknown>
      : {};
    const environmentReady = hasServerlessStaticEgressFor(
      configuredServerlessStaticEgressChannels(),
      [providerMutationStaticEgressChannel],
    );
    const channelName = providerMutationStaticEgressChannel === "coupang"
      ? "쿠팡"
      : "11번가";
    if (!environmentReady
        || staticEgressStatus.error
        || databasePolicy[providerMutationStaticEgressChannel] !== true) {
      return NextResponse.json({
        ok: false,
        manualRequired: true,
        externalActionRequired: true,
        staticEgressReady: false,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
        mode: "static_egress_required",
        message: `${channelName}에 승인된 고정 egress IP와 서버 정책을 활성화한 뒤 외부 변경 작업을 다시 시도해 주세요.`,
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const runtimeRelease = resolveRuntimeReleaseIdentity();
    const activeRuntimeRelease = typeof runtimeState.activeRelease === "string"
      ? runtimeState.activeRelease.trim().toLowerCase()
      : "";
    if (runtimeStatus.error
        || runtimeState.configured !== true
        || runtimeState.active !== true
        || runtimeRelease.status !== "valid"
        || activeRuntimeRelease !== runtimeRelease.release) {
      return NextResponse.json({
        ok: false,
        operatorActionRequired: true,
        workerReady: false,
        blockedReason: "SERVERLESS_WORKER_REQUIRED",
        mode: "serverless_worker_required",
        message: `${channelName} 외부 변경 작업자가 현재 배포 릴리스에서 활성 상태가 아니어서 작업을 대기열에 넣지 않았습니다.`,
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  if (channel === "smartstore") {
    const [staticEgressStatus, runtimeStatus] = await Promise.all([
      serviceClient.rpc("sellerpilot_service_serverless_static_egress_status"),
      serviceClient.rpc("sellerpilot_service_serverless_cs_wakeup_status"),
    ]);
    const databasePolicy = staticEgressStatus.data
      && typeof staticEgressStatus.data === "object"
      && !Array.isArray(staticEgressStatus.data)
      ? staticEgressStatus.data as Record<string, unknown>
      : {};
    const runtimeState = runtimeStatus.data
      && typeof runtimeStatus.data === "object"
      && !Array.isArray(runtimeStatus.data)
      ? runtimeStatus.data as Record<string, unknown>
      : {};
    const environmentReady = hasServerlessStaticEgressFor(
      configuredServerlessStaticEgressChannels(),
      ["smartstore"],
    );
    if (!environmentReady || staticEgressStatus.error || databasePolicy.smartstore !== true) {
      return NextResponse.json({
        ok: false,
        manualRequired: true,
        externalActionRequired: true,
        staticEgressReady: false,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
        mode: "static_egress_required",
        message: "네이버 커머스API에 등록된 Vercel 고정 egress IP와 서버 정책을 확인한 뒤 스마트스토어 작업을 다시 시도해 주세요.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (runtimeStatus.error || runtimeState.configured !== true || runtimeState.active !== true) {
      return NextResponse.json({
        ok: false,
        operatorActionRequired: true,
        workerReady: false,
        blockedReason: "SERVERLESS_WORKER_REQUIRED",
        mode: "serverless_worker_required",
        message: "스마트스토어 작업자가 활성 상태가 아니어서 작업을 대기열에 넣지 않았습니다.",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  if (channel === "ebay" && operation === "listing.create") {
    const missingConfiguration = missingEbayListingCreateConfiguration(parsed.data.arguments);
    if (missingConfiguration.length) {
      return NextResponse.json({
        ok: false,
        manualRequired: true,
        externalActionRequired: true,
        mode: "ebay_listing_configuration_required",
        missingConfiguration,
        message: "eBay 마켓과 Seller Hub에서 확인한 배송·결제·반품 정책 ID, 재고 위치 키를 명시적으로 입력한 뒤 다시 시도해 주세요.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  const staticEgressChannel = channel === "shopee"
    ? "shopee"
    : channel === "temu" && [
        "listing.create",
        "listing.stop",
        "listing.activate",
        "listing.publication.verify",
      ].includes(operation)
      ? "temu"
      : null;
  if (staticEgressChannel) {
    const [staticEgressStatus, runtimeStatus] = await Promise.all([
      serviceClient.rpc("sellerpilot_service_serverless_static_egress_status"),
      serviceClient.rpc("sellerpilot_service_serverless_cs_wakeup_status"),
    ]);
    const databasePolicy = staticEgressStatus.data
      && typeof staticEgressStatus.data === "object"
      && !Array.isArray(staticEgressStatus.data)
      ? staticEgressStatus.data as Record<string, unknown>
      : {};
    const runtimeState = runtimeStatus.data
      && typeof runtimeStatus.data === "object"
      && !Array.isArray(runtimeStatus.data)
      ? runtimeStatus.data as Record<string, unknown>
      : {};
    const environmentReady = hasServerlessStaticEgressFor(
      configuredServerlessStaticEgressChannels(),
      [staticEgressChannel],
    );
    if (!environmentReady
        || staticEgressStatus.error
        || databasePolicy[staticEgressChannel] !== true) {
      const channelName = staticEgressChannel === "shopee" ? "Shopee" : "Temu";
      return NextResponse.json({
        ok: false,
        manualRequired: true,
        externalActionRequired: true,
        staticEgressReady: false,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
        mode: "static_egress_required",
        message: `${channelName}에 승인된 고정 egress IP와 서버 정책을 활성화한 뒤 상품 작업을 다시 시도해 주세요.`,
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (runtimeStatus.error || runtimeState.configured !== true || runtimeState.active !== true) {
      const channelName = staticEgressChannel === "shopee" ? "Shopee" : "Temu";
      return NextResponse.json({
        ok: false,
        operatorActionRequired: true,
        workerReady: false,
        blockedReason: "SERVERLESS_WORKER_REQUIRED",
        mode: "serverless_worker_required",
        message: `${channelName} 상품 작업자가 활성 상태가 아니어서 작업을 대기열에 넣지 않았습니다.`,
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  // This marker is a server-owned capability. Always remove the browser value
  // and recreate it only from the exact rollback identity RPC above.
  let effectiveArguments = structuredClone(
    temuActivationSourceArguments ?? parsed.data.arguments,
  );
  delete effectiveArguments[qoo10RollbackUpdateRecoveryArgument];
  delete effectiveArguments[qoo10ExactLocalizationUpdateArgument];
  delete effectiveArguments[coupangExactQaRecoveryArgument];
  delete effectiveArguments[elevenstExactExistingPublicationArgument];
  delete effectiveArguments[smartstoreExactQaRecoveryArgument];
  delete effectiveArguments[ebayExactExistingQaRecoveryArgument];
  delete effectiveArguments[ebayExactNoEffectRetryArgument];
  if (boundQoo10RollbackUpdateRecovery) {
    effectiveArguments = bindQoo10RollbackUpdateRecoveryArguments(
      effectiveArguments,
      {
        ...boundQoo10RollbackUpdateRecovery,
        contract: qoo10RollbackUpdateRecoveryContract,
      },
    );
  }
  if (boundQoo10ExactLocalizationUpdate) {
    const runtimeRelease = resolveRuntimeReleaseIdentity();
    if (runtimeRelease.status !== "valid") {
      return NextResponse.json({
        message: "Qoo10 exact 현지화 요청을 현재 서버 릴리스에 결속하지 못해 시작하지 않았습니다.",
        mode: "qoo10_exact_localization_release_required",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    effectiveArguments = bindQoo10ExactLocalizationUpdateArguments(
      effectiveArguments,
      runtimeRelease.release,
    );
  }
  if (boundCoupangExactQaRecoveryPhase) {
    effectiveArguments = bindCoupangExactQaRecoveryArguments(
      effectiveArguments,
      boundCoupangExactQaRecoveryPhase,
    );
    if (boundCoupangExactQaRecoveryPhase === "listing.update") {
      effectiveArguments = bindCoupangExactQaUpdateItemIdentity(effectiveArguments);
    }
    if (boundCoupangExactQaRecoveryPhase === "listing.stop") {
      effectiveArguments = {
        ...effectiveArguments,
        sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
        vendorItemId: coupangExactQaRecoveryIdentity.vendorItemId,
        sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
      };
    }
  }
  if (boundSmartstoreExactQaRecovery) {
    effectiveArguments = bindSmartstoreExactQaRecoveryArguments(
      effectiveArguments,
    );
  }
  if (boundLazadaExactLiveUpdate) {
    effectiveArguments = {
      ...effectiveArguments,
      sellerpilotExpectedSellerId: parsed.data.targetId,
    };
  }
  if (channel === "ebay" && operation === "listing.update") {
    if (boundEbayExactExistingQaRecovery) {
      effectiveArguments = bindEbayExactExistingQaRecoveryArguments(
        effectiveArguments,
        boundEbayExactExistingQaRecovery,
      );
      if (boundEbayExactNoEffectRetry) {
        effectiveArguments = bindEbayExactNoEffectRetryArguments(
          effectiveArguments,
        );
      }
    } else if (boundEbayListingIdentity) {
      effectiveArguments = {
        ...effectiveArguments,
        ...boundEbayListingIdentity,
      };
    } else {
      return NextResponse.json({
        message: "eBay 불변 원격 식별값을 확인하지 못해 상품 수정을 시작하지 않았습니다.",
        mode: "ebay_immutable_identity_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  if (channel === "temu" && (operation === "listing.stop" || operation === "listing.activate")) {
    if (!boundTemuListingIdentity) {
      return NextResponse.json({
        message: "Temu 상품의 불변 원격 식별값을 확인하지 못해 판매 중지를 시작하지 않았습니다.",
        mode: "temu_immutable_identity_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    effectiveArguments = {
      ...effectiveArguments,
      ...boundTemuListingIdentity,
    };
  }
  if (channel === "elevenst" && operation === "listing.update") {
    const productNo = listingUpdateRemoteIdentity(channel, parsed.data.arguments);
    const { data: snapshotData, error: snapshotError } = await serviceClient.rpc(
      "sellerpilot_service_get_elevenst_listing_snapshot",
      {
        p_listing_id: parsed.data.resourceListingId!,
        p_credential_id: parsed.data.credentialId,
        p_remote_id: productNo,
      },
    );
    const snapshot = snapshotData && typeof snapshotData === "object" && !Array.isArray(snapshotData)
      ? snapshotData as Record<string, unknown>
      : null;
    if (snapshotError || !snapshot || !snapshot.product) {
      return NextResponse.json({
        message: "11번가 최초 등록 원본을 검증할 수 없어 전체 상품 XML을 임의로 재구성하지 않았습니다.",
        mode: "elevenst_update_snapshot_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    try {
      const requestedPatch = isRecord(parsed.data.arguments.productPatch)
        ? parsed.data.arguments.productPatch
        : {};
      let productPatch: Record<string, unknown> = structuredClone(requestedPatch);
      let product: Record<string, unknown>;
      let snapshotDigestInput: string;
      if (boundElevenstExactExistingPublication) {
        const { selPrc, prdSelQty, ...genericPatch } = requestedPatch;
        if (String(selPrc ?? "").trim() !== String(elevenstExactExistingPublicationIdentity.priceKrw)
            || String(prdSelQty ?? "").trim() !== String(elevenstExactExistingPublicationIdentity.stock)) {
          throw new Error("ELEVENST_EXACT_EXISTING_COMMERCE_VALUES_REQUIRED");
        }
        const genericProduct = mergeElevenstListingUpdateProduct(snapshot.product, genericPatch);
        productPatch = {
          ...genericPatch,
          selPrc: String(elevenstExactExistingPublicationIdentity.priceKrw),
          prdSelQty: String(elevenstExactExistingPublicationIdentity.stock),
        };
        product = validateElevenstListingProduct({ ...genericProduct, ...productPatch });
        snapshotDigestInput = elevenstExactExistingUpdateProjectionDigestInput(snapshot.product);
      } else {
        product = mergeElevenstListingUpdateProduct(snapshot.product, requestedPatch);
        snapshotDigestInput = elevenstListingUpdateProjectionDigestInput(snapshot.product);
      }
      const sellerpilotSnapshotMutableFingerprint = createHash("sha256")
        .update(snapshotDigestInput)
        .digest("hex");
      effectiveArguments = {
        ...(parsed.data.arguments.sellerpilotAssets === undefined
          ? {}
          : { sellerpilotAssets: structuredClone(parsed.data.arguments.sellerpilotAssets) }),
        productNo,
        productPatch,
        product,
        sellerpilotSnapshotMutableFingerprint,
      };
      if (boundElevenstExactExistingPublication) {
        effectiveArguments = bindElevenstExactExistingPublication(effectiveArguments);
      }
    } catch {
      return NextResponse.json({
        message: "11번가에서 안전하게 수정할 수 있는 상품명·설명·필수정보·이미지 값만 입력해 주세요.",
        mode: "elevenst_update_patch_invalid",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  if (contentBoundListingOperation) {
    if (!approvedDetailBinding) {
      return NextResponse.json({
        message: "승인된 상세페이지 이미지 결속을 확인하지 못해 판매채널 전송을 시작하지 않았습니다.",
        mode: "approved_detail_image_manifest_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    try {
      effectiveArguments = bindMarketplaceArgumentsToApprovedDetailManifest(
        effectiveArguments,
        approvedDetailBinding,
        approvedDetailSignedUrls,
      );
    } catch {
      return NextResponse.json({
        message: "현지화 상세정보를 승인된 상세 이미지 8장과 안전하게 결속하지 못해 판매채널 전송을 시작하지 않았습니다.",
        mode: "approved_detail_image_binding_invalid",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  if (boundSmartstoreExactQaRecovery) {
    const bucket = serviceClient.storage.from("sellerpilot-ai");
    const representative = await bindSmartstoreExactQaRepresentativeFromStorage({
      argumentsValue: effectiveArguments,
      generatedImagePaths: verifiedPublishContext?.generatedImagePaths,
      storage: {
        download: (path) => bucket.download(path),
        createSignedUrl: (path, expiresIn) => bucket.createSignedUrl(path, expiresIn),
      },
    });
    if (!representative.ok) {
      return NextResponse.json({
        message: "스마트스토어 대표 이미지 1장을 현재 상품 원장의 승인된 square 원본과 결속하지 못해 전송을 시작하지 않았습니다.",
        mode: "smartstore_exact_qa_representative_required",
        reasonCode: representative.code,
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    effectiveArguments = representative.argumentsValue;
  }
  if (channel === "temu" && operation === "listing.create") {
    const product = isRecord(verifiedPublishContext?.product)
      ? verifiedPublishContext.product
      : {};
    const manualFields = isRecord(verifiedPublishContext?.manualFields)
      ? verifiedPublishContext.manualFields
      : {};
    const canonicalSellerSku = typeof manualFields.sellerSku === "string" && manualFields.sellerSku.trim()
      ? manualFields.sellerSku.trim()
      : typeof product.sku === "string"
        ? product.sku.trim()
        : "";
    try {
      effectiveArguments = bindTemuCreateAttemptIdentity({
        argumentsValue: effectiveArguments,
        productId: parsed.data.productId!,
        canonicalSellerSku,
        market: parsed.data.market,
        targetId: parsed.data.targetId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
    } catch {
      return NextResponse.json({
        message: "Temu 외부 상품·SKU 식별자가 선택 상품의 확정 SKU 및 현재 작업 계보와 일치하지 않아 등록을 시작하지 않았습니다.",
        mode: "temu_create_identity_mismatch",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  const effectivePublicationIntent = operation === "listing.create"
    ? parsed.data.publicationIntent ?? "safe_test"
    : operation === "listing.update"
      ? boundListingPublicationIntent
      : operation === "listing.activate"
        ? "live" as const
      : undefined;
  const expectedPublicationLocale = listingOperationRequiresVerifiedRemoteState(operation)
    ? listingExpectedPublicationLocale(channel, parsed.data.market)
    : undefined;
  if (listingOperationRequiresVerifiedRemoteState(operation) && !expectedPublicationLocale) {
    return NextResponse.json({
      message: "판매채널 대상 국가의 게시 언어를 서버에서 확정하지 못해 상품 작업을 차단했습니다.",
      mode: "listing_publication_locale_unverified",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const expectedPublicationImageCount = operation === "listing.create"
    || operation === "listing.update"
    || operation === "listing.activate"
    ? marketplaceChannelDetailImageCount
    : 0;
  if (listingOperationRequiresVerifiedRemoteState(operation)) {
    effectiveArguments = {
      ...effectiveArguments,
      publicationStateContract: listingRemoteStateContractVersion,
      ...(listingOperationUsesPublicationIntent(operation)
        ? { publicationIntent: effectivePublicationIntent }
        : {}),
      publicationExpectedLocale: expectedPublicationLocale,
      publicationExpectedImageCount: expectedPublicationImageCount,
    };
    if (!listingOperationUsesPublicationIntent(operation)) {
      delete effectiveArguments.publicationIntent;
    }
  } else if (Object.hasOwn(effectiveArguments, "publicationIntent")
      || Object.hasOwn(effectiveArguments, "publicationStateContract")) {
    effectiveArguments = { ...effectiveArguments };
    delete effectiveArguments.publicationIntent;
    delete effectiveArguments.publicationStateContract;
  }
  if (boundEbayExactExistingQaRecovery) {
    try {
      assertEbayExactExistingQaProviderCopyRequest(effectiveArguments, {
        requirePreparedImages: false,
      });
    } catch {
      return NextResponse.json({
        message: "eBay exact QA 수정값은 en-US 제목·상세 8장·USD 12.90·중앙 재고·live 상태 계약과 정확히 일치해야 합니다.",
        mode: "ebay_exact_existing_content_contract_required",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  let effectiveCurrency = boundListingCurrency ?? parsed.data.currency;
  let effectivePrice = boundListingPrice ?? parsed.data.price;
  const strictShopeeSgCreate = channel === "shopee"
    && operation === "listing.create"
    && parsed.data.market.trim().toUpperCase() === "SG";
  if (strictShopeeSgCreate) {
    let rate;
    try {
      rate = await loadAuthoritativeKrwSgdUsdRate({ signal: request.signal });
    } catch {
      return NextResponse.json({
        message: "Shopee Singapore 등록 시점의 KRW→SGD 환율을 독립 확인하지 못해 원격 등록을 시작하지 않았습니다.",
        mode: "shopee_sg_exchange_rate_unavailable",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const createContext = buildShopeeSgListingCreateContext({
      productId: parsed.data.productId,
      product: verifiedPublishContext?.product,
      manualFields: verifiedPublishContext?.manualFields,
      assignments: verifiedPublishContext?.assignments,
      market: parsed.data.market,
      targetId: parsed.data.targetId,
      currency: "SGD",
      rate,
    });
    if (!createContext) {
      return NextResponse.json({
        message: "Shopee Singapore 상품의 확정 카테고리·SKU·5,000 KRW 원가·재고·SGD 환율 결속을 서버에서 확정하지 못해 원격 등록을 시작하지 않았습니다.",
        mode: "shopee_sg_listing_create_context_invalid",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    effectiveCurrency = createContext.targetCurrency;
    effectivePrice = createContext.targetPriceSgd;
    effectiveArguments = bindShopeeSgListingCreateArguments(effectiveArguments, createContext);
  }
  if (channel === "qoo10" && operation === "listing.create") {
    const qoo10CreateContext = buildQoo10ListingCreateContext({
      productId: parsed.data.productId,
      product: verifiedPublishContext?.product,
      manualFields: verifiedPublishContext?.manualFields,
      market: parsed.data.market,
      currency: effectiveCurrency,
      price: effectivePrice,
    });
    if (!qoo10CreateContext) {
      return NextResponse.json({
        message: "Qoo10 Japan 상품의 상품·SKU·JPY 가격·재고 결속을 서버에서 확정하지 못해 원격 등록을 시작하지 않았습니다.",
        mode: "qoo10_listing_create_context_invalid",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    effectiveArguments = {
      ...effectiveArguments,
      sellerpilotQoo10CreateContext: qoo10CreateContext,
    };
  }
  const manifestFingerprintArguments = approvedDetailBinding
    ? marketplaceArgumentsForApprovedDetailFingerprint(effectiveArguments, approvedDetailBinding)
    : effectiveArguments;
  const fingerprintArguments = strictShopeeSgCreate
    ? shopeeSgArgumentsForFingerprint(manifestFingerprintArguments)
    : manifestFingerprintArguments;
  const requestFingerprint = createHash("sha256")
    .update(canonicalJson({
      channel,
      operation,
      environment,
      productId: parsed.data.productId ?? null,
      resourceListingId: parsed.data.resourceListingId ?? null,
      inventoryItemId: parsed.data.inventoryItemId ?? null,
      orderId: parsed.data.orderId ?? null,
      shipmentCarrier: parsed.data.shipmentCarrier ?? null,
      shipmentTracking: parsed.data.shipmentTracking ?? null,
      currency: effectiveCurrency ?? null,
      price: effectivePrice ?? null,
      market: parsed.data.market,
      targetId: parsed.data.targetId,
      arguments: fingerprintArguments,
    }))
    .digest("hex");
  if (listingOperationRequiresVerifiedRemoteState(operation)) {
    // Bind the provider readback to the exact normalized request without
    // creating a circular hash input (the digest itself is appended after the
    // canonical request fingerprint has been computed).
    effectiveArguments = {
      ...effectiveArguments,
      publicationExpectedFingerprint: requestFingerprint,
    };
  }
  if (listingOperationRequiresVerifiedRemoteState(operation)) {
    const { data: releaseGateStatus, error: releaseGateError } = await serviceClient.rpc(
      "sellerpilot_service_listing_mutation_release_gate_status",
    );
    const runtimeRelease = resolveRuntimeReleaseIdentity();
    const globalReleaseGateIsExact = !releaseGateError
      && isRecord(releaseGateStatus)
      && releaseGateStatus.contract === "verified_publication_release_gate_v1"
      && typeof releaseGateStatus.effectiveOpen === "boolean"
      && releaseGateStatus.open === true
      && releaseGateStatus.state === "open"
      && releaseGateStatus.openedChannel === null
      && runtimeRelease.status === "valid"
      && releaseGateStatus.openedRelease === runtimeRelease.release
      && releaseGateStatus.attestedRelease === runtimeRelease.release
      && releaseGateStatus.activeRuntimeRelease === runtimeRelease.release;
    const qoo10ScopedReleaseGateIsExact = !releaseGateError
      && isRecord(releaseGateStatus)
      && releaseGateStatus.contract === "verified_publication_release_gate_v1"
      && typeof releaseGateStatus.qoo10EffectiveOpen === "boolean"
      && releaseGateStatus.open === true
      && releaseGateStatus.state === "open"
      && releaseGateStatus.openedChannel === "qoo10"
      && runtimeRelease.status === "valid"
      && releaseGateStatus.openedRelease === runtimeRelease.release
      && releaseGateStatus.qoo10AttestedRelease === runtimeRelease.release
      && releaseGateStatus.activeRuntimeRelease === runtimeRelease.release;
    const closedReleaseGateIsExact = !releaseGateError
      && isRecord(releaseGateStatus)
      && releaseGateStatus.contract === "verified_publication_release_gate_v1"
      && releaseGateStatus.open === false
      && releaseGateStatus.state === "closed"
      && releaseGateStatus.openedChannel === null;
    const releaseGateStateIsExact = globalReleaseGateIsExact
      || qoo10ScopedReleaseGateIsExact
      || closedReleaseGateIsExact;
    if (!releaseGateStateIsExact) {
      return NextResponse.json({
        message: "상품 게시 릴리스 게이트 상태를 확인하지 못해 판매채널 작업을 차단했습니다.",
        mode: "listing_mutation_release_gate_unavailable",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (boundQoo10ExactLocalizationUpdate && closedReleaseGateIsExact) {
      if (runtimeRelease.status !== "valid") {
        return NextResponse.json({
          message: "Qoo10 exact 현지화 갱신을 현재 서버 릴리스에 결속하지 못했습니다.",
          mode: "qoo10_exact_localization_release_required",
        }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
      }
      const { data: permitData, error: permitError } = await serviceClient.rpc(
        "sellerpilot_service_arm_exact_qoo10_localization_update",
        {
          p_listing_id: parsed.data.resourceListingId,
          p_credential_id: parsed.data.credentialId,
          p_release_sha: runtimeRelease.release,
          p_request_fingerprint: requestFingerprint,
        },
      );
      qoo10ExactLocalizationUpdatePermitArmed = !permitError
        && isRecord(permitData)
        && permitData.contract === "qoo10_exact_localization_update_permit_v2"
        && permitData.listingId === parsed.data.resourceListingId
        && permitData.releaseSha === runtimeRelease.release
        && permitData.requestFingerprint === requestFingerprint
        && permitData.bound === false;
      if (!qoo10ExactLocalizationUpdatePermitArmed) {
        return NextResponse.json({
          message: "Qoo10 exact 일본어 갱신의 일회성 허가를 만들지 못해 원격 호출을 시작하지 않았습니다.",
          mode: "qoo10_exact_localization_update_permit_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
    }
    if (boundSmartstoreExactQaRecovery && closedReleaseGateIsExact) {
      if (runtimeRelease.status !== "valid") {
        return NextResponse.json({
          message: "스마트스토어 exact QA 갱신을 현재 서버 릴리스에 결속하지 못했습니다.",
          mode: "smartstore_exact_qa_update_release_required",
        }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
      }
      const { data: permitData, error: permitError } = await serviceClient.rpc(
        "sellerpilot_service_arm_exact_smartstore_qa_update",
        {
          p_listing_id: parsed.data.resourceListingId,
          p_credential_id: parsed.data.credentialId,
          p_release_sha: runtimeRelease.release,
          p_request_fingerprint: requestFingerprint,
        },
      );
      smartstoreExactQaUpdatePermitArmed = !permitError
        && isRecord(permitData)
        && permitData.contract === "smartstore_exact_qa_update_permit_v1"
        && permitData.listingId === parsed.data.resourceListingId
        && permitData.releaseSha === runtimeRelease.release
        && permitData.requestFingerprint === requestFingerprint
        && permitData.bound === false;
      if (!smartstoreExactQaUpdatePermitArmed) {
        return NextResponse.json({
          message: "스마트스토어 exact QA 갱신의 일회성 허가를 만들지 못해 원격 호출을 시작하지 않았습니다.",
          mode: "smartstore_exact_qa_update_permit_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
    }
    if (boundExactExistingClosedGateUpdateChannel && closedReleaseGateIsExact) {
      if (runtimeRelease.status !== "valid") {
        return NextResponse.json({
          message: "기존 exact 상품 수정을 현재 서버 릴리스에 결속하지 못했습니다.",
          mode: "exact_existing_update_release_required",
        }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
      }
      const { data: permitData, error: permitError } = await serviceClient.rpc(
        boundEbayExactNoEffectRetry
          ? "sellerpilot_service_arm_ebay_no_effect_retry"
          : "sellerpilot_service_arm_exact_existing_update",
        {
          p_channel: boundExactExistingClosedGateUpdateChannel,
          p_listing_id: parsed.data.resourceListingId,
          p_credential_id: parsed.data.credentialId,
          p_release_sha: runtimeRelease.release,
          p_request_fingerprint: requestFingerprint,
        },
      );
      exactExistingUpdatePermitArmed = !permitError
        && isRecord(permitData)
        && permitData.contract === "exact_existing_update_permit_v1"
        && permitData.channel === boundExactExistingClosedGateUpdateChannel
        && permitData.listingId === parsed.data.resourceListingId
        && permitData.releaseSha === runtimeRelease.release
        && permitData.requestFingerprint === requestFingerprint
        && permitData.bound === false;
      if (!exactExistingUpdatePermitArmed) {
        return NextResponse.json({
          message: "기존 exact 상품 수정의 일회성 허가를 만들지 못해 원격 호출을 시작하지 않았습니다.",
          mode: "exact_existing_update_permit_required",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
    }
    const channelReleaseGateIsEffective = verifiedPublicationReleaseChannels.has(channel)
      && (globalReleaseGateIsExact
        ? releaseGateStatus.effectiveOpen === true
        : channel === "qoo10"
          && qoo10ScopedReleaseGateIsExact
          && releaseGateStatus.qoo10EffectiveOpen === true);
    if (!channelReleaseGateIsEffective
        && !qoo10ExactLocalizationUpdatePermitArmed
        && !smartstoreExactQaUpdatePermitArmed
        && !exactExistingUpdatePermitArmed) {
      return NextResponse.json({
        message: "판매채널 상품 작업은 채널별 원격 검증이 완료될 때까지 일시 중지되어 있습니다.",
        mode: "listing_mutation_release_gate_closed",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  const { data: claimData, error: claimError } = await userClient.rpc("sellerpilot_claim_channel_operation", {
    p_credential_id: parsed.data.credentialId,
    p_channel: channel,
    p_operation: operation,
    p_idempotency_key: channel === "temu" && operation === "listing.activate"
      ? temuActivationClaimIdempotencyKey!
      : parsed.data.idempotencyKey,
    p_request_fingerprint: requestFingerprint,
  });
  if (claimError || !claimData || typeof claimData !== "object" || Array.isArray(claimData)) {
    return NextResponse.json({ message: "중복 방지 작업을 생성하지 못했습니다. 같은 키에 다른 요청을 사용했는지 확인해 주세요." }, { status: 409 });
  }
  const claim = claimData as Record<string, unknown>;
  const attemptId = typeof claim.attempt_id === "string" ? claim.attempt_id : "";
  if (!attemptId) return NextResponse.json({ message: "작업 추적 ID를 만들지 못했습니다." }, { status: 500 });
  if (claim.duplicate === true) {
    const duplicateRemoteId = typeof claim.remote_id === "string" ? claim.remote_id : undefined;
    const duplicateMessage = typeof claim.safe_message === "string" ? claim.safe_message : "같은 작업이 이미 완료됐습니다.";
    if (claim.status === "succeeded") {
      const duplicateListingId = parsed.data.resourceListingId
        ?? await findProductListingId(duplicateRemoteId);
      const persistedPublicationReplay = listingOperationRequiresVerifiedRemoteState(operation)
        ? persistedListingPublicationReplay(
            operation,
            claim.publication_intent,
            claim.remote_state,
            effectivePublicationIntent,
          )
        : null;
      const publicationReplay = persistedPublicationReplay?.status === "verified"
        ? verifiedListingPublicationResult(
            operation,
            {
              publicationStateContract: listingRemoteStateContractVersion,
              ...(persistedPublicationReplay.publicationIntent
                ? { publicationIntent: persistedPublicationReplay.publicationIntent }
                : {}),
              remoteState: persistedPublicationReplay.remoteState,
              publicationFulfilled: persistedPublicationReplay.publicationFulfilled,
              remoteId: duplicateRemoteId,
            },
            effectivePublicationIntent,
            {
              locale: expectedPublicationLocale,
              fingerprint: requestFingerprint,
              minimumImageCount: expectedPublicationImageCount,
            },
          )
        : persistedPublicationReplay;
      if (publicationReplay?.status === "invalid") {
        return NextResponse.json({
          ok: false,
          duplicate: true,
          manualRequired: true,
          reconciliationRequired: true,
          attemptId,
          remoteId: duplicateRemoteId,
          listingId: duplicateListingId || undefined,
          legacyPublicationResult: claim.legacy_publication_result === true,
          message: "이미 처리된 상품 작업의 원격 게시 상태를 검증할 수 없습니다. 판매자센터에서 상태를 확인하기 전에는 성공으로 처리하지 않습니다.",
          mode: "listing_remote_state_unverified",
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      // Gateway completion already owns the attempt + listing transaction.
      // Replaying a legacy listing completion here could overwrite a newer
      // active attempt (for example, an update replay while stop is running).
      const publicationPending = publicationReplay?.status === "verified"
        && publicationReplay.publicationFulfilled === false;
      return NextResponse.json({
        ok: true,
        duplicate: true,
        ...(publicationPending ? { publicationPending: true } : {}),
        message: "이미 성공한 동일 작업을 다시 호출하지 않고 기존 결과를 반환했습니다.",
        safeMessage: duplicateMessage,
        remoteId: duplicateRemoteId,
        attemptId,
        listingId: duplicateListingId || undefined,
        ...(publicationReplay?.status === "verified"
          ? {
              ...(publicationReplay.publicationIntent
                ? { publicationIntent: publicationReplay.publicationIntent }
                : {}),
              remoteState: publicationReplay.remoteState,
              publicationFulfilled: publicationReplay.publicationFulfilled,
            }
          : {}),
      }, {
        status: publicationPending ? 202 : 200,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    if (claim.status === "running") {
      const activeListingId = parsed.data.resourceListingId ?? await findProductListingId();
      return NextResponse.json({
        ok: false,
        inProgress: true,
        reconciliationRequired: false,
        attemptId,
        listingId: activeListingId || undefined,
        message: "같은 판매채널 작업이 이미 진행 중입니다. 기존 작업 결과가 확정될 때까지 새 원격 호출을 실행하지 않았습니다.",
      }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (claim.status === "manual_required") {
      const reconciliationRequired = duplicateMessage.includes("수동 확인")
        || duplicateMessage.includes("provider outcome requires reconciliation");
      return NextResponse.json({
        ok: false,
        inProgress: false,
        manualRequired: true,
        reconciliationRequired,
        attemptId,
        message: duplicateMessage,
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    return NextResponse.json({
      message: "같은 작업이 이미 접수됐습니다. 외부 상품·주문 중복 처리를 막기 위해 다시 실행하지 않았습니다.",
      attemptId,
      status: claim.status,
    }, { status: 409 });
  }

  let listingId = "";
  if (parsed.data.productId && ["listing.create", "listing.update", "listing.stop", "listing.activate"].includes(operation)) {
    if (operation !== "listing.create") {
      listingId = parsed.data.resourceListingId!;
    }
  }

  const completeListing = async (input: { success: boolean; remoteId?: string; publicUrl?: string; safeMessage: string }) => {
    if (!listingId) return true;
    const { data, error } = await serviceClient.rpc("sellerpilot_service_complete_product_listing", {
      p_listing_id: listingId,
      p_attempt_id: attemptId,
      p_operation: operation,
      p_success: input.success,
      p_remote_id: input.remoteId ?? null,
      p_safe_message: input.safeMessage,
    });
    if (error || data !== true) return false;
    if (input.success && input.publicUrl) {
      const { data: publicUrlStored, error: publicUrlError } = await serviceClient.rpc("sellerpilot_service_set_listing_public_url", {
        p_listing_id: listingId,
        p_public_url: input.publicUrl,
      });
      if (publicUrlError || publicUrlStored !== true) return false;
    }
    return true;
  };

  const rejectBlockedCategory = async (code: string) => {
    if (!parsed.data.productId) return;
    await serviceClient.rpc("sellerpilot_service_reject_category_assignment", {
      p_product_id: parsed.data.productId,
      p_channel: channel,
      p_market: parsed.data.market,
      p_reason_code: code,
    });
  };

  const listingGatewayOperation = ["listing.create", "listing.update", "listing.stop", "listing.activate"].includes(operation);
  const usesChannelGateway = channel === "ebay"
    || channel === "shopee"
    || channel === "lazada"
    || channel === "coupang"
    || channel === "elevenst"
    || channel === "smartstore"
    || channel === "temu"
    || ((listingGatewayOperation || writeChannelOperations.has(operation)) && channel === "qoo10");
  if (usesChannelGateway) {
    try {
      const gatewayArguments = operation === "listing.create"
        || operation === "listing.update"
        || (channel === "temu" && operation === "listing.activate")
        ? await prepareMarketplaceImages(serviceClient, channel, effectiveArguments, {
            attemptId,
            productId: parsed.data.productId!,
            market: parsed.data.market,
            targetId: parsed.data.targetId,
          }).then((prepared) => {
            // The transport marker is server-owned. The request-side assets
            // were already exact-bound to the product lineage before the
            // idempotency attempt was claimed, so a client cannot relabel an
            // AI product as manual to relax the strict image evidence fence.
            if (verifiedProductContentMode === "manual_mvp") {
              prepared.sellerpilotContentMode = "manual_mvp";
            } else {
              delete prepared.sellerpilotContentMode;
            }
            return prepared;
          })
        : effectiveArguments;
      if (boundEbayExactExistingQaRecovery) {
        assertEbayExactExistingQaProviderCopyRequest(gatewayArguments);
      }
      if (boundSmartstoreExactQaRecovery) {
        assertSmartstoreExactQaUpdateArguments(gatewayArguments);
      }
      const writeResource = !listingGatewayOperation && writeChannelOperations.has(operation)
        ? {
            ...channelWriteResource({
              channel,
              operation,
              arguments: gatewayArguments,
              context: {
                listingId: parsed.data.resourceListingId,
                inventoryItemId: parsed.data.inventoryItemId,
                orderId: parsed.data.orderId,
                carrierCode: parsed.data.shipmentCarrier,
                trackingNumber: parsed.data.shipmentTracking,
              },
            }),
            requestFingerprint,
          }
        : undefined;
      const gatewayExecution = await executeViaChannelGateway({
        serviceClient,
        credentialId: parsed.data.credentialId,
        attemptId,
        channel,
        operation,
        arguments: gatewayArguments,
        listingId: operation === "listing.create" ? undefined : listingId || undefined,
        listingCreate: operation === "listing.create" && parsed.data.productId
          ? {
              productId: parsed.data.productId,
              market: parsed.data.market,
              targetId: parsed.data.targetId,
              currency: effectiveCurrency ?? "KRW",
              price: effectivePrice ?? 0,
              requestFingerprint,
            }
          : undefined,
        writeResource,
        timeoutMs: writeChannelOperations.has(operation) ? 45_000 : undefined,
      });
      const rawResult = gatewayExecution.result;
      if (gatewayExecution.listingId) listingId = gatewayExecution.listingId;
      if (rawResult.ok && listingOperationRequiresVerifiedRemoteState(operation)) {
        const verifiedPublication = verifiedListingPublicationResult(
          operation,
          rawResult as unknown as Record<string, unknown>,
          effectivePublicationIntent,
          {
            locale: expectedPublicationLocale,
            fingerprint: requestFingerprint,
            minimumImageCount: expectedPublicationImageCount,
          },
        );
        if (verifiedPublication.status !== "verified") {
          return NextResponse.json({
            ok: false,
            manualRequired: true,
            reconciliationRequired: true,
            attemptId,
            listingId: (gatewayExecution.listingId ?? listingId) || undefined,
            remoteId: rawResult.remoteId,
            message: "원격 상품 작업 결과가 요청한 게시 의도·식별자·검증 증거와 일치하지 않아 성공으로 반환하지 않습니다.",
            mode: "listing_remote_state_context_mismatch",
          }, {
            status: 409,
            headers: { "cache-control": "no-store, max-age=0" },
          });
        }
      }
      const { result, remediation } = applyListingRemediation(rawResult);
      if (remediation?.rejectCategory) await rejectBlockedCategory(remediation.code);
      // Listing gateway completion is the single transaction that owns both
      // the attempt and listing ledgers. Replaying the legacy completion RPCs
      // here can overwrite a worker-recorded external_action/manual_required
      // outcome after a remote create whose readback could not be verified.
      const publicationPending = result.ok && result.publicationFulfilled === false;
      return NextResponse.json({
        ...result,
        ...(publicationPending ? { publicationPending: true } : {}),
        attemptId,
        listingId: listingId || parsed.data.resourceListingId || undefined,
        gateway: "vercel-serverless-channel-gateway",
      }, {
        status: publicationPending ? 202 : result.ok ? 200 : 422,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    } catch (error) {
      if (error instanceof ChannelGatewayReconciliationRequiredError) {
        const errorListingId = error.listingId || listingId || parsed.data.resourceListingId || undefined;
        return NextResponse.json({
          ok: false,
          inProgress: false,
          manualRequired: true,
          reconciliationRequired: true,
          jobId: error.jobId,
          attemptId: error.attemptId ?? attemptId,
          listingId: errorListingId,
          message: "판매채널이 작업을 수락했는지 확정할 수 없습니다. 원격 판매자센터와 진행 현황을 수동 확인하기 전에는 다시 실행할 수 없습니다.",
        }, {
          status: 409,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      if (error instanceof ChannelGatewayInProgressError) {
        const errorListingId = error.listingId || listingId || parsed.data.resourceListingId || undefined;
        return NextResponse.json({
          ok: false,
          inProgress: true,
          reconciliationRequired: false,
          jobId: error.jobId,
          attemptId: error.attemptId ?? attemptId,
          listingId: errorListingId,
          message: error.message === "CHANNEL_GATEWAY_TIMEOUT"
            ? "판매채널 작업이 계속 진행 중입니다. 원격 결과가 확인될 때까지 재등록하지 않고 진행 현황에서 자동 반영을 기다립니다."
            : "동일 상품·채널 작업이 이미 진행 중입니다. 기존 작업이 끝날 때까지 새 원격 등록을 실행하지 않았습니다.",
        }, {
          status: 202,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      if (error instanceof ChannelGatewayListingAlreadyPublishedError) {
        return NextResponse.json({
          ok: false,
          alreadyPublished: true,
          attemptId: error.attemptId,
          listingId: error.listingId,
          message: "이미 게시된 원격 상품이 있어 기존 원장을 변경하거나 새 등록을 호출하지 않았습니다.",
        }, {
          status: 409,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      if (error instanceof ChannelGatewayListingBlockedError) {
        return NextResponse.json({
          ok: false,
          manualRequired: true,
          reconciliationRequired: true,
          attemptId: error.attemptId,
          listingId: error.listingId,
          message: "이전 원격 등록 결과를 판매자센터에서 수동 확인하기 전에는 재등록할 수 없습니다.",
        }, {
          status: 409,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      if (error instanceof ChannelGatewayRemoteFailedError) {
        return NextResponse.json({
          ok: false,
          attemptId: error.attemptId ?? attemptId,
          listingId: error.listingId || listingId || parsed.data.resourceListingId || undefined,
          message: errorMessage(error),
        }, {
          status: 422,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      if (error instanceof ChannelGatewayCredentialUnattestedError) {
        const message = "현재 OAuth 인증정보의 판매자 계정 식별자가 공식 API로 아직 검증되지 않았습니다. 해당 채널을 다시 연결한 뒤 등록해 주세요.";
        await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
          p_attempt_id: attemptId,
          p_status: "failed",
          p_http_status: 409,
          p_remote_id: null,
          p_safe_message: message,
        });
        return NextResponse.json({
          ok: false,
          attemptId,
          message,
          mode: "credential_unverified",
        }, {
          status: 409,
          headers: { "cache-control": "no-store, max-age=0" },
        });
      }
      const message = errorMessage(error);
      const { data: preGatewayFailed, error: preGatewayFailureError } = await serviceClient.rpc(
        "sellerpilot_service_fail_pre_gateway_channel_operation",
        {
          p_attempt_id: attemptId,
          p_http_status: 422,
          p_safe_message: message,
        },
      );
      const preGatewayRetryable = !preGatewayFailureError && preGatewayFailed === true;
      if (!preGatewayRetryable) {
        await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
          p_attempt_id: attemptId,
          p_status: "failed",
          p_http_status: 422,
          p_remote_id: null,
          p_safe_message: message,
        });
      }
      // A failure before the gateway made any provider request is safe to
      // retry. Preserve the exact paused/S1 rollback-confirmed listing row so
      // the next attempt can pass the same read-only identity RPC instead of
      // destroying its only recovery classification.
      if (!(boundQoo10RollbackUpdateRecovery && preGatewayRetryable)) {
        await completeListing({ success: false, safeMessage: message });
      }
      return NextResponse.json({ message, attemptId, preGatewayRetryable }, { status: 422 });
    }
  }

  const { data: secretPayload, error: secretError } = await serviceClient.rpc("sellerpilot_decrypt_credential", {
    p_credential_id: parsed.data.credentialId,
  });
  if (secretError || !secretPayload || typeof secretPayload !== "object" || Array.isArray(secretPayload)) {
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: "failed",
      p_http_status: 404,
      p_remote_id: null,
      p_safe_message: "활성 키를 안전하게 불러오지 못했습니다.",
    });
    await completeListing({ success: false, safeMessage: "활성 키를 안전하게 불러오지 못했습니다." });
    return NextResponse.json({ message: "활성 키를 안전하게 불러오지 못했습니다.", attemptId }, { status: 404 });
  }

  try {
    const executionPayload = secretPayload as Record<string, unknown>;
    const operationArguments = operation === "listing.create" || operation === "listing.update"
      ? await prepareMarketplaceImages(serviceClient, channel, effectiveArguments, {
          attemptId,
          productId: parsed.data.productId!,
          market: parsed.data.market,
          targetId: parsed.data.targetId,
        })
      : effectiveArguments;
    const rawResult = await executeChannelOperation({
      channel,
      operation,
      payload: executionPayload,
      arguments: operationArguments,
      environment,
    });
    const { result, remediation } = applyListingRemediation(rawResult);
    if (remediation?.rejectCategory) await rejectBlockedCategory(remediation.code);
    const remoteStatus = result.steps.find((item) => !item.ok)?.status ?? result.steps.at(-1)?.status ?? 200;
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: result.ok ? "succeeded" : "failed",
      p_http_status: remoteStatus,
      p_remote_id: result.remoteId ?? null,
      p_safe_message: result.safeMessage,
    });
    const listingRecorded = await completeListing({ success: result.ok, remoteId: result.remoteId, publicUrl: result.publicUrl, safeMessage: result.safeMessage });
    if (!listingRecorded) {
      return NextResponse.json({
        message: "원격 작업은 완료됐지만 상품 원장 조정이 필요합니다. 같은 멱등키로 다시 요청하면 원격 재호출 없이 복구합니다.",
        attemptId,
        remoteId: result.remoteId,
        listingId: listingId || parsed.data.resourceListingId || undefined,
        reconciliationRequired: true,
      }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
    }
    const publicationPending = result.ok && result.publicationFulfilled === false;
    return NextResponse.json({
      ...result,
      ...(publicationPending ? { publicationPending: true } : {}),
      attemptId,
      listingId: listingId || parsed.data.resourceListingId || undefined,
    }, {
      status: publicationPending ? 202 : result.ok ? 200 : 422,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = errorMessage(error);
    await serviceClient.rpc("sellerpilot_service_complete_channel_operation", {
      p_attempt_id: attemptId,
      p_status: "failed",
      p_http_status: 422,
      p_remote_id: null,
      p_safe_message: message,
    });
    await completeListing({ success: false, safeMessage: message });
    return NextResponse.json({ message, attemptId }, { status: 422 });
  }
}
