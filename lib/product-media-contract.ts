export const detailAnimatedGifMaximumUrlLength = 2_048;

const staticPosterExtensions = [".jpg", ".jpeg", ".png", ".webp", ".avif"] as const;

export type DetailAnimatedGifInput = {
  gifUrl: string;
  posterUrl: string;
  alt: string;
  caption: string;
};

export type DetailAnimatedGifIssue = "invalid_gif_url" | "invalid_poster_url" | "missing_alt" | "missing_caption";

export type ValidatedDetailAnimatedGif = {
  gifUrl: string | null;
  posterUrl: string | null;
  alt: string;
  caption: string;
  canAnimate: boolean;
  issues: DetailAnimatedGifIssue[];
};

function isPublicHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (!normalized.includes(".") || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) return false;
  if (normalized.includes(":")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  return true;
}

function validatedHttpsImageUrl(value: string, extensions: readonly string[]) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > detailAnimatedGifMaximumUrlLength) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !isPublicHostname(url.hostname)) return null;
    const pathname = url.pathname.toLowerCase();
    if (!extensions.some((extension) => pathname.endsWith(extension))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function validateDetailAnimatedGif(input: DetailAnimatedGifInput): ValidatedDetailAnimatedGif {
  const gifUrl = validatedHttpsImageUrl(input.gifUrl, [".gif"]);
  const posterUrl = validatedHttpsImageUrl(input.posterUrl, staticPosterExtensions);
  const alt = input.alt.trim();
  const caption = input.caption.trim();
  const issues: DetailAnimatedGifIssue[] = [];
  if (!gifUrl) issues.push("invalid_gif_url");
  if (!posterUrl) issues.push("invalid_poster_url");
  if (!alt) issues.push("missing_alt");
  if (!caption) issues.push("missing_caption");
  return {
    gifUrl,
    posterUrl,
    alt: alt || "상품 상세 애니메이션의 정적 대체 이미지",
    caption,
    canAnimate: issues.length === 0,
    issues,
  };
}
