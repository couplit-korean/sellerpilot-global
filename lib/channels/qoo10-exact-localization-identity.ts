export const qoo10ExactLocalizationRecoveryIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
  credentialId: "2b49d081-5188-4a75-9555-e0a6438e8a2b",
  ownerId: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  sellerAccountKey: "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46",
  remoteId: "1217336970",
  sellerSku: "QA-20260823-CC-001",
  categoryCode: "320000542",
  market: "JP",
  targetId: "",
  locale: "ja-JP",
  currency: "JPY",
  priceJpy: 1871,
  quantity: 1,
  shippingNo: "806971",
  title: "貼り付け式ケーブル整理クリップ6個セット",
  sourceKeyword: "貼り付け式ケーブル整理クリップ6個セット,No Brand,購入前確認",
  providerKeyword: "No Brand,購入前確認",
  promotionName: "購入前確認",
  legacyRomanizedName: "buchakhyeong keibeul jeongri keulrip 6gae seteu",
});

export const qoo10ExactLocalizationUpdateArgument =
  "sellerpilotQoo10ExactLocalization" as const;
export const qoo10ExactLocalizationUpdateContract =
  "qoo10_exact_localization_update_v2" as const;

function exactLocalizationHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && !url.hash;
  } catch {
    return false;
  }
}

export function qoo10ExactReviewedJapaneseDetail(
  detailImageUrls: readonly string[],
) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  if (detailImageUrls.length !== 8
      || new Set(detailImageUrls).size !== 8
      || !detailImageUrls.every(exactLocalizationHttpsUrl)) {
    throw new Error("QOO10_EXACT_LOCALIZATION_IMAGES_REQUIRED");
  }
  return [
    '<section lang="ja-JP">',
    `<h1>${identity.title}</h1>`,
    "<p>ケーブルをすっきり整理できる貼り付け式クリップの6個セットです。</p>",
    `<p>販売価格は${identity.priceJpy.toLocaleString("ja-JP")}円です。購入前にサイズ、設置面、内容物をご確認ください。</p>`,
    "</section>",
    '<section data-sellerpilot-detail-images="true">',
    ...detailImageUrls.map((url, index) => (
      `<img src="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" alt="商品詳細画像 ${index + 1}">`
    )),
    "</section>",
  ].join("");
}
