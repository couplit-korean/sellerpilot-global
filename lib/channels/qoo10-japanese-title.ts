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
