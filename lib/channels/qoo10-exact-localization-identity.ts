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
  representativeImageContentId: 8461402963,
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

export type Qoo10ExactLocalizationUpdateBinding = {
  status: "allowed";
  contract: typeof qoo10ExactLocalizationUpdateContract;
  productId: string;
  listingId: string;
  credentialId: string;
  remoteId: string;
  sellerSku: string;
  releaseSha: string;
};

export type Qoo10ExactLocalizationLedgerCandidate = {
  channel?: string | null;
  productId?: string | null;
  listingId?: string | null;
  remoteId?: string | null;
  market?: string | null;
  targetId?: string | null;
  status?: string | null;
  failureClass?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
};

/**
 * The v2 localization permit retires one historical, uncertain Qoo10 update.
 * It is deliberately narrower than the generic external-action recovery
 * predicates: only the immutable production tuple installed by migration
 * 20260831144000 may enter the server-owned one-shot path.
 */
export function qoo10ExactLocalizationLedgerCandidate(
  input: Qoo10ExactLocalizationLedgerCandidate,
) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  return input.channel === "qoo10"
    && input.productId === identity.productId
    && input.listingId === identity.listingId
    && input.remoteId === identity.remoteId
    && input.market === identity.market
    && input.targetId === identity.targetId
    && input.status === "failed"
    && input.failureClass === "external_action"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown";
}

export function qoo10ExactLocalizationRequestCandidate(
  input: Qoo10ExactLocalizationLedgerCandidate & {
    credentialId?: string | null;
  },
) {
  return input.credentialId === qoo10ExactLocalizationRecoveryIdentity.credentialId
    && qoo10ExactLocalizationLedgerCandidate(input);
}

export function qoo10ExactLocalizationCentralSkuVerified(value: unknown) {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const product = context.product && typeof context.product === "object"
      && !Array.isArray(context.product)
    ? context.product as Record<string, unknown>
    : {};
  const manualFields = context.manualFields
      && typeof context.manualFields === "object"
      && !Array.isArray(context.manualFields)
    ? context.manualFields as Record<string, unknown>
    : {};
  const productSku = typeof product.sku === "string" ? product.sku.trim() : "";
  const manualSku = typeof manualFields.sellerSku === "string"
    ? manualFields.sellerSku.trim()
    : "";
  const expected = qoo10ExactLocalizationRecoveryIdentity.sellerSku;
  return (productSku === expected || manualSku === expected)
    && (!productSku || productSku === expected)
    && (!manualSku || manualSku === expected);
}

export function qoo10ExactLocalizationUpdateBinding(
  argumentsValue: Record<string, unknown>,
): Qoo10ExactLocalizationUpdateBinding | null {
  const rawMarker = argumentsValue[qoo10ExactLocalizationUpdateArgument];
  const marker = rawMarker && typeof rawMarker === "object" && !Array.isArray(rawMarker)
    ? rawMarker as Record<string, unknown>
    : {};
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  const expectedKeys = new Set([
    "status",
    "contract",
    "productId",
    "listingId",
    "credentialId",
    "remoteId",
    "sellerSku",
    "releaseSha",
  ]);
  if (Object.keys(marker).length !== expectedKeys.size
      || !Object.keys(marker).every((key) => expectedKeys.has(key))
      || marker.status !== "allowed"
      || marker.contract !== qoo10ExactLocalizationUpdateContract
      || marker.productId !== identity.productId
      || marker.listingId !== identity.listingId
      || marker.credentialId !== identity.credentialId
      || marker.remoteId !== identity.remoteId
      || marker.sellerSku !== identity.sellerSku
      || typeof marker.releaseSha !== "string"
      || !/^[a-f0-9]{40}$/u.test(marker.releaseSha)) return null;
  return structuredClone(marker) as Qoo10ExactLocalizationUpdateBinding;
}

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
