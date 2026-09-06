import {
  elevenstSellerXmlRequest,
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "./protocols";

export const elevenstCookieSellerProductCode = "AUTO-780720401E2D4E4EA45F";

const SELLERPRODCODE_PREFIX = "/rest/prodmarketservice/sellerprodcode/";
const PRODMARKET_PREFIX = "/rest/prodmarketservice/prodmarket/";

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function assertSellerProductCode(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(normalized)) {
    throw new Error("ELEVENST_SELLER_PRODUCT_CODE_INVALID");
  }
  return normalized;
}

function assertProductNo(value: string) {
  const normalized = value.trim();
  if (!/^[0-9]{1,20}$/.test(normalized)) {
    throw new Error("ELEVENST_PRODUCT_NO_INVALID");
  }
  return normalized;
}

function productRecord(value: unknown): {
  prdNo: string;
  sellerPrdCd: string;
  selStatCd: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { prdNo: "", sellerPrdCd: "", selStatCd: "" };
  }
  const record = value as Record<string, unknown>;
  return {
    prdNo: typeof record.prdNo === "string" ? record.prdNo.trim() : "",
    sellerPrdCd: typeof record.sellerPrdCd === "string" ? record.sellerPrdCd.trim() : "",
    selStatCd: typeof record.selStatCd === "string" ? record.selStatCd.trim() : "",
  };
}

function lookupFingerprint(remote: {
  response: { status: number };
  data: Record<string, unknown>;
}) {
  const resultCode = String(remote.data.resultCode ?? "").trim();
  const lookupRoot = String(remote.data.lookupDocumentRoot ?? "").trim();
  const bodyBytes = Number(remote.data.lookupBodyBytes);
  return {
    lookupHttpStatus: remote.response.status,
    resultCode,
    lookupRoot,
    bodyBytes,
    lookupResultCode: resultCode.toUpperCase().replace(/[^A-Z0-9]/gu, "_").slice(0, 40) || "NONE",
    lookupRootCode: lookupRoot.toUpperCase().replace(/[^A-Z0-9]/gu, "_").slice(0, 40) || "NONE",
    lookupBodyBytes: Number.isSafeInteger(bodyBytes) && bodyBytes >= 0 ? bodyBytes : 0,
  };
}

export type ElevenstSellerProdcodeReadResult = {
  sellerProductCode: string;
  outcome: "present" | "absent" | "unverified";
  lookupHttpStatus: number;
  lookupResultCode: string;
  lookupRoot: string;
  lookupBodyBytes: number;
  productNo: string | null;
  absentReason?: "http_404" | "result_code_404" | "official_namespaced_empty_products";
  unverifiedReason?: string;
  prodmarket: {
    httpStatus: number;
    accepted: boolean;
    productNo: string;
    sellerPrdCd: string;
    sellerProductCodeMatched: boolean;
    selStatCd: string;
  } | null;
};

export async function readElevenstSellerProdcode(input: {
  payload: SecretPayload;
  sellerProductCode: string;
}): Promise<ElevenstSellerProdcodeReadResult> {
  const sellerProductCode = assertSellerProductCode(input.sellerProductCode);
  return runWithProviderReadOnlyTransport(async () => {
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "GET",
      path: `${SELLERPRODCODE_PREFIX}${pathSegment(sellerProductCode)}`,
    });
    const fingerprint = lookupFingerprint(remote);
    const productNo = String(remote.data.productNo ?? "").trim();
    if (productNo) {
      const safeProductNo = assertProductNo(productNo);
      const readback = await elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `${PRODMARKET_PREFIX}${pathSegment(safeProductNo)}`,
      });
      const product = productRecord(readback.data.product);
      const readbackNo = String(readback.data.productNo ?? product.prdNo ?? "").trim();
      const sellerPrdCd = product.sellerPrdCd;
      return {
        sellerProductCode,
        outcome: "present",
        lookupHttpStatus: fingerprint.lookupHttpStatus,
        lookupResultCode: fingerprint.lookupResultCode,
        lookupRoot: fingerprint.lookupRootCode,
        lookupBodyBytes: fingerprint.lookupBodyBytes,
        productNo: safeProductNo,
        prodmarket: {
          httpStatus: readback.response.status,
          accepted: readback.data.accepted === true,
          productNo: readbackNo,
          sellerPrdCd,
          sellerProductCodeMatched: sellerPrdCd === sellerProductCode && readbackNo === safeProductNo,
          selStatCd: product.selStatCd,
        },
      };
    }

    const lookupProducts = Array.isArray(remote.data.products) ? remote.data.products : null;
    const verifiedEmptyCollection = remote.response.status === 200
      && remote.data.accepted === true
      && /^(?:[A-Za-z_][\w.-]*:)?products$/iu.test(fingerprint.lookupRoot)
      && lookupProducts?.length === 0
      && Number.isSafeInteger(fingerprint.bodyBytes)
      && fingerprint.bodyBytes > 0
      && fingerprint.bodyBytes <= 4_096;
    if (remote.response.status === 404 || fingerprint.resultCode === "404" || verifiedEmptyCollection) {
      return {
        sellerProductCode,
        outcome: "absent",
        lookupHttpStatus: fingerprint.lookupHttpStatus,
        lookupResultCode: fingerprint.lookupResultCode,
        lookupRoot: fingerprint.lookupRootCode,
        lookupBodyBytes: fingerprint.lookupBodyBytes,
        productNo: null,
        absentReason: remote.response.status === 404
          ? "http_404"
          : fingerprint.resultCode === "404"
            ? "result_code_404"
            : "official_namespaced_empty_products",
        prodmarket: null,
      };
    }

    return {
      sellerProductCode,
      outcome: "unverified",
      lookupHttpStatus: fingerprint.lookupHttpStatus,
      lookupResultCode: fingerprint.lookupResultCode,
      lookupRoot: fingerprint.lookupRootCode,
      lookupBodyBytes: fingerprint.lookupBodyBytes,
      productNo: null,
      unverifiedReason:
        `ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED:HTTP_${fingerprint.lookupHttpStatus}:CODE_${fingerprint.lookupResultCode}:ROOT_${fingerprint.lookupRootCode}:BYTES_${fingerprint.lookupBodyBytes}`,
      prodmarket: null,
    };
  });
}
