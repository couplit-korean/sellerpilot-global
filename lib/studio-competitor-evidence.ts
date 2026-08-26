const ELEVENST_HOSTNAME = /(^|\.)11st\.co\.kr$/iu;

type StudioCompetitorUrlSource = {
  provider: string;
  marketplace: string;
  url: string;
};

export function canonicalizeStudioCompetitorUrl(source: StudioCompetitorUrlSource) {
  try {
    const url = new URL(source.url.trim());
    const isElevenstEvidence = source.provider === "elevenst_product_search"
      && source.marketplace === "elevenst";

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
