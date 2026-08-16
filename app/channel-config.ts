export type ChannelKey = "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay";
export type AllChannelKey = ChannelKey | "alibaba" | "one688";

export type ChannelConfig = {
  name: string;
  market: string;
  color: string;
  letter: string;
  enabled: boolean;
};

export const channels: Record<AllChannelKey, ChannelConfig> = {
  qoo10: { name: "Qoo10 Japan", market: "일본", color: "#ff5e62", letter: "Q", enabled: true },
  shopee: { name: "Shopee Global", market: "SG · MY · PH · VN · TH · TW · BR · MX", color: "#ee4d2d", letter: "S", enabled: true },
  lazada: { name: "Lazada Malaysia", market: "말레이시아", color: "#7357ff", letter: "L", enabled: true },
  coupang: { name: "쿠팡", market: "대한민국", color: "#e8344e", letter: "C", enabled: true },
  elevenst: { name: "11번가", market: "대한민국", color: "#ff2d55", letter: "11", enabled: true },
  smartstore: { name: "네이버 스마트스토어", market: "대한민국", color: "#03c75a", letter: "N", enabled: true },
  ebay: { name: "eBay Global", market: "글로벌", color: "#3665f3", letter: "E", enabled: true },
  alibaba: { name: "Alibaba.com", market: "글로벌 B2B", color: "#ff6a00", letter: "A", enabled: false },
  one688: { name: "1688.com", market: "중국 내수 B2B", color: "#ff7300", letter: "1688", enabled: false },
};
