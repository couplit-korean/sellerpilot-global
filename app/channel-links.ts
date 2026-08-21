import { channels, type AllChannelKey } from "./channel-config";

export type RemoteListingReference = {
  channel: string;
  market?: string;
  targetId?: string;
  remoteId?: string | null;
  publicUrl?: string | null;
  publicPageStatus?: "unverified" | "active" | "unavailable";
  publicPageCheckedAt?: string | null;
  status?: string;
  currency?: string;
  price?: number;
  lastError?: string | null;
  updatedAt?: string;
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
  return marketplaceListingUrl(reference)
    ? reference.publicPageStatus === "unavailable" ? "판매중지 상품 페이지 열기" : "판매 상품 페이지 열기"
    : "판매 상품 주소 확인 필요";
}

function allowedPublicUrl(channel: AllChannelKey, value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hosts: Partial<Record<AllChannelKey, string[]>> = {
      qoo10: ["www.qoo10.jp", "qoo10.jp"],
      shopee: Object.values(shopeeDomains),
      lazada: ["www.lazada.com.my", "lazada.com.my"],
      coupang: ["www.coupang.com", "coupang.com"],
      elevenst: ["www.11st.co.kr", "11st.co.kr"],
      smartstore: ["smartstore.naver.com"],
      ebay: ["www.ebay.com", "ebay.com"],
      temu: ["www.temu.com", "temu.com"],
    };
    return hosts[channel]?.includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 원격 ID만으로 공개 판매 페이지를 정확히 만들 수 있는 채널만 반환합니다.
 * 판매자센터나 검색 화면은 상품 페이지가 아니므로 대체 링크로 사용하지 않습니다.
 */
export function marketplaceListingUrl(reference: RemoteListingReference) {
  if (!isKnownChannelKey(reference.channel)) return null;
  const remoteId = reference.remoteId?.trim();
  if (!remoteId || !["published", "paused"].includes(reference.status ?? "")) return null;
  const storedPublicUrl = allowedPublicUrl(reference.channel, reference.publicUrl);
  if (storedPublicUrl) return storedPublicUrl;

  switch (reference.channel) {
    case "qoo10":
      return `https://www.qoo10.jp/g/${encodeURIComponent(remoteId)}`;
    case "shopee": {
      const shopId = reference.targetId?.trim();
      const domain = shopeeDomains[(reference.market ?? "SG").toUpperCase()];
      return shopId && domain
        ? `https://${domain}/product/${encodeURIComponent(shopId)}/${encodeURIComponent(remoteId)}`
        : null;
    }
    case "lazada":
      return (reference.market ?? "MY").toUpperCase() === "MY"
        ? `https://www.lazada.com.my/products/i${encodeURIComponent(remoteId)}.html`
        : null;
    case "coupang":
      return null;
    case "elevenst":
      return `https://www.11st.co.kr/products/${encodeURIComponent(remoteId)}`;
    case "smartstore":
      return null;
    case "ebay":
      return `https://www.ebay.com/itm/${encodeURIComponent(remoteId)}`;
    case "temu":
      return `https://www.temu.com/goods.html?_bg_fs=1&goods_id=${encodeURIComponent(remoteId)}`;
    default:
      return null;
  }
}
