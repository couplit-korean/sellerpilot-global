/** Buyer-facing chrome only. Never translates or rewrites product facts. */
export type ProductDetailLocale = "ko" | "ja" | "en";
export function resolveProductDetailLocale(data?: { root?: unknown } | null, explicit?: string): ProductDetailLocale {
  const root = data?.root as { props?: { locale?: unknown } } | undefined;
  const value = explicit ?? root?.props?.locale ?? "ko";
  const language = typeof value === "string" ? value.trim().toLowerCase().split(/[-_]/)[0] : "";
  if (language === "ko" || language === "ja" || language === "en") return language;
  throw new Error("PRODUCT_DETAIL_CHROME_LOCALE_UNSUPPORTED");
}
const ko = {
  classification: "상품 분류", health: "건강기능식품 표시", audience: "추천 대상", verified: "자료 확인 완료", needsReview: "구매 전 추가 확인", ribbonAria: "상품 분류와 확인 상태",
  checked: "자료 확인", unchecked: "확인 필요", question: "구매 전 질문", evidence: "확인 근거", pendingEvidence: "추가 확인할 근거", evidenceAria: "구매 질문과 확인 근거", productInfo: "상품 정보",
  button: "버튼 문구", buttonPreview: "마켓 버튼 문구 미리보기", heroAlt: "상품 대표 이미지",
  gifAnimated: "상세페이지에서만 재생됩니다. 판매채널 이미지 전송과는 별도입니다.", gifReduced: "동작 줄이기 설정에 따라 정적 poster로 표시합니다.", gifFailed: "GIF를 불러오지 못해 정적 poster로 표시합니다.", posterInvalid: "유효한 HTTPS 정적 poster URL이 필요합니다.", gifInvalid: "GIF URL·poster·대체텍스트·캡션을 확인해 정적 poster로 표시합니다.", posterCheck: "정적 poster URL을 확인해 주세요.", motionCaption: "상품 동작 안내",
  sections: { benefit: "핵심 효익", story: "브랜드 스토리", howto: "사용·활용", proof: "확인 근거", spec: "규격·수치", caution: "주의·제외", comparison: "선택 비교", faq: "자주 묻는 질문", notice: "필수 안내" },
};
type ChromeLabels = { [K in keyof typeof ko]: K extends "sections" ? Record<keyof typeof ko.sections, string> : string };
const ja: ChromeLabels = {
  classification: "商品分類", health: "健康機能食品の表示", audience: "おすすめの方", verified: "資料確認済み", needsReview: "購入前に要確認", ribbonAria: "商品分類と確認状況",
  checked: "資料確認", unchecked: "要確認", question: "購入前の質問", evidence: "確認根拠", pendingEvidence: "追加確認が必要な根拠", evidenceAria: "購入前の質問と確認根拠", productInfo: "商品情報",
  button: "ボタン文言", buttonPreview: "販売ページのボタン文言プレビュー", heroAlt: "商品メイン画像",
  gifAnimated: "詳細ページ内でのみ再生されます。販売チャネルへの画像送信とは別です。", gifReduced: "動きを減らす設定に従い静止画像を表示しています。", gifFailed: "GIFを読み込めないため静止画像を表示しています。", posterInvalid: "有効なHTTPS静止画像URLが必要です。", gifInvalid: "GIF URL・静止画像・代替テキスト・キャプションをご確認ください。", posterCheck: "静止画像URLをご確認ください。", motionCaption: "商品の動作紹介",
  sections: { benefit: "特徴", story: "ブランドストーリー", howto: "使い方", proof: "確認根拠", spec: "仕様・数値", caution: "注意事項", comparison: "比較", faq: "よくある質問", notice: "ご案内" },
};
const en: ChromeLabels = {
  classification: "Product category", health: "Health-functional food labelling", audience: "Who it is for", verified: "Sources checked", needsReview: "Check before purchase", ribbonAria: "Product category and verification status",
  checked: "Sources checked", unchecked: "Review needed", question: "Before you buy", evidence: "Supporting evidence", pendingEvidence: "Evidence requiring review", evidenceAria: "Buyer questions and supporting evidence", productInfo: "Product information",
  button: "Button text", buttonPreview: "Marketplace button text preview", heroAlt: "Main product image",
  gifAnimated: "Plays on this detail page only, separately from marketplace image delivery.", gifReduced: "Showing a still image according to the reduced-motion setting.", gifFailed: "The GIF could not load; showing a still image.", posterInvalid: "A valid HTTPS still-image URL is required.", gifInvalid: "Check the GIF URL, still image, alt text and caption.", posterCheck: "Check the still-image URL.", motionCaption: "Product motion overview",
  sections: { benefit: "Key features", story: "Brand story", howto: "How to use", proof: "Evidence", spec: "Specifications", caution: "Cautions", comparison: "Comparison", faq: "Frequently asked questions", notice: "Important information" },
};
export function productDetailChrome(locale: ProductDetailLocale): ChromeLabels { return { ko, ja, en }[locale]; }
