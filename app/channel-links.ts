import { channels, type AllChannelKey } from "./channel-config";

export type RemoteListingReference = {
  channel: string;
  market?: string;
  targetId?: string;
  remoteId?: string | null;
  status?: string;
};

const shopeeDomains: Record<string, string> = {
  SG: "shopee.sg",
  MY: "shopee.com.my",
  PH: "shopee.ph",
  VN: "shopee.vn",
  TH: "shopee.co.th",
  TW: "shopee.tw",
  BR: "shopee.com.br",
  MX: "shopee.com.mx",
};

export function isKnownChannelKey(value: string): value is AllChannelKey {
  return value in channels;
}

export function sellerCenterUrl(channel: string) {
  return isKnownChannelKey(channel) ? channels[channel].sellerCenterUrl : null;
}

export function marketplaceListingLinkLabel(reference: RemoteListingReference) {
  if (!reference.remoteId?.trim()) return "판매자센터 열기";

  if (reference.channel === "shopee") {
    const market = (reference.market ?? "SG").toUpperCase();
    return reference.targetId?.trim() && shopeeDomains[market]
      ? "등록 상품 열기"
      : "채널에서 상품 찾기";
  }

  return ["qoo10", "elevenst", "ebay", "temu"].includes(reference.channel)
    ? "등록 상품 열기"
    : "채널에서 상품 찾기";
}

/**
 * 공개 상품 URL이 원격 ID만으로 안정적으로 만들어지는 채널은 공개 페이지로,
 * 별도의 공개 상품번호나 slug가 필요한 채널은 공식 판매자센터의 상품 조회로 보냅니다.
 */
export function marketplaceListingUrl(reference: RemoteListingReference) {
  if (!isKnownChannelKey(reference.channel)) return null;
  const remoteId = reference.remoteId?.trim();
  const fallback = channels[reference.channel].sellerCenterUrl;
  if (!remoteId) return fallback;

  switch (reference.channel) {
    case "qoo10":
      return `https://www.qoo10.jp/g/${encodeURIComponent(remoteId)}`;
    case "shopee": {
      const shopId = reference.targetId?.trim();
      const domain = shopeeDomains[(reference.market ?? "SG").toUpperCase()];
      return shopId && domain
        ? `https://${domain}/product/${encodeURIComponent(shopId)}/${encodeURIComponent(remoteId)}`
        : fallback;
    }
    case "lazada":
      return `https://sellercenter.lazada.com.my/apps/product/list?search=${encodeURIComponent(remoteId)}`;
    case "coupang":
      return `https://wing.coupang.com/vendor-inventory/list?page=1&countPerPage=10&searchKeyword=${encodeURIComponent(remoteId)}`;
    case "elevenst":
      return `https://www.11st.co.kr/products/${encodeURIComponent(remoteId)}`;
    case "smartstore":
      return "https://sell.smartstore.naver.com/#/products/origin-list";
    case "ebay":
      return `https://www.ebay.com/itm/${encodeURIComponent(remoteId)}`;
    case "temu":
      return `https://www.temu.com/goods.html?_bg_fs=1&goods_id=${encodeURIComponent(remoteId)}`;
    default:
      return fallback;
  }
}
