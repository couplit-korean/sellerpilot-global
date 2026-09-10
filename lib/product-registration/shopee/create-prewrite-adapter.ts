import {
  shopeeSgExpectedCategoryPathVerified,
  shopeeSgListingCreateExpectation,
} from "../../channels/shopee-sg-listing-create";
import {
  shopeeSgCreateExecutionLineageArgument,
  shopeeSgCreateExecutionLineageContract,
} from "./target-lineage-readiness";
import {
  prepareShopeeSgOfficialRequirements,
  type ShopeeSgRequirementReaders,
  type ShopeeSgRequirementRemote,
} from "./provider-requirements";
import { parseShopeeSgDaysToShip, parseShopeeSgPackage } from "./sg-requirements";
import { shopeePositiveInteger } from "./strict-numbers";
import { shopeeCreateConditionValid } from "../../channels/shopee-create-preflight";
import { shopeeSgCreateTransportPayloadFromArguments } from "./transport-json";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgCreatePrewriteContract =
  "sellerpilot_shopee_sg_create_prewrite_v1" as const;
export const shopeeSgCreatePrewriteEvidenceArgument =
  "sellerpilotShopeeSgCreatePrewriteEvidence" as const;

const localItemStatuses = ["NORMAL", "UNLIST", "BANNED", "DELETED"] as const;
const inventoryPageSize = 100;
const inventoryDetailBatchSize = 50;
const prewriteTtlMs = 5 * 60_000;

export type ShopeeSgCreateCredentialRevision = {
  credentialId: string;
  credentialVersion: number;
  credentialSnapshotSha256: string;
  merchantId: string;
  shopId: string;
  region: "SG";
};

export type ShopeeSgCreatePrewriteEvidence = {
  contract: typeof shopeeSgCreatePrewriteContract;
  preparedAt: string;
  expiresAt: string;
  credential: ShopeeSgCreateCredentialRevision;
  payloadSha256: string;
  provider: {
    merchantId: string;
    shopId: string;
    region: "SG";
    globalCategoryId: string;
    globalCategoryPath: string[];
    localCategoryId: string;
  };
  requirements: {
    brandId: number;
    attributeIds: number[];
    logisticsChannelIds: number[];
    warehouseId: string;
    shopId: string;
    daysToShip: number;
  };
  duplicateAbsence: {
    mode: "create" | "local-resume";
    globalItemId?: string;
    sku: string;
    globalName: string;
    localName: string;
    globalItemCount: number;
    localItemCount: number;
    localStatuses: typeof localItemStatuses;
  };
};

type InventoryRead = (
  path: string,
  query: URLSearchParams,
) => Promise<ShopeeSgRequirementRemote>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((row) => Object.keys(row).length > 0)
    : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function numericId(value: unknown) {
  const id = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(id) ? id : "";
}

function uuid(value: unknown) {
  const id = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)
    ? id
    : "";
}

function normalizedCredentialRevision(
  value: unknown,
  errorCode = "SHOPEE_SG_PREWRITE_CREDENTIAL_REVISION_INVALID",
): ShopeeSgCreateCredentialRevision {
  const row = record(value);
  const credentialId = uuid(row.credentialId);
  const credentialVersion = shopeePositiveInteger(row.credentialVersion);
  const merchantId = numericId(row.merchantId);
  const shopId = numericId(row.shopId);
  const credentialSnapshotSha256 = text(row.credentialSnapshotSha256).toLowerCase();
  if (!credentialId || credentialVersion === null || !merchantId || !shopId
      || row.region !== "SG" || !/^[a-f0-9]{64}$/u.test(credentialSnapshotSha256)) {
    throw new Error(errorCode);
  }
  return {
    credentialId,
    credentialVersion,
    credentialSnapshotSha256,
    merchantId,
    shopId,
    region: "SG",
  };
}

function sameCredentialRevision(
  left: ShopeeSgCreateCredentialRevision,
  right: ShopeeSgCreateCredentialRevision,
) {
  return left.credentialId === right.credentialId
    && left.credentialVersion === right.credentialVersion
    && left.credentialSnapshotSha256 === right.credentialSnapshotSha256
    && left.merchantId === right.merchantId
    && left.shopId === right.shopId
    && left.region === right.region;
}

function assertExecutionLineage(
  argumentsValue: UnknownRecord,
  credential: ShopeeSgCreateCredentialRevision,
) {
  const lineage = record(argumentsValue[shopeeSgCreateExecutionLineageArgument]);
  if (lineage.contract !== shopeeSgCreateExecutionLineageContract
      || uuid(lineage.credentialId) !== credential.credentialId
      || shopeePositiveInteger(lineage.credentialVersion) !== credential.credentialVersion
      || numericId(lineage.targetId) !== credential.shopId
      || lineage.marketCode !== "SG") {
    throw new Error("SHOPEE_SG_PREWRITE_EXECUTION_LINEAGE_MISMATCH");
  }
}

function successfulResponse(remote: ShopeeSgRequirementRemote, errorCode: string) {
  const root = record(remote.data);
  const response = record(root.response);
  const providerError = text(root.error);
  if (!remote.response.ok || providerError || !Object.keys(response).length) {
    throw new Error(errorCode);
  }
  return response;
}

function exactNonNegativeInteger(value: unknown, errorCode: string) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(errorCode);
  return parsed;
}

function inventoryRows(
  response: UnknownRecord,
  keys: readonly string[],
  errorCode: string,
) {
  const key = keys.find((candidate) => Object.hasOwn(response, candidate));
  if (!key || !Array.isArray(response[key])) throw new Error(errorCode);
  const rows = (response[key] as unknown[]).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(errorCode);
    return item as UnknownRecord;
  });
  return rows;
}

async function completeInventoryIds(input: {
  read: InventoryRead;
  path: string;
  listKeys: readonly string[];
  idKey: string;
  errorCode: string;
  fixedQuery?: Record<string, string>;
}) {
  const ids: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total: number | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const remote = await input.read(input.path, new URLSearchParams({
      ...(input.fixedQuery ?? {}),
      offset: String(offset),
      page_size: String(inventoryPageSize),
    }));
    const response = successfulResponse(remote, input.errorCode);
    const currentTotal = exactNonNegativeInteger(response.total_count, input.errorCode);
    if (total !== null && currentTotal !== total) throw new Error(input.errorCode);
    total ??= currentTotal;
    const rows = inventoryRows(response, input.listKeys, input.errorCode);
    if (rows.length > inventoryPageSize || offset + rows.length > total
        || (offset < total && rows.length === 0)) throw new Error(input.errorCode);
    for (const row of rows) {
      const id = numericId(row[input.idKey]);
      if (!id || seen.has(id)) throw new Error(input.errorCode);
      seen.add(id);
      ids.push(id);
    }
    const complete = offset + rows.length === total;
    if (Object.hasOwn(response, "has_next_page")
        && (typeof response.has_next_page !== "boolean"
          || response.has_next_page !== !complete)) throw new Error(input.errorCode);
    if (complete) return ids;
    offset += rows.length;
  }
  throw new Error(input.errorCode);
}

async function inventoryDetails(input: {
  ids: readonly string[];
  read: InventoryRead;
  path: string;
  queryKey: string;
  listKeys: readonly string[];
  idKey: string;
  skuKeys: readonly string[];
  nameKeys: readonly string[];
  errorCode: string;
}) {
  const details: UnknownRecord[] = [];
  for (let offset = 0; offset < input.ids.length; offset += inventoryDetailBatchSize) {
    const batch = input.ids.slice(offset, offset + inventoryDetailBatchSize);
    const remote = await input.read(input.path, new URLSearchParams({
      [input.queryKey]: batch.join(","),
    }));
    const response = successfulResponse(remote, input.errorCode);
    const rows = inventoryRows(response, input.listKeys, input.errorCode);
    const expected = new Set(batch);
    const returned = new Set<string>();
    if (rows.length !== batch.length) throw new Error(input.errorCode);
    for (const row of rows) {
      const id = numericId(row[input.idKey]);
      const sku = input.skuKeys.map((key) => text(row[key])).find(Boolean) ?? "";
      const name = input.nameKeys.map((key) => text(row[key])).find(Boolean) ?? "";
      if (!id || !expected.has(id) || returned.has(id) || !sku || !name) {
        throw new Error(input.errorCode);
      }
      returned.add(id);
      details.push({ id, sku, name });
    }
    if (returned.size !== expected.size) throw new Error(input.errorCode);
  }
  return details;
}

export async function readShopeeSgExactGlobalIdentity(input: {
  merchantRead: InventoryRead;
  sku: string;
  globalName: string;
}) {
  const ids = await completeInventoryIds({
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    errorCode: "SHOPEE_SG_GLOBAL_RESPONSE_LOSS_INVENTORY_INCOMPLETE",
  });
  const details = await inventoryDetails({
    ids,
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_info",
    queryKey: "global_item_id_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    skuKeys: ["global_item_sku", "item_sku"],
    nameKeys: ["global_item_name", "item_name"],
    errorCode: "SHOPEE_SG_GLOBAL_RESPONSE_LOSS_INVENTORY_INCOMPLETE",
  });
  const skuMatches = details.filter((item) => item.sku === input.sku);
  const nameMatches = details.filter((item) => item.name === input.globalName);
  const exact = details.filter((item) => item.sku === input.sku
    && item.name === input.globalName);
  if (exact.length !== 1 || skuMatches.length !== 1 || nameMatches.length !== 1) {
    throw new Error("SHOPEE_SG_GLOBAL_RESPONSE_LOSS_IDENTITY_UNRESOLVED");
  }
  return exact[0].id as string;
}

async function exactDuplicateAbsence(input: {
  merchantRead: InventoryRead;
  shopRead: InventoryRead;
  sku: string;
  globalName: string;
  localName: string;
  resumeGlobalItemId?: string;
}) {
  const globalIds = await completeInventoryIds({
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    errorCode: "SHOPEE_SG_PREWRITE_GLOBAL_INVENTORY_INCOMPLETE",
  });
  const globalDetails = await inventoryDetails({
    ids: globalIds,
    read: input.merchantRead,
    path: "/api/v2/global_product/get_global_item_info",
    queryKey: "global_item_id_list",
    listKeys: ["global_item_list"],
    idKey: "global_item_id",
    skuKeys: ["global_item_sku", "item_sku"],
    nameKeys: ["global_item_name", "item_name"],
    errorCode: "SHOPEE_SG_PREWRITE_GLOBAL_INVENTORY_INCOMPLETE",
  });
  const globalSkuMatches = globalDetails.filter((item) => item.sku === input.sku);
  const globalNameMatches = globalDetails.filter((item) => item.name === input.globalName);
  if (input.resumeGlobalItemId) {
    const owned = globalDetails.filter((item) => item.id === input.resumeGlobalItemId
      && item.sku === input.sku && item.name === input.globalName);
    if (owned.length !== 1 || globalSkuMatches.length !== 1 || globalNameMatches.length !== 1) {
      throw new Error("SHOPEE_SG_PREWRITE_RESUME_GLOBAL_IDENTITY_INVALID");
    }
  } else {
    if (globalSkuMatches.length) {
      throw new Error("SHOPEE_SG_PREWRITE_EXACT_SKU_EXISTS_GLOBAL");
    }
    if (globalNameMatches.length) {
      throw new Error("SHOPEE_SG_PREWRITE_EXACT_NAME_EXISTS_GLOBAL");
    }
  }

  const localIds: string[] = [];
  const seenLocalIds = new Set<string>();
  for (const status of localItemStatuses) {
    const ids = await completeInventoryIds({
      read: input.shopRead,
      path: "/api/v2/product/get_item_list",
      listKeys: ["item", "item_list"],
      idKey: "item_id",
      errorCode: "SHOPEE_SG_PREWRITE_LOCAL_INVENTORY_INCOMPLETE",
      fixedQuery: { item_status: status },
    });
    for (const id of ids) {
      if (seenLocalIds.has(id)) {
        throw new Error("SHOPEE_SG_PREWRITE_LOCAL_INVENTORY_INCOMPLETE");
      }
      seenLocalIds.add(id);
      localIds.push(id);
    }
  }
  const localDetails = await inventoryDetails({
    ids: localIds,
    read: input.shopRead,
    path: "/api/v2/product/get_item_base_info",
    queryKey: "item_id_list",
    listKeys: ["item_list"],
    idKey: "item_id",
    skuKeys: ["item_sku", "seller_sku"],
    nameKeys: ["item_name", "global_item_name"],
    errorCode: "SHOPEE_SG_PREWRITE_LOCAL_INVENTORY_INCOMPLETE",
  });
  if (localDetails.some((item) => item.sku === input.sku)) {
    throw new Error("SHOPEE_SG_PREWRITE_EXACT_SKU_EXISTS_LOCAL");
  }
  if (localDetails.some((item) => item.name === input.localName)) {
    throw new Error("SHOPEE_SG_PREWRITE_EXACT_NAME_EXISTS_LOCAL");
  }
  return {
    mode: input.resumeGlobalItemId ? "local-resume" as const : "create" as const,
    ...(input.resumeGlobalItemId ? { globalItemId: input.resumeGlobalItemId } : {}),
    sku: input.sku,
    globalName: input.globalName,
    localName: input.localName,
    globalItemCount: globalIds.length,
    localItemCount: localIds.length,
    localStatuses: [...localItemStatuses] as typeof localItemStatuses,
  };
}

function recommendedLocalCategory(
  recommendationRemote: ShopeeSgRequirementRemote,
  categoryRemote: ShopeeSgRequirementRemote,
) {
  const recommendation = successfulResponse(
    recommendationRemote,
    "SHOPEE_SG_PREWRITE_LOCAL_CATEGORY_INVALID",
  );
  const category = successfulResponse(
    categoryRemote,
    "SHOPEE_SG_PREWRITE_LOCAL_CATEGORY_INVALID",
  );
  const recommended = Array.isArray(recommendation.category_id)
    ? recommendation.category_id.map(numericId).filter(Boolean)
    : [];
  const leaves = new Set(records(category.category_list).flatMap((row) => {
    const id = numericId(row.category_id);
    const hasChildren = row.has_children;
    return id && (hasChildren === false || hasChildren === 0 || hasChildren === "0")
      ? [id]
      : [];
  }));
  const matches = [...new Set(recommended)].filter((id) => leaves.has(id));
  if (matches.length !== 1) throw new Error("SHOPEE_SG_PREWRITE_LOCAL_CATEGORY_INVALID");
  return matches[0];
}

function payloadSha256(argumentsValue: UnknownRecord) {
  return shopeeSgCreateTransportPayloadFromArguments(argumentsValue).payloadSha256;
}

function exactPreparedEvidence(value: unknown): ShopeeSgCreatePrewriteEvidence {
  const evidence = record(value);
  const provider = record(evidence.provider);
  const requirements = record(evidence.requirements);
  const duplicateAbsence = record(evidence.duplicateAbsence);
  const credential = normalizedCredentialRevision(evidence.credential);
  const preparedAt = text(evidence.preparedAt);
  const expiresAt = text(evidence.expiresAt);
  const attributeIds = Array.isArray(requirements.attributeIds)
    ? requirements.attributeIds.map(shopeePositiveInteger)
    : [];
  const logisticsChannelIds = Array.isArray(requirements.logisticsChannelIds)
    ? requirements.logisticsChannelIds.map(shopeePositiveInteger)
    : [];
  const statuses = Array.isArray(duplicateAbsence.localStatuses)
    ? duplicateAbsence.localStatuses.map(text)
    : [];
  const duplicateMode = text(duplicateAbsence.mode);
  const resumeGlobalItemId = numericId(duplicateAbsence.globalItemId);
  if (evidence.contract !== shopeeSgCreatePrewriteContract
      || !Number.isFinite(Date.parse(preparedAt)) || !Number.isFinite(Date.parse(expiresAt))
      || !/^[a-f0-9]{64}$/u.test(text(evidence.payloadSha256))
      || numericId(provider.merchantId) !== credential.merchantId
      || numericId(provider.shopId) !== credential.shopId
      || provider.region !== "SG"
      || !numericId(provider.globalCategoryId) || !numericId(provider.localCategoryId)
      || !Array.isArray(provider.globalCategoryPath) || !provider.globalCategoryPath.length
      || !provider.globalCategoryPath.every((part) => Boolean(text(part)))
      || shopeePositiveInteger(requirements.brandId) === null
      || !attributeIds.length || attributeIds.some((id) => id === null)
      || new Set(attributeIds).size !== attributeIds.length
      || !logisticsChannelIds.length || logisticsChannelIds.some((id) => id === null)
      || new Set(logisticsChannelIds).size !== logisticsChannelIds.length
      || !numericId(requirements.warehouseId)
      || numericId(requirements.shopId) !== credential.shopId
      || (() => {
        try {
          parseShopeeSgDaysToShip(requirements.daysToShip);
          return false;
        } catch {
          return true;
        }
      })()
      || !text(duplicateAbsence.sku) || !text(duplicateAbsence.globalName)
      || !text(duplicateAbsence.localName)
      || !["create", "local-resume"].includes(duplicateMode)
      || (duplicateMode === "create" && Boolean(resumeGlobalItemId))
      || (duplicateMode === "local-resume" && !resumeGlobalItemId)
      || !Number.isSafeInteger(duplicateAbsence.globalItemCount)
      || Number(duplicateAbsence.globalItemCount) < 0
      || !Number.isSafeInteger(duplicateAbsence.localItemCount)
      || Number(duplicateAbsence.localItemCount) < 0
      || statuses.length !== localItemStatuses.length
      || statuses.some((status, index) => status !== localItemStatuses[index])) {
    throw new Error("SHOPEE_SG_PREWRITE_EVIDENCE_INVALID");
  }
  return evidence as ShopeeSgCreatePrewriteEvidence;
}

export async function prepareShopeeSgCreatePrewrite(input: {
  argumentsValue: UnknownRecord;
  credential: ShopeeSgCreateCredentialRevision;
  readCurrentCredential: () => Promise<ShopeeSgCreateCredentialRevision>;
  readers: ShopeeSgRequirementReaders;
  resumeGlobalItemId?: string;
  now?: Date;
}) {
  const credential = normalizedCredentialRevision(input.credential);
  const sourceArguments = structuredClone(input.argumentsValue);
  delete sourceArguments[shopeeSgCreatePrewriteEvidenceArgument];
  delete sourceArguments.sellerpilotShopeeSgResumeGlobalItemId;
  const resumeGlobalItemId = input.resumeGlobalItemId === undefined
    ? ""
    : numericId(input.resumeGlobalItemId);
  if (input.resumeGlobalItemId !== undefined && !resumeGlobalItemId) {
    throw new Error("SHOPEE_SG_PREWRITE_RESUME_GLOBAL_ID_INVALID");
  }
  assertExecutionLineage(sourceArguments, credential);
  const expectation = shopeeSgListingCreateExpectation(sourceArguments);
  if (!expectation.ok) {
    throw new Error(`SHOPEE_SG_PREWRITE_ARGUMENTS_INVALID:${expectation.mismatchFields.join(",")}`);
  }
  if (expectation.expectation.context.targetId !== credential.shopId) {
    throw new Error("SHOPEE_SG_PREWRITE_TARGET_MISMATCH");
  }
  const body = record(sourceArguments.body);
  const publish = record(sourceArguments.publish);
  const publishItem = record(publish.item);
  const categoryId = numericId(body.category_id);
  const globalName = text(body.global_item_name);
  const localName = text(publishItem.item_name);
  if (!categoryId || numericId(publish.shop_id) !== credential.shopId
      || text(publish.shop_region).toUpperCase() !== "SG" || !globalName || !localName) {
    throw new Error("SHOPEE_SG_PREWRITE_ARGUMENTS_INVALID");
  }
  parseShopeeSgPackage(body);
  parseShopeeSgPackage(publishItem);
  parseShopeeSgDaysToShip(body.days_to_ship);
  parseShopeeSgDaysToShip(publishItem.days_to_ship);
  if (!shopeeCreateConditionValid(body.condition)
      || !shopeeCreateConditionValid(publishItem.condition)
      || text(body.condition).toUpperCase() !== text(publishItem.condition).toUpperCase()) {
    throw new Error("SHOPEE_SG_GLOBAL_LOCAL_CONDITION_MISMATCH");
  }

  const assertCurrentCredential = async () => {
    const current = normalizedCredentialRevision(
      await input.readCurrentCredential(),
      "SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED",
    );
    if (!sameCredentialRevision(credential, current)) {
      throw new Error("SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED");
    }
  };
  const guarded = async <T>(read: () => Promise<T>) => {
    await assertCurrentCredential();
    const result = await read();
    await assertCurrentCredential();
    return result;
  };
  const readers: ShopeeSgRequirementReaders = {
    merchantGet: (path, query) => guarded(() => input.readers.merchantGet(path, query)),
    merchantPost: (path, requestBody) => guarded(() => input.readers.merchantPost(path, requestBody)),
    shopGet: (path, query) => guarded(() => input.readers.shopGet(path, query)),
  };

  await assertCurrentCredential();
  const merchantInfo = successfulResponse(await readers.merchantGet(
    "/api/v2/merchant/get_merchant_info",
    new URLSearchParams(),
  ), "SHOPEE_SG_PREWRITE_MERCHANT_IDENTITY_INVALID");
  if (numericId(merchantInfo.merchant_id) !== credential.merchantId) {
    throw new Error("SHOPEE_SG_PREWRITE_MERCHANT_IDENTITY_INVALID");
  }
  const shopInfo = successfulResponse(await readers.shopGet(
    "/api/v2/shop/get_shop_info",
    new URLSearchParams(),
  ), "SHOPEE_SG_PREWRITE_SHOP_IDENTITY_INVALID");
  if (numericId(shopInfo.shop_id) !== credential.shopId
      || text(shopInfo.region ?? shopInfo.country).toUpperCase() !== "SG") {
    throw new Error("SHOPEE_SG_PREWRITE_SHOP_IDENTITY_INVALID");
  }
  const categoryRemote = await readers.merchantGet(
    "/api/v2/global_product/get_category",
    new URLSearchParams({ language: "en" }),
  );
  const globalCategoryPath = shopeeSgExpectedCategoryPathVerified(
    categoryRemote.data,
    expectation.expectation.context,
  );
  if (!categoryRemote.response.ok || !globalCategoryPath) {
    throw new Error("SHOPEE_SG_PREWRITE_GLOBAL_CATEGORY_INVALID");
  }
  const attributeRemote = await readers.merchantGet(
    "/api/v2/global_product/get_attribute_tree",
    new URLSearchParams({ category_id_list: categoryId, language: "en" }),
  );
  if (!attributeRemote.response.ok) {
    throw new Error("SHOPEE_SG_PREWRITE_ATTRIBUTE_METADATA_INVALID");
  }
  const localRecommendation = await readers.shopGet(
    "/api/v2/product/category_recommend",
    new URLSearchParams({ item_name: localName }),
  );
  const localCategories = await readers.shopGet(
    "/api/v2/product/get_category",
    new URLSearchParams({ language: "en" }),
  );
  const localCategoryId = recommendedLocalCategory(localRecommendation, localCategories);

  const prepared = await prepareShopeeSgOfficialRequirements({
    body,
    publishItem,
    targetShopId: credential.shopId,
    globalAttributeResponse: attributeRemote.data,
    readers,
  });
  const duplicateAbsence = await exactDuplicateAbsence({
    merchantRead: readers.merchantGet,
    shopRead: readers.shopGet,
    sku: expectation.expectation.context.sku,
    globalName,
    localName,
    ...(resumeGlobalItemId ? { resumeGlobalItemId } : {}),
  });
  await assertCurrentCredential();

  const normalizedArguments = {
    ...sourceArguments,
    ...(resumeGlobalItemId ? { sellerpilotShopeeSgResumeGlobalItemId: resumeGlobalItemId } : {}),
    sellerpilotProviderGlobalCategoryPath: globalCategoryPath,
    sellerpilotProviderLocalCategoryId: localCategoryId,
    body: prepared.body,
    publish: { ...publish, item: prepared.publishItem },
  };
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("SHOPEE_SG_PREWRITE_CLOCK_INVALID");
  const evidence: ShopeeSgCreatePrewriteEvidence = {
    contract: shopeeSgCreatePrewriteContract,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + prewriteTtlMs).toISOString(),
    credential,
    payloadSha256: payloadSha256(normalizedArguments),
    provider: {
      merchantId: credential.merchantId,
      shopId: credential.shopId,
      region: "SG",
      globalCategoryId: categoryId,
      globalCategoryPath: [...globalCategoryPath.names],
      localCategoryId,
    },
    requirements: prepared.evidence,
    duplicateAbsence,
  };
  return {
    argumentsValue: {
      ...normalizedArguments,
      [shopeeSgCreatePrewriteEvidenceArgument]: evidence,
    },
    evidence,
  };
}

export async function assertShopeeSgCreatePrewriteAtMutation(input: {
  argumentsValue: UnknownRecord;
  stage: "global-item-create" | "local-publish";
  readCurrentCredential: () => Promise<ShopeeSgCreateCredentialRevision>;
  now?: Date;
}) {
  const evidence = exactPreparedEvidence(
    input.argumentsValue[shopeeSgCreatePrewriteEvidenceArgument],
  );
  const resumeGlobalItemId = numericId(input.argumentsValue.sellerpilotShopeeSgResumeGlobalItemId);
  if ((evidence.duplicateAbsence.mode === "create" && resumeGlobalItemId)
      || (evidence.duplicateAbsence.mode === "local-resume"
        && resumeGlobalItemId !== evidence.duplicateAbsence.globalItemId)) {
    throw new Error("SHOPEE_SG_PREWRITE_EVIDENCE_INVALID");
  }
  const current = normalizedCredentialRevision(
    await input.readCurrentCredential(),
    "SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED",
  );
  if (!sameCredentialRevision(evidence.credential, current)) {
    throw new Error("SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED");
  }
  assertExecutionLineage(input.argumentsValue, current);
  const nowMs = (input.now ?? new Date()).getTime();
  const preparedAt = Date.parse(evidence.preparedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(nowMs) || preparedAt > nowMs + 5_000
      || expiresAt !== preparedAt + prewriteTtlMs || nowMs > expiresAt) {
    throw new Error("SHOPEE_SG_PREWRITE_EXPIRED");
  }
  if (payloadSha256(input.argumentsValue) !== evidence.payloadSha256) {
    throw new Error("SHOPEE_SG_PREWRITE_PAYLOAD_CHANGED");
  }
  const publish = record(input.argumentsValue.publish);
  if (input.stage === "global-item-create" && !Object.keys(record(input.argumentsValue.body)).length) {
    throw new Error("SHOPEE_SG_PREWRITE_GLOBAL_BODY_MISSING");
  }
  if (input.stage === "local-publish"
      && (numericId(publish.shop_id) !== current.shopId
        || !Object.keys(record(publish.item)).length)) {
    throw new Error("SHOPEE_SG_PREWRITE_LOCAL_BODY_MISSING");
  }
  return evidence;
}
