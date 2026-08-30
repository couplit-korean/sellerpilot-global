import {
  capabilityModeLabels,
  channelCatalog,
  type ActiveChannelKey,
  type CapabilityMode,
  type ChannelCapabilityKey,
} from "./catalog";
import type { ChannelOperationName } from "./operations";
import { channelPriceUpdateRelease } from "./price-update-release";

const operationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "listing.publication.verify": "listingCreate",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "inquiries.list": "inquiries",
  "inquiries.reply": "inquiries",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

const elevenstImplementedOperations = new Set<ChannelOperationName>([
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.publication.verify",
  "orders.list",
]);

const publicationVerificationChannels = new Set<ActiveChannelKey>([
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
]);

// Product updates are released only when this codebase has both a complete
// channel payload mapper and a stable remote identity/readback path. Temu's
// seller-specific update schema is not yet released. eBay is admitted only
// after its offerId/SKU/listingId/marketplaceId tuple is independently attested
// and preserved by the immutable product-listing identity fence.
const releasedListingUpdateChannels = new Set<ActiveChannelKey>([
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
]);

const releaseOperationByCapability: Partial<Record<ChannelCapabilityKey, ChannelOperationName>> = {
  listingCreate: "listing.create",
  listingUpdate: "listing.update",
  listingStop: "listing.stop",
  price: "price.update",
  inventory: "inventory.update",
  orders: "orders.list",
};

export type ChannelOperationRelease = {
  available: boolean;
  mode: "available" | "unsupported" | "vendor_docs_required" | "release_verification_required";
  reason: string;
};

export type ChannelEnvironment = "sandbox" | "production";

const listingUpdateBlockedReasons: Partial<Record<ActiveChannelKey, string>> = {
  elevenst: "11번가 상품 수정은 검증된 최초 등록 원본과 정확한 prdNo readback을 사용할 수 없는 기존 상품에 한해 차단합니다.",
  temu: "Temu 상품 수정은 판매자별 수정 스키마와 SKU 식별값을 원장에 확정하기 전까지 차단했습니다.",
};

export function channelOperationRelease(
  channel: ActiveChannelKey,
  operation: ChannelOperationName,
  environment: ChannelEnvironment = "production",
): ChannelOperationRelease {
  if (operation === "listing.publication.verify" && !publicationVerificationChannels.has(channel)) {
    return {
      available: false,
      mode: "release_verification_required",
      reason: "이 채널은 정확한 원격 게시 상태 재조회 어댑터가 출시되지 않아 차단했습니다.",
    };
  }
  const capability = channelCatalog[channel].capabilities[operationCapabilities[operation]];
  if (channel === "ebay" && operation === "inquiries.reply") {
    return {
      available: false,
      mode: "release_verification_required",
      reason: `eBay ASQ 답변은 계정·마켓·문의 계보가 검증된 ${environment === "sandbox" ? "Sandbox" : "운영"} 티켓의 전용 CS 경로에서만 실행할 수 있습니다.`,
    };
  }
  if (capability.mode === "unsupported" || capability.mode === "vendor_docs_required") {
    return { available: false, mode: capability.mode, reason: capability.note };
  }
  if (channel === "elevenst" && !elevenstImplementedOperations.has(operation)) {
    return {
      available: false,
      mode: "release_verification_required",
      reason: operation === "listing.update"
        ? listingUpdateBlockedReasons.elevenst!
        : "11번가 판매자 전용 쓰기 명세와 원격 결과 재조회가 확인되지 않아 이 작업을 차단했습니다.",
    };
  }
  if (operation === "listing.update" && !releasedListingUpdateChannels.has(channel)) {
    return {
      available: false,
      mode: "release_verification_required",
      reason: listingUpdateBlockedReasons[channel]
        ?? "원격 상품 식별값과 수정 결과 readback이 모두 검증되지 않아 상품 수정을 차단했습니다.",
    };
  }
  if (channel === "ebay" && operation === "listing.stop") {
    return {
      available: false,
      mode: "release_verification_required",
      reason: "eBay 판매 중지는 offer ID가 필요하지만 현재 원장에는 공개 listing ID만 보존되므로 다른 상품을 중지하지 않도록 차단했습니다.",
    };
  }
  if (operation === "price.update") {
    return channelPriceUpdateRelease(channel);
  }
  if (channel === "shopee" && operation === "inquiries.list") {
    return { available: false, mode: "release_verification_required", reason: "Shopee Chat API 권한과 실제 메시지 readback이 확인되지 않아 차단했습니다." };
  }
  if (operation === "inquiries.reply" && !["qoo10", "lazada", "coupang", "smartstore", "ebay"].includes(channel)) {
    return { available: false, mode: "release_verification_required", reason: "이 채널은 현재 공식 문의 답변 API가 검증되지 않아 원격 전송을 차단했습니다." };
  }
  if (["ebay", "temu"].includes(channel) && operation === "shipment.acknowledge") {
    return {
      available: false,
      mode: "release_verification_required",
      reason: channel === "temu"
        ? "Temu 실행 계약에는 별도 발주확인 동작이 없어 출고 확정과 혼동되지 않도록 차단했습니다."
        : "eBay에는 별도 발주확인 쓰기 동작이 없어 차단했습니다.",
    };
  }
  return { available: true, mode: "available", reason: capability.note };
}

export function channelOperationAvailable(
  channel: ActiveChannelKey,
  operation: ChannelOperationName,
  environment: ChannelEnvironment = "production",
) {
  return channelOperationRelease(channel, operation, environment).available;
}

export type ChannelCapabilityReleasePresentation = {
  mode: CapabilityMode;
  label: string;
  note: string;
  releaseState: "available" | "partial" | "blocked";
};

/**
 * The catalog records what a provider documents, while this projection records
 * what SellerPilot can safely release today. Keep the readiness table on the
 * latter so a documented API is never mistaken for an enabled production path.
 */
export function channelCapabilityReleasePresentation(
  channel: ActiveChannelKey,
  capability: ChannelCapabilityKey,
  environment: ChannelEnvironment = "production",
): ChannelCapabilityReleasePresentation {
  const documented = channelCatalog[channel].capabilities[capability];
  const operation = releaseOperationByCapability[capability];
  if (operation) {
    const release = channelOperationRelease(channel, operation, environment);
    if (!release.available) {
      return {
        mode: release.mode === "vendor_docs_required" ? "vendor_docs_required" : "unsupported",
        label: release.mode === "vendor_docs_required" ? capabilityModeLabels.vendor_docs_required : "출시 차단",
        note: release.reason,
        releaseState: "blocked",
      };
    }
  }

  if (capability === "inquiries") {
    const listRelease = channelOperationRelease(channel, "inquiries.list", environment);
    const replyRelease = channelOperationRelease(channel, "inquiries.reply", environment);
    if (!listRelease.available && !replyRelease.available) {
      return {
        mode: listRelease.mode === "vendor_docs_required" || replyRelease.mode === "vendor_docs_required"
          ? "vendor_docs_required"
          : "unsupported",
        label: listRelease.mode === "vendor_docs_required" || replyRelease.mode === "vendor_docs_required"
          ? capabilityModeLabels.vendor_docs_required
          : "출시 차단",
        note: `조회 차단 · ${listRelease.reason} 답변 차단 · ${replyRelease.reason}`,
        releaseState: "blocked",
      };
    }
    if (listRelease.available !== replyRelease.available) {
      const blocked = listRelease.available ? replyRelease : listRelease;
      return {
        mode: documented.mode,
        label: listRelease.available ? "조회만" : "답변만",
        note: `${documented.note} · ${listRelease.available ? "답변" : "조회"} 경로는 출시 차단 · ${blocked.reason}`,
        releaseState: "partial",
      };
    }
  }

  return {
    mode: documented.mode,
    label: capabilityModeLabels[documented.mode],
    note: documented.note,
    releaseState: "available",
  };
}
