import { lazadaCreateSkuChecks } from "../../channels/lazada-create-preflight";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
  stringMap,
} from "../../channels/operation-values";
import { lazadaRequest } from "../../channels/protocols";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "../../channels/listing-publication-state";
import {
  lazadaListingArgumentsForPublicationIntent,
  lazadaListingArgumentsForRemoteItem,
  lazadaListingRemoteIdFromArguments,
  readLazadaListingPublicationState,
  type LazadaPublicationReadbackVerification,
} from "../../channels/provider-lazada-publication-readback";
import { uploadChannelNativeImages } from "../../channels/native-image-upload";
import {
  type ExecuteInput,
  nativeImageSourceUrls,
  result,
  type ChannelOperationName,
  inventoryQuantityVerificationStep,
  writeChannelOperations,
  verifiedPublicationArguments,
  listingUpdateReadbackStep,
} from "../execution-shared";

export function lazadaXmlEscape(value: string) {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

export function lazadaXmlNode(name: string, value: unknown): string {
  // Lazada's category metadata can contain optional attribute keys that are not
  // valid XML element names (for example `Units_(per_Bundle)`). Empty optional
  // values are not part of a create request, so discard them before validating
  // the element name.
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name))
    throw new Error("LAZADA_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value))
    return value.map((item) => lazadaXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => lazadaXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${lazadaXmlEscape(String(value))}</${name}>`;
}

export function lazadaPayload(argumentsValue: Record<string, unknown>) {
  const request = argumentsValue.request;
  if (typeof request === "string" && request.trim()) return request.trim();
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const root = Object.entries(request as Record<string, unknown>);
    if (root.length !== 1 || root[0][0] !== "Request")
      throw new Error("LAZADA_PAYLOAD_ROOT_INVALID");
    return `<?xml version="1.0" encoding="UTF-8"?>${lazadaXmlNode(root[0][0], root[0][1])}`;
  }
  throw new Error("CHANNEL_ARGUMENT_REQUIRED:request");
}

export function applyLazadaPublicationVerification(
  readbackStep: ChannelOperationStep,
  verification: LazadaPublicationReadbackVerification,
) {
  readbackStep.ok = readbackStep.ok && Boolean(verification.remoteState);
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotPublicationVerification: verification.remoteState
      ? "LAZADA_PUBLICATION_STATE_VERIFIED"
      : "LAZADA_PUBLICATION_STATE_UNVERIFIED",
    providerStatus: verification.providerStatus,
    actualImageCount: verification.imageCount,
    sellerpilotPublicationChecks: verification.checks,
  };
  return readbackStep;
}

export function lazadaRequestHasNativeImages(
  argumentsValue: Record<string, unknown>,
) {
  const request = objectValue(argumentsValue, "request", false);
  const requestRoot = objectValue(request, "Request", false);
  const product = objectValue(requestRoot, "Product", false);
  const images = objectValue(product, "Images", false);
  const listing = Array.isArray(images.Image)
    ? images.Image.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  return (
    listing.length > 0 && listing.every((url) => url.includes("slatic.net"))
  );
}

export async function prepareLazadaNativeImageArguments(
  input: ExecuteInput,
  argumentsValue: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // The provider-listing runtime migrates Lazada gallery/SKU/description
  // images into slatic.net media space before execution reaches this point.
  if (lazadaRequestHasNativeImages(argumentsValue)) return argumentsValue;
  if (!nativeImageSourceUrls(argumentsValue.imageUrls).length)
    return argumentsValue;
  try {
    const uploaded = await uploadChannelNativeImages({
      channel: "lazada",
      payload: input.payload,
      environment: input.environment,
      argumentsValue,
    });
    return uploaded.ok ? uploaded.argumentsValue : argumentsValue;
  } catch {
    return argumentsValue;
  }
}

export async function executeLazada(input: ExecuteInput) {
  if (input.channel !== "lazada")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:lazada");
  const query = stringMap(input.arguments, "queryParams");
  const publicationIntent = listingPublicationIntentFromArguments(
    input.arguments,
  );
  const verifiedPublicationRequested =
    input.arguments.publicationStateContract ===
    listingRemoteStateContractVersion;
  if (input.operation === "categories.suggest") {
    const params = {
      ...query,
      product_name: stringArgument(input.arguments, "query"),
    };
    const treeParams: Record<string, string> = {};
    if (query.language_code) treeParams.language_code = query.language_code;
    const [remote, tree] = await Promise.all([
      lazadaRequest({
        payload: input.payload,
        path: "/product/category/suggestion/get",
        params,
      }),
      lazadaRequest({
        payload: input.payload,
        path: "/category/tree/get",
        params: treeParams,
      }),
    ]);
    return result(input, [
      step("category-suggestion", remote),
      step("category-tree", tree),
    ]);
  }
  if (
    input.operation === "categories.attributes" ||
    input.operation === "categories.validate"
  ) {
    const params = {
      ...query,
      primary_category_id: stringArgument(input.arguments, "categoryId"),
    };
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/category/attributes/get",
      params,
    });
    return result(
      input,
      [step("category-attributes", remote)],
      params.primary_category_id,
    );
  }
  const pathMap: Partial<Record<ChannelOperationName, string>> = {
    "categories.list": "/category/tree/get",
    "listing.create": "/product/create",
    "listing.update": "/product/update",
    "listing.stop": "/product/deactivate",
    "price.update": "/product/price_quantity/update",
    "inventory.update": "/product/price_quantity/update",
  };

  if (input.operation === "inventory.update" && !input.arguments.request) {
    const itemId = stringArgument(input.arguments, "itemId");
    const quantity = integerArgument(input.arguments, "quantity", {
      min: 0,
      max: 99_999_999,
    });
    const readback = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: itemId },
    });
    const readbackStep = step("inventory-item-readback", readback);
    if (!readbackStep.ok) return result(input, [readbackStep], itemId);
    const data = objectValue(readback.data, "data", false);
    const product = objectValue(data, "item", false);
    const skusContainer =
      product.Skus &&
      typeof product.Skus === "object" &&
      !Array.isArray(product.Skus)
        ? (product.Skus as Record<string, unknown>)
        : data.Skus &&
            typeof data.Skus === "object" &&
            !Array.isArray(data.Skus)
          ? (data.Skus as Record<string, unknown>)
          : {};
    const rawSkuValue = skusContainer.Sku ?? data.skus;
    const skuRoot =
      rawSkuValue &&
      typeof rawSkuValue === "object" &&
      !Array.isArray(rawSkuValue)
        ? (rawSkuValue as Record<string, unknown>)
        : {};
    const rawSkus = Array.isArray(rawSkuValue)
      ? rawSkuValue.filter(
          (sku): sku is Record<string, unknown> =>
            Boolean(sku) && typeof sku === "object" && !Array.isArray(sku),
        )
      : Object.keys(skuRoot).length
        ? [skuRoot]
        : [];
    const skuIds = rawSkus
      .map((sku) =>
        String(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "").trim(),
      )
      .filter(Boolean);
    if (!skuIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:skuId");
    const request = {
      Request: {
        Product: {
          Skus: {
            Sku: skuIds.map((skuId) => ({ SkuId: skuId, Quantity: quantity })),
          },
        },
      },
    };
    const write = await lazadaRequest({
      payload: input.payload,
      path: "/product/price_quantity/update",
      method: "POST",
      params: { ...query, payload: lazadaPayload({ request }) },
    });
    const writeStep = step("inventory.update", write);
    if (!writeStep.ok) return result(input, [readbackStep, writeStep], itemId);
    const verificationRemote = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: itemId },
    });
    const verificationData = objectValue(
      verificationRemote.data,
      "data",
      false,
    );
    const verificationProduct = objectValue(verificationData, "item", false);
    const verificationSkusContainer =
      verificationProduct.Skus &&
      typeof verificationProduct.Skus === "object" &&
      !Array.isArray(verificationProduct.Skus)
        ? (verificationProduct.Skus as Record<string, unknown>)
        : verificationData.Skus &&
            typeof verificationData.Skus === "object" &&
            !Array.isArray(verificationData.Skus)
          ? (verificationData.Skus as Record<string, unknown>)
          : {};
    const verificationSkuValue =
      verificationSkusContainer.Sku ?? verificationData.skus;
    const verificationSkus = Array.isArray(verificationSkuValue)
      ? verificationSkuValue.filter(
          (sku): sku is Record<string, unknown> =>
            Boolean(sku) && typeof sku === "object" && !Array.isArray(sku),
        )
      : verificationSkuValue &&
          typeof verificationSkuValue === "object" &&
          !Array.isArray(verificationSkuValue)
        ? [verificationSkuValue as Record<string, unknown>]
        : [];
    const matchingQuantities = verificationSkus
      .filter((sku) =>
        skuIds.includes(
          String(
            sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "",
          ).trim(),
        ),
      )
      .map((sku) => Number(sku.Quantity ?? sku.quantity));
    const verifiedQuantity =
      matchingQuantities.length > 0 &&
      matchingQuantities.every((value) => value === quantity)
        ? quantity
        : Number.NaN;
    const verificationStep = inventoryQuantityVerificationStep(
      "inventory-readback",
      verificationRemote,
      quantity,
      verifiedQuantity,
    );
    return result(input, [readbackStep, writeStep, verificationStep], itemId);
  }
  const path = pathMap[input.operation];
  if (!path)
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const write = writeChannelOperations.has(input.operation);
  let effectiveArguments = input.arguments;
  if (input.operation === "listing.create") {
    if (verifiedPublicationRequested) {
      const checks = lazadaCreateSkuChecks(input.arguments);
      if (Object.values(checks).some(value => !value)) {
        return result(input, [{ name: "listing-create-sku-prewrite", ok: false, status: 422,
          data: { error: "LAZADA_CREATE_SKU_CONTRACT_INVALID", checks, sellerpilotNoWriteConfirmed: true } }]);
      }
    }
    effectiveArguments = await prepareLazadaNativeImageArguments(
      input,
      effectiveArguments,
    );
  }
  if (verifiedPublicationRequested && input.operation === "listing.create") {
    if (!publicationIntent)
      throw new Error("LAZADA_PUBLICATION_INTENT_REQUIRED");
    effectiveArguments = lazadaListingArgumentsForPublicationIntent(
      effectiveArguments,
      publicationIntent,
    );
  }
  if (
    verifiedPublicationRequested &&
    (input.operation === "listing.update" || input.operation === "listing.stop")
  ) {
    const requestedRemoteId = lazadaListingRemoteIdFromArguments(
      input.arguments,
    );
    effectiveArguments = lazadaListingArgumentsForRemoteItem(
      input.arguments,
      requestedRemoteId,
    );
  }
  const params = write
    ? { ...query, payload: lazadaPayload(effectiveArguments) }
    : query;
  const remote = await lazadaRequest({
    payload: input.payload,
    path,
    method: write ? "POST" : "GET",
    params,
  });
  const dataValue = remote.data.data;
  const responseRemoteId =
    dataValue &&
    typeof dataValue === "object" &&
    !Array.isArray(dataValue) &&
    "item_id" in dataValue
      ? String((dataValue as Record<string, unknown>).item_id)
      : undefined;
  const requestedItemId =
    input.operation === "listing.update" || input.operation === "listing.stop"
      ? lazadaListingRemoteIdFromArguments(effectiveArguments)
      : "";
  const remoteId = requestedItemId || responseRemoteId;
  const writeStep = step(path, remote);
  if (
    verifiedPublicationRequested &&
    requestedItemId &&
    responseRemoteId &&
    requestedItemId !== responseRemoteId
  ) {
    writeStep.ok = false;
    writeStep.data = {
      ...writeStep.data,
      sellerpilotPublicationVerification: "LAZADA_MUTATION_ITEM_ID_MISMATCH",
    };
  }
  if (
    (input.operation === "listing.create" ||
      input.operation === "listing.update" ||
      input.operation === "listing.stop") &&
    writeStep.ok &&
    remoteId &&
    verifiedPublicationRequested
  ) {
    const verification = await readLazadaListingPublicationState({
      payload: input.payload,
      operation: input.operation,
      remoteId,
      mutationArguments: effectiveArguments,
      ...verifiedPublicationArguments(input),
    });
    const readbackStep =
      input.operation === "listing.update"
        ? listingUpdateReadbackStep(
            "listing-readback",
            verification.remote,
            input.channel,
            effectiveArguments,
          )
        : step("listing-readback", verification.remote);
    applyLazadaPublicationVerification(readbackStep, verification);
    return result(
      input,
      [writeStep, readbackStep],
      remoteId,
      undefined,
      verification.remoteState,
    );
  }
  if (
    (input.operation === "listing.create" ||
      input.operation === "listing.update") &&
    writeStep.ok &&
    remoteId
  ) {
    const readback = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: remoteId },
    });
    const readbackStep =
      input.operation === "listing.update"
        ? listingUpdateReadbackStep(
            "listing-readback",
            readback,
            input.channel,
            effectiveArguments,
          )
        : step("listing-readback", readback);
    const readbackData = objectValue(readback.data, "data", false);
    const readbackItem = objectValue(readbackData, "item", false);
    const readbackId =
      readbackItem.item_id ??
      readbackItem.itemId ??
      readbackData.item_id ??
      readbackData.itemId;
    readbackStep.ok = readbackStep.ok && String(readbackId ?? "") === remoteId;
    return result(input, [writeStep, readbackStep], remoteId);
  }
  return result(input, [writeStep], remoteId);
}
