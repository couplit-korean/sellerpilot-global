import type { ActiveChannelKey } from "./catalog";

export type PriceUpdateReleaseEvidence = {
  writeImplemented: boolean;
  exactRemoteIdentity: boolean;
  sameProductPriceCurrencyReadback: boolean;
  failClosedOnMismatch: boolean;
  reason: string;
};

export type PriceUpdateRelease = {
  available: boolean;
  mode: "available" | "release_verification_required";
  reason: string;
  evidence: PriceUpdateReleaseEvidence;
};

/**
 * A documented or implemented write endpoint is not sufficient to release a
 * remote price change. The channel must also bind the write to the exact
 * remote product and fail closed unless a subsequent read returns that same
 * product, currency, and price.
 *
 * Keep this evidence exhaustive. Both the admin release gate and the
 * serverless executor consume the same projection so one path cannot expose a
 * write that the other still considers unverified.
 */
const evidenceByChannel = {
  qoo10: {
    writeImplemented: true,
    exactRemoteIdentity: true,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: true,
    reason: "Qoo10 게시 원장의 ItemCode 계보, SetGoodsPriceQty의 Price·Qty 매핑, 동일 ItemCode·요청가격 불일치 차단은 구현됐습니다. 하지만 현재 GetItemDetailInfo 계약에는 통화 필드가 없고 반영에 최대 10분이 걸릴 수 있어 동일 상품의 통화·가격 terminal readback을 증명할 수 없습니다.",
  },
  shopee: {
    writeImplemented: true,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "Shopee update_price 쓰기는 구현됐지만, item/model 계보와 동일 item/model의 통화·가격 사후 조회 및 불일치 차단이 없습니다.",
  },
  lazada: {
    writeImplemented: true,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "Lazada UpdatePriceQuantity 쓰기는 구현됐지만, SellerSku 계보와 동일 SKU의 통화·가격 사후 조회가 검증되지 않았습니다.",
  },
  coupang: {
    writeImplemented: true,
    exactRemoteIdentity: true,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "Coupang vendor-item 가격 쓰기는 구현됐지만, 동일 vendorItemId의 실제 판매가 readback과 불일치 차단이 없습니다.",
  },
  elevenst: {
    writeImplemented: false,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "11번가 판매자 가격 API의 공식 계약·서비스 권한과 동일 prdNo 사후 조회가 확인되지 않았습니다.",
  },
  temu: {
    writeImplemented: false,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "Temu 가격 쓰기 동작과 판매자별 SKU 계보, 동일 상품 통화·가격 readback이 아직 구현·검증되지 않았습니다.",
  },
  smartstore: {
    writeImplemented: true,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "스마트스토어 다건 가격 쓰기는 구현됐지만, 요청 항목별 originProductNo 계보와 동일 상품 가격 사후 조회를 검증하지 않습니다.",
  },
  ebay: {
    writeImplemented: true,
    exactRemoteIdentity: false,
    sameProductPriceCurrencyReadback: false,
    failClosedOnMismatch: false,
    reason: "eBay offer 가격 쓰기는 구현됐지만, 원장에 offer ID·SKU 계보가 완전하지 않고 동일 offer의 통화·가격 readback이 없습니다.",
  },
} as const satisfies Record<ActiveChannelKey, PriceUpdateReleaseEvidence>;

export function channelPriceUpdateRelease(channel: ActiveChannelKey): PriceUpdateRelease {
  const evidence = evidenceByChannel[channel];
  const available = evidence.writeImplemented
    && evidence.exactRemoteIdentity
    && evidence.sameProductPriceCurrencyReadback
    && evidence.failClosedOnMismatch;
  return {
    available,
    mode: available ? "available" : "release_verification_required",
    reason: evidence.reason,
    evidence,
  };
}
