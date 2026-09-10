import { shopeeGlobalCreateBody } from "../../channels/shopee-create-preflight";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
  queryParams,
} from "../../channels/operation-values";
import { shopeeMerchantRequest, shopeeRequest } from "../../channels/protocols";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "../../channels/listing-publication-state";
import {
  readShopeeListingPublicationState,
  type ShopeePublicationReadbackVerification,
} from "../../channels/provider-shopee-publication-readback";
import { shopeeExactGlobalCategoryPath } from "../../channels/shopee-category-tree";
import { shopeeSgListingCreateRequested } from "../../channels/shopee-sg-listing-create";

import { uploadChannelNativeImages } from "../../channels/native-image-upload";
import {
  type ExecuteInput,
  nativeImageSourceUrls,
  booleanArgument,
  result,
  inventoryQuantityVerificationStep,
  verifiedPublicationArguments,
  listingUpdateReadbackStep,
  type ChannelOperationName,
} from "../execution-shared";
import { executeShopeeSgCreateRuntime } from "../shopee/execute-create-runtime";

export function shopeeResponseId(data: Record<string, unknown>, key: string) {
  const response = data.response;
  if (!response || typeof response !== "object" || Array.isArray(response))
    return undefined;
  const value = (response as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

export function applyShopeePublicationVerification(
  readbackStep: ChannelOperationStep,
  verification: ShopeePublicationReadbackVerification,
) {
  readbackStep.ok = readbackStep.ok && Boolean(verification.remoteState);
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotPublicationVerification: verification.remoteState
      ? "SHOPEE_PUBLICATION_STATE_VERIFIED"
      : "SHOPEE_PUBLICATION_STATE_UNVERIFIED",
    providerStatus: verification.providerStatus,
    actualImageCount: verification.imageCount,
    sellerpilotPublicationChecks: verification.checks,
  };
  return readbackStep;
}

export function shopeeBodyHasNativeImageIds(body: Record<string, unknown>) {
  const image = objectValue(body, "image", false);
  return (
    Array.isArray(image.image_id_list) &&
    image.image_id_list.some((value) => String(value ?? "").trim())
  );
}

export async function prepareShopeeNativeImageBody(
  input: ExecuteInput,
): Promise<Record<string, unknown>> {
  const body = objectValue(input.arguments, "body");
  // The provider-listing runtime may already have populated native image ids
  // (for example inside the serverless gateway worker). Re-uploading would
  // orphan those assets and renumber the gallery, so keep them as-is.
  if (shopeeBodyHasNativeImageIds(body)) return body;
  if (!nativeImageSourceUrls(input.arguments.imageUrls).length) return body;
  try {
    const uploaded = await uploadChannelNativeImages({
      channel: "shopee",
      payload: input.payload,
      environment: input.environment,
      argumentsValue: input.arguments,
    });
    if (!uploaded.ok) return body;
    return objectValue(uploaded.argumentsValue, "body");
  } catch {
    return body;
  }
}

export async function executeShopee(input: ExecuteInput) {
  if (input.channel !== "shopee")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:shopee");
  const globalProduct = booleanArgument(input.arguments, "globalProduct");
  const publicationIntent = listingPublicationIntentFromArguments(
    input.arguments,
  );
  const verifiedPublicationRequested =
    input.arguments.publicationStateContract ===
    listingRemoteStateContractVersion;
  if (
    verifiedPublicationRequested &&
    input.operation === "listing.create" &&
    publicationIntent === "safe_test" &&
    !globalProduct
  ) {
    throw new Error("SHOPEE_SAFE_TEST_REQUIRES_GLOBAL_PUBLISH");
  }
  if (globalProduct && input.operation === "listing.create"
      && shopeeSgListingCreateRequested(input.arguments)) {
    return executeShopeeSgCreateRuntime(input);
  }
  if (
    globalProduct &&
    (input.operation === "categories.list" ||
      input.operation === "categories.suggest")
  ) {
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("global-categories", remote)]);
  }
  if (globalProduct && input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list"))
      query.set("category_id_list", categoryId);
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_attribute_tree",
      query,
    });
    return result(
      input,
      [step("global-category-attribute-tree", remote)],
      categoryId,
    );
  }
  if (globalProduct && input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const categoryQuery = queryParams(input.arguments);
    categoryQuery.delete("category_id");
    categoryQuery.delete("category_id_list");
    if (!categoryQuery.has("language")) categoryQuery.set("language", "en");
    const attributeQuery = new URLSearchParams(categoryQuery);
    attributeQuery.set("category_id_list", categoryId);
    const [categoryRemote, attributeRemote] = await Promise.all([
      shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_category",
        query: categoryQuery,
      }),
      shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_attribute_tree",
        query: attributeQuery,
      }),
    ]);
    const exactPath = shopeeExactGlobalCategoryPath(
      categoryRemote.data,
      categoryId,
    );
    const categoryStep = step("global-category-exact-leaf", categoryRemote);
    categoryStep.ok = categoryStep.ok && Boolean(exactPath);
    categoryStep.data = {
      ...categoryStep.data,
      sellerpilotVerification: categoryStep.ok
        ? "SHOPEE_EXACT_GLOBAL_LEAF_CATEGORY_VERIFIED"
        : "SHOPEE_EXACT_GLOBAL_LEAF_CATEGORY_UNVERIFIED",
      categoryId,
      categoryPathIds: exactPath?.ids ?? [],
      categoryPath: exactPath?.names ?? [],
      exactLeafMatchCount: exactPath ? 1 : 0,
    };
    return result(
      input,
      [categoryStep, step("global-category-attribute-tree", attributeRemote)],
      categoryId,
    );
  }
  if (globalProduct && input.operation === "listing.create") {
    let globalItemId = stringArgument(input.arguments, "globalItemId", false);
    const steps: ChannelOperationStep[] = [];
    const suppliedPublish = objectValue(input.arguments, "publish", false);
    if (
      verifiedPublicationRequested &&
      (!publicationIntent || !Object.keys(suppliedPublish).length)
    ) {
      throw new Error("SHOPEE_VERIFIED_PUBLISH_ARGUMENTS_REQUIRED");
    }
    const publish = structuredClone(suppliedPublish);
    const publishItem = objectValue(publish, "item", false);
    const requestedShopId = String(publish.shop_id ?? "").trim();
    if (Object.keys(publish).length && !/^[1-9][0-9]{0,31}$/u.test(requestedShopId)) {
      throw new Error("SHOPEE_PUBLISH_SHOP_ID_REQUIRED");
    }
    if (publicationIntent && Object.keys(publish).length) {
      publish.item = {
        ...publishItem,
        item_status: publicationIntent === "safe_test" ? "UNLIST" : "NORMAL",
      };
    }
    const finalLocalReadback = (localItemId: string) => result(input, steps, localItemId);
    if (!globalItemId) {
      const createRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/add_global_item",
        body: shopeeGlobalCreateBody(objectValue(input.arguments, "body"), verifiedPublicationRequested),
      });
      const createStep = step("global-item-create", createRemote);
      globalItemId =
        shopeeResponseId(createRemote.data, "global_item_id") ?? "";
      steps.push(createStep);
      if (!createStep.ok || !globalItemId)
        return result(input, steps, globalItemId || undefined);
    }

    const readbackRemote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_global_item_info",
      query: new URLSearchParams({ global_item_id_list: globalItemId }),
    });
    const globalReadbackStep = step("global-item-readback", readbackRemote);
    const globalResponse = objectValue(readbackRemote.data, "response", false);
    const globalRows = Array.isArray(globalResponse.global_item_list)
      ? globalResponse.global_item_list.filter((item): item is Record<string, unknown> => (
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
      : [];
    const expectedGlobalSku = String(objectValue(input.arguments, "body").global_item_sku ?? "").trim();
    const globalMatches = globalRows.filter((item) => String(item.global_item_id ?? "") === globalItemId
      && (!expectedGlobalSku || String(item.global_item_sku ?? item.item_sku ?? "").trim() === expectedGlobalSku));
    globalReadbackStep.ok = globalReadbackStep.ok && globalMatches.length === 1;
    globalReadbackStep.data = {
      ...globalReadbackStep.data,
      sellerpilotVerification: globalReadbackStep.ok
        ? "SHOPEE_GLOBAL_ITEM_IDENTITY_VERIFIED"
        : "SHOPEE_GLOBAL_ITEM_IDENTITY_UNVERIFIED",
      expectedSku: expectedGlobalSku,
      exactMatchCount: globalMatches.length,
    };
    steps.push(globalReadbackStep);
    if (!globalReadbackStep.ok) return result(input, steps, globalItemId);
    const publishedItem = async (maxAttempts = 1) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0)
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        const remote = await shopeeMerchantRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/global_product/get_published_list",
          query: new URLSearchParams({ global_item_id: globalItemId }),
        });
        const publishedStep = step(
          attempt === 0
            ? "published-item-readback"
            : `published-item-readback-${attempt + 1}`,
          remote,
        );
        steps.push(publishedStep);
        const response = remote.data.response;
        const rows =
          response &&
            typeof response === "object" &&
            !Array.isArray(response) &&
            Array.isArray((response as Record<string, unknown>).published_item)
            ? (response as { published_item: unknown[] }).published_item
            : [];
        const matches = rows.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            String((item as Record<string, unknown>).shop_id ?? "") === requestedShopId,
        ) as Record<string, unknown>[];
        const row = matches.length === 1 ? matches[0] : undefined;
        const itemId = row?.item_id;
        if (typeof itemId === "string" || typeof itemId === "number")
          return { itemId: String(itemId), ok: publishedStep.ok };
        if (!publishedStep.ok) return { itemId: "", ok: false };
        if (attempt === maxAttempts - 1) {
          publishedStep.ok = false;
          publishedStep.data = {
            ...publishedStep.data,
            sellerpilotVerification: "SHOPEE_EXACT_SHOP_LINKAGE_UNVERIFIED",
            expectedShopId: requestedShopId,
            exactMatchCount: matches.length,
          };
          return { itemId: "", ok: false };
        }
      }
      return { itemId: "", ok: false };
    };
    if (booleanArgument(input.arguments, "recoverPublished")) {
      const published = await publishedItem();
      return published.itemId
        ? finalLocalReadback(published.itemId)
        : result(input, steps, globalItemId);
    }
    let publishTaskId = stringArgument(input.arguments, "publishTaskId", false);
    if (!publishTaskId) {
      if (!Object.keys(publish).length)
        return result(input, steps, globalItemId);
      const publishRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/create_publish_task",
        body: { ...publish, global_item_id: Number(globalItemId) },
      });
      const publishStep = step("publish-task-create", publishRemote);
      steps.push(publishStep);
      publishTaskId =
        shopeeResponseId(publishRemote.data, "publish_task_id") ?? "";
      if (!publishStep.ok || !publishTaskId) {
        const alreadyPublished = String(publishRemote.data.message ?? "")
          .toLowerCase()
          .includes("published this global item");
        if (!alreadyPublished) return result(input, steps, globalItemId);
        const published = await publishedItem();
        if (published.ok && published.itemId) publishStep.ok = true;
        return result(input, steps, published.itemId || globalItemId);
      }
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const taskRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/global_product/get_publish_task_result",
        query: new URLSearchParams({ publish_task_id: publishTaskId }),
      });
      const taskStep = step(`publish-task-result-${attempt + 1}`, taskRemote);
      const transientNotFound = String(taskRemote.data.message ?? "")
        .toLowerCase()
        .includes("task not found");
      if (transientNotFound && attempt < 5) continue;
      const response = taskRemote.data.response;
      const responseRecord =
        response && typeof response === "object" && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : {};
      const status = String(
        responseRecord.publish_status ?? responseRecord.status ?? "",
      ).toUpperCase();
      if (["FAILED", "FAIL"].includes(status)) taskStep.ok = false;
      const terminal = [
        "SUCCESS",
        "FAILED",
        "FAIL",
        "COMPLETED",
        "DONE",
      ].includes(status);
      if (terminal || !taskStep.ok || attempt === 5) {
        if (!terminal && taskStep.ok) taskStep.ok = false;
        steps.push(taskStep);
        break;
      }
    }
    const published = await publishedItem(4);
    if (published.ok && published.itemId) {
      for (const item of steps)
        if (item.name.startsWith("publish-task-result-")) item.ok = true;
    }
    return published.itemId
      ? finalLocalReadback(published.itemId)
      : result(input, steps, globalItemId);
  }
  if (
    input.operation === "categories.list" ||
    input.operation === "categories.suggest"
  ) {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("categories", remote)]);
  }
  if (
    input.operation === "categories.attributes" ||
    input.operation === "categories.validate"
  ) {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list"))
      query.set("category_id_list", categoryId);
    const treeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attribute_tree",
      query,
    });
    const treeStep = step("category-attribute-tree", treeRemote);
    if (treeStep.ok) return result(input, [treeStep], categoryId);
    const error = String(treeRemote.data.error ?? "");
    if (
      !new Set(["api_suspended", "error_not_found", "wrong_path"]).has(error)
    ) {
      return result(input, [treeStep], categoryId);
    }
    query.delete("category_id_list");
    query.set("category_id", categoryId);
    const legacyRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_attributes",
      query,
    });
    return result(
      input,
      [step("category-attributes-compatibility", legacyRemote)],
      categoryId,
    );
  }
  if (input.operation === "inventory.update") {

    const suppliedBody = input.arguments.body
      ? objectValue(input.arguments, "body")
      : null;
    const itemId = suppliedBody
      ? String(suppliedBody.item_id ?? suppliedBody.itemId ?? "").trim()
      : stringArgument(input.arguments, "itemId");
    if (!itemId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:itemId");
    const suppliedStockList =
      suppliedBody && Array.isArray(suppliedBody.stock_list)
        ? (suppliedBody.stock_list as Array<Record<string, unknown>>)
        : [];
    const suppliedQuantity = suppliedStockList
      .flatMap((stock) =>
        Array.isArray(stock.seller_stock)
          ? (stock.seller_stock as Array<Record<string, unknown>>)
          : [],
      )
      .map((stock) => stock.stock)
      .find((value) => Number.isInteger(Number(value)));
    const quantity =
      suppliedQuantity === undefined
        ? integerArgument(input.arguments, "quantity", {
          min: 0,
          max: 99_999_999,
        })
        : Number(suppliedQuantity);
    const steps: ChannelOperationStep[] = [];

    let writeBody = suppliedBody;
    if (!writeBody) {
      const modelsRemote = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_model_list",
        query: new URLSearchParams({ item_id: itemId }),
      });
      const modelsStep = step("inventory-models", modelsRemote);
      steps.push(modelsStep);
      if (!modelsStep.ok) return result(input, steps, itemId);
      const response = objectValue(modelsRemote.data, "response", false);
      const modelList = Array.isArray(response.model)
        ? response.model.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        : [];
      const stockList = modelList.length
        ? modelList.map((model) => ({
          model_id: Number(model.model_id),
          seller_stock: [{ stock: quantity }],
        }))
        : [{ model_id: 0, seller_stock: [{ stock: quantity }] }];
      writeBody = { item_id: Number(itemId), stock_list: stockList };
    }

    const writeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/product/update_stock",
      body: writeBody,
    });
    const writeStep = step("inventory.update", writeRemote);
    steps.push(writeStep);
    if (!writeStep.ok) return result(input, steps, itemId);
    const readback = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_item_base_info",
      query: new URLSearchParams({ item_id_list: itemId }),
    });
    const response = objectValue(readback.data, "response", false);
    const itemList = Array.isArray(response.item_list)
      ? (response.item_list as Array<Record<string, unknown>>)
      : [];
    const item =
      itemList.find(
        (candidate) => String(candidate.item_id ?? "") === itemId,
      ) ??
      itemList[0] ??
      {};
    const stockInfo = objectValue(item, "stock_info_v2", false);
    const summaryInfo = objectValue(stockInfo, "summary_info", false);
    const readbackStep = inventoryQuantityVerificationStep(
      "inventory-readback",
      readback,
      quantity,
      summaryInfo.total_available_stock,
    );

    steps.push(readbackStep);
    return result(input, steps, itemId);
  }
  if (input.operation === "listing.update") {

    const localItemId = stringArgument(input.arguments, "localItemId");
    const body = objectValue(input.arguments, "body");
    if (String(body.item_id ?? "") !== localItemId)
      throw new Error("SHOPEE_LOCAL_ITEM_ID_MISMATCH");
    const readLocalItem = () =>
      shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_item_base_info",
        query: new URLSearchParams({ item_id_list: localItemId }),
      });
    const [preflightRemote] = [await readLocalItem(), null];
    const preflightStep = step("local-item-preflight", preflightRemote);
    const preflightResponse = objectValue(
      preflightRemote.data,
      "response",
      false,
    );
    const preflightItems = Array.isArray(preflightResponse.item_list)
      ? (preflightResponse.item_list as Array<Record<string, unknown>>)
      : [];
    const localIdentityVerified = preflightItems.some(
      (item) => String(item.item_id ?? "") === localItemId,
    );
    preflightStep.ok = preflightStep.ok && localIdentityVerified;

    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok
        ? "SHOPEE_LOCAL_ITEM_ID_VERIFIED"
        : "SHOPEE_LOCAL_ITEM_ID_NOT_FOUND",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], localItemId);

    const writeRemote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/product/update_item",
      body,
    });
    const writeStep = step("listing.update", writeRemote);
    if (!writeStep.ok)
      return result(input, [preflightStep, writeStep], localItemId);
    if (verifiedPublicationRequested) {
      const verification = await readShopeeListingPublicationState({
        payload: input.payload,
        environment: input.environment,
        operation: input.operation,
        remoteId: localItemId,
        mutationArguments: input.arguments,
        ...verifiedPublicationArguments(input),
      });
      const readbackStep = applyShopeePublicationVerification(
        listingUpdateReadbackStep(
          "listing-readback",
          verification.remote,
          input.channel,
          input.arguments,
        ),
        verification,
      );

      return result(
        input,
        [preflightStep, writeStep, readbackStep],
        localItemId,
        undefined,
        verification.remoteState,
      );
    }
    const readbackRemote = await readLocalItem();
    const readbackStep = listingUpdateReadbackStep(
      "listing-readback",
      readbackRemote,
      input.channel,
      input.arguments,
    );
    return result(input, [preflightStep, writeStep, readbackStep], localItemId);
  }
  const writePaths: Partial<Record<ChannelOperationName, string>> = {
    "listing.create": "/api/v2/product/add_item",
    "listing.stop": "/api/v2/product/unlist_item",
    "price.update": "/api/v2/product/update_price",
    "inventory.update": "/api/v2/product/update_stock",
  };
  const writePath = writePaths[input.operation];
  if (writePath) {
    const body =
      input.operation === "listing.create"
        ? await prepareShopeeNativeImageBody(input)
        : objectValue(input.arguments, "body");
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: writePath,
      body,
    });
    const responseRemoteId = shopeeResponseId(
      remote.data,
      input.operation === "listing.create" ? "item_id" : "request_id",
    );
    const requestedItemId =
      input.operation === "listing.stop"
        ? String(body.item_id ?? "").trim()
        : "";
    const remoteId = requestedItemId || responseRemoteId;
    const writeStep = step(input.operation, remote);
    if (
      (input.operation === "listing.create" ||
        input.operation === "listing.stop") &&
      writeStep.ok &&
      remoteId &&
      verifiedPublicationRequested
    ) {
      const verification = await readShopeeListingPublicationState({
        payload: input.payload,
        environment: input.environment,
        operation: input.operation,
        remoteId,
        mutationArguments: input.arguments,
        ...verifiedPublicationArguments(input),
      });
      const readbackStep = applyShopeePublicationVerification(
        step("listing-readback", verification.remote),
        verification,
      );
      return result(
        input,
        [writeStep, readbackStep],
        remoteId,
        undefined,
        verification.remoteState,
      );
    }
    if (input.operation === "listing.create" && writeStep.ok && remoteId) {
      const readback = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_item_base_info",
        query: new URLSearchParams({ item_id_list: remoteId }),
      });
      const readbackStep = step("listing-readback", readback);
      const response = objectValue(readback.data, "response", false);
      const itemList = Array.isArray(response.item_list)
        ? (response.item_list as Array<Record<string, unknown>>)
        : [];
      readbackStep.ok =
        readbackStep.ok &&
        itemList.some((item) => String(item.item_id ?? "") === remoteId);
      return result(input, [writeStep, readbackStep], remoteId);
    }
    return result(input, [writeStep], remoteId);
  }

  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
