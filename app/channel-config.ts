export type ChannelKey = "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay" | "temu";
export type AllChannelKey = ChannelKey | "alibaba" | "one688";

export type ChannelConfig = {
  name: string;
  market: string;
  color: string;
  letter: string;
  mark: string;
  sellerCenterUrl: string;
  enabled: boolean;
};

export const channels: Record<AllChannelKey, ChannelConfig> = {
  qoo10: { name: "Qoo10 Japan", market: "일본", color: "#ff5e62", letter: "Q", mark: "큐텐", sellerCenterUrl: "https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/default.aspx", enabled: true },
  shopee: { name: "Shopee Global", market: "SG · MY · PH · VN · TH · TW · BR · MX", color: "#ee4d2d", letter: "S", mark: "쇼피", sellerCenterUrl: "https://seller.shopee.kr/", enabled: true },
  lazada: { name: "Lazada Malaysia", market: "말레이시아", color: "#7357ff", letter: "L", mark: "라자다", sellerCenterUrl: "https://sellercenter.lazada.com.my/", enabled: true },
  coupang: { name: "쿠팡", market: "대한민국", color: "#e8344e", letter: "C", mark: "쿠팡", sellerCenterUrl: "https://wing.coupang.com/", enabled: true },
  elevenst: { name: "11번가", market: "대한민국", color: "#ff2d55", letter: "11", mark: "11번가", sellerCenterUrl: "https://soffice.11st.co.kr/view/main", enabled: true },
  smartstore: { name: "네이버 스마트스토어", market: "대한민국", color: "#03c75a", letter: "N", mark: "네이버", sellerCenterUrl: "https://sell.smartstore.naver.com/#/home/dashboard", enabled: true },
  ebay: { name: "eBay Global", market: "글로벌", color: "#3665f3", letter: "E", mark: "이베이", sellerCenterUrl: "https://www.ebay.com/sh/ovw", enabled: true },
  temu: { name: "Temu Korea", market: "대한민국", color: "#ff5a00", letter: "T", mark: "테무", sellerCenterUrl: "https://kr.seller.temu.com/home.html", enabled: true },
  alibaba: { name: "Alibaba.com", market: "글로벌 B2B", color: "#ff6a00", letter: "A", mark: "알리바바", sellerCenterUrl: "https://seller.alibaba.com/", enabled: false },
  one688: { name: "1688.com", market: "중국 내수 B2B", color: "#ff7300", letter: "1688", mark: "1688", sellerCenterUrl: "https://work.1688.com/", enabled: false },
};
