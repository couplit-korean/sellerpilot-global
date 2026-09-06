import type { naverRequest } from "./protocols";

type RecordValue = Record<string, unknown>;
type Request = (input: Omit<Parameters<typeof naverRequest>[0], "accessToken">) => ReturnType<typeof naverRequest>;
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function id(value: unknown) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  const text = String(value ?? "").trim();
  return /^[1-9][0-9]{5,19}$/.test(text) ? text : "";
}
function aliasesMatch(values: unknown[], expected: string) {
  return values.filter(value => value !== undefined && value !== null && value !== "")
    .every(value => id(value) === expected);
}
function sku(origin: RecordValue) {
  return String(record(record(origin.detailAttribute).sellerCodeInfo).sellerManagementCode ?? "").trim();
}
function critical(origin: RecordValue) {
  const images = record(origin.images);
  return JSON.stringify({
    statusType: origin.statusType, name: origin.name, leafCategoryId: origin.leafCategoryId,
    salePrice: origin.salePrice, stockQuantity: origin.stockQuantity, detailContent: origin.detailContent,
    representative: record(images.representativeImage).url,
    optional: Array.isArray(images.optionalImages) ? images.optionalImages.map(x => record(x).url) : images.optionalImages,
  });
}

/** Official v2 GET bodies need not echo IDs. A complete unique seller-code
 * search and exact GET paths bind the pair; every present ID must still match.
 * All reads finish before an image upload or product mutation is permitted. */
export async function readSmartstoreUpdateIdentity(input: {
  request: Request;
  originProductNo: string;
  sellerSku?: string;
  expectedChannelProductNo?: string;
}) {
  if (!id(input.originProductNo)) throw new Error("NAVER_UPDATE_IDENTITY_INPUT_INVALID");
  let sellerSku = String(input.sellerSku ?? "").trim();
  if (!sellerSku) {
    const discovery = await input.request({
      method: "GET",
      path: `/v2/products/origin-products/${input.originProductNo}`,
    });
    const discoveryOriginProduct = record(discovery.data.originProduct);
    sellerSku = sku(discoveryOriginProduct);
    if (discovery.response.status !== 200 || discovery.data.code
        || !Object.keys(discoveryOriginProduct).length || !sellerSku
        || !aliasesMatch([
          discovery.data.originProductNo,
          discoveryOriginProduct.originProductNo,
        ], input.originProductNo)) {
      throw new Error("NAVER_UPDATE_SELLER_CODE_DISCOVERY_FAILED");
    }
  }
  const search = await input.request({ method: "POST", path: "/v1/products/search", body: {
    searchKeywordType: "SELLER_CODE", sellerManagementCode: sellerSku,
    page: 1, size: 50, orderType: "NO",
  } });
  const data = search.data;
  if (search.response.status !== 200 || data.code || !Array.isArray(data.contents)
      || data.page !== 1 || data.size !== 50 || data.first !== true || data.last !== true
      || !Number.isSafeInteger(data.totalElements) || data.totalElements !== data.contents.length
      || data.totalPages !== (data.contents.length === 0 ? 0 : 1)) {
    throw new Error("NAVER_UPDATE_SEARCH_PREFLIGHT_FAILED");
  }
  const matches = data.contents.flatMap(value => {
    const row = record(value);
    if (!id(row.originProductNo) || !Array.isArray(row.channelProducts)) return [];
    return row.channelProducts.flatMap(value => {
      const channel = record(value);
      if (String(channel.sellerManagementCode ?? "").trim() !== sellerSku) return [];
      const originProductNo = id(row.originProductNo);
      const channelProductNo = id(channel.channelProductNo);
      if (!channelProductNo || !aliasesMatch([channel.originProductNo], originProductNo)
          || !aliasesMatch([channel.smartstoreChannelProductNo], channelProductNo)) {
        throw new Error("NAVER_UPDATE_SEARCH_IDENTITY_MISMATCH");
      }
      return [{ originProductNo, channelProductNo }];
    });
  });
  if (matches.length !== 1 || matches[0].originProductNo !== input.originProductNo
      || (input.expectedChannelProductNo && matches[0].channelProductNo !== input.expectedChannelProductNo)) {
    throw new Error("NAVER_UPDATE_SEARCH_IDENTITY_MISMATCH");
  }
  const { originProductNo, channelProductNo } = matches[0];
  const origin = await input.request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
  const currentOriginProduct = record(origin.data.originProduct);
  const embedded = record(origin.data.smartstoreChannelProduct);
  if (origin.response.status !== 200 || origin.data.code || !Object.keys(currentOriginProduct).length
      || sku(currentOriginProduct) !== sellerSku
      || !aliasesMatch([origin.data.originProductNo, currentOriginProduct.originProductNo, embedded.originProductNo], originProductNo)
      || !aliasesMatch([origin.data.channelProductNo, origin.data.smartstoreChannelProductNo,
        embedded.channelProductNo, embedded.smartstoreChannelProductNo], channelProductNo)) {
    throw new Error("NAVER_UPDATE_ORIGIN_PREFLIGHT_FAILED");
  }
  const channel = await input.request({ method: "GET", path: `/v2/products/channel-products/${channelProductNo}` });
  const currentChannelProduct = record(channel.data.smartstoreChannelProduct);
  const channelOrigin = record(channel.data.originProduct);
  const channelSku = String(currentChannelProduct.sellerManagementCode ?? "").trim();
  if (channel.response.status !== 200 || channel.data.code || !Object.keys(currentChannelProduct).length
      || !Object.keys(channelOrigin).length || sku(channelOrigin) !== sellerSku
      || (channelSku && channelSku !== sellerSku)
      || !aliasesMatch([channel.data.originProductNo, channelOrigin.originProductNo, currentChannelProduct.originProductNo], originProductNo)
      || !aliasesMatch([channel.data.channelProductNo, channel.data.smartstoreChannelProductNo,
        currentChannelProduct.channelProductNo, currentChannelProduct.smartstoreChannelProductNo], channelProductNo)
      || critical(currentOriginProduct) !== critical(channelOrigin)) {
    throw new Error("NAVER_UPDATE_CHANNEL_PREFLIGHT_FAILED");
  }
  return { originProductNo, channelProductNo, sellerSku, currentOriginProduct, currentChannelProduct };
}
