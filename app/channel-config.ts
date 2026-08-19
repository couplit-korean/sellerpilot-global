export type ChannelKey = "qoo10" | "shopee" | "lazada" | "coupang" | "smartstore" | "ebay" | "temu";
export type AllChannelKey = ChannelKey | "alibaba" | "one688";

export type ChannelConfig = {
  name: string;
  market: string;
  color: string;
  letter: string;
  symbol: string;
  enabled: boolean;
};

export const channels: Record<AllChannelKey, ChannelConfig> = {
  qoo10: { name: "Qoo10 Japan", market: "일본", color: "#e93145", letter: "Q", symbol: "Q10", enabled: true },
  shopee: { name: "Shopee Global", market: "SG · MY · PH · VN · TH · TW · BR · MX", color: "#ee4d2d", letter: "S", symbol: "SP", enabled: true },
  lazada: { name: "Lazada Malaysia", market: "말레이시아", color: "#5f3dc4", letter: "L", symbol: "LZ", enabled: true },
  coupang: { name: "쿠팡", market: "대한민국", color: "#d7323f", letter: "C", symbol: "쿠", enabled: true },
  smartstore: { name: "네이버 스마트스토어", market: "대한민국", color: "#03a94d", letter: "N", symbol: "N", enabled: true },
  ebay: { name: "eBay Global", market: "글로벌", color: "#2454c6", letter: "E", symbol: "eB", enabled: true },
  temu: { name: "Temu Korea", market: "대한민국", color: "#f4511e", letter: "T", symbol: "TM", enabled: true },
  alibaba: { name: "Alibaba.com", market: "글로벌 B2B", color: "#ff6a00", letter: "A", symbol: "Ali", enabled: false },
  one688: { name: "1688.com", market: "중국 내수 B2B", color: "#ff7300", letter: "1688", symbol: "1688", enabled: false },
};
