import { channelCatalog, ebayAsqProductionVerified, type ActiveChannelKey, type ChannelCapabilityKey } from "./catalog";
import type { ChannelOperationName } from "./operations";

const operationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
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
  "listing.stop",
  "orders.list",
]);

// Product updates are released only when this codebase has both a complete
// channel payload mapper and a stable remote identity/readback path. Temu's
// seller-specific update schema and eBay's offer ID/SKU identity are not yet
// persisted in the product listing ledger, so exposing those writes would risk
// updating the wrong remote object.
const releasedListingUpdateChannels = new Set<ActiveChannelKey>([
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "smartstore",
]);

export type ChannelOperationRelease = {
  available: boolean;
  mode: "available" | "unsupported" | "vendor_docs_required" | "release_verification_required";
  reason: string;
};

const listingUpdateBlockedReasons: Partial<Record<ActiveChannelKey, string>> = {
  elevenst: "11번가 상품 수정은 판매자 전용 수정 명세와 원격 readback이 확정되지 않아 차단했습니다.",
  temu: "Temu 상품 수정은 판매자별 수정 스키마와 SKU 식별값을 원장에 확정하기 전까지 차단했습니다.",
  ebay: "eBay 상품 수정에는 offer ID와 SKU가 모두 필요하지만 현재 상품 원장에는 게시 listing ID만 보존되므로 차단했습니다.",
};

export function channelOperationRelease(channel: ActiveChannelKey, operation: ChannelOperationName): ChannelOperationRelease {
  const capability = channelCatalog[channel].capabilities[operationCapabilities[operation]];
  if (channel === "ebay"
      && (operation === "inquiries.list" || operation === "inquiries.reply")
      && !ebayAsqProductionVerified) {
    return {
      available: false,
      mode: "release_verification_required",
      reason: "eBay Trading API 상품 문의(ASQ)는 구현됐지만 Sandbox 2계정 왕복과 실판매자 계정 조회 검증 전이라 운영 실행을 차단했습니다.",
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
    return {
      available: false,
      mode: "release_verification_required",
      reason: "가격 쓰기 뒤 동일 원격 상품의 통화·가격을 다시 조회해 일치 여부를 검증하는 경로가 아직 없어 가격 수정을 차단했습니다.",
    };
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

export function channelOperationAvailable(channel: ActiveChannelKey, operation: ChannelOperationName) {
  return channelOperationRelease(channel, operation).available;
}
