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
import { mergeElevenstListingUpdateProduct } from "../../../../lib/channels/elevenst-listing";
import {
  elevenstListingUpdateProjectionDigestInput,
  listingUpdateRemoteIdentity,
  listingWriteOperation,
} from "../../../../lib/channels/listing-update";
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
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../lib/channels/serverless-static-egress";
import { channelListingRemoteIdentity, channelWriteResource, listingLedgerRemoteIdentity } from "../../../../lib/channels/write-resource";
import { supabasePublishableKey, supabaseUrl } from "../../../../lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  if (["listing.create", "listing.update", "listing.stop"].includes(operation) && !parsed.data.productId) {
    return NextResponse.json({
      message: "상품 원장 ID가 없는 상품 등록·수정·판매 중지는 중복 방지를 위해 실행할 수 없습니다.",
    }, { status: 409 });
  }
  if (operation === "listing.create" && (parsed.data.currency === undefined || parsed.data.price === undefined)) {
    return NextResponse.json({
      message: "상품 등록 가격과 통화를 확인하지 못해 임의 값으로 판매채널에 전송하지 않았습니다.",
      mode: "listing_commerce_values_required",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const listingBoundOperation = ["listing.update", "listing.stop", "price.update", "inventory.update"].includes(operation);
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
  const contentBoundListingOperation = operation === "listing.create"
    || (operation === "listing.update" && isRecord(parsed.data.arguments.sellerpilotAssets));
  let verifiedPublishContext: Record<string, unknown> | null = null;
  let verifiedProductContentMode: ProductContentMode | null = null;
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
    if (!marketplaceContentModeMatchesProduct(parsed.data.arguments, contentMode)) {
      return NextResponse.json({
        message: "요청한 이미지 제작 방식이 상품 원장의 제작 계보와 일치하지 않습니다.",
        mode: "product_content_mode_mismatch",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
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
  if (listingBoundOperation) {
    const productId = parsed.data.productId!;
    const resourceListingId = parsed.data.resourceListingId!;
    let requestedRemoteId = "";
    try {
      requestedRemoteId = operation === "listing.update"
        ? listingUpdateRemoteIdentity(channel, parsed.data.arguments)
        : channelListingRemoteIdentity(channel, operation, parsed.data.arguments);
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
          ? listingWriteOperation({
              remoteId: typeof listing.remoteId === "string" ? listing.remoteId : null,
              status: String(listing.status ?? ""),
              publishedAt: typeof listing.publishedAt === "string" ? listing.publishedAt : null,
              requestedPublicationIntent: typeof listing.requestedPublicationIntent === "string"
                ? listing.requestedPublicationIntent
                : null,
              remoteVisibility: typeof listing.remoteVisibility === "string"
                ? listing.remoteVisibility
                : null,
            }) === "listing.update"
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
    if (operation === "listing.update" || operation === "listing.stop") {
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
    }

    const { data: lineageStatus, error: lineageError } = await serviceClient.rpc(
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
  }

  const environment = "environment" in credentialMetadata && credentialMetadata.environment === "sandbox" ? "sandbox" : "production";
  const operationRelease = channelOperationRelease(channel, operation, environment);
  if (!operationRelease.available) {
    return NextResponse.json({
      message: operationRelease.reason,
      mode: operationRelease.mode,
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
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

  if (channel === "temu" && operation === "listing.create") {
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
      ["temu"],
    );
    if (!environmentReady || staticEgressStatus.error || databasePolicy.temu !== true) {
      return NextResponse.json({
        ok: false,
        manualRequired: true,
        externalActionRequired: true,
        staticEgressReady: false,
        blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
        mode: "static_egress_required",
        message: "Temu에 승인된 고정 egress IP와 서버 정책을 활성화한 뒤 상품 등록을 다시 시도해 주세요.",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (runtimeStatus.error || runtimeState.configured !== true || runtimeState.active !== true) {
      return NextResponse.json({
        ok: false,
        operatorActionRequired: true,
        workerReady: false,
        blockedReason: "SERVERLESS_WORKER_REQUIRED",
        mode: "serverless_worker_required",
        message: "Temu 상품 등록 작업자가 활성 상태가 아니어서 작업을 대기열에 넣지 않았습니다.",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }

  let effectiveArguments = parsed.data.arguments;
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
      const product = mergeElevenstListingUpdateProduct(snapshot.product, parsed.data.arguments.productPatch);
      const sellerpilotSnapshotMutableFingerprint = createHash("sha256")
        .update(elevenstListingUpdateProjectionDigestInput(snapshot.product))
        .digest("hex");
      effectiveArguments = {
        ...(parsed.data.arguments.sellerpilotAssets === undefined
          ? {}
          : { sellerpilotAssets: structuredClone(parsed.data.arguments.sellerpilotAssets) }),
        productNo,
        productPatch: structuredClone(parsed.data.arguments.productPatch),
        product,
        sellerpilotSnapshotMutableFingerprint,
      };
    } catch {
      return NextResponse.json({
        message: "11번가에서 안전하게 수정할 수 있는 상품명·설명·필수정보·이미지 값만 입력해 주세요.",
        mode: "elevenst_update_patch_invalid",
      }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
    }
  }
  const effectivePublicationIntent = operation === "listing.create"
    ? parsed.data.publicationIntent ?? "safe_test"
    : operation === "listing.update"
      ? boundListingPublicationIntent
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
  const expectedPublicationImageCount = operation === "listing.create" || operation === "listing.update"
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
  const effectiveCurrency = boundListingCurrency ?? parsed.data.currency;
  const effectivePrice = boundListingPrice ?? parsed.data.price;
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
      arguments: effectiveArguments,
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
    const releaseGateStateIsExact = !releaseGateError
      && isRecord(releaseGateStatus)
      && releaseGateStatus.contract === "verified_publication_release_gate_v1"
      && (
        (releaseGateStatus.open === true && releaseGateStatus.state === "open")
        || (releaseGateStatus.open === false && releaseGateStatus.state === "closed")
      );
    if (!releaseGateStateIsExact) {
      return NextResponse.json({
        message: "상품 게시 릴리스 게이트 상태를 확인하지 못해 판매채널 작업을 차단했습니다.",
        mode: "listing_mutation_release_gate_unavailable",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    if (releaseGateStatus.open !== true) {
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
    p_idempotency_key: parsed.data.idempotencyKey,
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
  if (parsed.data.productId && ["listing.create", "listing.update", "listing.stop"].includes(operation)) {
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

  const listingGatewayOperation = ["listing.create", "listing.update", "listing.stop"].includes(operation);
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
      const gatewayArguments = operation === "listing.create" || operation === "listing.update"
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
