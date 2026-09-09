import { registrationPatches, type RegistrationPatch } from "../../channel-registration-form";
import {
  publishRegistrationDataSchema,
  publishRegistrationIdentity,
  restoreChannelRegistrationPatches,
} from "../../publish-registration-draft";
import {
  assertShopeeSgWarehouseEligibleShop,
  bindShopeeSgWarehouseStock,
  parseShopeeSgPackage,
  resolveShopeeSgBrand,
  validateShopeeSgLogisticsSelection,
  validateShopeeSgRequiredAttributes,
  type ShopeeSgWarehouse,
} from "./sg-requirements";
import { shopeePositiveMoney } from "./strict-numbers";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgRequirementSnapshotContract = "sellerpilot_shopee_sg_requirement_snapshot_v1" as const;

export type ShopeeSgRequirementState<T> =
  | { state: "loading" }
  | { state: "missing"; reason: string }
  | { state: "blocked"; code: string; message: string }
  | { state: "ready"; value: T };

export type ShopeeSgRequirementSnapshot = {
  contract: typeof shopeeSgRequirementSnapshotContract;
  observedAt: string;
  tuple: {
    credentialId: string;
    merchantId: string;
    shopId: string;
    region: "SG";
    categoryId: string;
    sourceFingerprint: string;
  };
  resources: {
    category: ShopeeSgRequirementState<{
      categoryId: string;
      path: string[];
      hasChildren: boolean;
    }>;
    brand: ShopeeSgRequirementState<{
      brands: UnknownRecord[];
      mandatory: boolean;
      inputType: string;
    }>;
    attributes: ShopeeSgRequirementState<{ attributeTree: UnknownRecord[] }>;
    logistics: ShopeeSgRequirementState<{ channels: UnknownRecord[] }>;
    warehouses: ShopeeSgRequirementState<{ warehouses: ShopeeSgWarehouse[] }>;
    eligibleShops: ShopeeSgRequirementState<{
      byWarehouse: Array<{ warehouseId: string; shops: UnknownRecord[] }>;
    }>;
  };
};

export type ShopeeSgRequirementResourceKey = keyof ShopeeSgRequirementSnapshot["resources"];

export type ShopeeSgRequirementViewModel = {
  contract: typeof shopeeSgRequirementSnapshotContract;
  identity: string;
  tuple: ShopeeSgRequirementSnapshot["tuple"];
  observedAt: string;
  resources: ShopeeSgRequirementSnapshot["resources"];
  baseDraft: UnknownRecord | null;
  selectedDraft: UnknownRecord | null;
  savedGlobalPriceUsd: number | null;
  saveAllowed: boolean;
  blockers: Array<{
    resource: ShopeeSgRequirementResourceKey | "snapshot" | "draft";
    state: "missing" | "blocked";
    code: string;
    message: string;
  }>;
};

export type ShopeeSgRequirementSavePlan = {
  identity: string;
  categoryId: string;
  sourceFingerprint: string;
  patches: RegistrationPatch[];
  evidence: {
    brandId: number;
    attributeIds: number[];
    logisticsChannelIds: number[];
    warehouseId: string;
    locationId: string;
    shopId: string;
    globalPriceUsd: number;
    localPriceSgd: number;
  };
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveIntegerText(value: unknown) {
  const normalized = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(normalized) ? normalized : "";
}

function positiveMoney(value: unknown) {
  return shopeePositiveMoney(value);
}

function block(
  resource: ShopeeSgRequirementViewModel["blockers"][number]["resource"],
  code: string,
  message: string,
): ShopeeSgRequirementViewModel["blockers"][number] {
  return { resource, state: code.endsWith("_MISSING") ? "missing" : "blocked", code, message };
}

function exactBaseDraft(input: {
  baseDraft: unknown;
  shopId: string;
  categoryId: string;
}) {
  const base = record(input.baseDraft);
  const body = record(base?.body);
  const publish = record(base?.publish);
  const item = record(publish?.item);
  if (!base || !body || !publish || !item
    || positiveIntegerText(base.shopId) !== input.shopId
    || text(base.country).toUpperCase() !== "SG"
    || positiveIntegerText(publish.shop_id) !== input.shopId
    || text(publish.shop_region).toUpperCase() !== "SG"
    || positiveIntegerText(body.category_id) !== input.categoryId
    || positiveIntegerText(item.category_id) !== input.categoryId) {
    throw new Error("SHOPEE_SG_BASE_DRAFT_TUPLE_MISMATCH");
  }
  return base;
}

function snapshotAgeValid(observedAt: string, now: Date, maxAgeMs: number) {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp)
    && timestamp <= now.getTime() + 60_000
    && now.getTime() - timestamp <= maxAgeMs;
}

const requirementResourceKeys = [
  "category",
  "brand",
  "attributes",
  "logistics",
  "warehouses",
  "eligibleShops",
] as const satisfies readonly ShopeeSgRequirementResourceKey[];

const emptyTuple: ShopeeSgRequirementSnapshot["tuple"] = {
  credentialId: "",
  merchantId: "",
  shopId: "",
  region: "SG",
  categoryId: "",
  sourceFingerprint: "",
};

function exactRecordArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => record(item) !== null);
}

function readyResourceValueValid(key: ShopeeSgRequirementResourceKey, value: unknown) {
  const candidate = record(value);
  if (!candidate) return false;
  if (key === "category") {
    return typeof candidate.categoryId === "string"
      && Boolean(positiveIntegerText(candidate.categoryId))
      && typeof candidate.hasChildren === "boolean"
      && Array.isArray(candidate.path)
      && candidate.path.length > 0
      && candidate.path.every((part) => typeof part === "string" && Boolean(part.trim()));
  }
  if (key === "brand") {
    return exactRecordArray(candidate.brands)
      && typeof candidate.mandatory === "boolean"
      && Boolean(text(candidate.inputType));
  }
  if (key === "attributes") return exactRecordArray(candidate.attributeTree);
  if (key === "logistics") return exactRecordArray(candidate.channels);
  if (key === "warehouses") {
    return Array.isArray(candidate.warehouses)
      && candidate.warehouses.every((warehouse) => {
        const row = record(warehouse);
        return Boolean(row
          && typeof row.warehouseId === "string" && row.warehouseId.trim()
          && typeof row.locationId === "string" && row.locationId.trim()
          && typeof row.name === "string");
      });
  }
  return Array.isArray(candidate.byWarehouse)
    && candidate.byWarehouse.every((entry) => {
      const row = record(entry);
      return Boolean(row
        && typeof row.warehouseId === "string" && row.warehouseId.trim()
        && exactRecordArray(row.shops));
    });
}

function invalidResourceState(key: ShopeeSgRequirementResourceKey): ShopeeSgRequirementState<never> {
  return {
    state: "blocked",
    code: "SHOPEE_SG_REQUIREMENT_SNAPSHOT_INVALID",
    message: `${key} 공식 후보 snapshot 형식이 유효하지 않습니다.`,
  };
}

function normalizeSnapshotResources(value: unknown) {
  const container = record(value);
  const normalized: Partial<Record<ShopeeSgRequirementResourceKey, ShopeeSgRequirementState<unknown>>> = {};
  let malformed = !container;
  for (const key of requirementResourceKeys) {
    const state = record(container?.[key]);
    const stateName = text(state?.state);
    const valid = stateName === "loading"
      || (stateName === "missing" && Boolean(text(state?.reason)))
      || (stateName === "blocked" && Boolean(text(state?.code)) && Boolean(text(state?.message)))
      || (stateName === "ready" && readyResourceValueValid(key, state?.value));
    if (!valid) {
      malformed = true;
      normalized[key] = invalidResourceState(key);
    } else {
      normalized[key] = state as ShopeeSgRequirementState<unknown>;
    }
  }
  return { resources: normalized as ShopeeSgRequirementSnapshot["resources"], malformed };
}

function normalizeSnapshotTuple(value: unknown) {
  const tuple = record(value);
  if (!tuple
    || typeof tuple.credentialId !== "string" || !tuple.credentialId.trim()
    || typeof tuple.merchantId !== "string"
    || !positiveIntegerText(tuple.merchantId)
    || typeof tuple.shopId !== "string"
    || !positiveIntegerText(tuple.shopId)
    || tuple.region !== "SG"
    || typeof tuple.categoryId !== "string"
    || !positiveIntegerText(tuple.categoryId)
    || typeof tuple.sourceFingerprint !== "string" || !tuple.sourceFingerprint.trim()) {
    return { tuple: emptyTuple, malformed: true };
  }
  return {
    tuple: {
      credentialId: text(tuple.credentialId),
      merchantId: positiveIntegerText(tuple.merchantId),
      shopId: positiveIntegerText(tuple.shopId),
      region: "SG" as const,
      categoryId: positiveIntegerText(tuple.categoryId),
      sourceFingerprint: text(tuple.sourceFingerprint),
    },
    malformed: false,
  };
}

export function buildShopeeSgRequirementViewModel(input: {
  draftData: unknown;
  baseDraft: unknown;
  snapshot: unknown;
  credentialId: unknown;
  merchantId: unknown;
  shopId: unknown;
  categoryId: unknown;
  expectedSourceFingerprint: unknown;
  now?: Date;
  maxAgeMs?: number;
}): ShopeeSgRequirementViewModel {
  const credentialId = text(input.credentialId);
  const merchantId = positiveIntegerText(input.merchantId);
  const shopId = positiveIntegerText(input.shopId);
  const categoryId = positiveIntegerText(input.categoryId);
  const sourceFingerprint = text(input.expectedSourceFingerprint);
  const identity = publishRegistrationIdentity("shopee", "SG", shopId, credentialId);
  const blockers: ShopeeSgRequirementViewModel["blockers"] = [];
  const snapshot = record(input.snapshot);
  const normalizedTuple = normalizeSnapshotTuple(snapshot?.tuple);
  const normalizedResources = normalizeSnapshotResources(snapshot?.resources);
  const observedAt = text(snapshot?.observedAt);
  const draftData = publishRegistrationDataSchema.safeParse(input.draftData);
  let baseDraft: UnknownRecord | null = null;
  let selectedDraft: UnknownRecord | null = null;
  let savedGlobalPriceUsd: number | null = null;

  if (!credentialId || !merchantId || !shopId || !categoryId || !sourceFingerprint) {
    blockers.push(block("draft", "SHOPEE_SG_DRAFT_IDENTITY_MISSING", "저장할 credential/shop/category/source 정체성이 완전하지 않습니다."));
  }
  if (!snapshot
    || snapshot.contract !== shopeeSgRequirementSnapshotContract
    || !observedAt
    || normalizedTuple.malformed
    || normalizedResources.malformed) {
    blockers.push(block("snapshot", "SHOPEE_SG_REQUIREMENT_SNAPSHOT_INVALID", "지원하는 Shopee SG 필수조건 snapshot이 아닙니다."));
  }
  if (!normalizedTuple.malformed) {
    const tuple = normalizedTuple.tuple;
    if (tuple.region !== "SG"
      || tuple.credentialId !== credentialId
      || tuple.merchantId !== merchantId
      || tuple.shopId !== shopId
      || tuple.categoryId !== categoryId
      || tuple.sourceFingerprint !== sourceFingerprint
      || !text(tuple.merchantId)) {
      blockers.push(block("snapshot", "SHOPEE_SG_REQUIREMENT_TUPLE_MISMATCH", "공식 후보가 현재 credential/shop/category/source와 일치하지 않습니다."));
    }
    if (!snapshotAgeValid(observedAt, input.now ?? new Date(), input.maxAgeMs ?? 10 * 60_000)) {
      blockers.push(block("snapshot", "SHOPEE_SG_REQUIREMENT_SNAPSHOT_STALE", "공식 필수조건 snapshot이 만료되었거나 시각이 유효하지 않습니다."));
    }
  }

  if (!draftData.success) {
    blockers.push(block("draft", "SHOPEE_SG_DRAFT_DATA_INVALID", "저장된 상품등록 초안 원장을 읽을 수 없습니다."));
  } else {
    savedGlobalPriceUsd = positiveMoney(draftData.data.common.globalBaseUsdPrice);
    if (savedGlobalPriceUsd === null) {
      blockers.push(block("draft", "SHOPEE_SG_GLOBAL_PRICE_MISSING", "공통 원장에 명시적으로 저장된 USD 기준가가 없습니다."));
    }
    if (draftData.data.sourceFingerprint !== sourceFingerprint) {
      blockers.push(block("draft", "SHOPEE_SG_DRAFT_SOURCE_MISMATCH", "저장된 초안의 원상품 fingerprint가 현재 상품과 다릅니다."));
    }
    const channelDraft = draftData.data.channels[identity];
    if (!channelDraft) {
      blockers.push(block("draft", "SHOPEE_SG_CHANNEL_DRAFT_MISSING", "현재 SG 숍 정체성에 저장된 채널 초안이 없습니다."));
    } else if (channelDraft.categoryId !== categoryId) {
      blockers.push(block("draft", "SHOPEE_SG_DRAFT_CATEGORY_MISMATCH", "저장된 채널 초안의 category가 현재 선택과 다릅니다."));
    } else {
      try {
        baseDraft = exactBaseDraft({ baseDraft: input.baseDraft, shopId, categoryId });
        selectedDraft = restoreChannelRegistrationPatches(baseDraft, channelDraft.patches);
        exactBaseDraft({ baseDraft: selectedDraft, shopId, categoryId });
      } catch (error) {
        blockers.push(block("draft", "SHOPEE_SG_DRAFT_RESTORE_BLOCKED", error instanceof Error ? error.message : "저장된 채널 초안을 복원할 수 없습니다."));
      }
    }
  }

  for (const resource of requirementResourceKeys) {
    const state = normalizedResources.resources[resource];
    if (state.state === "loading") {
      blockers.push(block(resource, "SHOPEE_SG_REQUIREMENT_LOADING", `${resource} 공식 조회가 아직 진행 중입니다.`));
    } else if (state.state === "missing") {
      blockers.push(block(resource, "SHOPEE_SG_REQUIREMENT_MISSING", state.reason));
    } else if (state.state === "blocked") {
      blockers.push(block(resource, state.code, state.message));
    }
  }

  if (normalizedResources.resources.category.state === "ready") {
    const category = normalizedResources.resources.category.value;
    if (category.categoryId !== categoryId || category.hasChildren || !Array.isArray(category.path) || !category.path.length) {
      blockers.push(block("category", "SHOPEE_SG_CATEGORY_CANDIDATE_INVALID", "공식 category 후보가 현재 leaf category와 일치하지 않습니다."));
    }
  }

  return {
    contract: shopeeSgRequirementSnapshotContract,
    identity,
    tuple: normalizedTuple.tuple,
    observedAt,
    resources: normalizedResources.resources,
    baseDraft,
    selectedDraft,
    savedGlobalPriceUsd,
    saveAllowed: blockers.length === 0 && selectedDraft !== null,
    blockers,
  };
}

function requireReady<K extends ShopeeSgRequirementResourceKey>(
  viewModel: ShopeeSgRequirementViewModel,
  key: K,
): Extract<ShopeeSgRequirementSnapshot["resources"][K], { state: "ready" }>["value"] {
  const resources = record(viewModel.resources);
  const state = record(resources?.[key]);
  if (state?.state !== "ready" || !readyResourceValueValid(key, state.value)) {
    throw new Error(`SHOPEE_SG_${key.toUpperCase()}_NOT_READY`);
  }
  return state.value as Extract<ShopeeSgRequirementSnapshot["resources"][K], { state: "ready" }>["value"];
}

export function planShopeeSgRequirementDraftSave(input: {
  viewModel: ShopeeSgRequirementViewModel;
  currentDraft: unknown;
}): ShopeeSgRequirementSavePlan {
  const viewModel = input.viewModel;
  const viewModelRecord = record(viewModel);
  const tuple = record(viewModelRecord?.tuple);
  const baseDraft = record(viewModelRecord?.baseDraft);
  const selectedDraft = record(viewModelRecord?.selectedDraft);
  if (!viewModelRecord
    || viewModel.contract !== shopeeSgRequirementSnapshotContract
    || viewModel.saveAllowed !== true
    || !baseDraft
    || !selectedDraft
    || !tuple
    || !text(tuple.credentialId)
    || !positiveIntegerText(tuple.merchantId)
    || !positiveIntegerText(tuple.shopId)
    || tuple.region !== "SG"
    || !positiveIntegerText(tuple.categoryId)
    || !text(tuple.sourceFingerprint)) {
    const blockers = Array.isArray(viewModelRecord?.blockers) ? viewModelRecord.blockers : [];
    const firstBlocker = record(blockers[0]);
    throw new Error(text(firstBlocker?.code) || "SHOPEE_SG_REQUIREMENT_SAVE_BLOCKED");
  }
  if (viewModel.identity !== publishRegistrationIdentity(
    "shopee",
    "SG",
    positiveIntegerText(tuple.shopId),
    text(tuple.credentialId),
  )) {
    throw new Error("SHOPEE_SG_REQUIREMENT_SAVE_BLOCKED");
  }
  for (const resource of requirementResourceKeys) requireReady(viewModel, resource);
  const current = exactBaseDraft({
    baseDraft: input.currentDraft,
    shopId: viewModel.tuple.shopId,
    categoryId: viewModel.tuple.categoryId,
  });
  const body = record(current.body)!;
  const publish = record(current.publish)!;
  const publishItem = record(publish.item)!;
  const packageValue = parseShopeeSgPackage(body);
  const publishPackage = parseShopeeSgPackage(publishItem);
  if (JSON.stringify(packageValue) !== JSON.stringify(publishPackage)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_PACKAGE_MISMATCH");
  }
  const brandCandidates = requireReady(viewModel, "brand");
  const brand = resolveShopeeSgBrand({
    selected: body.brand,
    officialBrands: brandCandidates.brands,
    mandatory: brandCandidates.mandatory,
    inputType: brandCandidates.inputType,
  });
  const publishBrand = resolveShopeeSgBrand({
    selected: publishItem.brand,
    officialBrands: brandCandidates.brands,
    mandatory: brandCandidates.mandatory,
    inputType: brandCandidates.inputType,
  });
  if (JSON.stringify(brand) !== JSON.stringify(publishBrand)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_BRAND_MISMATCH");
  }
  const attributes = validateShopeeSgRequiredAttributes({
    supplied: body.attribute_list,
    metadata: requireReady(viewModel, "attributes").attributeTree,
  });
  const publishAttributes = validateShopeeSgRequiredAttributes({
    supplied: publishItem.attribute_list,
    metadata: requireReady(viewModel, "attributes").attributeTree,
  });
  if (JSON.stringify(attributes) !== JSON.stringify(publishAttributes)) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_ATTRIBUTES_MISMATCH");
  }
  const logistics = validateShopeeSgLogisticsSelection({
    selected: publishItem.logistic,
    officialChannels: requireReady(viewModel, "logistics").channels,
    package: packageValue,
  });
  const stockRows = Array.isArray(body.seller_stock) ? body.seller_stock : [];
  const totalStock = body.normal_stock ?? (stockRows.length === 1 ? record(stockRows[0])?.stock : undefined);
  const stock = bindShopeeSgWarehouseStock({
    sellerStock: body.seller_stock,
    totalStock,
    warehouses: requireReady(viewModel, "warehouses").warehouses,
  });
  const publishStockRows = Array.isArray(publishItem.seller_stock) ? publishItem.seller_stock : [];
  const publishTotalStock = publishItem.normal_stock ?? (publishStockRows.length === 1
    ? record(publishStockRows[0])?.stock
    : undefined);
  const publishStock = bindShopeeSgWarehouseStock({
    sellerStock: publishItem.seller_stock,
    totalStock: publishTotalStock,
    warehouses: requireReady(viewModel, "warehouses").warehouses,
  });
  if (JSON.stringify(stock.sellerStock) !== JSON.stringify(publishStock.sellerStock)
    || stock.warehouse.warehouseId !== publishStock.warehouse.warehouseId) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_WAREHOUSE_MISMATCH");
  }
  const eligible = requireReady(viewModel, "eligibleShops");
  const eligibleMatches = eligible.byWarehouse.filter((candidate) => (
    candidate.warehouseId === stock.warehouse.warehouseId
  ));
  if (eligibleMatches.length !== 1) {
    throw new Error("SHOPEE_SG_WAREHOUSE_ELIGIBILITY_MISMATCH");
  }
  const eligibility = assertShopeeSgWarehouseEligibleShop({
    warehouse: stock.warehouse,
    targetShopId: viewModel.tuple.shopId,
    eligibleShops: eligibleMatches[0].shops,
  });
  const globalPriceUsd = positiveMoney(body.original_price);
  const localPriceSgd = positiveMoney(publishItem.original_price);
  if (globalPriceUsd === null) throw new Error("SHOPEE_SG_GLOBAL_PRICE_REQUIRED");
  if (globalPriceUsd !== viewModel.savedGlobalPriceUsd) {
    throw new Error("SHOPEE_SG_GLOBAL_PRICE_NOT_SAVED");
  }
  if (localPriceSgd === null) throw new Error("SHOPEE_SG_LOCAL_PRICE_REQUIRED");

  const normalized = structuredClone(current);
  const normalizedBody = record(normalized.body)!;
  const normalizedPublish = record(normalized.publish)!;
  const normalizedItem = record(normalizedPublish.item)!;
  normalizedBody.brand = brand;
  normalizedBody.attribute_list = attributes;
  normalizedBody.seller_stock = stock.sellerStock;
  normalizedItem.brand = publishBrand;
  normalizedItem.attribute_list = publishAttributes;
  normalizedItem.seller_stock = publishStock.sellerStock;
  normalizedItem.logistic = logistics;
  exactBaseDraft({ baseDraft: normalized, shopId: viewModel.tuple.shopId, categoryId: viewModel.tuple.categoryId });

  return {
    identity: viewModel.identity,
    categoryId: viewModel.tuple.categoryId,
    sourceFingerprint: viewModel.tuple.sourceFingerprint,
    patches: registrationPatches(baseDraft, normalized),
    evidence: {
      brandId: brand.brand_id,
      attributeIds: attributes.map((item) => item.attribute_id),
      logisticsChannelIds: logistics.map((item) => item.logistic_id),
      warehouseId: eligibility.warehouseId,
      locationId: stock.warehouse.locationId,
      shopId: eligibility.shopId,
      globalPriceUsd,
      localPriceSgd,
    },
  };
}
