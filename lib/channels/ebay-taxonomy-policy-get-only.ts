import {
  ebayRequest,
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "./protocols";

export const ebayCookieCategoryId = "20473";
export const ebayCookieMarketplaceId = "EBAY_US";

const DEFAULT_TREE_PATH = "/commerce/taxonomy/v1/get_default_category_tree_id";
const ASPECTS_PATH = (treeId: string) =>
  `/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category`;
const FULFILLMENT_POLICY_PATH = "/sell/account/v1/fulfillment_policy";
const PAYMENT_POLICY_PATH = "/sell/account/v1/payment_policy";
const RETURN_POLICY_PATH = "/sell/account/v1/return_policy";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function assertCategoryId(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,10}$/.test(normalized)) {
    throw new Error("EBAY_CATEGORY_ID_INVALID");
  }
  return normalized;
}

function assertMarketplaceId(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^EBAY_[A-Z]{2}$/.test(normalized)) {
    throw new Error("EBAY_MARKETPLACE_ID_INVALID");
  }
  return normalized;
}

export type EbayAspectSummary = {
  name: string;
  required: boolean;
  mode: string | null;
  valueCount: number;
  valuesSample: string[];
};

export type EbayPolicySummary = {
  httpStatus: number;
  ids: string[];
  names: string[];
  marketplaceIds: string[];
  exactId: string | null;
  unverifiedReason?: string;
};

export type EbayTaxonomyPolicyGetOnlyResult = {
  marketplaceId: string;
  categoryId: string;
  categoryTreeId: string | null;
  treeHttpStatus: number;
  aspectsHttpStatus: number;
  aspectCount: number;
  requiredAspectNames: string[];
  brandAspect: EbayAspectSummary | null;
  productAspect: EbayAspectSummary | null;
  brandProbeHits: string[];
  productProbeHits: string[];
  fulfillmentPolicy: EbayPolicySummary;
  paymentPolicy: EbayPolicySummary;
  returnPolicy: EbayPolicySummary;
  unverifiedReason?: string;
};

function localizedAspectValues(row: Record<string, unknown>) {
  const values = Array.isArray(row.aspectValues) ? row.aspectValues : [];
  return values.flatMap((item) => {
    const value = text(record(item).localizedValue);
    return value ? [value] : [];
  });
}

function aspectSummary(row: Record<string, unknown>): EbayAspectSummary | null {
  const name = text(row.localizedAspectName) || text(row.name);
  if (!name) return null;
  const constraint = record(row.aspectConstraint);
  const localized = localizedAspectValues(row);
  return {
    name,
    required: constraint.aspectRequired === true,
    mode: text(constraint.aspectMode) || null,
    valueCount: localized.length,
    valuesSample: localized.slice(0, 20),
  };
}

function probeHits(allValues: readonly string[], probes: readonly string[]) {
  return probes.filter((probe) => allValues.includes(probe));
}

function policySummary(
  httpStatus: number,
  data: Record<string, unknown>,
  listKey: string,
  idKey: string,
  marketplaceId: string,
): EbayPolicySummary {
  if (httpStatus !== 200) {
    return {
      httpStatus,
      ids: [],
      names: [],
      marketplaceIds: [],
      exactId: null,
      unverifiedReason: `EBAY_POLICY_GET_UNVERIFIED:HTTP_${httpStatus}`,
    };
  }
  const list = Array.isArray(data[listKey]) ? data[listKey] : [];
  const rows = list.flatMap((item) => {
    const policy = record(item);
    const id = text(policy[idKey]);
    if (!id) return [];
    return [{
      id,
      name: text(policy.name) || id,
      marketplaceId: text(policy.marketplaceId).toUpperCase(),
    }];
  });
  const matching = rows.filter((row) => !row.marketplaceId || row.marketplaceId === marketplaceId);
  const total = typeof data.total === "number" && Number.isFinite(data.total)
    ? data.total
    : rows.length;
  if (total > rows.length) {
    return {
      httpStatus,
      ids: matching.map((row) => row.id),
      names: matching.map((row) => row.name),
      marketplaceIds: matching.map((row) => row.marketplaceId).filter(Boolean),
      exactId: null,
      unverifiedReason: "EBAY_POLICY_PAGE_INCOMPLETE",
    };
  }
  const exactId = matching.length === 1 ? matching[0].id : null;
  return {
    httpStatus,
    ids: matching.map((row) => row.id),
    names: matching.map((row) => row.name),
    marketplaceIds: matching.map((row) => row.marketplaceId).filter(Boolean),
    exactId,
    ...(exactId
      ? {}
      : { unverifiedReason: matching.length === 0 ? "EBAY_POLICY_NONE" : "EBAY_POLICY_NOT_UNIQUE" }),
  };
}

export function exactAllowedAspectValue(
  allowedValues: readonly string[],
  candidate: string,
) {
  const needle = candidate.trim();
  if (!needle) return null;
  const matches = allowedValues.filter((value) => value === needle);
  return matches.length === 1 ? matches[0] : null;
}

export async function readEbayTaxonomyPolicyGetOnly(input: {
  payload: SecretPayload;
  categoryId?: string;
  marketplaceId?: string;
  environment?: "sandbox" | "production";
  brandProbes?: readonly string[];
  productProbes?: readonly string[];
}): Promise<EbayTaxonomyPolicyGetOnlyResult> {
  const categoryId = assertCategoryId(input.categoryId ?? ebayCookieCategoryId);
  const marketplaceId = assertMarketplaceId(
    input.marketplaceId
    || (typeof input.payload.marketplace_id === "string" ? input.payload.marketplace_id : "")
    || ebayCookieMarketplaceId,
  );
  const environment = input.environment ?? "production";
  return runWithProviderReadOnlyTransport(async () => {
    const treeRemote = await ebayRequest({
      payload: input.payload,
      environment,
      method: "GET",
      path: DEFAULT_TREE_PATH,
      query: new URLSearchParams({ marketplace_id: marketplaceId }),
    });
    const categoryTreeId = text(treeRemote.data.categoryTreeId);
    const treeHttpStatus = treeRemote.response.status;
    if (treeHttpStatus !== 200 || !/^\d+$/.test(categoryTreeId)) {
      return {
        marketplaceId,
        categoryId,
        categoryTreeId: categoryTreeId || null,
        treeHttpStatus,
        aspectsHttpStatus: 0,
        aspectCount: 0,
        requiredAspectNames: [],
        brandAspect: null,
        productAspect: null,
        brandProbeHits: [],
        productProbeHits: [],
        fulfillmentPolicy: {
          httpStatus: 0,
          ids: [],
          names: [],
          marketplaceIds: [],
          exactId: null,
          unverifiedReason: "EBAY_CATEGORY_TREE_UNVERIFIED",
        },
        paymentPolicy: {
          httpStatus: 0,
          ids: [],
          names: [],
          marketplaceIds: [],
          exactId: null,
          unverifiedReason: "EBAY_CATEGORY_TREE_UNVERIFIED",
        },
        returnPolicy: {
          httpStatus: 0,
          ids: [],
          names: [],
          marketplaceIds: [],
          exactId: null,
          unverifiedReason: "EBAY_CATEGORY_TREE_UNVERIFIED",
        },
        unverifiedReason: `EBAY_CATEGORY_TREE_UNVERIFIED:HTTP_${treeHttpStatus}`,
      };
    }

    const [aspectsRemote, fulfillmentRemote, paymentRemote, returnRemote] = await Promise.all([
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: ASPECTS_PATH(categoryTreeId),
        query: new URLSearchParams({ category_id: categoryId }),
      }),
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: FULFILLMENT_POLICY_PATH,
        query: new URLSearchParams({ marketplace_id: marketplaceId }),
      }),
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: PAYMENT_POLICY_PATH,
        query: new URLSearchParams({ marketplace_id: marketplaceId }),
      }),
      ebayRequest({
        payload: input.payload,
        environment,
        method: "GET",
        path: RETURN_POLICY_PATH,
        query: new URLSearchParams({ marketplace_id: marketplaceId }),
      }),
    ]);

    const aspectRows = Array.isArray(aspectsRemote.data.aspects) ? aspectsRemote.data.aspects : [];
    const aspects = aspectRows.flatMap((item) => {
      const summary = aspectSummary(record(item));
      return summary ? [summary] : [];
    });
    const requiredAspectNames = aspects.filter((item) => item.required).map((item) => item.name);
    const byName = new Map(aspects.map((item) => [item.name, item]));
    const valuesByName = new Map(
      aspectRows.flatMap((item) => {
        const row = record(item);
        const name = text(row.localizedAspectName) || text(row.name);
        return name ? [[name, localizedAspectValues(row)] as const] : [];
      }),
    );

    return {
      marketplaceId,
      categoryId,
      categoryTreeId,
      treeHttpStatus,
      aspectsHttpStatus: aspectsRemote.response.status,
      aspectCount: aspects.length,
      requiredAspectNames,
      brandAspect: byName.get("Brand") ?? null,
      productAspect: byName.get("Product") ?? null,
      brandProbeHits: probeHits(valuesByName.get("Brand") ?? [], input.brandProbes ?? []),
      productProbeHits: probeHits(valuesByName.get("Product") ?? [], input.productProbes ?? []),
      fulfillmentPolicy: policySummary(
        fulfillmentRemote.response.status,
        fulfillmentRemote.data,
        "fulfillmentPolicies",
        "fulfillmentPolicyId",
        marketplaceId,
      ),
      paymentPolicy: policySummary(
        paymentRemote.response.status,
        paymentRemote.data,
        "paymentPolicies",
        "paymentPolicyId",
        marketplaceId,
      ),
      returnPolicy: policySummary(
        returnRemote.response.status,
        returnRemote.data,
        "returnPolicies",
        "returnPolicyId",
        marketplaceId,
      ),
      ...(aspectsRemote.response.status === 200
        ? {}
        : { unverifiedReason: `EBAY_ASPECTS_GET_UNVERIFIED:HTTP_${aspectsRemote.response.status}` }),
    };
  });
}
