const ELEVENST_HOSTNAME = /(^|\.)11st\.co\.kr$/iu;
const MARKETPLACE_WEB_ROOTS = {
  shopee: [
    "shopee.sg",
    "shopee.com.my",
    "shopee.ph",
    "shopee.co.th",
    "shopee.vn",
    "shopee.co.id",
    "shopee.tw",
    "shopee.com.br",
    "shopee.com.mx",
    "shopee.cl",
    "shopee.com.co",
  ],
  lazada: [
    "lazada.sg",
    "lazada.com.my",
    "lazada.com.ph",
    "lazada.co.th",
    "lazada.vn",
    "lazada.co.id",
  ],
  temu: ["temu.com"],
} as const;

type MarketplaceWebMarketplace = keyof typeof MARKETPLACE_WEB_ROOTS;

type StudioCompetitorUrlSource = {
  provider: string;
  marketplace: string;
  url: string;
};

function isMarketplaceWebMarketplace(value: string): value is MarketplaceWebMarketplace {
  return value === "shopee" || value === "lazada" || value === "temu";
}

function isOfficialMarketplaceHostname(hostname: string, marketplace: MarketplaceWebMarketplace) {
  const normalized = hostname.toLocaleLowerCase().replace(/\.$/u, "");
  return MARKETPLACE_WEB_ROOTS[marketplace].some((root) => normalized === root || normalized.endsWith(`.${root}`));
}

function canonicalizeMarketplaceWebProductUrl(url: URL, marketplace: MarketplaceWebMarketplace) {
  if (url.protocol !== "https:" || url.port || url.username || url.password) return "";
  if (!isOfficialMarketplaceHostname(url.hostname, marketplace)) return "";

  if (marketplace === "shopee") {
    const slugProduct = /-i\.\d+\.\d+(?:$|\/)/iu.test(url.pathname);
    const idProduct = /\/product\/\d+\/\d+(?:$|\/)/iu.test(url.pathname);
    if (!slugProduct && !idProduct) return "";
    url.search = "";
  } else if (marketplace === "lazada") {
    if (!/-i\d+(?:-s\d+)?\.html?$/iu.test(url.pathname)) return "";
    url.search = "";
  } else {
    const pathProduct = /-g-\d+\.html?$/iu.test(url.pathname);
    const goodsId = url.searchParams.get("goods_id") ?? "";
    const queryProduct = /\/goods\.html?$/iu.test(url.pathname) && /^\d{6,32}$/u.test(goodsId);
    if (!pathProduct && !queryProduct) return "";
    url.search = "";
    if (queryProduct) url.searchParams.set("goods_id", goodsId);
  }

  url.hash = "";
  const canonicalUrl = url.toString();
  return canonicalUrl.length <= 1_000 ? canonicalUrl : "";
}

export function canonicalizeStudioCompetitorUrl(source: StudioCompetitorUrlSource) {
  try {
    const url = new URL(source.url.trim());
    const isElevenstEvidence = source.provider === "elevenst_product_search"
      && source.marketplace === "elevenst";
    const marketplaceWebMarketplace = isMarketplaceWebMarketplace(source.marketplace)
      ? source.marketplace
      : null;

    if (source.provider === "brave_marketplace_web" || marketplaceWebMarketplace) {
      if (source.provider !== "brave_marketplace_web" || !marketplaceWebMarketplace) return "";
      return canonicalizeMarketplaceWebProductUrl(url, marketplaceWebMarketplace);
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.port) return "";

    if (isElevenstEvidence) {
      if (!ELEVENST_HOSTNAME.test(url.hostname)) return "";
      url.protocol = "https:";
    } else if (url.protocol !== "https:") {
      return "";
    }

    url.username = "";
    url.password = "";
    url.hash = "";

    const canonicalUrl = url.toString();
    return canonicalUrl.length <= 1_000 ? canonicalUrl : "";
  } catch {
    return "";
  }
}
