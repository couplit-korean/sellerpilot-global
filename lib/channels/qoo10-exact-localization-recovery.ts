import {
  listingPublicationLanguageVerified,
  normalizedListingPublicationText,
} from "./listing-publication-content";
import {
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateBinding,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationContract,
  type Qoo10ExactAdoptedLocalizationBinding as Qoo10ExactAdoptedLocalizationBindingValue,
  type Qoo10ExactLocalizationUpdateBinding,
} from "./qoo10-exact-localization-identity";
import { qoo10DetailImageUrls } from "./qoo10-listing-create-preflight";

export {
  qoo10ExactAdoptedLiveListingCandidate,
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationBinding,
  qoo10ExactAdoptedLocalizationContract,
  qoo10ExactLocalizationCentralSkuVerified,
  qoo10ExactLocalizationLedgerCandidate,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationRequestCandidate,
  qoo10ExactReviewedJapaneseDetail,
  qoo10ExactLocalizationUpdateBinding,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
  type Qoo10ExactLocalizationUpdateBinding,
  type Qoo10ExactAdoptedLocalizationBinding,
} from "./qoo10-exact-localization-identity";

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(record: UnknownRecord, aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLocaleLowerCase()));
  const value = Object.entries(record)
    .find(([key]) => normalizedAliases.has(key.toLocaleLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function aliasesConsistent(record: UnknownRecord, aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLocaleLowerCase()));
  const values = Object.entries(record)
    .filter(([key]) => normalizedAliases.has(key.toLocaleLowerCase()))
    .map(([, value]) => typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "");
  return values.length <= 1 || new Set(values).size === 1;
}

function matchingItems(
  value: unknown,
  depth = 0,
  found: UnknownRecord[] = [],
): UnknownRecord[] {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const child of value) matchingItems(child, depth + 1, found);
    return found;
  }
  const candidate = recordValue(value);
  if (!Object.keys(candidate).length) return found;
  const identities = ["ItemNo", "ItemCode", "GdNo"]
    .filter((alias) => Object.hasOwn(candidate, alias))
    .map((alias) => exactText(candidate, [alias]));
  if (identities.length > 0 && identities.every((identity) => (
    identity === qoo10ExactLocalizationRecoveryIdentity.remoteId
  ))) found.push(candidate);
  for (const child of Object.values(candidate)) matchingItems(child, depth + 1, found);
  return found;
}

function safeHttpsUrl(value: string) {
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

function localizationComparable(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "");
}

export function bindQoo10ExactLocalizationUpdateArguments(
  argumentsValue: UnknownRecord,
  releaseSha: string,
) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  if (!/^[a-f0-9]{40}$/u.test(releaseSha)) {
    throw new Error("QOO10_EXACT_LOCALIZATION_RELEASE_INVALID");
  }
  return {
    ...argumentsValue,
    [qoo10ExactLocalizationUpdateArgument]: {
      status: "allowed",
      contract: qoo10ExactLocalizationUpdateContract,
      productId: identity.productId,
      listingId: identity.listingId,
      credentialId: identity.credentialId,
      remoteId: identity.remoteId,
      sellerSku: identity.sellerSku,
      releaseSha,
    } satisfies Qoo10ExactLocalizationUpdateBinding,
  };
}

export function bindQoo10ExactAdoptedLocalizationArguments(
  argumentsValue: UnknownRecord,
  binding: Omit<Qoo10ExactAdoptedLocalizationBindingValue, "status" | "contract" | "sourceJobId">,
) {
  return {
    ...argumentsValue,
    [qoo10ExactAdoptedLocalizationArgument]: {
      status: "allowed",
      contract: qoo10ExactAdoptedLocalizationContract,
      sourceJobId: "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
      ...binding,
    } satisfies Qoo10ExactAdoptedLocalizationBindingValue,
  };
}

const qoo10ExactAdoptedDetailSections = Object.freeze([
  {
    type: "overview",
    imageAsset: "detail-overview",
    heading: "商品概要",
    body: "貼り付け式ケーブル整理クリップを6個まとめたセットです。デスクや作業スペースで散らばりやすいケーブルを決めた位置へ案内し、配線を見やすく整えるための商品です。購入前に設置場所と必要個数をご確認ください。",
    buyerQuestion: "セット内容と使用目的を購入前に確認できますか？",
    evidence: "販売者が確認した商品名、セット数量、承認済みの商品画像に基づく案内です。",
  },
  {
    type: "feature",
    imageAsset: "detail-feature",
    heading: "形状と特徴",
    body: "黒色の小型クリップ形状で、ケーブルを通す部分と設置面へ貼り付ける部分を備えています。机まわりの配線位置をそろえたい場合に使える構成です。画像で形状と開口部を確認してからご購入ください。",
    buyerQuestion: "クリップの形状と色を画像で確認できますか？",
    evidence: "販売者が承認した特徴画像と商品写真で確認できる外観だけを説明しています。",
  },
  {
    type: "howto",
    imageAsset: "detail-use",
    heading: "使用方法",
    body: "設置面のほこり、水分、油分を取り除き、十分に乾いた状態で貼り付けてください。貼り付け後はクリップへケーブルを通し、無理な力がかからない位置へ整えます。接着状態を確認してから使用してください。",
    buyerQuestion: "貼り付け前の準備と基本的な使い方を確認できますか？",
    evidence: "販売者が確認した貼り付け式クリップの使用手順を、未確認の性能表現を加えず記載しています。",
  },
  {
    type: "proof",
    imageAsset: "detail-package",
    heading: "梱包と受取確認",
    body: "本商品は小型クリップ6個のセットとして案内しています。受け取り後は開封時に内容物の個数と外観をご確認ください。小型部品のため、開封や保管の際は紛失しないよう取り扱ってください。",
    buyerQuestion: "到着後に確認する内容物と個数を確認できますか？",
    evidence: "販売者が確認した6個セット情報と承認済み梱包画像に基づく案内です。",
  },
  {
    type: "contents",
    imageAsset: "detail-contents",
    heading: "セット内容",
    body: "販売内容は貼り付け式ケーブル整理クリップ6個です。ケーブル、充電器、机などの撮影用小物は商品に含まれません。画像は使用例を含むため、購入対象となるクリップの数量を確認してからご注文ください。",
    buyerQuestion: "商品に含まれる物と含まれない物を確認できますか？",
    evidence: "販売者が確定した6個セットの販売単位と承認済み内容物画像に基づく説明です。",
  },
  {
    type: "routine",
    imageAsset: "detail-routine",
    heading: "使用前の確認",
    body: "使用前に設置面とケーブルの太さ、クリップを置く位置をご確認ください。仮の位置で配線の流れを整えてから設置すると、必要な間隔を判断しやすくなります。貼り付け後も定期的に固定状態をご確認ください。",
    buyerQuestion: "設置位置を決める前の確認事項を確認できますか？",
    evidence: "販売者が確認した用途に沿い、購入者が設置前後に確認できる事項を整理しています。",
  },
  {
    type: "care",
    imageAsset: "detail-care",
    heading: "使用上の注意",
    body: "設置面の材質、凹凸、汚れ、湿気などにより貼り付き方が異なる場合があります。目立たない場所で状態を確認し、強い荷重や急な引っ張りを避けてください。小型部品は子どもの手が届かない場所で保管してください。",
    buyerQuestion: "設置面と取り扱いに関する注意事項を確認できますか？",
    evidence: "未確認の耐荷重や材質を断定せず、貼り付け式小型部品として必要な注意だけを記載しています。",
  },
  {
    type: "spec",
    imageAsset: "detail-dimensions",
    heading: "サイズ確認",
    body: "クリップとケーブルの適合は、使用するケーブルの太さや設置方法によって異なります。購入前に承認済み画像でクリップの形状とケーブルを通す部分をご確認ください。未確認の寸法値は掲載していません。",
    buyerQuestion: "ケーブルとの適合を購入前にどのように確認しますか？",
    evidence: "承認済み寸法確認画像を使用し、販売者が確定していない数値を推測せず案内しています。",
  },
] as const);

export function qoo10ExactAdoptedLocalizedDetailSections() {
  const title = qoo10ExactLocalizationRecoveryIdentity.title;
  return qoo10ExactAdoptedDetailSections.map((section) => ({
    ...section,
    imageAltText: `${title} ${section.heading} 商品詳細画像`,
  }));
}

export function qoo10ExactAdoptedJapaneseDetailBase() {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  return [
    '<section lang="ja-JP">',
    `<h1>${identity.title}</h1>`,
    "<p>貼り付け式ケーブル整理クリップを6個まとめたセットです。デスクや作業スペースの配線を見やすく整える用途でお使いいただけます。</p>",
    `<p>販売価格は${identity.priceJpy.toLocaleString("ja-JP")}円です。購入前にセット内容、設置面、ケーブルとの適合をご確認ください。</p>`,
    "</section>",
  ].join("");
}

/**
 * Rebind the immutable commerce carriers for the already-live Qoo10 cleanup.
 * The browser draft is not authoritative for these values, and the adopted
 * content-only operation must never upload a replacement representative image.
 */
export function bindQoo10ExactAdoptedCommerceArguments(
  argumentsValue: UnknownRecord,
) {
  const identity = qoo10ExactLocalizationRecoveryIdentity;
  const localizedDetailSections = qoo10ExactAdoptedLocalizedDetailSections();
  const params: UnknownRecord = {
    ...recordValue(argumentsValue.params),
    ItemCode: identity.remoteId,
    SellerCode: identity.sellerSku,
    SecondSubCat: identity.categoryCode,
    ItemTitle: identity.title,
    PromotionName: identity.promotionName,
    Keyword: identity.sourceKeyword,
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    AdultYN: "N",
    RetailPrice: String(identity.priceJpy),
    ItemPrice: String(identity.priceJpy),
    ItemQty: String(identity.quantity),
    ShippingNo: identity.shippingNo,
    ItemDescription: qoo10ExactAdoptedJapaneseDetailBase(),
  };
  delete params.StandardImage;
  return {
    ...argumentsValue,
    sellerpilotAssets: {
      ...recordValue(argumentsValue.sellerpilotAssets),
      contentMode: "ai_generated",
      detailAssetMode: "dedicated",
      detailImageRoles: localizedDetailSections.map((section) => section.imageAsset),
      detailImageAltTexts: localizedDetailSections.map((section) => section.imageAltText),
      localizedDetailSections,
      classification: {
        displayName: "販売者確認分類: ケーブル整理クリップ",
        evidence: "販売者が確認した商品情報と承認済み画像に基づく分類です。",
        verificationStatus: "verified",
        isHealthFunctionalFood: false,
      },
    },
    params,
  };
}

const qoo10ExactForbiddenRomanizedTokens = Object.freeze([
  "buchakhyeong",
  "keibeul",
  "jeongri",
  "keulrip",
  "6gae",
  "seteu",
  // This colour label remained in the live S1 detail after the product-name
  // repair. Keep the block scoped to the one exact recovery item instead of
  // applying a speculative romanization dictionary to every Qoo10 listing.
  "geomjeongsaek",
]);

export function qoo10ExactLegacyRomanizedCopyPresent(value: string) {
  const comparable = localizationComparable(value);
  return qoo10ExactForbiddenRomanizedTokens
    .map(localizationComparable)
    .some((token) => token.length >= 4 && comparable.includes(token));
}

export function qoo10ExactForeignPriceCopyPresent(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  return /(?:^|[^a-z])krw(?:$|[^a-z])/u.test(normalized)
    || normalized.includes("₩")
    || /\d[\d,.\s]*\s*원/u.test(normalized)
    || normalized.includes("ウォン");
}

export function qoo10ExactTargetCreateForbidden(argumentsValue: UnknownRecord) {
  const params = recordValue(argumentsValue.params);
  const sellerCode = exactText(params, ["SellerCode"]);
  const itemCode = exactText(params, ["ItemCode"]);
  const title = exactText(params, ["ItemTitle"]);
  const category = exactText(params, ["SecondSubCat"]);
  return itemCode === qoo10ExactLocalizationRecoveryIdentity.remoteId
    || sellerCode === qoo10ExactLocalizationRecoveryIdentity.sellerSku
    || sellerCode.startsWith(`${qoo10ExactLocalizationRecoveryIdentity.sellerSku}-R`)
    || (title === qoo10ExactLocalizationRecoveryIdentity.title
      && category === qoo10ExactLocalizationRecoveryIdentity.categoryCode);
}

export type Qoo10ExactLocalizedUpdate = {
  detailHtml: string;
  detailImageUrls: string[];
};

export function qoo10ExactLocalizedUpdate(
  argumentsValue: UnknownRecord,
  remoteId: string,
  requireServerBinding = false,
): Qoo10ExactLocalizedUpdate | null {
  if (remoteId !== qoo10ExactLocalizationRecoveryIdentity.remoteId) return null;
  const params = recordValue(argumentsValue.params);
  const title = exactText(params, ["ItemTitle"]);
  const keyword = exactText(params, ["Keyword"]);
  const detailHtml = typeof params.ItemDescription === "string" ? params.ItemDescription : "";
  const description = normalizedListingPublicationText(detailHtml);
  const detailImageUrls = qoo10DetailImageUrls(detailHtml);
  const legacyCopy = `${title}\n${keyword}\n${description}`;
  const exactV2Commerce = !requireServerBinding || (
    Boolean(qoo10ExactLocalizationUpdateBinding(argumentsValue))
    && exactText(params, ["RetailPrice"]) === String(qoo10ExactLocalizationRecoveryIdentity.priceJpy)
    && exactText(params, ["ItemPrice"]) === String(qoo10ExactLocalizationRecoveryIdentity.priceJpy)
    && exactText(params, ["ItemQty"]) === String(qoo10ExactLocalizationRecoveryIdentity.quantity)
    && exactText(params, ["ShippingNo"]) === qoo10ExactLocalizationRecoveryIdentity.shippingNo
    && exactText(params, ["PromotionName"]) === qoo10ExactLocalizationRecoveryIdentity.promotionName
  );
  if (!exactV2Commerce
      || exactText(params, ["ItemCode"]) !== qoo10ExactLocalizationRecoveryIdentity.remoteId
      || exactText(params, ["SellerCode"]) !== qoo10ExactLocalizationRecoveryIdentity.sellerSku
      || exactText(params, ["SecondSubCat"]) !== qoo10ExactLocalizationRecoveryIdentity.categoryCode
      || title !== qoo10ExactLocalizationRecoveryIdentity.title
      || keyword !== qoo10ExactLocalizationRecoveryIdentity.sourceKeyword
      || !description.includes(qoo10ExactLocalizationRecoveryIdentity.title)
      || qoo10ExactLegacyRomanizedCopyPresent(legacyCopy)
      || qoo10ExactForeignPriceCopyPresent(legacyCopy)
      || !listingPublicationLanguageVerified("ja-JP", title, "title")
      || !listingPublicationLanguageVerified("ja-JP", description, "description")
      || detailImageUrls.length !== 8
      || new Set(detailImageUrls).size !== 8
      || !detailImageUrls.every(safeHttpsUrl)) {
    throw new Error("QOO10_EXACT_LOCALIZED_UPDATE_INVALID");
  }
  return { detailHtml, detailImageUrls };
}

export function verifyQoo10ExactCurrentS1Readback(input: {
  resultObject: unknown;
  expectedDetailImageUrls: readonly string[];
}) {
  const matches = matchingItems(input.resultObject);
  const item = matches.length === 1 ? matches[0] : {};
  const status = exactText(item, ["ItemStatus", "Status"]).toLocaleUpperCase();
  const sellerCode = exactText(item, ["SellerCode"]);
  const categoryCode = exactText(item, ["SecondSubCatCd", "SecondSubCat", "CategoryCode"]);
  const currentDetailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const currentDetailImageUrls = qoo10DetailImageUrls(currentDetailHtml);
  const checks = {
    uniqueRemoteIdentityVerified: matches.length === 1,
    identityAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["ItemNo", "ItemCode", "GdNo"]),
    statusAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["ItemStatus", "Status"]),
    currentStatusS1Verified: status === "S1" || status === "1",
    sellerSkuAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["SellerCode"]),
    sellerSkuVerified: sellerCode === qoo10ExactLocalizationRecoveryIdentity.sellerSku,
    categoryAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["SecondSubCatCd", "SecondSubCat", "CategoryCode"]),
    categoryVerified: categoryCode === qoo10ExactLocalizationRecoveryIdentity.categoryCode,
    approvedEightImagesPreserved: currentDetailImageUrls.length === 8
      && currentDetailImageUrls.every((url, index) => url === input.expectedDetailImageUrls[index]),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    providerStatus: status,
    currentDetailImageUrls,
  };
}

function exactWholeNumber(record: UnknownRecord, aliases: readonly string[]) {
  const value = exactText(record, aliases);
  if (!/^\d+(?:\.0+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function exactRepresentativeImagePreserved(value: string) {
  const contentId = String(qoo10ExactLocalizationRecoveryIdentity.representativeImageContentId);
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "gd.image-qoo10.jp"
      && url.pathname.includes(`/${contentId}.g`);
  } catch {
    return false;
  }
}

export function verifyQoo10ExactAdoptedLiveReadback(input: {
  resultObject: unknown;
  expectedDetailImageUrls: readonly string[];
  expectedDetailHtml: string;
  phase: "prewrite" | "postwrite";
}) {
  const matches = matchingItems(input.resultObject);
  const item = matches.length === 1 ? matches[0] : {};
  const status = exactText(item, ["ItemStatus", "Status"]).toLocaleUpperCase();
  const detailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const currentDetailImageUrls = qoo10DetailImageUrls(detailHtml);
  const checks = {
    uniqueRemoteIdentityVerified: matches.length === 1,
    identityAliasesConsistent: matches.length === 1
      && aliasesConsistent(item, ["ItemNo", "ItemCode", "GdNo"]),
    sellingS2Preserved: status === "S2" || status === "2",
    sellerSkuVerified: exactText(item, ["SellerCode"])
      === qoo10ExactLocalizationRecoveryIdentity.sellerSku,
    categoryVerified: exactText(item, ["SecondSubCatCd", "SecondSubCat", "CategoryCode"])
      === qoo10ExactLocalizationRecoveryIdentity.categoryCode,
    titlePreserved: exactText(item, ["ItemTitle"])
      === qoo10ExactLocalizationRecoveryIdentity.title,
    promotionPreserved: exactText(item, ["PromotionName", "PromotionNm"])
      === "販売者が確認した入力だけに基づく商品案内",
    retailPricePreserved: exactWholeNumber(item, ["RetailPrice"])
      === qoo10ExactLocalizationRecoveryIdentity.priceJpy,
    sellPricePreserved: exactWholeNumber(item, ["SellPrice", "ItemPrice"])
      === qoo10ExactLocalizationRecoveryIdentity.priceJpy,
    quantityPreserved: exactWholeNumber(item, ["ItemQty", "Qty", "StockQty"])
      === qoo10ExactLocalizationRecoveryIdentity.quantity,
    shippingPreserved: exactText(item, ["ShippingNo", "ShippingNO", "DeliveryGroupNo"])
      === qoo10ExactLocalizationRecoveryIdentity.shippingNo,
    representativeImagePreserved: exactRepresentativeImagePreserved(
      exactText(item, ["ImageUrl", "StandardImage", "MainImageUrl"]),
    ),
    approvedEightImagesPreserved: currentDetailImageUrls.length === 8
      && currentDetailImageUrls.every((url, index) => url === input.expectedDetailImageUrls[index]),
    exactBuyerVisibleDetailPreserved: input.phase === "prewrite"
      ? true
      : normalizedListingPublicationText(detailHtml)
          === normalizedListingPublicationText(input.expectedDetailHtml),
    japaneseDetailPreserved: input.phase === "prewrite"
      ? /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(detailHtml)
        && /<[^>]+\blang=["']ja-JP["']/iu.test(detailHtml)
      : listingPublicationLanguageVerified(
          "ja-JP",
          normalizedListingPublicationText(detailHtml),
          "description",
        ),
    romanizedIssueStateVerified: input.phase === "prewrite"
      ? qoo10ExactLegacyRomanizedCopyPresent(detailHtml)
      : !qoo10ExactLegacyRomanizedCopyPresent(detailHtml),
    krwIssueStateVerified: input.phase === "prewrite"
      ? qoo10ExactForeignPriceCopyPresent(detailHtml)
      : !qoo10ExactForeignPriceCopyPresent(detailHtml),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    providerStatus: status,
    currentDetailImageUrls,
  };
}
