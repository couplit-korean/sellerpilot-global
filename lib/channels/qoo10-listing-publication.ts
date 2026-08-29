import {
  verifiedListingRemoteStateSchema,
  type VerifiedListingRemoteState,
} from "./listing-publication-state";

export type Qoo10ListingReadbackOperation = "listing.create" | "listing.update" | "listing.stop";

type Qoo10ListingReadbackInput = {
  operation: Qoo10ListingReadbackOperation;
  remoteId: string;
  resultObject: unknown;
  expectedLocale: string;
  expectedFingerprint: string;
  expectedImageCount: number;
  expectedSellerCode?: string;
  verifiedAt?: Date;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(record: Record<string, unknown>, names: readonly string[]) {
  const expected = new Set(names.map((name) => name.toLowerCase()));
  const value = Object.entries(record).find(([name]) => expected.has(name.toLowerCase()))?.[1];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function matchingItems(value: unknown, remoteId: string, depth = 0, found: Record<string, unknown>[] = []) {
  if (depth > 7 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    for (const item of value) matchingItems(item, remoteId, depth + 1, found);
    return found;
  }
  const record = recordValue(value);
  if (!record) return found;
  if (exactText(record, ["ItemNo", "ItemCode", "GdNo"]) === remoteId) found.push(record);
  for (const nested of Object.values(record)) matchingItems(nested, remoteId, depth + 1, found);
  return found;
}

function detailImageCount(html: string) {
  const decoded = html
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  return (decoded.match(/<img\b[^>]*\bsrc\s*=\s*(?:["'][^"']+["']|[^\s>]+)/giu) ?? []).length;
}

function japaneseLocaleVerified(value: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)
    || /\blang\s*=\s*["']?ja(?:-JP)?\b/iu.test(value);
}

function visibilityForStatus(operation: Qoo10ListingReadbackOperation, status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "S2" || normalized === "2") return "live" as const;
  if (normalized === "S1" || normalized === "1") {
    return operation === "listing.stop" ? "non_public" as const : "pending_review" as const;
  }
  if (normalized === "S3" || normalized === "3") return "withdrawn" as const;
  return null;
}

/**
 * Converts one authoritative ItemsLookup.GetItemDetailInfo response into the
 * publication ledger contract. The helper performs no provider mutation, so a
 * later read-only reconciliation operation can reuse the same boundary.
 */
export function qoo10VerifiedListingRemoteState(
  input: Qoo10ListingReadbackInput,
): VerifiedListingRemoteState | null {
  if (!/^\d{9,10}$/u.test(input.remoteId)
      || input.expectedLocale !== "ja-JP"
      || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)
      || !Number.isInteger(input.expectedImageCount)
      || input.expectedImageCount < 0
      || input.expectedImageCount > 64) {
    return null;
  }
  const matches = matchingItems(input.resultObject, input.remoteId);
  if (matches.length !== 1) return null;
  const item = matches[0];
  const itemStatus = exactText(item, ["ItemStatus", "Status"]);
  const visibility = visibilityForStatus(input.operation, itemStatus);
  const sellerCode = exactText(item, ["SellerCode"]);
  if (!visibility || (input.expectedSellerCode && sellerCode !== input.expectedSellerCode)) return null;

  const detailHtml = exactText(item, ["ItemDetail", "ItemDescription", "Description"]);
  const itemTitle = exactText(item, ["ItemTitle"]);
  const imageCount = detailImageCount(detailHtml);
  const localeVerified = japaneseLocaleVerified(`${itemTitle}\n${detailHtml}`);
  const imageCountVerified = input.expectedImageCount === 0 || imageCount === input.expectedImageCount;
  if (!localeVerified || !imageCountVerified) return null;

  const candidate = {
    verified: true,
    visibility,
    providerStatus: itemStatus,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
    evidence: {
      version: "qoo10_get_item_detail_v1",
      readbackMethod: "ItemsLookup.GetItemDetailInfo",
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
      detailImageCount: imageCount,
    },
    resources: {
      itemCode: input.remoteId,
      ...(sellerCode ? { sellerCode } : {}),
      market: "JP",
    },
    locale: input.expectedLocale,
    fingerprint: input.expectedFingerprint,
    imageCount,
  } satisfies VerifiedListingRemoteState;
  const parsed = verifiedListingRemoteStateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
