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
const CONDITION_POLICY_PATH = (marketplaceId: string) =>
  `/sell/metadata/v1/marketplace/${marketplaceId}/get_item_condition_policies`;

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
  usage: string | null;
  expectedRequiredByDate: string | null;
  mode: string | null;
  cardinality: string | null;
  valueCount: number;
  valuesSample: string[];
  values: Array<{
    value: string;
    constraints: Array<{
      aspectName: string;
      aspectValues: string[];
    }>;
  }>;
};

export type EbayPolicySummary = {
  httpStatus: number;
  ids: string[];
  names: string[];
  marketplaceIds: string[];
  exactId: string | null;
  unverifiedReason?: string;
};

export type EbayReturnTermsSummary = {
  returnsAccepted: boolean | null;
  returnPeriod: { value: number | null; unit: string | null } | null;
  returnShippingCostPayer: string | null;
  refundMethod: string | null;
  returnMethod: string | null;
};

export type EbayReturnPolicyDetail = EbayReturnTermsSummary & {
  id: string;
  name: string;
  marketplaceId: string;
  internationalOverride: EbayReturnTermsSummary | null;
};

export type EbayTaxonomyPolicyGetOnlyResult = {
  marketplaceId: string;
  categoryId: string;
  categoryTreeId: string | null;
  treeHttpStatus: number;
  aspectsHttpStatus: number;
  aspectsShapeVerified: boolean;
  aspectCount: number;
  aspects: EbayAspectSummary[];
  requiredAspectNames: string[];
  upcomingRequiredAspectNames: string[];
  brandAspect: EbayAspectSummary | null;
  productAspect: EbayAspectSummary | null;
  brandProbeHits: string[];
  productProbeHits: string[];
  aspectProbeHits: Record<string, string[]>;
  conditionPolicyHttpStatus: number;
  conditionPolicyCategoryTreeId: string | null;
  conditionRequired: boolean | null;
  conditionIds: string[];
  fulfillmentPolicy: EbayPolicySummary;
  paymentPolicy: EbayPolicySummary;
  returnPolicy: EbayPolicySummary;
  returnPolicyDetails: EbayReturnPolicyDetail[];
  unverifiedReason?: string;
};

const inventoryConditionIds = {
  NEW: "1000",
  NEW_OTHER: "1500",
  NEW_WITH_DEFECTS: "1750",
  CERTIFIED_REFURBISHED: "2000",
  EXCELLENT_REFURBISHED: "2010",
  VERY_GOOD_REFURBISHED: "2020",
  GOOD_REFURBISHED: "2030",
  LIKE_NEW: "2750",
  PRE_OWNED_EXCELLENT: "2990",
  USED_EXCELLENT: "3000",
  PRE_OWNED_FAIR: "3010",
  USED_VERY_GOOD: "4000",
  USED_GOOD: "5000",
  USED_ACCEPTABLE: "6000",
  FOR_PARTS_OR_NOT_WORKING: "7000",
} as const;

export function ebayInventoryConditionId(value: unknown) {
  const condition = text(value).toUpperCase();
  return inventoryConditionIds[condition as keyof typeof inventoryConditionIds] ?? null;
}

function exactNonEmptyStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item !== item.trim()) return null;
    values.push(item);
  }
  return values.length === new Set(values).size ? values : null;
}

function aspectSummary(value: unknown): EbayAspectSummary | null {
  const row = record(value);
  if (!Object.keys(row).length) return null;
  const name = typeof row.localizedAspectName === "string"
    && row.localizedAspectName === row.localizedAspectName.trim()
    ? row.localizedAspectName
    : "";
  if (!name) return null;
  const constraint = record(row.aspectConstraint);
  if (!Object.keys(constraint).length || typeof constraint.aspectRequired !== "boolean") return null;
  const mode = constraint.aspectMode === undefined
    ? null
    : text(constraint.aspectMode).toUpperCase();
  const cardinality = constraint.itemToAspectCardinality === undefined
    ? null
    : text(constraint.itemToAspectCardinality).toUpperCase();
  if ((mode !== null && !["FREE_TEXT", "SELECTION_ONLY"].includes(mode))
      || (cardinality !== null && !["SINGLE", "MULTI"].includes(cardinality))) return null;
  if (row.aspectValues !== undefined && !Array.isArray(row.aspectValues)) return null;
  if (mode === "SELECTION_ONLY" && !Array.isArray(row.aspectValues)) return null;
  const values: EbayAspectSummary["values"] = [];
  for (const candidate of (row.aspectValues ?? []) as unknown[]) {
    const aspectValue = record(candidate);
    if (!Object.keys(aspectValue).length
        || typeof aspectValue.localizedValue !== "string"
        || !aspectValue.localizedValue.trim()
        || aspectValue.localizedValue !== aspectValue.localizedValue.trim()) return null;
    const constraints: EbayAspectSummary["values"][number]["constraints"] = [];
    if (aspectValue.valueConstraints !== undefined
        && !Array.isArray(aspectValue.valueConstraints)) return null;
    for (const constraintValue of (aspectValue.valueConstraints ?? []) as unknown[]) {
      const valueConstraint = record(constraintValue);
      const aspectName = typeof valueConstraint.applicableForLocalizedAspectName === "string"
        && valueConstraint.applicableForLocalizedAspectName
          === valueConstraint.applicableForLocalizedAspectName.trim()
        ? valueConstraint.applicableForLocalizedAspectName
        : "";
      const aspectValues = exactNonEmptyStrings(
        valueConstraint.applicableForLocalizedAspectValues,
      );
      if (!aspectName || !aspectValues?.length) return null;
      constraints.push({ aspectName, aspectValues });
    }
    if (constraints.length !== new Set(constraints.map((item) => item.aspectName)).size) return null;
    values.push({ value: aspectValue.localizedValue, constraints });
  }
  if (values.length !== new Set(values.map((item) => item.value)).size) return null;
  return {
    name,
    required: constraint.aspectRequired === true,
    usage: text(constraint.aspectUsage).toUpperCase() || null,
    expectedRequiredByDate: text(constraint.expectedRequiredByDate) || null,
    mode,
    cardinality,
    valueCount: values.length,
    valuesSample: values.slice(0, 20).map((item) => item.value),
    values,
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

function returnPeriodSummary(value: unknown) {
  const period = record(value);
  if (!Object.keys(period).length) return null;
  return {
    value: typeof period.value === "number"
        && Number.isSafeInteger(period.value)
        && period.value >= 0
      ? period.value
      : null,
    unit: text(period.unit).toUpperCase() || null,
  };
}

function returnTermsSummary(value: unknown): EbayReturnTermsSummary {
  const terms = record(value);
  return {
    returnsAccepted: typeof terms.returnsAccepted === "boolean"
      ? terms.returnsAccepted
      : null,
    returnPeriod: returnPeriodSummary(terms.returnPeriod),
    returnShippingCostPayer:
      text(terms.returnShippingCostPayer).toUpperCase() || null,
    refundMethod: text(terms.refundMethod).toUpperCase() || null,
    returnMethod: text(terms.returnMethod).toUpperCase() || null,
  };
}

function returnPolicyDetails(
  httpStatus: number,
  data: Record<string, unknown>,
  marketplaceId: string,
) {
  if (httpStatus !== 200 || !Array.isArray(data.returnPolicies)) return [];
  return data.returnPolicies.flatMap((item): EbayReturnPolicyDetail[] => {
    const policy = record(item);
    const id = text(policy.returnPolicyId);
    const policyMarketplaceId = text(policy.marketplaceId).toUpperCase();
    if (!id || (policyMarketplaceId && policyMarketplaceId !== marketplaceId)) {
      return [];
    }
    const internationalOverride = record(policy.internationalOverride);
    return [{
      id,
      name: text(policy.name) || id,
      marketplaceId: policyMarketplaceId,
      ...returnTermsSummary(policy),
      internationalOverride: Object.keys(internationalOverride).length
        ? returnTermsSummary(internationalOverride)
        : null,
    }];
  });
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
  categoryId: string;
  marketplaceId?: string;
  environment?: "sandbox" | "production";
  brandProbes?: readonly string[];
  productProbes?: readonly string[];
  aspectProbes?: Readonly<Record<string, readonly string[]>>;
}): Promise<EbayTaxonomyPolicyGetOnlyResult> {
  const categoryId = assertCategoryId(input.categoryId);
  const marketplaceId = assertMarketplaceId(
    input.marketplaceId
    || (typeof input.payload.marketplace_id === "string" ? input.payload.marketplace_id : ""),
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
        aspectsShapeVerified: false,
        aspectCount: 0,
        aspects: [],
        requiredAspectNames: [],
        upcomingRequiredAspectNames: [],
        brandAspect: null,
        productAspect: null,
        brandProbeHits: [],
        productProbeHits: [],
        aspectProbeHits: {},
        conditionPolicyHttpStatus: 0,
        conditionPolicyCategoryTreeId: null,
        conditionRequired: null,
        conditionIds: [],
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
        returnPolicyDetails: [],
        unverifiedReason: `EBAY_CATEGORY_TREE_UNVERIFIED:HTTP_${treeHttpStatus}`,
      };
    }

    const [aspectsRemote, conditionRemote, fulfillmentRemote, paymentRemote, returnRemote] = await Promise.all([
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
        path: CONDITION_POLICY_PATH(marketplaceId),
        query: new URLSearchParams({ filter: `categoryIds:{${categoryId}}` }),
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

    const aspectRows = aspectsRemote.data.aspects;
    const parsedAspects = Array.isArray(aspectRows)
      ? aspectRows.map(aspectSummary)
      : [];
    const parsedAspectNames = parsedAspects.flatMap((item) => item ? [item.name] : []);
    const aspectsShapeVerified = aspectsRemote.response.status === 200
      && Array.isArray(aspectRows)
      && parsedAspects.every(Boolean)
      && parsedAspectNames.length === new Set(parsedAspectNames).size;
    const aspects = aspectsShapeVerified
      ? parsedAspects.filter((item): item is EbayAspectSummary => Boolean(item))
      : [];
    const requiredAspectNames = aspects.filter((item) => item.required).map((item) => item.name);
    const upcomingRequiredAspectNames = aspects.filter((item) =>
      !item.required && Boolean(item.expectedRequiredByDate)).map((item) => item.name);
    const byName = new Map(aspects.map((item) => [item.name, item]));
    const valuesByName = new Map(
      aspects.map((item) => [item.name, item.values.map((value) => value.value)] as const),
    );
    const conditionPolicies = Array.isArray(conditionRemote.data.itemConditionPolicies)
      ? conditionRemote.data.itemConditionPolicies.map(record).filter((policy) =>
        text(policy.categoryId) === categoryId)
      : [];
    const conditionPolicy = conditionPolicies.length === 1
      ? conditionPolicies[0]
      : {};
    const conditionIds = Array.isArray(conditionPolicy.itemConditions)
      ? conditionPolicy.itemConditions.map(record).map((item) => text(item.conditionId)).filter(Boolean)
      : [];

    return {
      marketplaceId,
      categoryId,
      categoryTreeId,
      treeHttpStatus,
      aspectsHttpStatus: aspectsRemote.response.status,
      aspectsShapeVerified,
      aspectCount: aspects.length,
      aspects,
      requiredAspectNames,
      upcomingRequiredAspectNames,
      brandAspect: byName.get("Brand") ?? null,
      productAspect: byName.get("Product") ?? null,
      brandProbeHits: probeHits(valuesByName.get("Brand") ?? [], input.brandProbes ?? []),
      productProbeHits: probeHits(valuesByName.get("Product") ?? [], input.productProbes ?? []),
      aspectProbeHits: Object.fromEntries(
        Object.entries(input.aspectProbes ?? {}).map(([name, probes]) => [
          name,
          probeHits(valuesByName.get(name) ?? [], probes),
        ]),
      ),
      conditionPolicyHttpStatus: conditionRemote.response.status,
      conditionPolicyCategoryTreeId: text(conditionPolicy.categoryTreeId) || null,
      conditionRequired: typeof conditionPolicy.itemConditionRequired === "boolean"
        ? conditionPolicy.itemConditionRequired
        : null,
      conditionIds: [...new Set(conditionIds)],
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
      returnPolicyDetails: returnPolicyDetails(
        returnRemote.response.status,
        returnRemote.data,
        marketplaceId,
      ),
      ...(aspectsRemote.response.status !== 200
        ? { unverifiedReason: `EBAY_ASPECTS_GET_UNVERIFIED:HTTP_${aspectsRemote.response.status}` }
        : !aspectsShapeVerified
          ? { unverifiedReason: "EBAY_ASPECTS_RESPONSE_MALFORMED" }
          : {}),
    };
  });
}
