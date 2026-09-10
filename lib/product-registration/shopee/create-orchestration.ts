import {
  assertShopeeSgCreatePrewriteAtMutation,
  prepareShopeeSgCreatePrewrite,
  type ShopeeSgCreateCredentialRevision,
} from "./create-prewrite-adapter";
import type {
  ShopeeSgRequirementReaders,
  ShopeeSgRequirementRemote,
} from "./provider-requirements";
import { shopeeFiniteNonNegative, shopeePositiveInteger, shopeePositiveMoney } from "./strict-numbers";

type UnknownRecord = Record<string, unknown>;

export type ShopeeSgCreateMutationStage = "global-item-create" | "local-publish";

export type ShopeeSgLocalPublicationReadback = {
  publishedRemote: ShopeeSgRequirementRemote;
  localRemote: ShopeeSgRequirementRemote;
};

export type ShopeeSgCreateOrchestrationDependencies = {
  readers: ShopeeSgRequirementReaders;
  readCurrentCredential: () => Promise<ShopeeSgCreateCredentialRevision>;
  assertLeaseHealthy: () => Promise<void>;
  beginProviderMutation: (
    stage: ShopeeSgCreateMutationStage,
    argumentsValue: UnknownRecord,
  ) => Promise<void>;
  completeProviderMutation: (
    stage: ShopeeSgCreateMutationStage,
    argumentsValue: UnknownRecord,
    result: {
      globalItemId: string;
      outputId: string;
      result: UnknownRecord;
    },
  ) => Promise<void>;
  prepareProviderImages: (argumentsValue: UnknownRecord) => Promise<UnknownRecord>;
  createGlobalItem: (body: UnknownRecord) => Promise<ShopeeSgRequirementRemote>;
  readGlobalItem: (globalItemId: string) => Promise<ShopeeSgRequirementRemote>;
  recordGlobalCreateReadback?: (input: {
    globalItemId: string;
    createRemote: ShopeeSgRequirementRemote;
    readbackRemote: ShopeeSgRequirementRemote;
    preparedArguments: UnknownRecord;
  }) => Promise<void>;
  createLocalPublish: (body: UnknownRecord) => Promise<ShopeeSgRequirementRemote>;
  readLocalPublication: (input: {
    globalItemId: string;
    publishTaskId: string;
    shopId: string;
  }) => Promise<ShopeeSgLocalPublicationReadback>;
  now?: () => Date;
};

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

function successfulResponse(remote: ShopeeSgRequirementRemote, errorCode: string) {
  const root = record(remote.data);
  const response = record(root.response);
  if (!remote.response.ok || text(root.error) || !Object.keys(response).length) {
    throw new Error(errorCode);
  }
  return response;
}

function exactMoney(value: unknown) {
  return shopeePositiveMoney(value);
}

function itemPrice(item: UnknownRecord) {
  const priceInfo = record(item.price_info);
  return exactMoney(item.original_price ?? priceInfo.original_price ?? priceInfo.current_price);
}

function itemStock(item: UnknownRecord) {
  const stockInfo = record(item.stock_info_v2);
  const summary = record(stockInfo.summary_info);
  const direct = shopeePositiveInteger(summary.total_available_stock ?? item.normal_stock);
  if (direct !== null) return direct;
  const sellerStock = records(item.seller_stock);
  if (!sellerStock.length) return null;
  const amounts = sellerStock.map((row) => shopeeFiniteNonNegative(row.stock));
  return amounts.every((amount) => amount !== null && Number.isSafeInteger(amount))
    ? amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0)
    : null;
}

function stockLocations(item: UnknownRecord) {
  const rows = records(item.seller_stock);
  if (!rows.length) return null;
  const normalized = rows.map((row) => {
    const locationId = text(row.location_id);
    const stock = shopeeFiniteNonNegative(row.stock);
    return locationId && stock !== null && Number.isSafeInteger(stock)
      ? `${locationId}:${stock}`
      : "";
  });
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length
    ? normalized.sort()
    : null;
}

function selectedLogistics(item: UnknownRecord) {
  const rows = Array.isArray(item.logistic) ? records(item.logistic) : records(item.logistic_info);
  const ids = rows.flatMap((row) => {
    const id = shopeePositiveInteger(row.logistic_id ?? row.logistics_channel_id);
    const enabled = row.enabled ?? row.is_enabled;
    return id !== null && (enabled === true || enabled === 1 || enabled === "1") ? [id] : [];
  });
  return ids.length && new Set(ids).size === ids.length ? ids.sort((left, right) => left - right) : null;
}

function sameStrings(left: readonly string[] | null, right: readonly string[] | null) {
  return Boolean(left && right && left.length === right.length
    && left.every((value, index) => value === right[index]));
}

function sameNumbers(left: readonly number[] | null, right: readonly number[] | null) {
  return Boolean(left && right && left.length === right.length
    && left.every((value, index) => value === right[index]));
}

function imageIds(value: unknown) {
  const image = record(value);
  if (!Array.isArray(image.image_id_list)) return null;
  const ids = image.image_id_list.map(text);
  return ids.length && ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
}

export function assertShopeeSgProviderImageBinding(argumentsValue: UnknownRecord) {
  const body = record(argumentsValue.body);
  const publish = record(argumentsValue.publish);
  const item = record(publish.item);
  const gallery = imageIds(body.image);
  const localGallery = imageIds(item.image);
  const details = Array.isArray(argumentsValue.sellerpilotProviderDetailImageIds)
    ? argumentsValue.sellerpilotProviderDetailImageIds.map(text)
    : [];
  const surface = text(argumentsValue.sellerpilotProviderImageSurface);
  if (!gallery || !localGallery || details.length !== 8 || details.some((id) => !id)
      || new Set(details).size !== 8 || gallery[0] === undefined
      || details.includes(gallery[0]) || gallery[0] !== localGallery[0]) {
    throw new Error("SHOPEE_SG_PROVIDER_IMAGES_UNVERIFIED");
  }
  if (surface === "gallery") {
    if (gallery.length !== 9 || localGallery.length !== 9
        || !sameStrings(gallery, localGallery)
        || !sameStrings(gallery.slice(1), details)) {
      throw new Error("SHOPEE_SG_PROVIDER_IMAGES_UNVERIFIED");
    }
    return;
  }
  if (surface !== "detail_content") {
    throw new Error("SHOPEE_SG_PROVIDER_IMAGES_UNVERIFIED");
  }
  const descriptionInfo = record(body.description_info);
  const extended = record(descriptionInfo.extended_description);
  const extendedDetails = records(extended.field_list).flatMap((field) => {
    if (field.field_type !== "image") return [];
    const id = text(record(field.image_info).image_id);
    return id ? [id] : [];
  });
  if (!sameStrings(extendedDetails, details)) {
    throw new Error("SHOPEE_SG_PROVIDER_IMAGES_UNVERIFIED");
  }
}

export function assertShopeeSgExactGlobalReadback(input: {
  remote: ShopeeSgRequirementRemote;
  globalItemId: string;
  expectedBody: UnknownRecord;
}) {
  const response = successfulResponse(input.remote, "SHOPEE_SG_GLOBAL_CREATE_READBACK_INVALID");
  const matches = records(response.global_item_list).filter((row) => (
    numericId(row.global_item_id) === input.globalItemId
  ));
  if (matches.length !== 1) throw new Error("SHOPEE_SG_GLOBAL_CREATE_READBACK_INVALID");
  const item = matches[0];
  const expectedStock = itemStock(input.expectedBody);
  const expectedLocations = stockLocations(input.expectedBody);
  const actualLocations = stockLocations(item);
  if (text(item.global_item_sku ?? item.item_sku) !== text(input.expectedBody.global_item_sku)
      || text(item.global_item_name ?? item.item_name) !== text(input.expectedBody.global_item_name)
      || numericId(item.category_id) !== numericId(input.expectedBody.category_id)
      || itemPrice(item) !== exactMoney(input.expectedBody.original_price)
      || itemStock(item) !== expectedStock
      || !sameStrings(actualLocations, expectedLocations)) {
    throw new Error("SHOPEE_SG_GLOBAL_CREATE_READBACK_INVALID");
  }
  return item;
}

function exactLocalReadback(input: {
  readback: ShopeeSgLocalPublicationReadback;
  globalItemId: string;
  localItemId: string;
  shopId: string;
  expectedItem: UnknownRecord;
  localCategoryId: string;
}) {
  const published = successfulResponse(
    input.readback.publishedRemote,
    "SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID",
  );
  const links = records(published.published_item).filter((row) => (
    numericId(row.global_item_id ?? input.globalItemId) === input.globalItemId
      && numericId(row.shop_id) === input.shopId
      && numericId(row.item_id) === input.localItemId
  ));
  const local = successfulResponse(
    input.readback.localRemote,
    "SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID",
  );
  const matches = records(local.item_list).filter((row) => numericId(row.item_id) === input.localItemId);
  if (links.length !== 1 || matches.length !== 1) {
    throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  }
  const item = matches[0];
  const expectedLocations = stockLocations(input.expectedItem);
  const actualLocations = stockLocations(item);
  const expectedLogistics = selectedLogistics(input.expectedItem);
  const actualLogistics = selectedLogistics(item);
  if (text(item.item_sku ?? item.seller_sku) !== text(input.expectedItem.item_sku)
      || text(item.item_name) !== text(input.expectedItem.item_name)
      || numericId(item.category_id) !== input.localCategoryId
      || itemPrice(item) !== exactMoney(input.expectedItem.original_price)
      || itemStock(item) !== itemStock(input.expectedItem)
      || !sameStrings(actualLocations, expectedLocations)
      || !sameNumbers(actualLogistics, expectedLogistics)) {
    throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  }
  return item;
}

function responseId(
  remote: ShopeeSgRequirementRemote,
  key: string,
  errorCode: string,
) {
  const response = successfulResponse(remote, errorCode);
  const id = numericId(response[key]);
  if (!id) throw new Error(errorCode);
  return id;
}

/**
 * Runs one authoritative prewrite read set and then permits at most one
 * add_global_item and one create_publish_task mutation. The shared runtime
 * owns provider transports; this module owns their SG ordering contract.
 */
export async function executeShopeeSgCreateOrchestration(input: {
  argumentsValue: UnknownRecord;
  credential: ShopeeSgCreateCredentialRevision;
  dependencies: ShopeeSgCreateOrchestrationDependencies;
}) {
  const { dependencies } = input;
  const currentTime = () => dependencies.now?.() ?? new Date();
  await dependencies.assertLeaseHealthy();
  const prepared = await prepareShopeeSgCreatePrewrite({
    argumentsValue: input.argumentsValue,
    credential: input.credential,
    readCurrentCredential: dependencies.readCurrentCredential,
    readers: dependencies.readers,
    now: currentTime(),
  });
  await dependencies.assertLeaseHealthy();
  const preparedArguments = await dependencies.prepareProviderImages(
    structuredClone(prepared.argumentsValue),
  );
  assertShopeeSgProviderImageBinding(preparedArguments);
  const globalBody = record(preparedArguments.body);
  const publish = record(preparedArguments.publish);
  const localItem = record(publish.item);
  let globalMutationStarted = false;
  let localMutationStarted = false;

  await dependencies.assertLeaseHealthy();
  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: preparedArguments,
    stage: "global-item-create",
    readCurrentCredential: dependencies.readCurrentCredential,
    now: currentTime(),
  });
  await dependencies.beginProviderMutation("global-item-create", preparedArguments);
  if (globalMutationStarted) throw new Error("SHOPEE_SG_GLOBAL_CREATE_ALREADY_STARTED");
  globalMutationStarted = true;
  const globalCreate = await dependencies.createGlobalItem(structuredClone(globalBody));
  const globalItemId = responseId(
    globalCreate,
    "global_item_id",
    "SHOPEE_SG_GLOBAL_CREATE_RESPONSE_INVALID",
  );
  await dependencies.assertLeaseHealthy();
  const globalReadback = await dependencies.readGlobalItem(globalItemId);
  assertShopeeSgExactGlobalReadback({ remote: globalReadback, globalItemId, expectedBody: globalBody });
  if (dependencies.recordGlobalCreateReadback) {
    await dependencies.assertLeaseHealthy();
    await dependencies.recordGlobalCreateReadback({
      globalItemId,
      createRemote: globalCreate,
      readbackRemote: globalReadback,
      preparedArguments,
    });
  }

  await dependencies.assertLeaseHealthy();
  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: preparedArguments,
    stage: "local-publish",
    readCurrentCredential: dependencies.readCurrentCredential,
    now: currentTime(),
  });
  const localStageArguments = { ...preparedArguments, globalItemId };
  await dependencies.beginProviderMutation("local-publish", localStageArguments);
  if (localMutationStarted) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_ALREADY_STARTED");
  localMutationStarted = true;
  const publishBody = {
    ...publish,
    global_item_id: Number(globalItemId),
  };
  const localPublish = await dependencies.createLocalPublish(structuredClone(publishBody));
  const publishTaskId = responseId(
    localPublish,
    "publish_task_id",
    "SHOPEE_SG_LOCAL_PUBLISH_RESPONSE_INVALID",
  );
  await dependencies.assertLeaseHealthy();
  const localReadback = await dependencies.readLocalPublication({
    globalItemId,
    publishTaskId,
    shopId: input.credential.shopId,
  });
  const publishedResponse = successfulResponse(
    localReadback.publishedRemote,
    "SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID",
  );
  const localLinks = records(publishedResponse.published_item).filter((row) => (
    numericId(row.shop_id) === input.credential.shopId
      && numericId(row.global_item_id ?? globalItemId) === globalItemId
  ));
  if (localLinks.length !== 1) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  const localItemId = numericId(localLinks[0].item_id);
  if (!localItemId) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  exactLocalReadback({
    readback: localReadback,
    globalItemId,
    localItemId,
    shopId: input.credential.shopId,
    expectedItem: localItem,
    localCategoryId: prepared.evidence.provider.localCategoryId,
  });
  await dependencies.completeProviderMutation(
    "local-publish",
    localStageArguments,
    {
      globalItemId,
      outputId: localItemId,
      result: {
        publishResponse: record(localPublish.data),
        publishedReadback: record(localReadback.publishedRemote.data),
        localReadback: record(localReadback.localRemote.data),
        publishTaskId,
        localItemId,
      },
    },
  );
  return {
    ok: true as const,
    argumentsValue: preparedArguments,
    evidence: prepared.evidence,
    globalItemId,
    publishTaskId,
    localItemId,
    providerMutationCounts: {
      globalItemCreate: globalMutationStarted ? 1 : 0,
      localPublish: localMutationStarted ? 1 : 0,
    },
  };
}

export type ShopeeSgLocalResumeDependencies = Omit<
  ShopeeSgCreateOrchestrationDependencies,
  "createGlobalItem"
> & {
  readExistingLocalPublication: (input: {
    globalItemId: string;
    shopId: string;
  }) => Promise<ShopeeSgLocalPublicationReadback | null>;
};

function sameResumeCredential(
  expected: ShopeeSgCreateCredentialRevision,
  current: ShopeeSgCreateCredentialRevision,
) {
  return expected.credentialId === current.credentialId
    && expected.credentialVersion === current.credentialVersion
    && expected.credentialSnapshotSha256 === current.credentialSnapshotSha256
    && expected.merchantId === current.merchantId
    && expected.shopId === current.shopId
    && expected.region === "SG" && current.region === "SG";
}

/**
 * Resumes only the local publish half after an exact Global CREATE. It never
 * calls add_global_item. An already linked local item is reconciled with zero
 * provider mutations; otherwise a fresh local-resume prewrite owns the one
 * existing Global identity before permitting one publish mutation.
 */
export async function executeShopeeSgLocalResumeOrchestration(input: {
  argumentsValue: UnknownRecord;
  credential: ShopeeSgCreateCredentialRevision;
  globalItemId: string;
  dependencies: ShopeeSgLocalResumeDependencies;
}) {
  const globalItemId = numericId(input.globalItemId);
  if (!globalItemId) throw new Error("SHOPEE_SG_RESUME_GLOBAL_ID_INVALID");
  const { dependencies } = input;
  const currentTime = () => dependencies.now?.() ?? new Date();
  await dependencies.assertLeaseHealthy();
  const currentCredential = await dependencies.readCurrentCredential();
  if (!sameResumeCredential(input.credential, currentCredential)) {
    throw new Error("SHOPEE_SG_PREWRITE_CREDENTIAL_CHANGED");
  }
  const existing = await dependencies.readExistingLocalPublication({
    globalItemId,
    shopId: input.credential.shopId,
  });
  if (existing) {
    const published = successfulResponse(existing.publishedRemote, "SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    const links = records(published.published_item).filter((row) => (
      numericId(row.global_item_id ?? globalItemId) === globalItemId
        && numericId(row.shop_id) === input.credential.shopId
    ));
    if (links.length !== 1) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    const localItemId = numericId(links[0].item_id);
    const publish = record(input.argumentsValue.publish);
    const localCategoryId = numericId(input.argumentsValue.sellerpilotProviderLocalCategoryId);
    if (!localItemId || !localCategoryId) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    exactLocalReadback({
      readback: existing,
      globalItemId,
      localItemId,
      shopId: input.credential.shopId,
      expectedItem: record(publish.item),
      localCategoryId,
    });
    await dependencies.completeProviderMutation(
      "local-publish",
      { ...input.argumentsValue, globalItemId },
      {
        globalItemId,
        outputId: localItemId,
        result: {
          sellerpilotReconciliation: "official-exact-local-readback",
          publishedReadback: record(existing.publishedRemote.data),
          localReadback: record(existing.localRemote.data),
          localItemId,
        },
      },
    );
    return {
      ok: true as const,
      recovered: true as const,
      globalItemId,
      localItemId,
      providerMutationCounts: { globalItemCreate: 0, localPublish: 0 },
    };
  }

  const prepared = await prepareShopeeSgCreatePrewrite({
    argumentsValue: input.argumentsValue,
    credential: input.credential,
    readCurrentCredential: dependencies.readCurrentCredential,
    readers: dependencies.readers,
    resumeGlobalItemId: globalItemId,
    now: currentTime(),
  });
  let preparedArguments: UnknownRecord = prepared.argumentsValue;
  try {
    assertShopeeSgProviderImageBinding(preparedArguments);
  } catch {
    await dependencies.assertLeaseHealthy();
    preparedArguments = await dependencies.prepareProviderImages(structuredClone(preparedArguments));
    assertShopeeSgProviderImageBinding(preparedArguments);
  }
  const globalBody = record(preparedArguments.body);
  const publish = record(preparedArguments.publish);
  const localItem = record(publish.item);
  await dependencies.assertLeaseHealthy();
  assertShopeeSgExactGlobalReadback({
    remote: await dependencies.readGlobalItem(globalItemId),
    globalItemId,
    expectedBody: globalBody,
  });
  await dependencies.assertLeaseHealthy();
  await assertShopeeSgCreatePrewriteAtMutation({
    argumentsValue: preparedArguments,
    stage: "local-publish",
    readCurrentCredential: dependencies.readCurrentCredential,
    now: currentTime(),
  });
  const localStageArguments = { ...preparedArguments, globalItemId };
  await dependencies.beginProviderMutation("local-publish", localStageArguments);
  const localPublish = await dependencies.createLocalPublish({
    ...publish,
    global_item_id: Number(globalItemId),
  });
  const publishTaskId = responseId(
    localPublish,
    "publish_task_id",
    "SHOPEE_SG_LOCAL_PUBLISH_RESPONSE_INVALID",
  );
  const readback = await dependencies.readLocalPublication({
    globalItemId,
    publishTaskId,
    shopId: input.credential.shopId,
  });
  const published = successfulResponse(readback.publishedRemote, "SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  const links = records(published.published_item).filter((row) => (
    numericId(row.global_item_id ?? globalItemId) === globalItemId
      && numericId(row.shop_id) === input.credential.shopId
  ));
  if (links.length !== 1) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  const localItemId = numericId(links[0].item_id);
  if (!localItemId) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
  exactLocalReadback({
    readback,
    globalItemId,
    localItemId,
    shopId: input.credential.shopId,
    expectedItem: localItem,
    localCategoryId: prepared.evidence.provider.localCategoryId,
  });
  await dependencies.completeProviderMutation(
    "local-publish",
    localStageArguments,
    {
      globalItemId,
      outputId: localItemId,
      result: {
        publishResponse: record(localPublish.data),
        publishedReadback: record(readback.publishedRemote.data),
        localReadback: record(readback.localRemote.data),
        publishTaskId,
        localItemId,
      },
    },
  );
  return {
    ok: true as const,
    recovered: false as const,
    argumentsValue: preparedArguments,
    evidence: prepared.evidence,
    globalItemId,
    publishTaskId,
    localItemId,
    providerMutationCounts: { globalItemCreate: 0, localPublish: 1 },
  };
}
