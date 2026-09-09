import type { RemoteResponse, SecretPayload } from "../../channels/protocols";
import { validateElevenstListingProduct } from "../../channels/elevenst-listing";

export type ElevenstCreateCredentialBinding = {
  apiKeyConfigured: true;
  sellerIdConfigured: true;
};

export type ElevenstCreateReadbackVerification = {
  ok: boolean;
  mismatches: string[];
  productGetVerifiedFields: string[];
  normalizedFields: string[];
  separatelyVerifiedFields: string[];
  providerReadbackUnavailableFields: string[];
};

/**
 * Official 신규상품조회 response fields that overlap SellerPilot's CREATE
 * payload. The API does not promise to echo the complete registration XML.
 * Keep this allowlist tied to the documented response contract instead of
 * comparing every submitted field against a request-shaped fixture.
 */
export const elevenstCreateProductGetExactFields = [
  "dispCtgrNo",
  "prdNm",
  "sellerPrdCd",
  "selPrc",
  "bndlDlvCnYn",
  "rtngdDlvCst",
  "exchDlvCst",
  "asDetail",
  "htmlDetail",
] as const;

export const elevenstCreateProductGetNormalizedDateFields = [
  "aplBgnDy",
  "aplEndDy",
] as const;

export const elevenstCreateSeparatelyVerifiedFields = ["prdSelQty"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function credentialText(payload: SecretPayload, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/**
 * A Seller Office password is never accepted here. The general product-create
 * path requires the stored OPEN API key and its separately stored seller ID.
 * The ID is intentionally not compared with a product/account constant; the
 * selected credential lineage is responsible for choosing the seller.
 */
export function assertElevenstCreateCredentialBinding(
  payload: SecretPayload,
): ElevenstCreateCredentialBinding {
  const apiKey = credentialText(payload, "api_key");
  const sellerId = credentialText(payload, "seller_id");
  if (!/^[A-Za-z0-9]{32}$/u.test(apiKey)) {
    throw new Error("ELEVENST_CREATE_OPEN_API_KEY_REQUIRED");
  }
  if (
    sellerId.length < 2 ||
    sellerId.length > 100 ||
    hasControlCharacter(sellerId)
  ) {
    throw new Error("ELEVENST_CREATE_SELLER_ID_REQUIRED");
  }
  return { apiKeyConfigured: true, sellerIdConfigured: true };
}

/**
 * sellerPrdCd is a lookup key, not a provider uniqueness guarantee. Reject a
 * collection that resolves the same code to more than one remote product;
 * choosing the first row could adopt or update the wrong listing.
 */
export function elevenstSellerCodeLookupProductNo(input: {
  remote: RemoteResponse;
  sellerProductCode: string;
}): string | null {
  const rows = Array.isArray(input.remote.data.products)
    ? input.remote.data.products
    : [];
  const productNumbers = new Set<string>();
  const topLevelProductNo = String(input.remote.data.productNo ?? "").trim();
  if (topLevelProductNo) productNumbers.add(topLevelProductNo);
  for (const value of rows) {
    const row = record(value);
    if (!row) throw new Error("ELEVENST_SELLER_CODE_LOOKUP_UNVERIFIED");
    const productNo = String(row.productNo ?? "").trim();
    const sellerProductCode = String(row.sellerProductCode ?? "").trim();
    if (
      !/^\d{1,20}$/u.test(productNo) ||
      (sellerProductCode && sellerProductCode !== input.sellerProductCode)
    ) {
      throw new Error("ELEVENST_SELLER_CODE_LOOKUP_UNVERIFIED");
    }
    productNumbers.add(productNo);
  }
  if ([...productNumbers].some((value) => !/^\d{1,20}$/u.test(value))) {
    throw new Error("ELEVENST_SELLER_CODE_LOOKUP_UNVERIFIED");
  }
  if (productNumbers.size > 1) {
    throw new Error("ELEVENST_SELLER_CODE_LOOKUP_AMBIGUOUS");
  }
  return [...productNumbers][0] ?? null;
}

function normalizedScalar(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : value;
}

function normalizedOfficialDate(value: unknown) {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T].*)?$/u.exec(
    String(value ?? "").trim(),
  );
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Verify only fields guaranteed by the official 신규상품조회 Product response.
 * Request-only fields are reported explicitly, not treated as mismatches.
 * Quantity is verified by the separate official stock endpoint.
 */
export function verifyElevenstCreateProductReadback(input: {
  expectedProduct: unknown;
  remote: RemoteResponse;
  productNo: string;
}): ElevenstCreateReadbackVerification {
  const expected = validateElevenstListingProduct(input.expectedProduct);
  const actual = record(input.remote.data.product);
  const mismatches: string[] = [];
  const exactFields = new Set<string>(elevenstCreateProductGetExactFields);
  const normalizedFields = new Set<string>(
    elevenstCreateProductGetNormalizedDateFields,
  );
  const separatelyVerifiedFields = new Set<string>(
    elevenstCreateSeparatelyVerifiedFields,
  );
  const expectedFields = Object.keys(expected);
  const providerReadbackUnavailableFields = expectedFields.filter(
    (field) =>
      !exactFields.has(field) &&
      !normalizedFields.has(field) &&
      !separatelyVerifiedFields.has(field),
  );
  if (!input.remote.response.ok || input.remote.data.accepted !== true) {
    mismatches.push("response.accepted");
  }
  const responseProductNo = String(input.remote.data.productNo ?? "").trim();
  const productNodeNo = String(actual?.prdNo ?? "").trim();
  if (!/^\d{1,20}$/u.test(input.productNo)) {
    mismatches.push("expected.productNo");
  }
  if (responseProductNo !== input.productNo) {
    mismatches.push("response.productNo");
  }
  if (productNodeNo !== input.productNo) {
    mismatches.push("product.prdNo");
  }
  if (!actual) {
    mismatches.push("product");
    return {
      ok: false,
      mismatches,
      productGetVerifiedFields: [],
      normalizedFields: [...normalizedFields],
      separatelyVerifiedFields: [...separatelyVerifiedFields],
      providerReadbackUnavailableFields,
    };
  }
  const productGetVerifiedFields: string[] = [];
  for (const field of elevenstCreateProductGetExactFields) {
    const expectedValue = expected[field];
    if (!Object.hasOwn(actual, field)) {
      mismatches.push(`product.${field}`);
      continue;
    }
    if (
      JSON.stringify(normalizedScalar(actual[field])) !==
      JSON.stringify(normalizedScalar(expectedValue))
    ) {
      mismatches.push(`product.${field}`);
      continue;
    }
    productGetVerifiedFields.push(field);
  }
  for (const field of elevenstCreateProductGetNormalizedDateFields) {
    if (
      normalizedOfficialDate(actual[field]) !==
      normalizedOfficialDate(expected[field])
    ) {
      mismatches.push(`product.${field}`);
      continue;
    }
    productGetVerifiedFields.push(field);
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    productGetVerifiedFields,
    normalizedFields: [...normalizedFields],
    separatelyVerifiedFields: [...separatelyVerifiedFields],
    providerReadbackUnavailableFields,
  };
}

/**
 * 11st stock is a separate official resource. A Product prdSelQty value alone
 * is not used as stock proof. The currently supported no-option listing must
 * have exactly one saleable row whose quantity equals the create request.
 */
export function verifyElevenstCreateStockReadback(input: {
  remote: RemoteResponse;
  productNo: string;
  expectedQuantity: number;
}): ElevenstCreateReadbackVerification {
  const mismatches: string[] = [];
  if (!input.remote.response.ok || input.remote.data.accepted !== true) {
    mismatches.push("response.accepted");
  }
  if (
    !/^(?:[A-Za-z_][\w.-]*:)?ProductStocks$/u.test(
      String(input.remote.data.stockDocumentRoot ?? ""),
    )
  ) {
    mismatches.push("stocks.documentRoot");
  }
  const stocks = Array.isArray(input.remote.data.stocks)
    ? input.remote.data.stocks
    : [];
  if (stocks.length !== 1) {
    mismatches.push("stocks.length");
    return {
      ok: false,
      mismatches,
      productGetVerifiedFields: [],
      normalizedFields: [],
      separatelyVerifiedFields: ["prdSelQty"],
      providerReadbackUnavailableFields: [],
    };
  }
  const stock = record(stocks[0]);
  if (!stock) {
    mismatches.push("stocks.0");
    return {
      ok: false,
      mismatches,
      productGetVerifiedFields: [],
      normalizedFields: [],
      separatelyVerifiedFields: ["prdSelQty"],
      providerReadbackUnavailableFields: [],
    };
  }
  if (String(stock.prdNo ?? "").trim() !== input.productNo) {
    mismatches.push("stocks.0.prdNo");
  }
  if (!/^[1-9]\d{0,19}$/u.test(String(stock.prdStckNo ?? "").trim())) {
    mismatches.push("stocks.0.prdStckNo");
  }
  const quantity = String(stock.stckQty ?? "").trim();
  if (!/^\d+$/u.test(quantity) || Number(quantity) !== input.expectedQuantity) {
    mismatches.push("stocks.0.stckQty");
  }
  if (String(stock.prdStckStatCd ?? "").trim() !== "01") {
    mismatches.push("stocks.0.prdStckStatCd");
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    productGetVerifiedFields: [],
    normalizedFields: [],
    separatelyVerifiedFields: ["prdSelQty"],
    providerReadbackUnavailableFields: [],
  };
}
