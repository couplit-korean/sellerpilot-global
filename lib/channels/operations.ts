import {
  coupangRequest,
  ebayRequest,
  elevenstCategoryRequest,
  elevenstOrderRequest,
  elevenstSellerXmlRequest,
  fetchNaverAccessToken,
  lazadaRequest,
  naverRequest,
  qoo10Request,
  shopeeMerchantRequest,
  shopeeRequest,
  temuRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";
import {
  channelCatalog,
  type ActiveChannelKey,
  type ChannelCapabilityKey,
} from "./catalog";
import { qoo10ProductionPlace, qoo10ResultMessage } from "./qoo10";
import { validateElevenstListingProduct } from "./elevenst-listing";
import {
  listingUpdateRemoteIdentity,
  mergeCoupangListingUpdateBody,
  mergeListingUpdatePatch,
  prepareListingUpdateArguments,
  verifyListingUpdateReadback,
} from "./listing-update";

export const channelOperationNames = [
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "price.update",
  "inventory.update",
  "orders.list",
  "orders.get",
  "inquiries.list",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
] as const;

export type ChannelOperationName = (typeof channelOperationNames)[number];

export const channelOperationCapabilities: Record<ChannelOperationName, ChannelCapabilityKey> = {
  "categories.list": "categories",
  "categories.suggest": "categories",
  "categories.attributes": "categories",
  "categories.validate": "categories",
  "listing.create": "listingCreate",
  "listing.update": "listingUpdate",
  "listing.stop": "listingStop",
  "price.update": "price",
  "inventory.update": "inventory",
  "orders.list": "orders",
  "orders.get": "orders",
  "inquiries.list": "inquiries",
  "inquiries.reply": "inquiries",
  "shipment.acknowledge": "shipment",
  "shipment.confirm": "shipment",
};

export const writeChannelOperations = new Set<ChannelOperationName>([
  "listing.create",
  "listing.update",
  "listing.stop",
  "price.update",
  "inventory.update",
  "inquiries.reply",
  "shipment.acknowledge",
  "shipment.confirm",
]);

export type ChannelOperationStep = {
  name: string;
  ok: boolean;
  status: number;
  requestId?: string;
  data: Record<string, unknown>;
};

export type ChannelOperationResult = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  steps: ChannelOperationStep[];
  remoteId?: string;
  publicUrl?: string;
  safeMessage: string;
};

type ExecuteInput = {
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
};

function objectValue(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!required) return {};
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function stringArgument(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!required) return "";
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

function booleanArgument(source: Record<string, unknown>, key: string, fallback = false) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function integerArgument(source: Record<string, unknown>, key: string, options?: { min?: number; max?: number }) {
  const raw = source[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < (options?.min ?? 0) || value > (options?.max ?? Number.MAX_SAFE_INTEGER)) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function stringMap(source: Record<string, unknown>, key: string, required = false) {
  const value = objectValue(source, key, required);
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  );
  return Object.fromEntries(entries.map(([name, item]) => [name, String(item)]));
}

function queryParams(source: Record<string, unknown>, key = "query") {
  return new URLSearchParams(stringMap(source, key));
}

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function providerBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function lazadaResultData(data: Record<string, unknown>) {
  const providerResult = objectValue(data, "result", false);
  const nestedData = objectValue(providerResult, "data", false);
  return Object.keys(nestedData).length ? nestedData : objectValue(data, "data", false);
}

function lazadaFulfillmentStep(name: string, remote: RemoteResponse, verification: string) {
  const base = step(name, remote);
  const providerResult = objectValue(remote.data, "result", false);
  const providerErrorCode = String(providerResult.error_code ?? "").trim();
  const packages = objectArray(lazadaResultData(remote.data).packages);
  const packageErrors = packages.filter((item) => {
    const itemErrorCode = String(item.item_err_code ?? item.error_code ?? "").trim();
    return itemErrorCode !== "" && itemErrorCode !== "0";
  });
  const accepted = base.ok
    && (providerResult.success === undefined || providerBoolean(providerResult.success))
    && (!providerErrorCode || providerErrorCode === "0")
    && packageErrors.length === 0;
  return {
    ...base,
    ok: accepted,
    data: {
      ...base.data,
      sellerpilotVerification: accepted ? verification : "LAZADA_FULFILLMENT_REJECTED",
    },
  };
}

function requestIdentifier(data: Record<string, unknown>) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
}

function step(name: string, remote: RemoteResponse): ChannelOperationStep {
  const resultCode = remote.data.ResultCode ?? remote.data.ErrorCode;
  const commonCode = remote.data.code;
  const shopeeError = remote.data.error;
  const temuSuccess = remote.data.success;
  const normalizedCommonCode = commonCode === undefined || commonCode === null ? "" : String(commonCode).toUpperCase();
  const commonCodeAccepted = !normalizedCommonCode
    || ["0", "SUCCESS", "SUCCES", "OK"].includes(normalizedCommonCode)
    || (/^2\d\d$/.test(normalizedCommonCode));
  const providerAccepted =
    (resultCode === undefined || resultCode === null || String(resultCode) === "0") &&
    commonCodeAccepted &&
    (temuSuccess === undefined || temuSuccess === true) &&
    (shopeeError === undefined || shopeeError === null || String(shopeeError) === "");
  return {
    name,
    ok: remote.response.ok && providerAccepted,
    status: remote.response.status,
    requestId: requestIdentifier(remote.data),
    data: remote.data,
  };
}

function inventoryQuantityVerificationStep(
  name: string,
  remote: RemoteResponse,
  expectedQuantity: number,
  actualQuantity: unknown,
): ChannelOperationStep {
  const verifiedStep = step(name, remote);
  const normalizedActual = typeof actualQuantity === "number" ? actualQuantity : Number(actualQuantity);
  const verified = verifiedStep.ok && Number.isFinite(normalizedActual) && normalizedActual === expectedQuantity;
  return {
    ...verifiedStep,
    ok: verified,
    data: {
      ...verifiedStep.data,
      expectedQuantity,
      actualQuantity: Number.isFinite(normalizedActual) ? normalizedActual : null,
      sellerpilotVerification: verified ? "INVENTORY_QUANTITY_VERIFIED" : "INVENTORY_QUANTITY_MISMATCH",
    },
  };
}

function listingUpdateReadbackStep(
  name: string,
  remote: RemoteResponse,
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
): ChannelOperationStep {
  const readbackStep = step(name, remote);
  const verification = verifyListingUpdateReadback(channel, argumentsValue, remote.data);
  readbackStep.ok = readbackStep.ok && verification.ok;
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotVerification: readbackStep.ok ? "LISTING_MUTABLE_FIELDS_VERIFIED" : "LISTING_MUTABLE_FIELDS_MISMATCH",
    sellerpilotMismatchPaths: verification.mismatches.slice(0, 40),
  };
  return readbackStep;
}

function naverOptionalCategoryMetadataStep(name: string, remote: RemoteResponse): ChannelOperationStep {
  const metadataStep = step(name, remote);
  const noMetadataForCategory = remote.response.status === 404
    && String(remote.data.code ?? "").toUpperCase() === "NOT_FOUND";
  if (!noMetadataForCategory) return metadataStep;
  return {
    ...metadataStep,
    ok: true,
    data: { items: [] },
  };
}

function result(input: ExecuteInput, steps: ChannelOperationStep[], remoteId?: string): ChannelOperationResult {
  const providerStepsSucceeded = steps.length > 0 && steps.every((item) => item.ok);
  // A create response is not a durable success until the provider identity is
  // known. Some marketplace APIs can acknowledge the mutation while omitting
  // the identifier from a malformed/delayed response. Treating that response
  // as successful would publish a listing that cannot be updated and, after a
  // retry, can create a duplicate remote product.
  const createIdentityMissing = input.operation === "listing.create"
    && !remoteId?.trim();
  const ok = providerStepsSucceeded && !createIdentityMissing;
  const providerMessage = steps
    .filter((item) => !item.ok)
    .map((item) => {
      const message = input.channel === "qoo10" ? qoo10ResultMessage(item.data) : safeProviderError(item.data);
      return message ? `${item.name}: ${message}` : "";
    })
    .find(Boolean) ?? "";
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    safeMessage: ok
      ? `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : createIdentityMissing && providerStepsSucceeded
        ? `${channelCatalog[input.channel].name} 상품 생성 응답은 수신했지만 원격 상품 식별값을 확인할 수 없습니다. 판매자센터 수동 확인이 필요합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.${providerMessage ? ` · ${providerMessage}` : ""}`,
  };
}

function safeProviderError(data: Record<string, unknown>) {
  const values: string[] = [];
  const keys = new Set([
    "error", "errors", "errorcode", "error_code", "errormsg", "error_msg", "errormessage", "error_message",
    "message", "resultmessage", "authmessage", "msg", "detail", "details", "reason", "failure_reason", "issue", "issues",
    "invalidinputs", "invalid_inputs",
  ]);
  const visit = (value: unknown, depth: number, keyed = false) => {
    if (depth > 6 || values.length >= 16 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") {
      if (keyed && String(value).trim()) values.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, keyed);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z_]/g, "");
      if (keys.has(normalizedKey)) visit(child, depth + 1, true);
      else if (keyed) visit(child, depth + 1, true);
    }
  };
  visit(data, 0);
  return [...new Set(values)]
    .join(" · ")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(key|token|secret|authorization|signature)=\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function lazadaXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

function lazadaXmlNode(name: string, value: unknown): string {
  // Lazada's category metadata can contain optional attribute keys that are not
  // valid XML element names (for example `Units_(per_Bundle)`). Empty optional
  // values are not part of a create request, so discard them before validating
  // the element name.
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) throw new Error("LAZADA_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value)) return value.map((item) => lazadaXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => lazadaXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${lazadaXmlEscape(String(value))}</${name}>`;
}

function lazadaPayload(argumentsValue: Record<string, unknown>) {
  const request = argumentsValue.request;
  if (typeof request === "string" && request.trim()) return request.trim();
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const root = Object.entries(request as Record<string, unknown>);
    if (root.length !== 1 || root[0][0] !== "Request") throw new Error("LAZADA_PAYLOAD_ROOT_INVALID");
    return `<?xml version="1.0" encoding="UTF-8"?>${lazadaXmlNode(root[0][0], root[0][1])}`;
  }
  throw new Error("CHANNEL_ARGUMENT_REQUIRED:request");
}

function ensureProviderSupport(channel: ActiveChannelKey, operation: ChannelOperationName) {
  if (channel === "ebay" && operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  if (operation === "inquiries.reply" && !["qoo10", "lazada", "coupang", "smartstore"].includes(channel)) {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  const capability = channelCatalog[channel].capabilities[channelOperationCapabilities[operation]];
  if (capability.mode === "unsupported") throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  if (capability.mode === "vendor_docs_required") throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${operation}`);
}

function elevenstXmlEscape(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
}

function elevenstXmlNode(name: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name)) throw new Error("ELEVENST_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value)) return value.map((item) => elevenstXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => elevenstXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${elevenstXmlEscape(String(value))}</${name}>`;
}

function elevenstProductPayload(argumentsValue: Record<string, unknown>) {
  const product = validateElevenstListingProduct(objectValue(argumentsValue, "product"));
  return `<?xml version="1.0" encoding="UTF-8"?>${elevenstXmlNode("Product", product)}`;
}

function elevenstSearchPayload(productNo: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>${elevenstXmlNode("SearchProduct", {
    prdNo: productNo,
    limit: "1",
    start: "1",
    end: "1",
  })}`;
}

function elevenstVerifiedStep(name: string, remote: RemoteResponse, verified = true) {
  const remoteStep = step(name, remote);
  const accepted = remote.data.accepted === true && verified;
  return {
    ...remoteStep,
    ok: remoteStep.ok && accepted,
    data: {
      ...remoteStep.data,
      sellerpilotVerification: accepted ? "ELEVENST_RESPONSE_VERIFIED" : "ELEVENST_RESPONSE_UNVERIFIED",
    },
  };
}

function elevenstPrewriteFailureStep(name: string, error: unknown, status = 422): ChannelOperationStep {
  const raw = error instanceof Error ? error.message : "";
  const safeCode = /^ELEVENST_[A-Z0-9_:-]+$/u.test(raw) ? raw : "ELEVENST_PREWRITE_VALIDATION_FAILED";
  return {
    name,
    ok: false,
    status,
    data: {
      error: safeCode,
      sellerpilotVerification: "ELEVENST_PREWRITE_REJECTED",
    },
  };
}

function elevenstUnavailableRemote(message: string): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { accepted: false, errorMessage: message },
  };
}

type ElevenstCategory = {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string;
  depth: number;
  leaf: boolean;
  categoryPath: string;
};

function elevenstCategories(remote: RemoteResponse) {
  return Array.isArray(remote.data.items)
    ? remote.data.items.filter((item): item is ElevenstCategory => Boolean(
      item && typeof item === "object" && !Array.isArray(item)
      && typeof (item as ElevenstCategory).categoryId === "string"
      && typeof (item as ElevenstCategory).categoryName === "string",
    ))
    : [];
}

function elevenstCategoryResult(remote: RemoteResponse, items: ElevenstCategory[], accepted = remote.data.accepted === true): RemoteResponse {
  return {
    response: remote.response,
    text: "",
    data: {
      accepted,
      items,
      totalCount: items.length,
      ...(!accepted ? { errorMessage: "11번가 공식 말단 카테고리로 확인되지 않았습니다." } : {}),
    },
  };
}

function elevenstCategoryScore(query: string, category: ElevenstCategory) {
  const normalizedQuery = query.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const candidate = `${category.categoryPath} ${category.categoryName}`.toLocaleLowerCase();
  const words = [...new Set(normalizedQuery.split(/\s+/).filter((word) => word.length > 1))];
  const matched = words.filter((word) => candidate.includes(word)).length;
  const cableOrganizerBoost = /(케이블|전선|cable|cord)/u.test(normalizedQuery)
    && /(정리|클립|홀더|organizer|clip)/u.test(normalizedQuery)
    && /(케이블|전선).*(정리|클립|홀더)|(?:정리|클립|홀더).*(?:케이블|전선)/u.test(candidate)
    ? 1_000
    : 0;
  const cableClipLeafBoost = /(클립|clip|holder)/u.test(normalizedQuery)
    && /케이블\s*정리소품/u.test(category.categoryName)
    ? 400
    : 0;
  const relevance = cableOrganizerBoost + cableClipLeafBoost + matched * 100 + (candidate.includes(normalizedQuery) ? 500 : 0);
  return relevance > 0 ? relevance + category.depth : 0;
}

async function executeElevenst(input: ExecuteInput) {
  if (input.operation === "categories.list") {
    const parentCategoryId = stringArgument(input.arguments, "categoryId", false);
    const remote = await elevenstCategoryRequest();
    const categories = elevenstCategories(remote);
    const items = parentCategoryId
      ? categories.filter((item) => item.parentCategoryId === parentCategoryId)
      : categories.filter((item) => item.parentCategoryId === "0");
    const narrowed = elevenstCategoryResult(remote, items);
    return result(input, [elevenstVerifiedStep("category-list", narrowed)], parentCategoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const query = stringArgument(input.arguments, "query");
    const remote = await elevenstCategoryRequest();
    const items = elevenstCategories(remote)
      .filter((item) => item.leaf)
      .map((item) => ({ item, score: elevenstCategoryScore(query, item) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.item.depth - left.item.depth)
      .slice(0, 25)
      .map(({ item, score }) => ({ ...item, confidence: Math.min(0.99, 0.45 + score / 2_000) }));
    const narrowed = elevenstCategoryResult(remote, items, remote.data.accepted === true && items.length > 0);
    return result(input, [elevenstVerifiedStep("category-suggestions", narrowed)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await elevenstCategoryRequest();
    const category = elevenstCategories(remote).find((item) => item.categoryId === categoryId);
    const validLeaf = Boolean(category?.leaf);
    const narrowed = elevenstCategoryResult(remote, category ? [category] : [], remote.data.accepted === true && validLeaf);
    narrowed.data.attributes = [];
    return result(input, [elevenstVerifiedStep(
      input.operation === "categories.attributes" ? "category-attributes" : "category-validation",
      narrowed,
      validLeaf,
    )], categoryId);
  }
  if (input.operation === "listing.create") {
    let product: Record<string, unknown>;
    try {
      product = validateElevenstListingProduct(objectValue(input.arguments, "product"));
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-contract-validation", error)]);
    }
    const sellerProductCode = String(product.sellerPrdCd ?? "").trim();
    const categoryId = String(product.dispCtgrNo ?? "").trim();

    let categoryRemote: RemoteResponse;
    try {
      categoryRemote = await elevenstCategoryRequest();
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("category-validation", error, 503)]);
    }
    const category = elevenstCategories(categoryRemote).find((item) => item.categoryId === categoryId);
    const categoryVerified = categoryRemote.data.accepted === true && category?.leaf === true;
    if (!categoryVerified) {
      const narrowed = elevenstCategoryResult(
        categoryRemote,
        category ? [category] : [],
        false,
      );
      return result(input, [elevenstVerifiedStep("category-validation", narrowed, false)]);
    }

    const findExistingProduct = async () => {
      const remote = await elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/prodmarketservice/sellerprodcode/${pathSegment(sellerProductCode)}`,
      });
      const productNo = String(remote.data.productNo ?? "").trim();
      if (productNo) return { remote, productNo };
      const notFound = remote.response.status === 404 || String(remote.data.resultCode ?? "").trim() === "404";
      if (!notFound) throw new Error("ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED");
      return null;
    };

    let reconciled: Awaited<ReturnType<typeof findExistingProduct>>;
    try {
      reconciled = await findExistingProduct();
    } catch (error) {
      return result(input, [elevenstPrewriteFailureStep("product-idempotency-read", error, 503)]);
    }
    let createRemote: RemoteResponse;
    let productNo = "";
    let createStep: ChannelOperationStep | null = null;
    let providerCreateAcceptedStep: ChannelOperationStep | null = null;
    if (reconciled) {
      createRemote = reconciled.remote;
      productNo = reconciled.productNo;
      createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
    } else {
      try {
        createRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "POST",
          path: "/rest/prodservices/product",
          body: elevenstProductPayload(input.arguments),
        });
      } catch (error) {
        for (let attempt = 1; attempt <= 3 && !reconciled; attempt += 1) {
          await operationDelay(800 * attempt);
          try {
            reconciled = await findExistingProduct();
          } catch {
            // The create outcome is already uncertain. Keep reconciling with
            // the stable seller product code, but never submit a second POST.
          }
        }
        if (!reconciled) throw error;
        createRemote = reconciled.remote;
        productNo = reconciled.productNo;
        createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
      }
      if (!productNo) productNo = String(createRemote.data.productNo ?? "").trim();
      if (!productNo && createRemote.data.accepted === true) {
        for (let attempt = 1; attempt <= 3 && !reconciled; attempt += 1) {
          await operationDelay(800 * attempt);
          try {
            reconciled = await findExistingProduct();
          } catch {
            // A successful response without productNo is an uncertain create.
            // Lookup failures must not trigger another create request.
          }
        }
        if (reconciled) {
          createRemote = reconciled.remote;
          productNo = reconciled.productNo;
          createStep = elevenstVerifiedStep("product-create-reconcile", createRemote, true);
        }
      }
      if (!createStep) {
        providerCreateAcceptedStep = elevenstVerifiedStep("product-create-accepted", createRemote);
        createStep = elevenstVerifiedStep("product-create", createRemote, Boolean(productNo));
      }
    }
    if (!createStep.ok || !productNo) {
      return result(
        input,
        providerCreateAcceptedStep?.ok && !productNo
          ? [providerCreateAcceptedStep, createStep]
          : [createStep],
      );
    }

    let readbackRemote: RemoteResponse | null = null;
    let readbackVerified = false;
    for (let attempt = 0; attempt < 3 && !readbackVerified; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "POST",
          path: "/rest/prodmarketservice/prodmarket",
          body: elevenstSearchPayload(productNo),
        });
      } catch {
        readbackRemote = elevenstUnavailableRemote("11번가 상품 생성 후 재조회 응답을 확인하지 못했습니다.");
        continue;
      }
      const products = Array.isArray(readbackRemote.data.products) ? readbackRemote.data.products : [];
      readbackVerified = products.some((item) => item && typeof item === "object" && String((item as Record<string, unknown>).productNo) === productNo);
    }
    if (!readbackRemote) throw new Error("ELEVENST_READBACK_MISSING");
    const readbackStep = elevenstVerifiedStep("product-readback", readbackRemote, readbackVerified);
    const steps: ChannelOperationStep[] = [createStep, readbackStep];
    if (booleanArgument(input.arguments, "verificationOnly")) {
      let stopRemote: RemoteResponse;
      try {
        stopRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "PUT",
          path: `/rest/prodstatservice/stat/stopdisplay/${pathSegment(productNo)}`,
        });
      } catch {
        stopRemote = elevenstUnavailableRemote("11번가 검증 상품의 전시 중지 응답을 확인하지 못했습니다.");
      }
      steps.push(elevenstVerifiedStep("verification-stop-display", stopRemote));
    }
    const operationResult = result(input, steps, productNo);
    operationResult.publicUrl = `https://www.11st.co.kr/products/${pathSegment(productNo)}`;
    return operationResult;
  }
  if (input.operation === "listing.stop") {
    const productNo = pathSegment(stringArgument(input.arguments, "productNo"));
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodstatservice/stat/stopdisplay/${productNo}`,
    });
    return result(input, [elevenstVerifiedStep("stop-display", remote)], decodeURIComponent(productNo));
  }
  if (input.operation === "orders.list") {
    const remote = await elevenstOrderRequest({
      payload: input.payload,
      startTime: stringArgument(input.arguments, "startTime"),
      endTime: stringArgument(input.arguments, "endTime"),
    });
    return result(input, [step("orders", remote)]);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

function qoo10DetailHtml(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = qoo10DetailHtml(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["itemdetail", "itemdescription", "description"].includes(key.toLowerCase()) && typeof item === "string") {
      return item;
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = qoo10DetailHtml(item, depth + 1);
    if (found) return found;
  }
  return "";
}

function qoo10ImageCount(html: string) {
  return (html.match(/(?:<|&lt;)img\b/gi) ?? []).length;
}

function qoo10VerificationStep(ok: boolean, status: number, imageCount: number): ChannelOperationStep {
  return {
    name: "detail-image-readback",
    ok,
    status,
    data: {
      ResultCode: ok ? 0 : -9999,
      ResultMsg: ok ? "DETAIL_IMAGES_VERIFIED" : "QOO10_DETAIL_IMAGE_READBACK_MISSING",
      detailImageCount: imageCount,
    },
  };
}

function operationDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function qoo10InventoryQuantity(value: unknown, itemCode: string, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const records = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    const matching = records.find((item) => String(item.ItemCode ?? item.GdNo ?? "") === itemCode);
    if (matching) return qoo10InventoryQuantity(matching, itemCode, depth + 1);
    for (const item of value) {
      const found = qoo10InventoryQuantity(item, itemCode, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const recordValue = value as Record<string, unknown>;
  for (const key of ["ItemQty", "Qty", "StockQty", "stockQty", "quantity"]) {
    const quantity = recordValue[key];
    if (typeof quantity === "string" || typeof quantity === "number") return quantity;
  }
  for (const nested of Object.values(recordValue)) {
    const found = qoo10InventoryQuantity(nested, itemCode, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function executeQoo10(input: ExecuteInput) {
  const suppliedParams = stringMap(input.arguments, "params");
  const inventoryQuantity = input.operation === "inventory.update"
    ? integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 })
    : null;
  const params = input.operation === "inventory.update"
    ? {
      ...suppliedParams,
      ItemCode: suppliedParams.ItemCode || stringArgument(input.arguments, "remoteId", false),
      Qty: String(inventoryQuantity),
    }
    : suppliedParams;
  if (input.operation === "inventory.update") delete params.ItemQty;
  if (params.ProductionPlace) params.ProductionPlace = qoo10ProductionPlace(params.ProductionPlace);
  const map: Partial<Record<ChannelOperationName, { service: string; method: string; version?: string }>> = {
    "categories.list": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.suggest": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.attributes": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "categories.validate": { service: "CommonInfoLookup", method: "GetCatagoryListAll" },
    "listing.create": { service: "ItemsBasic", method: "SetNewGoods", version: "1.1" },
    "listing.update": { service: "ItemsBasic", method: "UpdateGoods" },
    "listing.stop": { service: "ItemsBasic", method: "EditGoodsStatus" },
    "price.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "inventory.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "orders.list": { service: "ShippingBasic", method: "GetShippingInfo_v3" },
    "inquiries.list": { service: "CSCenter", method: "GetInquiryMessage" },
    "inquiries.reply": { service: "CSCenter", method: "SetInquiryMessage" },
    "shipment.confirm": { service: "ShippingBasic", method: "SetSendingInfo" },
  };
  if (input.operation === "orders.get") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "GetShippingInfo_v3",
      params,
    });
    return result(input, [step("shipping-info", remote)]);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "SetSellerCheckYN_V2",
      params,
    });
    return result(input, [step("seller-check", remote)]);
  }
  const definition = map[input.operation];
  if (!definition) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const remote = await qoo10Request({ payload: input.payload, ...definition, params });
  const createStep = step(definition.method, remote);
  const resultObject = remote.data.ResultObject;
  const responseRemoteId = typeof resultObject === "string" || typeof resultObject === "number"
    ? String(resultObject)
    : resultObject && typeof resultObject === "object" && !Array.isArray(resultObject)
      ? ["GdNo", "ItemCode", "itemCode"]
        .map((key) => (resultObject as Record<string, unknown>)[key])
        .find((value): value is string | number => typeof value === "string" || typeof value === "number")
        ?.toString()
      : undefined;
  const remoteId = responseRemoteId
    ?? (input.operation === "listing.update" ? params.ItemCode : undefined);
  if (input.operation === "inventory.update") {
    const itemCode = params.ItemCode;
    if (!createStep.ok) return result(input, [createStep], itemCode || remoteId);
    let lastVerification: ChannelOperationStep | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: itemCode, SellerCode: params.SellerCode ?? "" },
      });
      lastVerification = inventoryQuantityVerificationStep(
        "GetItemDetailInfo",
        readback,
        inventoryQuantity ?? 0,
        qoo10InventoryQuantity(readback.data.ResultObject, itemCode),
      );
      if (lastVerification.ok) return result(input, [createStep, lastVerification], itemCode || remoteId);
    }
    return result(input, [createStep, lastVerification!], itemCode || remoteId);
  }
  if ((input.operation !== "listing.create" && input.operation !== "listing.update") || !createStep.ok || !remoteId) {
    return result(input, [createStep], remoteId);
  }

  // SetNewGoods accepts ItemDescription, but Qoo10 exposes a dedicated
  // EditGoodsContents method for the public product-detail surface. Persist the
  // same verified HTML through that method before treating the create as done.
  const detailHtml = params.ItemDescription ?? "";
  const expectedDetailImages = qoo10ImageCount(detailHtml);
  const detailUpdate = await qoo10Request({
    payload: input.payload,
    service: "ItemsContents",
    method: "EditGoodsContents",
    version: "1.0",
    params: { ItemCode: remoteId, SellerCode: "", Contents: detailHtml },
  });
  const detailUpdateStep = step("EditGoodsContents", detailUpdate);
  let readbackStatus = 422;
  let readbackImageCount = 0;
  let updateReadbackStep: ChannelOperationStep | null = null;
  for (let attempt = 0; detailUpdateStep.ok && attempt < 4; attempt += 1) {
    if (attempt > 0) await operationDelay(750 * attempt);
    const readback = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: remoteId, SellerCode: "" },
    });
    const readbackStep = step("GetItemDetailInfo", readback);
    readbackStatus = readbackStep.status;
    readbackImageCount = qoo10ImageCount(qoo10DetailHtml(readback.data.ResultObject));
    if (readbackStep.ok && expectedDetailImages >= 4 && readbackImageCount >= expectedDetailImages) {
      if (input.operation === "listing.update") {
        updateReadbackStep = listingUpdateReadbackStep("detail-image-readback", readback, input.channel, input.arguments);
        updateReadbackStep.ok = updateReadbackStep.ok && readbackImageCount >= expectedDetailImages;
        updateReadbackStep.data = { ...updateReadbackStep.data, detailImageCount: readbackImageCount };
        if (!updateReadbackStep.ok) continue;
        return result(input, [createStep, detailUpdateStep, updateReadbackStep], remoteId);
      }
      return result(input, [createStep, detailUpdateStep, qoo10VerificationStep(true, readbackStatus, readbackImageCount)], remoteId);
    }
  }

  if (input.operation === "listing.update") {
    updateReadbackStep ??= {
      ...qoo10VerificationStep(false, readbackStatus, readbackImageCount),
      data: {
        ...qoo10VerificationStep(false, readbackStatus, readbackImageCount).data,
        sellerpilotVerification: "LISTING_MUTABLE_FIELDS_MISMATCH",
      },
    };
    return result(input, [
      createStep,
      detailUpdateStep,
      updateReadbackStep,
    ], remoteId);
  }

  // A create response is not sufficient: Qoo10 can accept the item while
  // omitting its long detail HTML. Pause that incomplete remote item so it
  // cannot remain orderable, and report a failed verification to the ledger.
  const rollback = await qoo10Request({
    payload: input.payload,
    service: "ItemsBasic",
    method: "EditGoodsStatus",
    params: { ItemCode: remoteId, Status: "1" },
  });
  return result(input, [
    createStep,
    detailUpdateStep,
    qoo10VerificationStep(false, readbackStatus, readbackImageCount),
    step("rollback-missing-detail", rollback),
  ], remoteId);
}

function shopeeResponseId(data: Record<string, unknown>, key: string) {
  const response = data.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const value = (response as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

async function executeShopee(input: ExecuteInput) {
  const globalProduct = booleanArgument(input.arguments, "globalProduct");
  if (globalProduct && (input.operation === "categories.list" || input.operation === "categories.suggest")) {
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("global-categories", remote)]);
  }
  if (globalProduct && (input.operation === "categories.attributes" || input.operation === "categories.validate")) {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
    const remote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_attribute_tree",
      query,
    });
    return result(input, [step("global-category-attribute-tree", remote)], categoryId);
  }
  if (globalProduct && input.operation === "listing.create") {
    let globalItemId = stringArgument(input.arguments, "globalItemId", false);
    const steps: ChannelOperationStep[] = [];
    if (!globalItemId) {
      const createRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/add_global_item",
        body: objectValue(input.arguments, "body"),
      });
      const createStep = step("global-item-create", createRemote);
      globalItemId = shopeeResponseId(createRemote.data, "global_item_id") ?? "";
      steps.push(createStep);
      if (!createStep.ok || !globalItemId) return result(input, steps, globalItemId || undefined);
    }

    const readbackRemote = await shopeeMerchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/global_product/get_global_item_info",
      query: new URLSearchParams({ global_item_id_list: globalItemId }),
    });
    steps.push(step("global-item-readback", readbackRemote));
    const publish = objectValue(input.arguments, "publish", false);
    const publishedItem = async (maxAttempts = 1) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3_000));
        const remote = await shopeeMerchantRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/global_product/get_published_list",
          query: new URLSearchParams({ global_item_id: globalItemId }),
        });
        const publishedStep = step(attempt === 0 ? "published-item-readback" : `published-item-readback-${attempt + 1}`, remote);
        steps.push(publishedStep);
        const response = remote.data.response;
        const rows = response && typeof response === "object" && !Array.isArray(response)
          && Array.isArray((response as Record<string, unknown>).published_item)
          ? (response as { published_item: unknown[] }).published_item
          : [];
        const requestedShopId = String(publish.shop_id ?? "");
        const row = rows.find((item) => item && typeof item === "object" && !Array.isArray(item)
          && (!requestedShopId || String((item as Record<string, unknown>).shop_id ?? "") === requestedShopId)) as Record<string, unknown> | undefined;
        const itemId = row?.item_id;
        if (typeof itemId === "string" || typeof itemId === "number") return { itemId: String(itemId), ok: publishedStep.ok };
        if (!publishedStep.ok) return { itemId: "", ok: false };
      }
      return { itemId: "", ok: true };
    };
    if (booleanArgument(input.arguments, "recoverPublished")) {
      const published = await publishedItem();
      return result(input, steps, published.itemId || globalItemId);
    }
    let publishTaskId = stringArgument(input.arguments, "publishTaskId", false);
    if (!publishTaskId) {
      if (!Object.keys(publish).length) return result(input, steps, globalItemId);
      const publishRemote = await shopeeMerchantRequest({
        payload: input.payload,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/global_product/create_publish_task",
        body: { ...publish, global_item_id: Number(globalItemId) },
      });
      const publishStep = step("publish-task-create", publishRemote);
      steps.push(publishStep);
      publishTaskId = shopeeResponseId(publishRemote.data, "publish_task_id") ?? "";
      if (!publishStep.ok || !publishTaskId) {
        const alreadyPublished = String(publishRemote.data.message ?? "").toLowerCase().includes("published this global item");
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
      const transientNotFound = String(taskRemote.data.message ?? "").toLowerCase().includes("task not found");
      if (transientNotFound && attempt < 5) continue;
      const response = taskRemote.data.response;
      const responseRecord = response && typeof response === "object" && !Array.isArray(response)
        ? response as Record<string, unknown>
        : {};
      const status = String(responseRecord.publish_status ?? responseRecord.status ?? "").toUpperCase();
      if (["FAILED", "FAIL"].includes(status)) taskStep.ok = false;
      const terminal = ["SUCCESS", "FAILED", "FAIL", "COMPLETED", "DONE"].includes(status);
      if (terminal || !taskStep.ok || attempt === 5) {
        if (!terminal && taskStep.ok) taskStep.ok = false;
        steps.push(taskStep);
        break;
      }
    }
    const published = await publishedItem(4);
    if (published.ok && published.itemId) {
      for (const item of steps) if (item.name.startsWith("publish-task-result-")) item.ok = true;
    }
    return result(input, steps, published.itemId || globalItemId);
  }
  if (input.operation === "categories.list" || input.operation === "categories.suggest") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_category",
      query: queryParams(input.arguments),
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = queryParams(input.arguments);
    query.delete("category_id");
    if (!query.has("category_id_list")) query.set("category_id_list", categoryId);
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
    if (!new Set(["api_suspended", "error_not_found", "wrong_path"]).has(error)) {
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
    return result(input, [step("category-attributes-compatibility", legacyRemote)], categoryId);
  }
  if (input.operation === "inventory.update") {
    const suppliedBody = input.arguments.body ? objectValue(input.arguments, "body") : null;
    const itemId = suppliedBody
      ? String(suppliedBody.item_id ?? suppliedBody.itemId ?? "").trim()
      : stringArgument(input.arguments, "itemId");
    if (!itemId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:itemId");
    const suppliedStockList = suppliedBody && Array.isArray(suppliedBody.stock_list)
      ? suppliedBody.stock_list as Array<Record<string, unknown>>
      : [];
    const suppliedQuantity = suppliedStockList
      .flatMap((stock) => Array.isArray(stock.seller_stock) ? stock.seller_stock as Array<Record<string, unknown>> : [])
      .map((stock) => stock.stock)
      .find((value) => Number.isInteger(Number(value)));
    const quantity = suppliedQuantity === undefined
      ? integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 })
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
      const modelList = Array.isArray(response.model) ? response.model.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
      const stockList = modelList.length
        ? modelList.map((model) => ({ model_id: Number(model.model_id), seller_stock: [{ stock: quantity }] }))
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
    const itemList = Array.isArray(response.item_list) ? response.item_list as Array<Record<string, unknown>> : [];
    const item = itemList.find((candidate) => String(candidate.item_id ?? "") === itemId) ?? itemList[0] ?? {};
    const stockInfo = objectValue(item, "stock_info_v2", false);
    const summaryInfo = objectValue(stockInfo, "summary_info", false);
    steps.push(inventoryQuantityVerificationStep("inventory-readback", readback, quantity, summaryInfo.total_available_stock));
    return result(input, steps, itemId);
  }
  if (input.operation === "listing.update") {
    const localItemId = stringArgument(input.arguments, "localItemId");
    const body = objectValue(input.arguments, "body");
    if (String(body.item_id ?? "") !== localItemId) throw new Error("SHOPEE_LOCAL_ITEM_ID_MISMATCH");
    const readLocalItem = () => shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/product/get_item_base_info",
      query: new URLSearchParams({ item_id_list: localItemId }),
    });
    const preflightRemote = await readLocalItem();
    const preflightStep = step("local-item-preflight", preflightRemote);
    const preflightResponse = objectValue(preflightRemote.data, "response", false);
    const preflightItems = Array.isArray(preflightResponse.item_list)
      ? preflightResponse.item_list as Array<Record<string, unknown>>
      : [];
    const localIdentityVerified = preflightItems.some((item) => String(item.item_id ?? "") === localItemId);
    preflightStep.ok = preflightStep.ok && localIdentityVerified;
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "SHOPEE_LOCAL_ITEM_ID_VERIFIED" : "SHOPEE_LOCAL_ITEM_ID_NOT_FOUND",
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
    if (!writeStep.ok) return result(input, [preflightStep, writeStep], localItemId);
    const readbackRemote = await readLocalItem();
    const readbackStep = listingUpdateReadbackStep("listing-readback", readbackRemote, input.channel, input.arguments);
    return result(input, [preflightStep, writeStep, readbackStep], localItemId);
  }
  const writePaths: Partial<Record<ChannelOperationName, string>> = {
    "listing.create": "/api/v2/product/add_item",
    "listing.stop": "/api/v2/product/unlist_item",
    "price.update": "/api/v2/product/update_price",
    "inventory.update": "/api/v2/product/update_stock",
    "shipment.confirm": "/api/v2/logistics/ship_order",
  };
  const writePath = writePaths[input.operation];
  if (writePath) {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: writePath,
      body: objectValue(input.arguments, "body"),
    });
    const responseRemoteId = shopeeResponseId(remote.data, input.operation === "listing.create" ? "item_id" : "request_id");
    const remoteId = responseRemoteId;
    const writeStep = step(input.operation, remote);
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
      const itemList = Array.isArray(response.item_list) ? response.item_list as Array<Record<string, unknown>> : [];
      readbackStep.ok = readbackStep.ok && itemList.some((item) => String(item.item_id ?? "") === remoteId);
      return result(input, [writeStep, readbackStep], remoteId);
    }
    return result(input, [writeStep], remoteId);
  }
  if (input.operation === "orders.list") {
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_list",
      query: queryParams(input.arguments),
    });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const query = queryParams(input.arguments);
    if (!query.has("order_sn_list")) query.set("order_sn_list", stringArgument(input.arguments, "orderSn"));
    const remote = await shopeeRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path: "/api/v2/order/get_order_detail",
      query,
    });
    return result(input, [step("order", remote)], stringArgument(input.arguments, "orderSn", false) || undefined);
  }
  const remote = await shopeeRequest({
    payload: input.payload,
    environment: input.environment,
    method: "GET",
    path: "/api/v2/logistics/get_shipping_parameter",
    query: queryParams(input.arguments),
  });
  return result(input, [step("shipping-parameter", remote)]);
}

async function executeLazada(input: ExecuteInput) {
  const query = stringMap(input.arguments, "queryParams");
  if (input.operation === "categories.suggest") {
    const params = { ...query, product_name: stringArgument(input.arguments, "query") };
    const treeParams: Record<string, string> = {};
    if (query.language_code) treeParams.language_code = query.language_code;
    const [remote, tree] = await Promise.all([
      lazadaRequest({ payload: input.payload, path: "/product/category/suggestion/get", params }),
      lazadaRequest({ payload: input.payload, path: "/category/tree/get", params: treeParams }),
    ]);
    return result(input, [step("category-suggestion", remote), step("category-tree", tree)]);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const params = { ...query, primary_category_id: stringArgument(input.arguments, "categoryId") };
    const remote = await lazadaRequest({ payload: input.payload, path: "/category/attributes/get", params });
    return result(input, [step("category-attributes", remote)], params.primary_category_id);
  }
  const pathMap: Partial<Record<ChannelOperationName, string>> = {
    "categories.list": "/category/tree/get",
    "listing.create": "/product/create",
    "listing.update": "/product/update",
    "listing.stop": "/product/deactivate",
    "price.update": "/product/price_quantity/update",
    "inventory.update": "/product/price_quantity/update",
  };
  if (input.operation === "orders.list") {
    const remote = await lazadaRequest({ payload: input.payload, path: "/orders/get", params: query });
    const orderStep = step("orders", remote);
    if (!orderStep.ok) return result(input, [orderStep]);
    const orders = objectArray(objectValue(remote.data, "data", false).orders);
    const actionableOrders = orders.filter((order) => {
      const statusText = (Array.isArray(order.statuses) ? order.statuses.join(" ") : String(order.status ?? "")).toLocaleLowerCase();
      const terminal = /(?:^|[\s_-])(?:cancelled?|refunded?|returned?|shipped|delivered|completed?)(?:$|[\s_-])/i.test(statusText);
      return !terminal && stringArgument(order, "order_id", false);
    }).slice(0, 100);
    const detailSteps: ChannelOperationStep[] = [];
    for (let offset = 0; offset < actionableOrders.length; offset += 5) {
      const batch = actionableOrders.slice(offset, offset + 5);
      const remotes = await Promise.all(batch.map(async (order) => {
        const orderId = stringArgument(order, "order_id");
        const detail = await lazadaRequest({ payload: input.payload, path: "/order/items/get", params: { order_id: orderId } });
        return step(`order-items:${orderId}`, detail);
      }));
      detailSteps.push(...remotes);
    }
    return result(input, [orderStep, ...detailSteps]);
  }
  if (input.operation === "orders.get") {
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/get",
      params: { ...query, order_id: stringArgument(input.arguments, "orderId") },
    });
    return result(input, [step("order", remote)]);
  }
  if (input.operation === "inquiries.list") {
    if (input.arguments.bootstrap !== true) throw new Error("CHANNEL_ARGUMENT_REQUIRED:bootstrap");
    const pageSize = input.arguments.pageSize === undefined
      ? 20
      : integerArgument(input.arguments, "pageSize", { min: 1, max: 20 });
    const sessionLimit = input.arguments.sessionLimit === undefined
      ? 100
      : integerArgument(input.arguments, "sessionLimit", { min: 1, max: 100 });
    const messageLimit = input.arguments.messageLimit === undefined
      ? 100
      : integerArgument(input.arguments, "messageLimit", { min: 20, max: 100 });
    const startTime = input.arguments.startTime === undefined
      ? Date.now()
      : integerArgument(input.arguments, "startTime", { min: 1 });
    const steps: ChannelOperationStep[] = [];
    const sessions: Record<string, unknown>[] = [];
    let nextStartTime = String(startTime);
    let lastSessionId = "";

    while (sessions.length < sessionLimit) {
      const params: Record<string, string> = {
        start_time: nextStartTime,
        page_size: String(Math.min(pageSize, sessionLimit - sessions.length)),
      };
      if (lastSessionId) params.last_session_id = lastSessionId;
      const remote = await lazadaRequest({ payload: input.payload, path: "/im/session/list", params });
      const sessionStep = step(`inquiries-session-list:${steps.length + 1}`, remote);
      steps.push(sessionStep);
      if (!sessionStep.ok) return result(input, steps);
      const responseData = objectValue(remote.data, "data", false);
      const pageSessions = Array.isArray(responseData.session_list)
        ? responseData.session_list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        : [];
      sessions.push(...pageSessions);
      if (!providerBoolean(responseData.has_more) || pageSessions.length === 0) break;
      const candidateStartTime = String(responseData.next_start_time ?? "").trim();
      const candidateLastSessionId = String(responseData.last_session_id ?? "").trim();
      if (!candidateStartTime || !candidateLastSessionId
        || (candidateStartTime === nextStartTime && candidateLastSessionId === lastSessionId)) break;
      nextStartTime = candidateStartTime;
      lastSessionId = candidateLastSessionId;
    }

    for (let offset = 0; offset < sessions.length; offset += 5) {
      const batch = sessions.slice(offset, offset + 5);
      const remotes = await Promise.all(batch.map(async (session) => {
        const sessionId = String(session.session_id ?? "").trim();
        if (!sessionId) return [];
        const sessionSteps: ChannelOperationStep[] = [];
        let messageStartTime = String(startTime);
        let lastMessageId = "";
        let receivedMessages = 0;
        while (receivedMessages < messageLimit) {
          const params: Record<string, string> = {
            session_id: sessionId,
            start_time: messageStartTime,
            page_size: String(Math.min(20, messageLimit - receivedMessages)),
          };
          if (lastMessageId) params.last_message_id = lastMessageId;
          const remote = await lazadaRequest({ payload: input.payload, path: "/im/message/list", params });
          remote.data = { ...remote.data, sellerpilotSession: session };
          const messageStep = step(`inquiries-message:${sessionId}:${sessionSteps.length + 1}`, remote);
          sessionSteps.push(messageStep);
          if (!messageStep.ok) break;
          const responseData = objectValue(remote.data, "data", false);
          const pageMessages = Array.isArray(responseData.message_list) ? responseData.message_list : [];
          receivedMessages += pageMessages.length;
          if (!providerBoolean(responseData.has_more) || pageMessages.length === 0) break;
          const candidateStartTime = String(responseData.next_start_time ?? "").trim();
          const candidateLastMessageId = String(responseData.last_message_id ?? "").trim();
          if (!candidateStartTime || !candidateLastMessageId
            || (candidateStartTime === messageStartTime && candidateLastMessageId === lastMessageId)) break;
          messageStartTime = candidateStartTime;
          lastMessageId = candidateLastMessageId;
        }
        return sessionSteps;
      }));
      steps.push(...remotes.flat());
    }
    return result(input, steps);
  }
  if (input.operation === "inquiries.reply") {
    const sessionId = stringArgument(input.arguments, "sessionId");
    const reply = stringArgument(input.arguments, "reply");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/im/message/send",
      method: "POST",
      params: { template_id: "1", session_id: sessionId, txt: reply },
    });
    return result(input, [step("inquiry-reply", remote)], sessionId);
  }
  if (input.operation === "shipment.acknowledge") {
    const packRequest = objectValue(input.arguments, "packReq");
    const remote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { ...query, packReq: JSON.stringify(packRequest) },
    });
    return result(input, [lazadaFulfillmentStep("pack", remote, "LAZADA_PACKAGE_CREATED")]);
  }
  if (input.operation === "shipment.confirm") {
    const orderId = stringArgument(input.arguments, "orderId");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextOrderId = stringArgument(providerContext, "orderId");
    if (contextOrderId !== orderId) throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.orderId");
    const orderItemIds = Array.isArray(providerContext.orderItemIds)
      ? [...new Set(providerContext.orderItemIds.map((value) => String(value).trim()).filter(Boolean))].slice(0, 100)
      : [];
    if (!orderItemIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItemIds");
    const deliveryType = stringArgument(providerContext, "deliveryType");
    const providerRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/shipment/providers/get",
      method: "POST",
      params: {
        getShipmentProvidersReq: JSON.stringify({
          orders: [{ order_id: orderId, order_item_ids: orderItemIds }],
        }),
      },
    });
    const providerStep = lazadaFulfillmentStep("shipment-providers", providerRemote, "LAZADA_SHIPMENT_PROVIDERS_VERIFIED");
    if (!providerStep.ok) return result(input, [providerStep]);
    const providerData = lazadaResultData(providerRemote.data);
    const shipmentProviders = objectArray(providerData.shipment_providers);
    const normalizedCarrierCode = carrierCode.toLowerCase();
    const selectedProvider = shipmentProviders.find((provider) =>
      [provider.provider_code, provider.name].some((value) => String(value ?? "").trim().toLowerCase() === normalizedCarrierCode));
    if (!selectedProvider) throw new Error("CHANNEL_ARGUMENT_INVALID:carrierCode");
    const shipmentProviderCode = stringArgument(selectedProvider, "provider_code");
    const shippingAllocateType = stringArgument(providerData, "shipping_allocate_type");
    const packReq = {
      pack_order_list: [{ order_id: orderId, order_item_list: orderItemIds }],
      delivery_type: deliveryType,
      shipment_provider_code: shipmentProviderCode,
      shipping_allocate_type: shippingAllocateType,
    };
    const packRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/fulfill/pack",
      method: "POST",
      params: { packReq: JSON.stringify(packReq) },
    });
    const packPackages = objectArray(lazadaResultData(packRemote.data).packages);
    const packageIds = [...new Set(packPackages.map((item) => stringArgument(item, "package_id", false)).filter(Boolean))];
    const basePackStep = lazadaFulfillmentStep("pack", packRemote, "LAZADA_PACKAGE_CREATED");
    const packStep: ChannelOperationStep = packageIds.length
      ? basePackStep
      : {
          ...basePackStep,
          ok: false,
          data: { ...basePackStep.data, sellerpilotVerification: "LAZADA_PACKAGE_ID_MISSING" },
        };
    if (!packStep.ok) return result(input, [providerStep, packStep]);
    const readyRemote = await lazadaRequest({
      payload: input.payload,
      path: "/order/package/rts",
      method: "POST",
      params: { readyToShipReq: JSON.stringify({ packages: packageIds.map((package_id) => ({ package_id })) }) },
    });
    const readyStep = lazadaFulfillmentStep("ready-to-ship", readyRemote, "LAZADA_READY_TO_SHIP_CONFIRMED");
    const trackingNumber = packPackages.map((item) => stringArgument(item, "tracking_number", false)).find(Boolean);
    return result(input, [providerStep, packStep, readyStep], trackingNumber ?? packageIds[0]);
  }
  if (input.operation === "inventory.update" && !input.arguments.request) {
    const itemId = stringArgument(input.arguments, "itemId");
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const readback = await lazadaRequest({ payload: input.payload, path: "/product/item/get", params: { item_id: itemId } });
    const readbackStep = step("inventory-item-readback", readback);
    if (!readbackStep.ok) return result(input, [readbackStep], itemId);
    const data = objectValue(readback.data, "data", false);
    const product = objectValue(data, "item", false);
    const skusContainer = product.Skus && typeof product.Skus === "object" && !Array.isArray(product.Skus)
      ? product.Skus as Record<string, unknown>
      : data.Skus && typeof data.Skus === "object" && !Array.isArray(data.Skus)
        ? data.Skus as Record<string, unknown>
        : {};
    const rawSkuValue = skusContainer.Sku ?? data.skus;
    const skuRoot = rawSkuValue && typeof rawSkuValue === "object" && !Array.isArray(rawSkuValue)
      ? rawSkuValue as Record<string, unknown>
      : {};
    const rawSkus = Array.isArray(rawSkuValue)
      ? rawSkuValue.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : Object.keys(skuRoot).length ? [skuRoot] : [];
    const skuIds = rawSkus
      .map((sku) => String(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "").trim())
      .filter(Boolean);
    if (!skuIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:skuId");
    const request = { Request: { Product: { Skus: { Sku: skuIds.map((skuId) => ({ SkuId: skuId, Quantity: quantity })) } } } };
    const write = await lazadaRequest({ payload: input.payload, path: "/product/price_quantity/update", method: "POST", params: { ...query, payload: lazadaPayload({ request }) } });
    const writeStep = step("inventory.update", write);
    if (!writeStep.ok) return result(input, [readbackStep, writeStep], itemId);
    const verificationRemote = await lazadaRequest({ payload: input.payload, path: "/product/item/get", params: { item_id: itemId } });
    const verificationData = objectValue(verificationRemote.data, "data", false);
    const verificationProduct = objectValue(verificationData, "item", false);
    const verificationSkusContainer = verificationProduct.Skus && typeof verificationProduct.Skus === "object" && !Array.isArray(verificationProduct.Skus)
      ? verificationProduct.Skus as Record<string, unknown>
      : verificationData.Skus && typeof verificationData.Skus === "object" && !Array.isArray(verificationData.Skus)
        ? verificationData.Skus as Record<string, unknown>
        : {};
    const verificationSkuValue = verificationSkusContainer.Sku ?? verificationData.skus;
    const verificationSkus = Array.isArray(verificationSkuValue)
      ? verificationSkuValue.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : verificationSkuValue && typeof verificationSkuValue === "object" && !Array.isArray(verificationSkuValue)
        ? [verificationSkuValue as Record<string, unknown>]
        : [];
    const matchingQuantities = verificationSkus
      .filter((sku) => skuIds.includes(String(sku.SkuId ?? sku.SkuID ?? sku.sku_id ?? sku.skuId ?? "").trim()))
      .map((sku) => Number(sku.Quantity ?? sku.quantity));
    const verifiedQuantity = matchingQuantities.length > 0 && matchingQuantities.every((value) => value === quantity)
      ? quantity
      : Number.NaN;
    const verificationStep = inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verifiedQuantity);
    return result(input, [readbackStep, writeStep, verificationStep], itemId);
  }
  const path = pathMap[input.operation];
  if (!path) throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  const write = writeChannelOperations.has(input.operation);
  const params = write ? { ...query, payload: lazadaPayload(input.arguments) } : query;
  const remote = await lazadaRequest({ payload: input.payload, path, method: write ? "POST" : "GET", params });
  const dataValue = remote.data.data;
  const responseRemoteId = dataValue && typeof dataValue === "object" && !Array.isArray(dataValue) && "item_id" in dataValue
    ? String((dataValue as Record<string, unknown>).item_id)
    : undefined;
  const requestedItemId = input.operation === "listing.update"
    ? stringArgument(input.arguments, "itemId", false)
    : "";
  const remoteId = requestedItemId || responseRemoteId;
  const writeStep = step(path, remote);
  if ((input.operation === "listing.create" || input.operation === "listing.update") && writeStep.ok && remoteId) {
    const readback = await lazadaRequest({
      payload: input.payload,
      path: "/product/item/get",
      params: { item_id: remoteId },
    });
    const readbackStep = input.operation === "listing.update"
      ? listingUpdateReadbackStep("listing-readback", readback, input.channel, input.arguments)
      : step("listing-readback", readback);
    const readbackData = objectValue(readback.data, "data", false);
    const readbackItem = objectValue(readbackData, "item", false);
    const readbackId = readbackItem.item_id ?? readbackItem.itemId ?? readbackData.item_id ?? readbackData.itemId;
    readbackStep.ok = readbackStep.ok && String(readbackId ?? "") === remoteId;
    return result(input, [writeStep, readbackStep], remoteId);
  }
  return result(input, [writeStep], remoteId);
}

async function executeCoupang(input: ExecuteInput) {
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const sellerProductsPath = "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  if (input.operation === "categories.list") {
    // Coupang requires a display category code in the path. Code 0 returns the
    // first depth, and a returned code can be passed back to fetch its children.
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId", false) || "0");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}`,
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.suggest") {
    const body = objectValue(input.arguments, "body", false);
    const productName = stringArgument(input.arguments, "query", false) || stringArgument(body, "productName");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: "/v2/providers/openapi/apis/api/v1/categorization/predict",
      body: { ...body, productName },
    });
    return result(input, [step("category-suggestion", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryId}`,
    });
    return result(input, [step("category-metadata", remote)], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = pathSegment(stringArgument(input.arguments, "categoryId"));
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}/status`,
    });
    return result(input, [step("category-status", remote)], categoryId);
  }
  if (input.operation === "listing.update") {
    const patchBody = objectValue(input.arguments, "body");
    const remoteId = String(patchBody.sellerProductId ?? "").trim();
    if (!remoteId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:sellerProductId");
    const readProduct = () => coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
    });
    const preflightRemote = await readProduct();
    const preflightStep = step("listing-update-preflight", preflightRemote);
    const currentBody = objectValue(preflightRemote.data, "data", false);
    preflightStep.ok = preflightStep.ok && String(currentBody.sellerProductId ?? "") === remoteId;
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "COUPANG_EXISTING_LISTING_VERIFIED" : "COUPANG_EXISTING_LISTING_MISMATCH",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], remoteId);

    const mergedBody = mergeCoupangListingUpdateBody(currentBody, patchBody);
    mergedBody.vendorId = vendorId;
    mergedBody.sellerProductId = patchBody.sellerProductId;
    const writeRemote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: sellerProductsPath,
      body: mergedBody,
    });
    const writeStep = step("listing.update", writeRemote);
    if (!writeStep.ok) return result(input, [preflightStep, writeStep], remoteId);
    const readbackRemote = await readProduct();
    const readbackStep = listingUpdateReadbackStep("listing-readback", readbackRemote, input.channel, input.arguments);
    const readbackBody = objectValue(readbackRemote.data, "data", false);
    readbackStep.ok = readbackStep.ok && String(readbackBody.sellerProductId ?? "") === remoteId;
    return result(input, [preflightStep, writeStep, readbackStep], remoteId);
  }
  if (input.operation === "listing.create") {
    const body: Record<string, unknown> = { ...objectValue(input.arguments, "body"), vendorId };
    const resumeRemoteId = stringArgument(input.arguments, "resumeRemoteId", false);
    const writeRemote = resumeRemoteId ? null : await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: sellerProductsPath,
      body,
    });
    const responseId = writeRemote && (typeof writeRemote.data.data === "number" || typeof writeRemote.data.data === "string")
      ? String(writeRemote.data.data)
      : undefined;
    const requestedId = typeof body.sellerProductId === "number" || typeof body.sellerProductId === "string" ? String(body.sellerProductId) : undefined;
    const remoteId = resumeRemoteId || responseId || requestedId;
    const writeStep: ChannelOperationStep = writeRemote
      ? step(input.operation, writeRemote)
      : { name: "listing.resume", ok: Boolean(remoteId), status: 200, data: { sellerProductId: remoteId, resumed: true } };
    if (!writeStep.ok || !remoteId) return result(input, [writeStep], remoteId);
    let readbackRemote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
    });
    const verifyReadback = (name: string) => {
      const readbackStep = step(name, readbackRemote);
      const stateValues: unknown[] = [];
      let readbackId: unknown;
      let requested: unknown;
      const inspect = (value: unknown, depth = 0) => {
        if (depth > 5 || !value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach((item) => inspect(item, depth + 1));
          return;
        }
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
          if (readbackId === undefined && key === "sellerProductId") readbackId = item;
          if (requested === undefined && key === "requested") requested = item;
          if (/^(?:mdId|status|statusName|requested|approvalStatus)$/i.test(key)) stateValues.push(item);
          inspect(item, depth + 1);
        }
      };
      inspect(readbackRemote.data);
      const stateIndicators = stateValues
        .filter((value) => value !== undefined && value !== null && String(value).length > 0)
        .map(String)
        .join(" ")
        .toUpperCase();
      const identityMatches = readbackId !== undefined && String(readbackId) === remoteId;
      const saved = /(TEMP_SAVED|\bSAVED\b)/.test(stateIndicators);
      const approvalObserved = requested === true
        || (stateIndicators.length > 0 && !saved && !/ID_GEN/.test(stateIndicators));
      const providerAndIdentityOk = readbackStep.ok && identityMatches;
      readbackStep.ok = providerAndIdentityOk && (body.requested !== true || approvalObserved);
      return { readbackStep, providerAndIdentityOk, approvalObserved, saved };
    };
    let initialReadback = verifyReadback("listing-readback");
    if (body.requested !== true || initialReadback.approvalObserved) {
      initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk;
      return result(input, [writeStep, initialReadback.readbackStep], remoteId);
    }

    // Coupang can return ID_GEN for several seconds after a successful create.
    // Approval during that window is rejected even though the same readback soon
    // transitions to SAVED, so wait for the documented temporary-save state.
    for (let attempt = 0; attempt < 8 && !initialReadback.saved; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      readbackRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
      });
      initialReadback = verifyReadback("listing-readback");
      if (initialReadback.approvalObserved) break;
    }
    if (initialReadback.approvalObserved) {
      initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk;
      return result(input, [writeStep, initialReadback.readbackStep], remoteId);
    }
    initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk && initialReadback.saved;
    if (!initialReadback.readbackStep.ok) {
      return result(input, [writeStep, initialReadback.readbackStep], remoteId);
    }

    const approvalRemote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}/approvals`,
    });
    const approvalStep = step("listing-approval-request", approvalRemote);
    let approvalReadback = initialReadback;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      readbackRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
      });
      approvalReadback = verifyReadback("listing-approval-readback");
      if (approvalReadback.approvalObserved) {
        approvalReadback.readbackStep.ok = approvalReadback.providerAndIdentityOk;
        break;
      }
    }
    if (approvalReadback.readbackStep.ok) {
      initialReadback.readbackStep.ok = true;
      approvalStep.ok = true;
    }
    return result(input, [writeStep, initialReadback.readbackStep, approvalStep, approvalReadback.readbackStep], remoteId);
  }
  if (input.operation === "listing.stop") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/sales/stop` });
    return result(input, [step("sales-stop", remote)], vendorItemId);
  }
  if (input.operation === "price.update") {
    const vendorItemId = pathSegment(stringArgument(input.arguments, "vendorItemId"));
    const price = integerArgument(input.arguments, "price", { min: 10 });
    if (price % 10 !== 0) throw new Error("CHANNEL_ARGUMENT_INVALID:price_must_be_10_won_unit");
    const query = new URLSearchParams({ forceSalePriceUpdate: String(booleanArgument(input.arguments, "forceSalePriceUpdate")) });
    const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/prices/${price}`, query });
    return result(input, [step("price", remote)], vendorItemId);
  }
  if (input.operation === "inventory.update") {
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const suppliedVendorItemId = stringArgument(input.arguments, "vendorItemId", false);
    let vendorItemIds = suppliedVendorItemId ? [suppliedVendorItemId] : [];
    const steps: ChannelOperationStep[] = [];
    const sellerProductId = stringArgument(input.arguments, "sellerProductId", false);
    if (!vendorItemIds.length && sellerProductId) {
      const readback = await coupangRequest({ payload: input.payload, method: "GET", path: `${sellerProductsPath}/${pathSegment(sellerProductId)}` });
      const readbackStep = step("inventory-item-readback", readback);
      steps.push(readbackStep);
      if (!readbackStep.ok) return result(input, steps, sellerProductId);
      const data = readback.data.data && typeof readback.data.data === "object" && !Array.isArray(readback.data.data)
        ? readback.data.data as Record<string, unknown>
        : readback.data;
      const items = Array.isArray(data.items) ? data.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
      vendorItemIds = items.map((item) => String(item.vendorItemId ?? "").trim()).filter(Boolean);
    }
    if (!vendorItemIds.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:vendorItemId");
    for (const vendorItemId of vendorItemIds) {
      const remote = await coupangRequest({ payload: input.payload, method: "PUT", path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/quantities/${quantity}` });
      const writeStep = step("quantity", remote);
      steps.push(writeStep);
      if (!writeStep.ok) continue;
      const verificationRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/inventories`,
      });
      const verificationData = verificationRemote.data.data && typeof verificationRemote.data.data === "object" && !Array.isArray(verificationRemote.data.data)
        ? verificationRemote.data.data as Record<string, unknown>
        : verificationRemote.data;
      steps.push(inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verificationData.amountInStock ?? verificationData.quantity));
    }
    return result(input, steps, sellerProductId || vendorItemIds[0]);
  }
  const orderBase = `/v2/providers/openapi/apis/api/v5/vendors/${pathSegment(vendorId)}`;
  if (input.operation === "inquiries.list") {
    const query = queryParams(input.arguments);
    query.set("vendorId", vendorId);
    const kind = stringArgument(input.arguments, "kind", false);
    const path = kind === "call-center" ? `${orderBase}/callCenterInquiries` : `${orderBase}/onlineInquiries`;
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path, query });
    const inquiryStep = step("inquiries", remote);
    inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: kind || "product" };
    return result(input, [inquiryStep]);
  }
  if (input.operation === "inquiries.reply") {
    const inquiryId = pathSegment(stringArgument(input.arguments, "inquiryId"));
    const kind = stringArgument(input.arguments, "kind");
    const replyBy = textValue(input.payload, "requested_by");
    if (!replyBy) throw new Error("COUPANG_WING_USER_ID_MISSING");
    if (kind !== "product" && kind !== "call-center") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const reply = stringArgument(input.arguments, "reply");
    const body = kind === "call-center"
      ? {
          vendorId,
          inquiryId: decodeURIComponent(inquiryId),
          content: reply,
          replyBy,
          parentAnswerId: pathSegment(stringArgument(input.arguments, "parentAnswerId")),
        }
      : { content: reply, vendorId, replyBy };
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/${kind === "call-center" ? "callCenterInquiries" : "onlineInquiries"}/${inquiryId}/replies`,
      body,
    });
    return result(input, [step("inquiry-reply", remote)], decodeURIComponent(inquiryId));
  }
  if (input.operation === "orders.list") {
    const kind = stringArgument(input.arguments, "kind", false);
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: kind === "cancellations"
        ? `/v2/providers/openapi/apis/api/v6/vendors/${pathSegment(vendorId)}/returnRequests`
        : `${orderBase}/ordersheets`,
      query: queryParams(input.arguments),
    });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const shipmentBoxId = pathSegment(stringArgument(input.arguments, "shipmentBoxId"));
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path: `${orderBase}/ordersheets/${shipmentBoxId}` });
    return result(input, [step("order", remote)], shipmentBoxId);
  }
  if (input.operation === "shipment.acknowledge") {
    const shipmentBoxIds = input.arguments.shipmentBoxIds;
    if (!Array.isArray(shipmentBoxIds) || shipmentBoxIds.length < 1 || shipmentBoxIds.length > 50) throw new Error("CHANNEL_ARGUMENT_INVALID:shipmentBoxIds");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "PATCH",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/ordersheets/acknowledgement`,
      body: { vendorId, shipmentBoxIds },
    });
    return result(input, [step("acknowledgement", remote)]);
  }
  const body = { ...objectValue(input.arguments, "body"), vendorId };
  const remote = await coupangRequest({
    payload: input.payload,
    method: "POST",
    path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/orders/invoices`,
    body,
  });
  return result(input, [step("invoice", remote)]);
}

async function executeSmartstore(input: ExecuteInput) {
  let token = await fetchNaverAccessToken(input.payload);
  const request = async (requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">) => {
    let remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    if (remote.response.status === 401 && textValue(remote.data, "code") === "GW.AUTHN") {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({ ...requestInput, accessToken: token.accessToken });
    }
    return remote;
  };
  if (input.operation === "categories.list") {
    const categoryId = stringArgument(input.arguments, "categoryId", false);
    const query = new URLSearchParams();
    if (booleanArgument(input.arguments, "leafOnly", true)) query.set("last", "true");
    const remote = categoryId
      ? await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` })
      : await request({ method: "GET", path: "/v1/categories", query });
    return result(input, [step("category", remote)], categoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const remote = await request({ method: "GET", path: "/v1/categories", query: new URLSearchParams({ last: "true" }) });
    return result(input, [step("category-tree", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = new URLSearchParams({ categoryId });
    const [category, attributes, values, options] = await Promise.all([
      request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` }),
      request({ method: "GET", path: "/v1/product-attributes/attributes", query }),
      request({ method: "GET", path: "/v1/product-attributes/attribute-values", query }),
      request({ method: "GET", path: "/v1/options/standard-options", query }),
    ]);
    return result(input, [
      step("category", category),
      naverOptionalCategoryMetadataStep("attributes", attributes),
      naverOptionalCategoryMetadataStep("attribute-values", values),
      naverOptionalCategoryMetadataStep("standard-options", options),
    ], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await request({ method: "GET", path: `/v1/categories/${pathSegment(categoryId)}` });
    return result(input, [step("category-validation", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const body = objectValue(input.arguments, "body");
    const originProduct = objectValue(body, "originProduct", false);
    const detailAttribute = objectValue(originProduct, "detailAttribute", false);
    const sellerCodeInfo = objectValue(detailAttribute, "sellerCodeInfo", false);
    const sellerManagementCode = textValue(sellerCodeInfo, "sellerManagementCode");
    if (sellerManagementCode) {
      const searchRemote = await request({
        method: "POST",
        path: "/v1/products/search",
        body: {
          searchKeywordType: "SELLER_CODE",
          sellerManagementCode,
          page: 1,
          size: 50,
          orderType: "NO",
        },
      });
      const contents: unknown[] = Array.isArray(searchRemote.data.contents) ? searchRemote.data.contents : [];
      const existing = contents.find((item: unknown) => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        const channelProducts: unknown[] = Array.isArray(record.channelProducts) ? record.channelProducts : [];
        return channelProducts.some((channelProduct: unknown) => channelProduct && typeof channelProduct === "object" && (channelProduct as Record<string, unknown>).sellerManagementCode === sellerManagementCode);
      });
      const existingOriginProductNo = existing && typeof existing === "object" ? (existing as Record<string, unknown>).originProductNo : undefined;
      if (existingOriginProductNo !== undefined) {
        const remoteId = String(existingOriginProductNo);
        const searchStep = step("product-reconcile", searchRemote);
        const updateRemote = await request({ method: "PUT", path: `/v2/products/origin-products/${pathSegment(remoteId)}`, body });
        const updateStep = step("product-update", updateRemote);
        if (!updateStep.ok) return result(input, [searchStep, updateStep], remoteId);
        const readbackRemote = await request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(remoteId)}` });
        const readbackStep = step("product-readback", readbackRemote);
        readbackStep.ok = readbackStep.ok && Boolean(readbackRemote.data.originProduct && typeof readbackRemote.data.originProduct === "object");
        return result(input, [searchStep, updateStep, readbackStep], remoteId);
      }
    }
    const createRemote = await request({ method: "POST", path: "/v2/products", body });
    const remoteId = createRemote.data.originProductNo === undefined ? undefined : String(createRemote.data.originProductNo);
    const steps = [step("product-create", createRemote)];
    if (!steps[0].ok || !remoteId) return result(input, steps, remoteId);
    const readbackRemote = await request({ method: "GET", path: `/v2/products/origin-products/${pathSegment(remoteId)}` });
    const readbackStep = step("product-readback", readbackRemote);
    readbackStep.ok = readbackStep.ok && Boolean(readbackRemote.data.originProduct && typeof readbackRemote.data.originProduct === "object");
    steps.push(readbackStep);
    return result(input, steps, remoteId);
  }
  if (input.operation === "listing.update") {
    const remoteId = stringArgument(input.arguments, "originProductNo");
    const originProductNo = pathSegment(remoteId);
    const patchBody = objectValue(input.arguments, "body");
    const readProduct = () => request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
    const preflightRemote = await readProduct();
    const preflightStep = step("product-update-preflight", preflightRemote);
    const currentOriginProduct = objectValue(preflightRemote.data, "originProduct", false);
    preflightStep.ok = preflightStep.ok && Object.keys(currentOriginProduct).length > 0;
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok ? "SMARTSTORE_EXISTING_PRODUCT_VERIFIED" : "SMARTSTORE_EXISTING_PRODUCT_MISSING",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], remoteId);
    const currentChannelProduct = objectValue(preflightRemote.data, "smartstoreChannelProduct", false);
    const currentBody = {
      originProduct: currentOriginProduct,
      ...(Object.keys(currentChannelProduct).length ? { smartstoreChannelProduct: currentChannelProduct } : {}),
    };
    const mergedBody = mergeListingUpdatePatch(currentBody, patchBody) as Record<string, unknown>;
    const remote = await request({ method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body: mergedBody });
    const updateStep = step("product-update", remote);
    if (!updateStep.ok) return result(input, [preflightStep, updateStep], remoteId);
    const readbackRemote = await readProduct();
    const readbackStep = listingUpdateReadbackStep("product-readback", readbackRemote, input.channel, input.arguments);
    return result(input, [preflightStep, updateStep, readbackStep], remoteId);
  }
  if (input.operation === "listing.stop") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const remote = await request({
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/change-status`,
      body: { ...objectValue(input.arguments, "body", false), statusType: "SUSPENSION" },
    });
    return result(input, [step("status-stop", remote)], originProductNo);
  }
  if (input.operation === "price.update") {
    const remote = await request({ method: "PUT", path: "/v1/products/origin-products/bulk-update", body: objectValue(input.arguments, "body") });
    return result(input, [step("bulk-price", remote)]);
  }
  if (input.operation === "inventory.update") {
    const originProductNo = pathSegment(stringArgument(input.arguments, "originProductNo"));
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    if (stringArgument(input.arguments, "mode", false) === "origin-product" || !input.arguments.body) {
      const readback = await request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
      const readbackStep = step("inventory-item-readback", readback);
      if (!readbackStep.ok) return result(input, [readbackStep], decodeURIComponent(originProductNo));
      const originProduct = objectValue(readback.data, "originProduct", false);
      if (!Object.keys(originProduct).length) return result(input, [{ ...readbackStep, ok: false }], decodeURIComponent(originProductNo));
      const body = {
        ...readback.data,
        originProduct: { ...originProduct, stockQuantity: quantity },
      };
      const writeRemote = await request({ method: "PUT", path: `/v2/products/origin-products/${originProductNo}`, body });
      const writeStep = step("origin-product-stock", writeRemote);
      if (!writeStep.ok) return result(input, [readbackStep, writeStep], decodeURIComponent(originProductNo));
      const verificationRemote = await request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` });
      const verificationProduct = objectValue(verificationRemote.data, "originProduct", false);
      return result(input, [
        readbackStep,
        writeStep,
        inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verificationProduct.stockQuantity),
      ], decodeURIComponent(originProductNo));
    }
    const body = input.arguments.body
      ? objectValue(input.arguments, "body")
      : { stockQuantity: quantity };
    const remote = await request({ method: "PUT", path: `/v1/products/origin-products/${originProductNo}/option-stock`, body });
    return result(input, [step("option-stock", remote)], decodeURIComponent(originProductNo));
  }
  if (input.operation === "orders.list") {
    const remote = await request({ method: "GET", path: "/v1/pay-order/seller/product-orders/last-changed-statuses", query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "inquiries.list") {
    const remote = await request({ method: "GET", path: "/v1/contents/qnas", query: queryParams(input.arguments) });
    return result(input, [step("inquiries", remote)]);
  }
  if (input.operation === "inquiries.reply") {
    const questionId = pathSegment(stringArgument(input.arguments, "questionId"));
    const remote = await request({
      method: "PUT",
      path: `/v1/contents/qnas/${questionId}`,
      body: { answerContent: stringArgument(input.arguments, "reply") },
    });
    return result(input, [step("inquiry-reply", remote)], decodeURIComponent(questionId));
  }
  if (input.operation === "orders.get") {
    const productOrderId = stringArgument(input.arguments, "productOrderId");
    const remote = await request({
      method: "POST",
      path: "/v1/pay-order/seller/product-orders/query",
      body: { productOrderIds: [productOrderId], quantityClaimCompatibility: true },
    });
    return result(input, [step("order", remote)], productOrderId);
  }
  if (input.operation === "shipment.acknowledge") {
    const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/confirm", body: objectValue(input.arguments, "body") });
    return result(input, [step("confirm", remote)]);
  }
  const remote = await request({ method: "POST", path: "/v1/pay-order/seller/product-orders/dispatch", body: objectValue(input.arguments, "body") });
  return result(input, [step("dispatch", remote)]);
}

function temuResultObject(data: Record<string, unknown>) {
  const value = data.result;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function temuResultRecords(data: Record<string, unknown>, ...keys: string[]) {
  const direct = data.result;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  const root = direct && typeof direct === "object" && !Array.isArray(direct)
    ? direct as Record<string, unknown>
    : {};
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}

function normalizedTemuCarrier(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function temuCarrierAliases(carrierCode: string) {
  const aliases: Record<string, string[]> = {
    CJGLS: ["CJ대한통운", "CJLOGISTICS"],
    HANJIN: ["한진", "HANJIN"],
    LOTTE: ["롯데", "LOTTE"],
    LOGEN: ["로젠", "LOGEN"],
    POST: ["우체국", "KOREAPOST"],
    EPOST: ["우체국", "KOREAPOST"],
  };
  return [carrierCode, ...(aliases[carrierCode.toLocaleUpperCase()] ?? [])]
    .map(normalizedTemuCarrier)
    .filter(Boolean);
}

function temuGoodsMatch(value: unknown, remoteId: string, externalGoodsId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return String(item.goodsId ?? "") === remoteId
    && [item.outGoodsSn, item.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId);
}

function temuStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

async function executeTemu(input: ExecuteInput) {
  if (input.operation === "categories.list" || input.operation === "categories.suggest" || input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const goodsName = stringArgument(input.arguments, "goodsName", false)
      || stringArgument(input.arguments, "query", false)
      || stringArgument(input.arguments, "categoryId", false);
    if (!goodsName) throw new Error("CHANNEL_ARGUMENT_REQUIRED:goodsName");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.category.recommend",
      arguments: {
        goodsName,
        ...(stringArgument(input.arguments, "description", false) ? { description: stringArgument(input.arguments, "description", false) } : {}),
        ...(stringArgument(input.arguments, "imageUrl", false) ? { imageUrl: stringArgument(input.arguments, "imageUrl", false) } : {}),
      },
    });
    const categoryId = temuResultObject(remote.data).catId;
    return result(input, [step("category-recommend", remote)], categoryId === undefined ? undefined : String(categoryId));
  }
  if (input.operation === "listing.create") {
    const body = objectValue(input.arguments, "body");
    const goodsBasic = objectValue(body, "goodsBasic");
    const externalGoodsId = stringArgument(goodsBasic, "externalGoodsId");
    const createRemote = await temuRequest({ payload: input.payload, type: "temu.local.goods.v3.add", arguments: body });
    const created = temuResultObject(createRemote.data);
    let remoteId = created.goodsId === undefined ? "" : String(created.goodsId);
    const createStep = step("goods-v3-add", createRemote);
    const steps: ChannelOperationStep[] = [];
    if (createStep.ok && remoteId) {
      steps.push(createStep);
    } else {
      // Preserve a provider-accepted create marker even if the response omitted
      // goodsId. If lookup recovery also misses, the gateway must quarantine
      // this create instead of treating it as safely retryable.
      if (createStep.ok) steps.push(createStep);
      // A successful Temu create can outlive a gateway timeout. Retrying the same
      // external ID would otherwise fail as a duplicate, so recover the existing
      // product and continue the same status/image verification path.
      const reconcileRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: { outGoodsSnList: [externalGoodsId], pageSize: 25 },
      });
      const reconcileGoods = temuResultObject(reconcileRemote.data).goodsList;
      const existing = Array.isArray(reconcileGoods)
        ? reconcileGoods.find((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const record = item as Record<string, unknown>;
          return [record.outGoodsSn, record.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId);
        }) as Record<string, unknown> | undefined
        : undefined;
      remoteId = existing?.goodsId === undefined ? "" : String(existing.goodsId);
      const reconcileStep = step("goods-reconcile", reconcileRemote);
      reconcileStep.ok = reconcileStep.ok && Boolean(remoteId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredGoodsId: remoteId || undefined,
        createStatus: createRemote.response.status,
        sellerpilotVerification: remoteId ? "EXISTING_GOODS_RECOVERED" : "TEMU_GOODS_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !remoteId) return result(input, steps, remoteId || undefined);
    }
    const readbackRemote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: { outGoodsSnList: [externalGoodsId], pageSize: 25 },
    });
    const readbackStep = step("goods-readback", readbackRemote);
    const goodsList = temuResultObject(readbackRemote.data).goodsList;
    const matched = Array.isArray(goodsList) && goodsList.some((item) => temuGoodsMatch(item, remoteId, externalGoodsId));
    readbackStep.ok = readbackStep.ok && matched;
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: matched ? "EXTERNAL_ID_VERIFIED" : "TEMU_EXTERNAL_ID_READBACK_MISSING",
    };
    steps.push(readbackStep);
    if (!readbackStep.ok) return result(input, steps, remoteId);

    const publishStatusRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [Number(remoteId)] },
    });
    const publishStatusStep = step("goods-publish-status", publishStatusRemote);
    const publishStatuses = temuResultObject(publishStatusRemote.data).goodsPublishStatusList;
    const publishStatus = Array.isArray(publishStatuses)
      ? publishStatuses.find((item) => item && typeof item === "object" && !Array.isArray(item)
        && String((item as Record<string, unknown>).goodsId ?? "") === remoteId) as Record<string, unknown> | undefined
      : undefined;
    publishStatusStep.ok = publishStatusStep.ok && Boolean(publishStatus);
    publishStatusStep.data = {
      ...publishStatusStep.data,
      remoteGoodsStatus: publishStatus?.status,
      remoteGoodsSubStatus: publishStatus?.subStatus,
      sellerpilotVerification: publishStatus ? "PUBLISH_STATUS_VERIFIED" : "TEMU_PUBLISH_STATUS_MISSING",
    };
    steps.push(publishStatusStep);
    if (!publishStatusStep.ok) return result(input, steps, remoteId);

    const detailRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: Number(remoteId), versionQueryType: 1 },
    });
    const detailStep = step("goods-detail-image-readback", detailRemote);
    const detail = temuResultObject(detailRemote.data);
    const gallery = objectValue(detail, "goodsGallery", false);
    const expectedCarouselImageCount = temuStringArray(goodsBasic.goodsCarouselImage).length;
    const expectedDetailImageCount = temuStringArray(goodsBasic.detailImage).length;
    const actualCarouselImageCount = temuStringArray(gallery.goodsCarouselImage).length;
    const actualDetailImageCount = temuStringArray(gallery.detailImage).length;
    const detailMatches = String(detail.goodsId ?? "") === remoteId;
    const imagesMatch = actualCarouselImageCount >= expectedCarouselImageCount
      && actualDetailImageCount >= expectedDetailImageCount;
    detailStep.ok = detailStep.ok && detailMatches && imagesMatch;
    detailStep.data = {
      ...detailStep.data,
      expectedCarouselImageCount,
      actualCarouselImageCount,
      expectedDetailImageCount,
      actualDetailImageCount,
      sellerpilotVerification: detailStep.ok ? "IMAGES_VERIFIED" : "TEMU_IMAGE_READBACK_MISSING",
    };
    steps.push(detailStep);
    return result(input, steps, remoteId);
  }
  if (input.operation === "listing.stop") {
    const goodsId = stringArgument(input.arguments, "goodsId");
    const remote = await temuRequest({ payload: input.payload, type: "bg.local.goods.sale.status.set", arguments: { goodsId: Number(goodsId), onsale: 0, operationType: 1 } });
    return result(input, [step("goods-off-shelf", remote)], goodsId);
  }
  if (input.operation === "inventory.update") {
    const goodsId = stringArgument(input.arguments, "goodsId", false);
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    let body = input.arguments.body ? objectValue(input.arguments, "body") : null;
    const steps: ChannelOperationStep[] = [];
    if (!body && goodsId) {
      const detail = await temuRequest({ payload: input.payload, type: "bg.local.goods.detail.query", arguments: { goodsId: Number(goodsId), versionQueryType: 1 } });
      const detailStep = step("inventory-item-readback", detail);
      steps.push(detailStep);
      if (!detailStep.ok) return result(input, steps, goodsId);
      const detailData = temuResultObject(detail.data);
      const skus = Array.isArray(detailData.skuList) ? detailData.skuList.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
      const skuStockList = skus.map((sku) => ({ skuId: Number(sku.skuId ?? sku.goodsSkuId), stockQuantity: quantity })).filter((sku) => Number.isFinite(sku.skuId));
      body = { goodsId: Number(goodsId), skuStockList };
    }
    if (!body) throw new Error("CHANNEL_ARGUMENT_REQUIRED:body");
    const remote = await temuRequest({ payload: input.payload, type: "bg.local.goods.stock.edit", arguments: body });
    const responseGoodsId = temuResultObject(remote.data).goodsId;
    const writeStep = step("goods-stock", remote);
    steps.push(writeStep);
    if (!writeStep.ok || !goodsId) return result(input, steps, responseGoodsId === undefined ? goodsId || undefined : String(responseGoodsId));
    const verificationRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: Number(goodsId), versionQueryType: 1 },
    });
    const verificationData = temuResultObject(verificationRemote.data);
    const verificationSkus = Array.isArray(verificationData.skuList)
      ? verificationData.skuList.filter((sku): sku is Record<string, unknown> => Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : [];
    const quantities = verificationSkus.map((sku) => Number(sku.stockQuantity ?? sku.quantity));
    const verifiedQuantity = quantities.length > 0 && quantities.every((value) => value === quantity) ? quantity : Number.NaN;
    steps.push(inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verifiedQuantity));
    return result(input, steps, responseGoodsId === undefined ? goodsId : String(responseGoodsId));
  }
  if (input.operation === "orders.list") {
    const pageSize = Math.max(1, Math.min(100, Number(input.arguments.pageSize) || 100));
    let pageNumber = Math.max(1, Number(input.arguments.pageNumber) || 1);
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.order.list.v2.get",
        arguments: { ...input.arguments, pageNumber, pageSize },
      });
      const pageStep = step(pageIndex === 0 ? "orders" : `orders:${pageNumber}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok || temuResultRecords(remote.data, "pageItems").length < pageSize) break;
      pageNumber += 1;
    }
    return result(input, steps);
  }
  if (input.operation === "orders.get") {
    const parentOrderSn = stringArgument(input.arguments, "parentOrderSn", false)
      || stringArgument(input.arguments, "orderId");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.order.list.v2.get",
      arguments: { pageNumber: 1, pageSize: 10, parentOrderSnList: [parentOrderSn] },
    });
    return result(input, [step("order", remote)], parentOrderSn);
  }
  if (input.operation === "inquiries.list") {
    const pageSize = Math.max(1, Math.min(200, Number(input.arguments.pageSize) || 200));
    let pageNo = Math.max(1, Number(input.arguments.pageNo) || 1);
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.aftersales.parentaftersales.list.get",
        arguments: { ...input.arguments, pageNo, pageSize },
      });
      const pageStep = step(pageIndex === 0 ? "inquiries" : `inquiries:${pageNo}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok || temuResultRecords(remote.data, "data").length < pageSize) break;
      pageNo += 1;
    }
    return result(input, steps);
  }
  if (input.operation === "shipment.confirm") {
    const parentOrderSn = stringArgument(input.arguments, "parentOrderSn");
    const carrierCode = stringArgument(input.arguments, "carrierCode");
    const trackingNumber = stringArgument(input.arguments, "trackingNumber");
    const providerContext = objectValue(input.arguments, "providerContext");
    const contextParentOrderSn = stringArgument(providerContext, "parentOrderSn");
    if (contextParentOrderSn !== parentOrderSn) throw new Error("CHANNEL_ARGUMENT_INVALID:providerContext.parentOrderSn");
    const orderItems = Array.isArray(providerContext.orderItems)
      ? providerContext.orderItems.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, 100)
      : [];
    const sendItems = orderItems.map((item) => ({
      parentOrderSn,
      orderSn: stringArgument(item, "orderSn"),
      ...(stringArgument(item, "goodsId", false) ? { goodsId: stringArgument(item, "goodsId", false) } : {}),
      ...(stringArgument(item, "skuId", false) ? { skuId: stringArgument(item, "skuId", false) } : {}),
      quantity: integerArgument(item, "quantity", { min: 1, max: 999_999 }),
    }));
    if (!sendItems.length) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.orderItems");

    const preflightRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const existingShipment = temuResultRecords(preflightRemote.data, "shipmentInfoDTO")
      .some((item) => String(item.trackingNumber ?? "").trim() === trackingNumber);
    if (existingShipment) {
      const existingStep = step("shipment-existing-readback", preflightRemote);
      existingStep.ok = existingStep.ok && existingShipment;
      existingStep.data = { ...existingStep.data, sellerpilotVerification: "EXISTING_SHIPMENT_VERIFIED" };
      return result(input, [existingStep], parentOrderSn);
    }

    const warehouseRemote = await temuRequest({ payload: input.payload, type: "bg.logistics.warehouse.list.get", arguments: {} });
    const warehouseStep = step("shipping-warehouses", warehouseRemote);
    const warehouses = temuResultRecords(warehouseRemote.data, "warehouseList");
    const preferredWarehouseId = stringArgument(providerContext, "inventoryDeductionWarehouseId", false);
    const warehouse = warehouses.find((item) => preferredWarehouseId && String(item.warehouseId ?? "") === preferredWarehouseId)
      ?? warehouses.find((item) => item.defaultWarehouse === true || Number(item.defaultWarehouse) === 1)
      ?? warehouses[0];
    const warehouseId = String(warehouse?.warehouseId ?? "").trim();
    warehouseStep.ok = warehouseStep.ok && Boolean(warehouseId);
    warehouseStep.data = {
      ...warehouseStep.data,
      sellerpilotVerification: warehouseId ? "SHIPPING_WAREHOUSE_SELECTED" : "TEMU_SHIPPING_WAREHOUSE_MISSING",
    };
    if (!warehouseStep.ok) return result(input, [warehouseStep], parentOrderSn);

    const regionIdText = stringArgument(providerContext, "regionId", false)
      || String(warehouse?.regionId1 ?? warehouse?.regionId ?? "").trim();
    if (!regionIdText) throw new Error("CHANNEL_ARGUMENT_REQUIRED:providerContext.regionId");
    const regionId = /^\d+$/.test(regionIdText) ? Number(regionIdText) : regionIdText;
    const carriersRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.companies.get",
      arguments: { regionId },
    });
    const carriersStep = step("shipping-carriers", carriersRemote);
    const requestedAliases = temuCarrierAliases(carrierCode);
    const carrier = temuResultRecords(carriersRemote.data, "logisticsServiceProviderList", "companyList")
      .find((item) => {
        if (String(item.logisticsServiceProviderId ?? "") === carrierCode) return true;
        const remoteNames = [item.logisticsServiceProviderName, item.logisticsBrandName]
          .map(normalizedTemuCarrier)
          .filter(Boolean);
        return requestedAliases.some((alias) => remoteNames.some((name) => name === alias || name.includes(alias) || alias.includes(name)));
      });
    const carrierIdText = String(carrier?.logisticsServiceProviderId ?? "").trim();
    carriersStep.ok = carriersStep.ok && Boolean(carrierIdText);
    carriersStep.data = {
      ...carriersStep.data,
      sellerpilotVerification: carrierIdText ? "SHIPPING_CARRIER_MATCHED" : "TEMU_SHIPPING_CARRIER_UNMATCHED",
    };
    if (!carriersStep.ok) return result(input, [warehouseStep, carriersStep], parentOrderSn);
    const carrierId = /^\d+$/.test(carrierIdText) ? Number(carrierIdText) : carrierIdText;

    const confirmRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.confirm",
      arguments: {
        sendType: 0,
        sendRequestList: [{
          carrierId,
          trackingNumber,
          selfShippingWarehouseId: /^\d+$/.test(warehouseId) ? Number(warehouseId) : warehouseId,
          orderSendInfoList: sendItems,
        }],
      },
    });
    const confirmStep = step("shipment-confirm", confirmRemote);
    if (!confirmStep.ok) return result(input, [warehouseStep, carriersStep, confirmStep], parentOrderSn);
    const readbackRemote = await temuRequest({
      payload: input.payload,
      type: "bg.logistics.shipment.v2.get",
      arguments: { parentOrderSn, orderSn: sendItems[0].orderSn },
    });
    const verified = temuResultRecords(readbackRemote.data, "shipmentInfoDTO")
      .some((item) => String(item.trackingNumber ?? "").trim() === trackingNumber);
    const readbackStep = step("shipment-readback", readbackRemote);
    readbackStep.ok = readbackStep.ok && verified;
    readbackStep.data = {
      ...readbackStep.data,
      sellerpilotVerification: verified ? "TRACKING_NUMBER_VERIFIED" : "TEMU_TRACKING_READBACK_MISMATCH",
    };
    return result(input, [warehouseStep, carriersStep, confirmStep, readbackStep], parentOrderSn);
  }
  if (input.operation === "shipment.acknowledge") {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}

async function executeEbay(input: ExecuteInput) {
  if (input.operation === "categories.list") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}` });
    return result(input, [step("taxonomy", remote)], categoryTreeId);
  }
  if (input.operation === "categories.suggest") {
    let categoryTreeId = stringArgument(input.arguments, "categoryTreeId", false);
    const marketplaceId = stringArgument(input.arguments, "marketplaceId", false) || textValue(input.payload, "marketplace_id") || "EBAY_US";
    const steps: ChannelOperationStep[] = [];
    if (!categoryTreeId) {
      const tree = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/commerce/taxonomy/v1/get_default_category_tree_id", query: new URLSearchParams({ marketplace_id: marketplaceId }) });
      steps.push(step("default-category-tree", tree));
      if (!tree.response.ok) return result(input, steps);
      categoryTreeId = String(tree.data.categoryTreeId ?? "");
    }
    if (!categoryTreeId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:categoryTreeId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${pathSegment(categoryTreeId)}/get_category_suggestions`, query: new URLSearchParams({ q: stringArgument(input.arguments, "query") }) });
    steps.push(step("category-suggestions", remote));
    return result(input, steps, categoryTreeId);
  }
  if (input.operation === "categories.attributes" || input.operation === "categories.validate") {
    const categoryTreeId = pathSegment(stringArgument(input.arguments, "categoryTreeId"));
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category`, query: new URLSearchParams({ category_id: categoryId }) });
    return result(input, [step("category-aspects", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const inventoryItem = objectValue(input.arguments, "inventoryItem");
    const offer = structuredClone(objectValue(input.arguments, "offer"));
    // eBay rejects an offer when its SKU differs from the Inventory Item URL
    // even if both values are otherwise valid. Enforce this invariant at the
    // channel boundary as a final guard for manually edited or legacy drafts.
    offer.sku = sku;
    const steps: ChannelOperationStep[] = [];
    const inventoryProduct = inventoryItem.product && typeof inventoryItem.product === "object" && !Array.isArray(inventoryItem.product)
      ? inventoryItem.product as Record<string, unknown>
      : {};
    const expectedImageUrls = Array.isArray(inventoryProduct.imageUrls)
      ? [...new Set(inventoryProduct.imageUrls.map(String).map((value) => value.trim()).filter(Boolean))]
      : [];
    if (!expectedImageUrls.length) throw new Error("EBAY_IMAGE_REQUIRED");
    const expectedDescriptionImages = (String(offer.listingDescription ?? "").match(/<img\b/gi) ?? []).length;
    const verifiedReadbackStep = (
      name: string,
      remote: RemoteResponse,
      expectedImageCount: number,
      actualImageCount: number,
    ): ChannelOperationStep => {
      const remoteStep = step(name, remote);
      const verified = remoteStep.ok && actualImageCount >= expectedImageCount;
      return {
        ...remoteStep,
        ok: verified,
        data: {
          ...remoteStep.data,
          expectedImageCount,
          actualImageCount,
          sellerpilotVerification: verified ? "IMAGES_VERIFIED" : "EBAY_IMAGE_READBACK_MISSING",
        },
      };
    };
    const listingPolicies = offer.listingPolicies && typeof offer.listingPolicies === "object" && !Array.isArray(offer.listingPolicies)
      ? offer.listingPolicies as Record<string, unknown>
      : {};
    const serverManaged = (value: unknown) => !String(value ?? "").trim() || value === "SERVER_MANAGED";
    const marketplaceId = String(offer.marketplaceId ?? textValue(input.payload, "marketplace_id") ?? "EBAY_US");
    if (["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"].some((key) => serverManaged(listingPolicies[key]))) {
      const query = new URLSearchParams({ marketplace_id: marketplaceId });
      const [fulfillmentRemote, paymentRemote, returnRemote] = await Promise.all([
        ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/account/v1/fulfillment_policy", query }),
        ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/account/v1/payment_policy", query }),
        ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/account/v1/return_policy", query }),
      ]);
      steps.push(step("fulfillment-policies", fulfillmentRemote), step("payment-policies", paymentRemote), step("return-policies", returnRemote));
      if (steps.some((item) => !item.ok)) return result(input, steps, sku);
      const defaultPolicy = (value: unknown, listKey: string, idKey: string) => {
        const policies = value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[listKey])
          ? (value as Record<string, unknown>)[listKey] as Array<Record<string, unknown>>
          : [];
        const nonVehicle = policies.find((policy) => Array.isArray(policy.categoryTypes) && policy.categoryTypes.some((category) => category && typeof category === "object" && (category as Record<string, unknown>).name === "ALL_EXCLUDING_MOTORS_VEHICLES"));
        return String((nonVehicle ?? policies[0])?.[idKey] ?? "").trim();
      };
      if (serverManaged(listingPolicies.fulfillmentPolicyId)) listingPolicies.fulfillmentPolicyId = defaultPolicy(fulfillmentRemote.data, "fulfillmentPolicies", "fulfillmentPolicyId");
      if (serverManaged(listingPolicies.paymentPolicyId)) listingPolicies.paymentPolicyId = defaultPolicy(paymentRemote.data, "paymentPolicies", "paymentPolicyId");
      if (serverManaged(listingPolicies.returnPolicyId)) listingPolicies.returnPolicyId = defaultPolicy(returnRemote.data, "returnPolicies", "returnPolicyId");
      if (["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"].some((key) => !String(listingPolicies[key] ?? "").trim())) {
        throw new Error("EBAY_BUSINESS_POLICIES_MISSING");
      }
      offer.listingPolicies = listingPolicies;
    }
    if (serverManaged(offer.merchantLocationKey)) {
      const locationRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/inventory/v1/location", query: new URLSearchParams({ limit: "100" }) });
      steps.push(step("inventory-locations", locationRemote));
      if (!locationRemote.response.ok) return result(input, steps, sku);
      const locations = Array.isArray(locationRemote.data.locations) ? locationRemote.data.locations as Array<Record<string, unknown>> : [];
      const enabled = locations.find((location) => {
        const inner = location.location && typeof location.location === "object" ? location.location as Record<string, unknown> : {};
        return String(inner.merchantLocationStatus ?? location.merchantLocationStatus ?? "").toUpperCase() === "ENABLED";
      }) ?? locations[0];
      offer.merchantLocationKey = String(enabled?.merchantLocationKey ?? "").trim();
      if (!offer.merchantLocationKey) {
        const locationKey = "sellerpilot-seoul";
        const createLocationRemote = await ebayRequest({
          payload: input.payload,
          environment: input.environment,
          method: "POST",
          path: `/sell/inventory/v1/location/${locationKey}`,
          body: {
            location: {
              address: {
                addressLine1: "Teheran-ro",
                city: "Seoul",
                stateOrProvince: "Seoul",
                postalCode: "06236",
                country: "KR",
              },
            },
            locationTypes: ["WAREHOUSE"],
            merchantLocationStatus: "ENABLED",
            name: "SellerPilot Seoul Warehouse",
          },
        });
        const createLocationStep = step("inventory-location-create", createLocationRemote);
        steps.push(createLocationStep);
        if (!createLocationStep.ok) return result(input, steps, sku);
        const locationReadbackRemote = await ebayRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: `/sell/inventory/v1/location/${locationKey}`,
        });
        const locationReadbackStep = step("inventory-location-readback", locationReadbackRemote);
        const readbackStatus = String(locationReadbackRemote.data.merchantLocationStatus ?? "").toUpperCase();
        locationReadbackStep.ok = locationReadbackStep.ok && readbackStatus === "ENABLED";
        steps.push(locationReadbackStep);
        if (!locationReadbackStep.ok) return result(input, steps, sku);
        offer.merchantLocationKey = locationKey;
      }
    }
    const itemRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/inventory_item/${sku}`, body: inventoryItem });
    steps.push(step("inventory-item", itemRemote));
    if (!itemRemote.response.ok) return result(input, steps, sku);
    const itemReadback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/inventory_item/${sku}` });
    const readbackProduct = itemReadback.data.product && typeof itemReadback.data.product === "object" && !Array.isArray(itemReadback.data.product)
      ? itemReadback.data.product as Record<string, unknown>
      : {};
    const actualImageCount = Array.isArray(readbackProduct.imageUrls)
      ? new Set(readbackProduct.imageUrls.map(String).map((value) => value.trim()).filter(Boolean)).size
      : 0;
    const inventoryImageStep = verifiedReadbackStep("inventory-image-readback", itemReadback, expectedImageUrls.length, actualImageCount);
    steps.push(inventoryImageStep);
    if (!inventoryImageStep.ok) return result(input, steps, sku);
    const offerRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: "/sell/inventory/v1/offer", body: offer });
    let offerId = offerRemote.data.offerId === undefined ? undefined : String(offerRemote.data.offerId);
    const offerStep = step("offer", offerRemote);
    if (offerStep.ok) steps.push(offerStep);
    if (offerStep.ok && offerId) {
      // The accepted provider step was recorded above together with its durable
      // offer identity.
    } else {
      // A timed-out create call may still have persisted the offer remotely. eBay
      // also rejects a second offer for the same SKU, so reconcile by SKU before
      // deciding that the retry failed.
      const reconcileRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/sell/inventory/v1/offer",
        query: new URLSearchParams({ sku: decodeURIComponent(sku), limit: "25" }),
      });
      const offers = Array.isArray(reconcileRemote.data.offers)
        ? reconcileRemote.data.offers as Array<Record<string, unknown>>
        : [];
      const existing = offers.find((candidate) =>
        String(candidate.marketplaceId ?? "") === marketplaceId
        && String(candidate.format ?? "") === String(offer.format ?? "FIXED_PRICE"),
      ) ?? offers.find((candidate) => String(candidate.marketplaceId ?? "") === marketplaceId) ?? offers[0];
      offerId = existing?.offerId === undefined ? undefined : String(existing.offerId);
      const reconcileStep = step("offer-reconcile", reconcileRemote);
      reconcileStep.ok = reconcileStep.ok && Boolean(offerId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredOfferId: offerId,
        createStatus: offerRemote.response.status,
        sellerpilotVerification: offerId ? "EXISTING_OFFER_RECOVERED" : "EBAY_OFFER_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !offerId) {
        // A locally known SKU is not an eBay offer/listing identity. In the
        // accepted-without-offerId case, leave remoteId empty so completion
        // records an unresolved external action rather than a false identity.
        return result(input, steps, offerStep.ok ? undefined : sku);
      }
      const updateRemote = await ebayRequest({
        payload: input.payload,
        environment: input.environment,
        method: "PUT",
        path: `/sell/inventory/v1/offer/${pathSegment(offerId)}`,
        body: offer,
      });
      const updateStep = step("offer-update-after-reconcile", updateRemote);
      steps.push(updateStep);
      if (!updateStep.ok) return result(input, steps, offerId);
    }
    let publishedListingId = "";
    if (offerId) {
      const offerReadback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/offer/${pathSegment(offerId)}` });
      const actualDescriptionImages = (String(offerReadback.data.listingDescription ?? "").match(/<img\b/gi) ?? []).length;
      const offerReadbackStep = expectedDescriptionImages > 0
        ? verifiedReadbackStep("offer-detail-image-readback", offerReadback, expectedDescriptionImages, actualDescriptionImages)
        : step("offer-readback", offerReadback);
      steps.push(offerReadbackStep);
      if (!offerReadbackStep.ok) return result(input, steps, offerId);
      const listing = offerReadback.data.listing && typeof offerReadback.data.listing === "object" && !Array.isArray(offerReadback.data.listing)
        ? offerReadback.data.listing as Record<string, unknown>
        : {};
      if (String(offerReadback.data.status ?? "").toUpperCase() === "PUBLISHED") {
        publishedListingId = String(listing.listingId ?? "").trim();
      }
    }
    if (offerId && booleanArgument(input.arguments, "publish") && !publishedListingId) {
      const publishRemote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${pathSegment(offerId)}/publish` });
      steps.push(step("publish", publishRemote));
      const listingId = publishRemote.data.listingId === undefined ? undefined : String(publishRemote.data.listingId);
      return result(input, steps, listingId ?? offerId);
    }
    return result(input, steps, publishedListingId || offerId || sku);
  }
  if (input.operation === "listing.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/offer/${offerId}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("offer-update", remote)], offerId);
  }
  if (input.operation === "listing.stop") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/inventory/v1/offer/${offerId}/withdraw` });
    return result(input, [step("offer-withdraw", remote)], offerId);
  }
  if (input.operation === "price.update") {
    const offerId = pathSegment(stringArgument(input.arguments, "offerId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "PUT", path: `/sell/inventory/v1/offer/${offerId}`, body: objectValue(input.arguments, "body") });
    return result(input, [step("offer-price", remote)], offerId);
  }
  if (input.operation === "inventory.update") {
    const sku = pathSegment(stringArgument(input.arguments, "sku"));
    const quantity = integerArgument(input.arguments, "quantity", { min: 0, max: 99_999_999 });
    const decodedSku = decodeURIComponent(sku);
    const bulkBody = input.arguments.body ? objectValue(input.arguments, "body") : {
      requests: [{
        sku: decodedSku,
        shipToLocationAvailability: { quantity },
      }],
    };
    const writeRemote = await ebayRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/sell/inventory/v1/bulk_update_price_quantity",
      body: bulkBody,
    });
    const writeStep = step("bulk-inventory", writeRemote);
    if (!writeStep.ok) return result(input, [writeStep], decodedSku);
    const readback = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/inventory/v1/inventory_item/${sku}` });
    const availability = objectValue(readback.data, "availability", false);
    const shipToLocationAvailability = objectValue(availability, "shipToLocationAvailability", false);
    return result(input, [
      writeStep,
      inventoryQuantityVerificationStep("inventory-readback", readback, quantity, shipToLocationAvailability.quantity),
    ], decodedSku);
  }
  if (input.operation === "orders.list") {
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: "/sell/fulfillment/v1/order", query: queryParams(input.arguments) });
    return result(input, [step("orders", remote)]);
  }
  if (input.operation === "orders.get") {
    const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
    const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "GET", path: `/sell/fulfillment/v1/order/${orderId}` });
    return result(input, [step("order", remote)], orderId);
  }
  const orderId = pathSegment(stringArgument(input.arguments, "orderId"));
  const remote = await ebayRequest({ payload: input.payload, environment: input.environment, method: "POST", path: `/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`, body: objectValue(input.arguments, "body") });
  return result(input, [step("shipping-fulfillment", remote)], orderId);
}

export async function executeChannelOperation(input: ExecuteInput): Promise<ChannelOperationResult> {
  ensureProviderSupport(input.channel, input.operation);
  const safeInput = input.operation === "listing.update"
    ? {
      ...input,
      arguments: prepareListingUpdateArguments(input.channel, input.arguments, {
        status: "published",
        remoteId: listingUpdateRemoteIdentity(input.channel, input.arguments),
      }),
    }
    : input;
  if (safeInput.channel === "qoo10") return executeQoo10(safeInput);
  if (safeInput.channel === "shopee") return executeShopee(safeInput);
  if (safeInput.channel === "lazada") return executeLazada(safeInput);
  if (safeInput.channel === "coupang") return executeCoupang(safeInput);
  if (safeInput.channel === "elevenst") return executeElevenst(safeInput);
  if (safeInput.channel === "smartstore") return executeSmartstore(safeInput);
  if (safeInput.channel === "ebay") return executeEbay(safeInput);
  if (safeInput.channel === "temu") return executeTemu(safeInput);
  throw new Error("CHANNEL_OPERATION_UNSUPPORTED");
}
