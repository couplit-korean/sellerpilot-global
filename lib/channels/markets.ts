export type ChannelMarket = {
  code: string;
  label: string;
  locale: string;
  language: string;
  currency: string;
  shopeeLanguage?: string;
  lazadaLanguage?: string;
};

export const shopeeMarkets: ChannelMarket[] = [
  { code: "SG", label: "Singapore", locale: "en-SG", language: "English", currency: "SGD", shopeeLanguage: "en" },
  { code: "MY", label: "Malaysia", locale: "ms-MY", language: "Bahasa Melayu", currency: "MYR", shopeeLanguage: "ms" },
  { code: "PH", label: "Philippines", locale: "en-PH", language: "English", currency: "PHP", shopeeLanguage: "en" },
  { code: "VN", label: "Vietnam", locale: "vi-VN", language: "Tiếng Việt", currency: "VND", shopeeLanguage: "vi" },
  { code: "TH", label: "Thailand", locale: "th-TH", language: "ไทย", currency: "THB", shopeeLanguage: "th" },
  { code: "TW", label: "Taiwan", locale: "zh-TW", language: "繁體中文", currency: "TWD", shopeeLanguage: "zh-hant" },
  { code: "BR", label: "Brazil", locale: "pt-BR", language: "Português", currency: "BRL", shopeeLanguage: "pt-br" },
  { code: "MX", label: "Mexico", locale: "es-MX", language: "Español", currency: "MXN", shopeeLanguage: "es-mx" },
];

export const lazadaMarkets: ChannelMarket[] = [
  { code: "MY", label: "Malaysia", locale: "ms-MY", language: "Bahasa Melayu", currency: "MYR", lazadaLanguage: "ms_MY" },
  { code: "SG", label: "Singapore", locale: "en-SG", language: "English", currency: "SGD", lazadaLanguage: "en_SG" },
  { code: "PH", label: "Philippines", locale: "en-PH", language: "English", currency: "PHP", lazadaLanguage: "en_PH" },
  { code: "TH", label: "Thailand", locale: "th-TH", language: "ไทย", currency: "THB", lazadaLanguage: "th_TH" },
  { code: "VN", label: "Vietnam", locale: "vi-VN", language: "Tiếng Việt", currency: "VND", lazadaLanguage: "vi_VN" },
  { code: "ID", label: "Indonesia", locale: "id-ID", language: "Bahasa Indonesia", currency: "IDR", lazadaLanguage: "id_ID" },
];

export function channelMarket(channel: "shopee" | "lazada", code: string) {
  const markets = channel === "shopee" ? shopeeMarkets : lazadaMarkets;
  return markets.find((market) => market.code === code.trim().toUpperCase());
}
