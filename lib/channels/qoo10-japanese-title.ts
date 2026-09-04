const reviewedJapaneseFallbackTitlePrefix = "販売者確認済み商品情報・購入前のご案内 - ";
const legacyReviewedJapaneseFallbackSuffix = " - 購入前確認";
const reviewedJapaneseCommerceTokens: ReadonlyMap<string, string> = new Map([
  ["부착형", "貼り付け式"],
  ["부착식", "貼り付け式"],
  ["접착식", "粘着式"],
  ["케이블", "ケーブル"],
  ["정리", "整理"],
  ["정리용", "整理用"],
  ["클립", "クリップ"],
  ["홀더", "ホルダー"],
  ["세트", "セット"],
]);

function scriptCount(text: string, expression: RegExp) {
  return (text.match(expression) ?? []).length;
}

function japaneseTitleLanguageVerified(value: string) {
  const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const letterCount = scriptCount(text, /\p{L}/gu);
  if (letterCount < 3) return false;
  const hangul = scriptCount(text, /\p{Script=Hangul}/gu);
  const kana = scriptCount(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = scriptCount(text, /\p{Script=Han}/gu);
  const thai = scriptCount(text, /\p{Script=Thai}/gu);
  const japaneseScript = kana + han;
  return japaneseScript >= Math.max(2, Math.ceil(letterCount * 0.25))
    && hangul === 0
    && thai === 0
    && kana >= 1;
}

function clippedCodePoints(value: string, maximum: number) {
  return Array.from(value).slice(0, maximum).join("");
}

export function buildReviewedJapaneseFallbackTitle(productName: string) {
  const normalizedName = productName.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const boundedName = clippedCodePoints(normalizedName, 52);
  return boundedName
    ? `${reviewedJapaneseFallbackTitlePrefix}${boundedName}`
    : reviewedJapaneseFallbackTitlePrefix.slice(0, -3);
}

export function reviewedJapaneseCommerceProductName(value: string) {
  const tokens = value.normalize("NFKC").replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const translated = tokens.map((token) => {
    const counted = /^(\d+)개$/u.exec(token);
    if (counted) return `${counted[1]}個`;
    return reviewedJapaneseCommerceTokens.get(token) ?? null;
  });
  if (translated.some((token) => token === null)) return null;
  const candidate = translated.join("");
  return japaneseTitleLanguageVerified(candidate) ? candidate : null;
}

export function repairLegacyQoo10JapaneseFallbackTitle(value: string, sourceProductName?: string) {
  if (!value.endsWith(legacyReviewedJapaneseFallbackSuffix)
      || japaneseTitleLanguageVerified(value)) {
    return value;
  }
  const legacyName = value.slice(0, -legacyReviewedJapaneseFallbackSuffix.length).trim();
  // The reviewed fallback romanizes Hangul before appending the exact legacy
  // suffix. Do not reinterpret a seller-authored Hangul title as that fallback.
  if (!legacyName || /\p{Script=Hangul}/u.test(legacyName)) return value;
  const reviewedCommerceName = sourceProductName
    ? reviewedJapaneseCommerceProductName(sourceProductName)
    : null;
  if (reviewedCommerceName) return reviewedCommerceName;
  const repaired = buildReviewedJapaneseFallbackTitle(legacyName);
  return japaneseTitleLanguageVerified(repaired) ? repaired : value;
}

function escapeQoo10Html(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}

function japaneseCategoryLeaf(categoryPath: readonly string[]) {
  return [...categoryPath].reverse().find((part) => {
    const text = part.normalize("NFKC").trim();
    return Boolean(text)
      && !/\p{Script=Hangul}/u.test(text)
      && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
  })?.normalize("NFKC").trim() ?? "";
}

export type Qoo10JapaneseListingCopy = {
  title: string;
  shortDescription: string;
  description: string;
};

/**
 * Qoo10 Japan rejects Hangul in ItemTitle/ItemDescription. When the operator
 * has confirmed a Japanese leaf category but the localization studio has not
 * approved channel copy yet, assemble a Japanese-only, operator-editable
 * fallback from that leaf. Do not copy Korean product facts into the payload.
 */
export function qoo10JapaneseListingCopyFromCategory(
  categoryPath: readonly string[],
  productName = "",
): Qoo10JapaneseListingCopy | null {
  const leaf = japaneseCategoryLeaf(categoryPath);
  const title = clippedCodePoints(
    leaf ? `${leaf}の販売者確認済み商品` : "販売者確認済み商品情報・購入前のご案内",
    100,
  );
  if (!japaneseTitleLanguageVerified(title)) return null;
  const shortDescription = `${leaf || "商品"}の出品情報です。購入前に内容をご確認ください。`;
  const latinProductName = productName.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const description = [
    `販売者が確認した${leaf || "商品"}です。`,
    "購入前に商品名、内容量、原材料表示をご確認ください。",
    "価格、在庫、配送条件は出品情報をご覧ください。",
    latinProductName && !/\p{Script=Hangul}/u.test(latinProductName)
      ? `確認済み商品名: ${latinProductName}`
      : "",
  ].filter(Boolean).join("");
  if (/\p{Script=Hangul}/u.test(`${shortDescription}${description}`)) return null;
  return { title, shortDescription, description };
}

export function qoo10JapaneseFallbackItemDescription(
  copy: Qoo10JapaneseListingCopy,
  imageUrls: readonly string[],
) {
  const images = imageUrls
    .filter((url) => url.startsWith("https://"))
    .slice(0, 8)
    .map((url) => `<img src="${escapeQoo10Html(url)}">`)
    .join("");
  return [
    `<div lang="ja-JP" data-sellerpilot-qoo10-fallback="category-copy">`,
    `<h1>${escapeQoo10Html(copy.title)}</h1>`,
    `<p>${escapeQoo10Html(copy.shortDescription)}</p>`,
    `<p>${escapeQoo10Html(copy.description)}</p>`,
    images,
    "</div>",
  ].join("");
}
