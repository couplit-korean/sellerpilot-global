import { temuCreateSkuChecks } from "../../channels/temu-create-preflight";

type UnknownRecord = Record<string, unknown>;

export const temuGeneralCreateContract = "temu_general_create_v1" as const;
export const temuGeneralCreateMethod = "temu.local.goods.v3.add" as const;
export const temuGeneralListMethod = "temu.local.goods.list.retrieve" as const;
export const temuRecommendedCreateReadDelayMs = 10 * 60 * 1_000;

export type TemuGeneralCreateIssue = {
  path: string;
  code:
    | "BODY_REQUIRED"
    | "FIELD_REQUIRED"
    | "FIELD_INVALID"
    | "CATEGORY_INVALID"
    | "SHIPPING_TEMPLATE_UNSUPPORTED"
    | "SKU_CONTRACT_INVALID"
    | "IMAGE_CONTRACT_INVALID"
    | "ATTRIBUTE_CONTRACT_INVALID";
};

export type TemuIdentityQuery = {
  method: typeof temuGeneralListMethod;
  arguments: {
    pageSize: number;
    outGoodsSnList?: string[];
    outSkuSnList?: string[];
  };
};

export type TemuIdentityRead = {
  contract: typeof temuGeneralCreateContract;
  queryKind: "goods" | "sku" | "invalid";
  complete: boolean;
  empty: boolean;
  observedGoodsCount?: number;
  total?: number;
};

export type TemuCreateProcessingState = {
  contract: typeof temuGeneralCreateContract;
  goodsId?: string;
  externalGoodsId: string;
  providerStatus: "MISSING" | "DRAFT" | "INCOMPLETE" | "ACTIVE" | "INACTIVE" | "DELETED";
  reviewState: "not_observed" | "not_submitted" | "pending_review" | "provider_active" | "provider_inactive" | "provider_deleted";
  saleState: "not_observed" | "not_sellable" | "active_not_buyer_verified" | "non_public" | "withdrawn";
  buyerVisibilityVerified: false;
  internalCompletionEligible: false;
  nextAction: "wait_for_official_list_readback" | "complete_category_attributes" | "wait_for_review" | "verify_full_readback_and_buyer_visibility" | "keep_non_public" | "stop_removed_lineage";
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((entry) => Object.keys(entry).length > 0)
    : [];
}

function exactText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  if (!value || value.length > maxLength || /\p{Cc}/u.test(value)) return "";
  return value;
}

function exactLong(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return "";
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!/^[1-9]\d{0,18}$/u.test(text)) return "";
  try {
    return BigInt(text) <= BigInt("9223372036854775807") ? text : "";
  } catch {
    return "";
  }
}

function nonNegativeInteger(value: unknown) {
  if (typeof value === "string" && value !== value.trim()) return null;
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!/^(?:0|[1-9]\d*)$/u.test(text)) return null;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) && numeric >= 0 && String(numeric) === text
    ? numeric
    : null;
}

function httpsImages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => {
    if (!exactText(entry, 2_048)) return false;
    try {
      const url = new URL(entry);
      return url.protocol === "https:" && Boolean(url.hostname);
    } catch {
      return false;
    }
  });
}

function placeholder(value: string) {
  return /^(?:server_managed|unknown|n\/a|미확인|확인 필요)$/iu.test(value);
}

function optionalContinuationAbsent(owner: UnknownRecord, key: string) {
  if (!Object.hasOwn(owner, key)) return true;
  const value = owner[key];
  return value === null || value === "";
}

function paginationContract(value: UnknownRecord) {
  if (!Object.hasOwn(value, "pagination")) return { valid: true, continuationAbsent: true };
  const paginationValue = value.pagination;
  if (!paginationValue || typeof paginationValue !== "object" || Array.isArray(paginationValue)) {
    return { valid: false, continuationAbsent: false };
  }
  const pagination = paginationValue as UnknownRecord;
  return {
    valid: true,
    continuationAbsent: optionalContinuationAbsent(pagination, "nextToken"),
  };
}

export function inspectTemuGeneralCreateBody(value: unknown) {
  const issues: TemuGeneralCreateIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, issues: [{ path: "body", code: "BODY_REQUIRED" as const }] };
  }
  const body = value as UnknownRecord;
  const goodsBasic = record(body.goodsBasic);
  const language = exactText(body.language, 32).replaceAll("_", "-").toLowerCase();
  if (!['ko', 'ko-kr'].includes(language)) issues.push({ path: "body.language", code: "FIELD_INVALID" });

  const externalGoodsId = exactText(goodsBasic.externalGoodsId, 128);
  const goodsName = exactText(goodsBasic.goodsName, 500);
  const goodsDesc = exactText(goodsBasic.goodsDesc, 10_000);
  const categoryExplicit = Object.hasOwn(goodsBasic, "extCatName");
  const category = exactText(goodsBasic.extCatName, 500);
  if (!externalGoodsId) issues.push({ path: "body.goodsBasic.externalGoodsId", code: "FIELD_REQUIRED" });
  if (!goodsName || /<[^>]*>|\p{Extended_Pictographic}/u.test(goodsName)) issues.push({ path: "body.goodsBasic.goodsName", code: "FIELD_INVALID" });
  if (!goodsDesc) issues.push({ path: "body.goodsBasic.goodsDesc", code: "FIELD_REQUIRED" });
  if (categoryExplicit && (!category || placeholder(category) || /^[1-9]\d*$/u.test(category))) {
    issues.push({ path: "body.goodsBasic.extCatName", code: "CATEGORY_INVALID" });
  }

  const shippingTemplateExplicit = Object.hasOwn(goodsBasic, "costTemplate");
  if (shippingTemplateExplicit) {
    issues.push({ path: "body.goodsBasic.costTemplate", code: "SHIPPING_TEMPLATE_UNSUPPORTED" });
  }

  const heroSource = Array.isArray(goodsBasic.goodsCarouselImage) ? goodsBasic.goodsCarouselImage : null;
  const detailSource = Array.isArray(goodsBasic.detailImage) ? goodsBasic.detailImage : null;
  const heroImages = httpsImages(heroSource);
  const detailImages = httpsImages(detailSource);
  if (!heroSource
      || !detailSource
      || heroImages.length !== heroSource.length
      || detailImages.length !== detailSource.length
      || heroImages.length !== 1
      || detailImages.length !== 8
      || new Set(detailImages).size !== 8
      || detailImages.includes(heroImages[0])) {
    issues.push({ path: "body.goodsBasic.goodsCarouselImage|detailImage", code: "IMAGE_CONTRACT_INVALID" });
  }

  const bulletPoints = Array.isArray(goodsBasic.bulletPoints)
    ? goodsBasic.bulletPoints.map((entry) => exactText(entry, 500))
    : [];
  if (bulletPoints.length < 1 || bulletPoints.length > 10 || bulletPoints.some((entry) => !entry || /<[^>]*>/u.test(entry))) {
    issues.push({ path: "body.goodsBasic.bulletPoints", code: "FIELD_INVALID" });
  }

  const attributes = records(body.attributes);
  if (!Array.isArray(body.attributes) || attributes.length < 1 || attributes.length !== body.attributes.length) {
    issues.push({ path: "body.attributes", code: "ATTRIBUTE_CONTRACT_INVALID" });
  } else {
    const names = new Set<string>();
    attributes.forEach((attribute, index) => {
      const name = exactText(attribute.name, 128);
      const values = Array.isArray(attribute.value)
        ? attribute.value.map((entry) => exactText(entry, 128))
        : [];
      if (!name || names.has(name) || values.length < 1 || values.some((entry) => !entry)) {
        issues.push({ path: `body.attributes.${index}`, code: "ATTRIBUTE_CONTRACT_INVALID" });
      }
      if (name) names.add(name);
    });
  }

  const skuChecks = temuCreateSkuChecks(body);
  if (Object.values(skuChecks).some((passed) => !passed)) {
    issues.push({ path: "body.skuList", code: "SKU_CONTRACT_INVALID" });
  }
  const skuRows = records(body.skuList);
  const externalSkuIds = skuRows.map((sku) => exactText(sku.externalSkuId, 128)).filter(Boolean);
  const variationCombinations = new Set<string>();
  let optionNames: string[] | null = null;
  for (const [index, sku] of skuRows.entries()) {
    const variations = records(sku.variations);
    const pairs = variations.map((variation) => [
      exactText(variation.name, 128),
      exactText(variation.value, 128),
    ] as const);
    const currentNames = pairs.map(([name]) => name).sort();
    if (optionNames === null) optionNames = currentNames;
    else if (JSON.stringify(optionNames) !== JSON.stringify(currentNames)) {
      issues.push({ path: `body.skuList.${index}.variations`, code: "SKU_CONTRACT_INVALID" });
    }
    const fingerprint = JSON.stringify([...pairs].sort(([left], [right]) => left.localeCompare(right)));
    if (variationCombinations.has(fingerprint)) {
      issues.push({ path: `body.skuList.${index}.variations`, code: "SKU_CONTRACT_INVALID" });
    }
    variationCombinations.add(fingerprint);
  }

  return {
    ok: issues.length === 0,
    issues,
    externalGoodsId,
    externalSkuIds,
    categoryMode: categoryExplicit ? "external_category_name" as const : "provider_auto_recommend" as const,
    shippingMode: "store_default" as const,
    skuChecks,
  };
}

export function temuGeneralCreateIdentityQueries(body: unknown): TemuIdentityQuery[] {
  const inspection = inspectTemuGeneralCreateBody(body);
  if (!inspection.ok || !inspection.externalGoodsId || inspection.externalSkuIds.length < 1) {
    throw new Error("TEMU_GENERAL_CREATE_BODY_INVALID");
  }
  const queries: TemuIdentityQuery[] = [{
    method: temuGeneralListMethod,
    arguments: { outGoodsSnList: [inspection.externalGoodsId], pageSize: 25 },
  }];
  for (let index = 0; index < inspection.externalSkuIds.length; index += 100) {
    const outSkuSnList = inspection.externalSkuIds.slice(index, index + 100);
    queries.push({
      method: temuGeneralListMethod,
      arguments: { outSkuSnList, pageSize: Math.max(25, outSkuSnList.length) },
    });
  }
  return queries;
}

export function normalizeTemuIdentityRead(input: { query: TemuIdentityQuery; response: unknown }): TemuIdentityRead {
  const goodsIds = input.query.arguments.outGoodsSnList;
  const skuIds = input.query.arguments.outSkuSnList;
  const queryKind = Array.isArray(goodsIds) && !skuIds
    ? "goods"
    : Array.isArray(skuIds) && !goodsIds
      ? "sku"
      : "invalid";
  const ids = queryKind === "goods" ? goodsIds : queryKind === "sku" ? skuIds : undefined;
  const response = record(input.response);
  const result = record(response.result);
  const goodsList = Array.isArray(result.goodsList) ? result.goodsList : null;
  const total = nonNegativeInteger(result.total);
  const pagination = paginationContract(result);
  const continuationAbsent = optionalContinuationAbsent(result, "nextToken")
    && pagination.valid
    && pagination.continuationAbsent;
  const complete = Boolean(
    input.query.method === temuGeneralListMethod
    && queryKind !== "invalid"
    && Array.isArray(ids)
    && ids.length >= 1
    && ids.length <= 100
    && ids.every((id) => Boolean(exactText(id, 128)))
    && new Set(ids).size === ids.length
    && input.query.arguments.pageSize >= ids.length
    && input.query.arguments.pageSize <= 100
    && !("goodsSearchType" in input.query.arguments)
    && response.success === true
    && goodsList
    && total !== null
    && total === goodsList.length
    && total <= input.query.arguments.pageSize
    && continuationAbsent,
  );
  return {
    contract: temuGeneralCreateContract,
    queryKind,
    complete,
    empty: complete && total === 0,
    ...(goodsList ? { observedGoodsCount: goodsList.length } : {}),
    ...(total === null ? {} : { total }),
  };
}

export function normalizeTemuCreateReceipt(input: { body: unknown; response: unknown }) {
  const inspection = inspectTemuGeneralCreateBody(input.body);
  const response = record(input.response);
  const result = record(response.result);
  const goodsId = exactLong(result.goodsId);
  const externalGoodsId = exactText(result.externalGoodsId, 128);
  if (!inspection.ok || response.success !== true || !goodsId || externalGoodsId !== inspection.externalGoodsId) return null;
  return {
    contract: temuGeneralCreateContract,
    created: true as const,
    goodsId,
    externalGoodsId,
    publicationConfirmed: false as const,
    reviewState: "not_yet_queried" as const,
    saleState: "not_yet_queried" as const,
    buyerVisibilityVerified: false as const,
    internalCompletionEligible: false as const,
    recommendedReadDelayMs: temuRecommendedCreateReadDelayMs,
  };
}

export function normalizeTemuCreateProcessingState(input: {
  listResponse: unknown;
  goodsId: string;
  externalGoodsId: string;
}): TemuCreateProcessingState | null {
  const goodsId = exactLong(input.goodsId);
  const externalGoodsId = exactText(input.externalGoodsId, 128);
  if (!goodsId || !externalGoodsId) return null;
  const response = record(input.listResponse);
  const result = record(response.result);
  const goodsList = Array.isArray(result.goodsList) ? records(result.goodsList) : null;
  const total = nonNegativeInteger(result.total);
  const pagination = paginationContract(result);
  const continuationAbsent = optionalContinuationAbsent(result, "nextToken")
    && pagination.valid
    && pagination.continuationAbsent;
  if (response.success !== true || !goodsList || total === null || total !== goodsList.length || !continuationAbsent) return null;
  const matches = goodsList.filter((goods) => exactLong(goods.goodsId) === goodsId
    && exactText(goods.outGoodsSn ?? goods.externalGoodsId, 128) === externalGoodsId);
  if (matches.length > 1) return null;
  if (matches.length === 0) return {
    contract: temuGeneralCreateContract,
    externalGoodsId,
    providerStatus: "MISSING",
    reviewState: "not_observed",
    saleState: "not_observed",
    buyerVisibilityVerified: false,
    internalCompletionEligible: false,
    nextAction: "wait_for_official_list_readback",
  };
  const goodsStatus = exactText(matches[0].goodsStatus, 32).toUpperCase();
  if (!['DRAFT', 'INCOMPLETE', 'ACTIVE', 'INACTIVE', 'DELETED'].includes(goodsStatus)) return null;
  const common = {
    contract: temuGeneralCreateContract,
    goodsId,
    externalGoodsId,
    providerStatus: goodsStatus as "DRAFT" | "INCOMPLETE" | "ACTIVE" | "INACTIVE" | "DELETED",
    buyerVisibilityVerified: false as const,
    internalCompletionEligible: false as const,
  };
  if (goodsStatus === "DRAFT") return { ...common, reviewState: "not_submitted", saleState: "not_sellable", nextAction: "complete_category_attributes" };
  if (goodsStatus === "INCOMPLETE") return { ...common, reviewState: "pending_review", saleState: "not_sellable", nextAction: "wait_for_review" };
  if (goodsStatus === "ACTIVE") return { ...common, reviewState: "provider_active", saleState: "active_not_buyer_verified", nextAction: "verify_full_readback_and_buyer_visibility" };
  if (goodsStatus === "INACTIVE") return { ...common, reviewState: "provider_inactive", saleState: "non_public", nextAction: "keep_non_public" };
  return { ...common, reviewState: "provider_deleted", saleState: "withdrawn", nextAction: "stop_removed_lineage" };
}
