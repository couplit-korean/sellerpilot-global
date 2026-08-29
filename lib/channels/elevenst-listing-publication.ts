import {
  verifiedListingRemoteStateSchema,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";

export type ElevenstListingReadbackOperation = "listing.create" | "listing.update" | "listing.stop";

type ElevenstListingReadbackInput = {
  operation: ElevenstListingReadbackOperation;
  remoteId: string;
  product: unknown;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
  expectedSellerProductCode?: string;
  verifiedAt?: Date;
};

function productRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function detailImageCount(html: string) {
  return (html.match(/<img\b[^>]*\bsrc\s*=\s*(?:["'][^"']+["']|[^\s>]+)/giu) ?? []).length;
}

function koreanLocaleVerified(value: string) {
  return /[\p{Script=Hangul}]/u.test(value)
    || /\blang\s*=\s*["']?ko(?:-KR)?\b/iu.test(value);
}

export function elevenstVisibilityFromStatus(status: string) {
  if (status === "103") return "live" as const;
  if (["101", "102", "110"].includes(status)) return "pending_review" as const;
  if (["104", "105"].includes(status)) return "non_public" as const;
  if (status === "106") return "withdrawn" as const;
  if (["107", "108", "109"].includes(status)) return "rejected" as const;
  return null;
}

/**
 * Converts the official single-product GET response into the publication
 * ledger contract. This helper is deliberately provider-write-free so the
 * pending-review reconciliation lifecycle can call it again later.
 */
export function elevenstVerifiedListingRemoteState(
  input: ElevenstListingReadbackInput,
): VerifiedListingRemoteState | null {
  if (!/^\d{1,20}$/u.test(input.remoteId)
      || input.expectedLocale !== "ko-KR"
      || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
      || !Number.isInteger(input.expectedImageCount)
      || input.expectedImageCount < 0
      || input.expectedImageCount > 64) {
    return null;
  }
  const product = productRecord(input.product);
  if (!product || text(product, "prdNo") !== input.remoteId) return null;
  const sellerProductCode = text(product, "sellerPrdCd");
  if (input.expectedSellerProductCode && sellerProductCode !== input.expectedSellerProductCode) return null;
  const providerStatus = text(product, "selStatCd");
  const visibility = elevenstVisibilityFromStatus(providerStatus);
  if (!visibility) return null;

  const detailHtml = text(product, "htmlDetail");
  const imageCount = detailImageCount(detailHtml);
  const localeVerified = koreanLocaleVerified(`${text(product, "prdNm")}\n${detailHtml}`);
  const imageCountVerified = input.expectedImageCount === 0 || imageCount === input.expectedImageCount;
  if (!localeVerified || !imageCountVerified) return null;

  const candidate = {
    verified: true,
    visibility,
    providerStatus,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
    evidence: {
      version: "elevenst_single_product_v1",
      readbackMethod: "GET /rest/prodmarketservice/prodmarket/{prdNo}",
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
      detailImageCount: imageCount,
      ...(text(product, "selStatNm") ? { providerStatusName: text(product, "selStatNm") } : {}),
    },
    resources: {
      productNo: input.remoteId,
      ...(sellerProductCode ? { sellerProductCode } : {}),
      market: "KR",
    },
    locale: input.expectedLocale,
    fingerprint: input.expectedFingerprint,
    imageCount,
  } satisfies VerifiedListingRemoteState;
  const parsed = verifiedListingRemoteStateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
