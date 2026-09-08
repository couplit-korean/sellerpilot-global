export const SHOPEE_RETURN_MAX_WINDOW_SECONDS = 15 * 86_400;
export const SHOPEE_MAX_SHOPS = 8;

export type ShopeeHistoryShop = {
  shopId: string;
  country: string;
};

export type ShopeeReviewHistoryScope = {
  scopeKey: string;
  kind: "product_review";
  shopId: string;
  country: string;
  coverage: "provider_cursor_corpus";
  arguments: { kind: "product_review"; cursor: ""; pageSize: 100; shopId: string };
};

export type ShopeeReturnHistoryScope = {
  scopeKey: string;
  kind: "return_refund";
  shopId: string;
  country: string;
  coverage: "explicit_time_window";
  arguments: {
    kind: "return_refund";
    createTimeFrom: number;
    createTimeTo: number;
    pageNo: 1;
    pageSize: 100;
    shopId: string;
  };
};

function validateShops(value: ShopeeHistoryShop[]) {
  if (!Array.isArray(value) || !value.length || value.length > SHOPEE_MAX_SHOPS) {
    throw new Error("SHOPEE_HISTORY_SHOPS_INVALID");
  }
  const seen = new Set<string>();
  return value.map((shop) => {
    const shopId = String(shop?.shopId ?? "").trim();
    const country = String(shop?.country ?? "").trim().toUpperCase();
    if (!/^[1-9]\d{0,31}$/.test(shopId) || !/^[A-Z][A-Z0-9_-]{1,39}$/.test(country) || seen.has(shopId)) {
      throw new Error("SHOPEE_HISTORY_SHOPS_INVALID");
    }
    seen.add(shopId);
    return { shopId, country };
  });
}

function epochSeconds(value: unknown, key: string) {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 9_999_999_999) {
    throw new Error(`SHOPEE_HISTORY_${key}_INVALID`);
  }
  return result;
}

export function planShopeeReviewHistory(shops: ShopeeHistoryShop[]): ShopeeReviewHistoryScope[] {
  return validateShops(shops).map(({ shopId, country }) => ({
    scopeKey: `shopee:${shopId}:product_review:cursor-corpus`,
    kind: "product_review",
    shopId,
    country,
    coverage: "provider_cursor_corpus",
    arguments: { kind: "product_review", cursor: "", pageSize: 100, shopId },
  }));
}

export function planShopeeReturnHistory(
  shops: ShopeeHistoryShop[],
  range: { from: number; to: number },
): ShopeeReturnHistoryScope[] {
  const validatedShops = validateShops(shops);
  const from = epochSeconds(range.from, "FROM");
  const to = epochSeconds(range.to, "TO");
  if (from >= to) throw new Error("SHOPEE_HISTORY_RANGE_INVALID");
  const windows: Array<{ from: number; to: number }> = [];
  let windowTo = to;
  while (windowTo > from) {
    const windowFrom = Math.max(from, windowTo - SHOPEE_RETURN_MAX_WINDOW_SECONDS);
    windows.push({ from: windowFrom, to: windowTo });
    // The provider contract does not state whether both timestamp boundaries
    // are inclusive. Overlap a full one-second interval so even an API that
    // excludes both endpoints cannot lose the internal boundary timestamp;
    // the return_sn ledger must deduplicate the overlap.
    if (windowFrom === from) break;
    windowTo = windowFrom + 1;
  }
  return validatedShops.flatMap(({ shopId, country }) => windows.map((window) => ({
    scopeKey: `shopee:${shopId}:return_refund:${window.from}-${window.to}`,
    kind: "return_refund" as const,
    shopId,
    country,
    coverage: "explicit_time_window" as const,
    arguments: {
      kind: "return_refund" as const,
      createTimeFrom: window.from,
      createTimeTo: window.to,
      pageNo: 1 as const,
      pageSize: 100 as const,
      shopId,
    },
  })));
}
