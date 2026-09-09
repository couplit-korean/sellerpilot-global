import { assertSmartstoreCreateAbsence } from "../../channels/smartstore-create-preflight";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
  objectArray,
  pathSegment,
} from "../../channels/operation-values";
import { createHash } from "node:crypto";
import { externalDetailCanonical } from "../../external-detail-canonical";
import {
  fetchNaverAccessToken,
  naverRequest,
  readStoredNaverAccessToken,
  textValue,
  type RemoteResponse,
} from "../../channels/protocols";
import { mergeListingUpdatePatch } from "../../channels/listing-update";
import { listingPublicationIntentFromArguments } from "../../channels/listing-publication-state";
import {
  listingPublicationReadbackExpectation,
  readSmartstoreListingPublicationState,
} from "../../channels/listing-publication-readback";
import { readSmartstoreUpdateIdentity } from "../../channels/smartstore-update-identity";
import {
  prepareSmartstoreContentRepairBody,
  smartstoreContentRepairBinding,
  smartstoreContentRepairBodyHashes,
} from "../../channels/smartstore-content-repair";
import { verifySmartstoreContentRepairPostwrite } from "../../channels/smartstore-content-repair-readback";
import {
  type ExecuteInput,
  listingPublicationReadbackRequested,
  result,
  publicationStateVerificationStep,
  booleanArgument,
  listingUpdateReadbackStep,
  inventoryQuantityVerificationStep,
} from "../execution-shared";
import {
  assertSmartstoreCreateBodyReady,
  smartstoreCreateIdentity,
  smartstoreStrictCreateRequested,
  type SmartstoreCreateIdentity,
} from "../../channels/smartstore-listing-create-contract";

export type SmartstoreOptionStockExpectation = {
  kind: "combination" | "standard";
  id: string;
  quantity: number;
};

export function smartstoreOptionStockExpectations(
  body: Record<string, unknown>,
) {
  const optionInfo = objectValue(body, "optionInfo", false);
  const groups = [
    {
      kind: "combination" as const,
      values: objectArray(optionInfo.optionCombinations),
    },
    {
      kind: "standard" as const,
      values: objectArray(optionInfo.optionStandards),
    },
  ];
  const expectations: SmartstoreOptionStockExpectation[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const option of group.values) {
      const id = String(option.id ?? "").trim();
      const quantity = Number(option.stockQuantity);
      const key = `${group.kind}:${id}`;
      if (
        !id ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        quantity > 99_999_999 ||
        seen.has(key)
      ) {
        return [];
      }
      seen.add(key);
      expectations.push({ kind: group.kind, id, quantity });
    }
  }
  return expectations;
}

export function smartstoreOptionStockReadbackStep(
  remote: RemoteResponse,
  expectations: SmartstoreOptionStockExpectation[],
): ChannelOperationStep {
  const verifiedStep = step("option-stock-readback", remote);
  const originProduct = objectValue(remote.data, "originProduct", false);
  const detailAttribute = objectValue(originProduct, "detailAttribute", false);
  const optionInfo = objectValue(detailAttribute, "optionInfo", false);
  const actualByKey = new Map<string, number>();
  for (const group of [
    {
      kind: "combination" as const,
      values: objectArray(optionInfo.optionCombinations),
    },
    {
      kind: "standard" as const,
      values: objectArray(optionInfo.optionStandards),
    },
  ]) {
    for (const option of group.values) {
      const id = String(option.id ?? "").trim();
      const quantity = Number(option.stockQuantity);
      if (id && Number.isFinite(quantity))
        actualByKey.set(`${group.kind}:${id}`, quantity);
    }
  }
  const mismatches = expectations.filter(
    (expectation) =>
      actualByKey.get(`${expectation.kind}:${expectation.id}`) !==
      expectation.quantity,
  );
  const verified =
    verifiedStep.ok && expectations.length > 0 && mismatches.length === 0;
  return {
    ...verifiedStep,
    ok: verified,
    data: {
      ...verifiedStep.data,
      expectedOptionCount: expectations.length,
      verifiedOptionCount: expectations.length - mismatches.length,
      sellerpilotVerification: verified
        ? "INVENTORY_OPTION_QUANTITIES_VERIFIED"
        : "INVENTORY_OPTION_QUANTITIES_MISMATCH",
      sellerpilotMismatchOptionIds: mismatches
        .slice(0, 40)
        .map((item) => item.id),
    },
  };
}

export function naverOptionalCategoryMetadataStep(
  name: string,
  remote: RemoteResponse,
): ChannelOperationStep {
  const metadataStep = step(name, remote);
  const noMetadataForCategory =
    remote.response.status === 404 &&
    String(remote.data.code ?? "").toUpperCase() === "NOT_FOUND";
  if (!noMetadataForCategory) return metadataStep;
  return {
    ...metadataStep,
    ok: true,
    data: { items: [] },
  };
}

export function smartstoreBodyForPublicationIntent(
  input: ExecuteInput,
  bodyValue: Record<string, unknown>,
) {
  if (!listingPublicationReadbackRequested(input)) return bodyValue;
  const publicationIntent = listingPublicationIntentFromArguments(
    input.arguments,
  );
  if (!publicationIntent) return bodyValue;
  const body = structuredClone(bodyValue);
  const originProduct = objectValue(body, "originProduct", false);
  const smartstoreChannelProduct = objectValue(
    body,
    "smartstoreChannelProduct",
    false,
  );
  originProduct.statusType =
    publicationIntent === "live" ? "SALE" : "SUSPENSION";
  smartstoreChannelProduct.channelProductDisplayStatusType =
    publicationIntent === "live" ? "ON" : "SUSPENSION";
  body.originProduct = originProduct;
  body.smartstoreChannelProduct = smartstoreChannelProduct;
  return body;
}

export function smartstoreSellerSkuFromArguments(
  argumentsValue: Record<string, unknown>,
) {
  const body = objectValue(argumentsValue, "body", false);
  const originProduct = objectValue(body, "originProduct", false);
  const detailAttribute = objectValue(originProduct, "detailAttribute", false);
  const sellerCodeInfo = objectValue(detailAttribute, "sellerCodeInfo", false);
  return textValue(sellerCodeInfo, "sellerManagementCode");
}

export async function smartstoreListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  request: Parameters<typeof readSmartstoreUpdateIdentity>[0]["request"],
  expectedCreateIdentity?: SmartstoreCreateIdentity,
) {
  if (
    !listingPublicationReadbackRequested(input) ||
    steps.some((item) => !item.ok)
  ) {
    return result(input, steps, remoteId);
  }
  const expected = listingPublicationReadbackExpectation(input.arguments);
  if (!expected) {
    return result(
      input,
      [
        ...steps,
        publicationStateVerificationStep(
          input.channel,
          undefined,
          "SMARTSTORE_PUBLICATION_EXPECTATION_MISSING",
        ),
      ],
      remoteId,
    );
  }
  const readback = await readSmartstoreListingPublicationState({
    operation: input.operation as
      | "listing.create"
      | "listing.update"
      | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    expected,
    sellerSku: smartstoreSellerSkuFromArguments(input.arguments) || undefined,
    request,
  });
  const officialOriginProductNo = String(
    readback.state?.resources.originProductNo ?? "",
  ).trim();
  const officialChannelProductNo = String(
    readback.state?.resources.smartstoreChannelProductNo ?? "",
  ).trim();
  const createIdentityMatches = !expectedCreateIdentity
    || (officialOriginProductNo === expectedCreateIdentity.originProductNo
      && officialChannelProductNo === expectedCreateIdentity.channelProductNo);
  const createIdentityStep: ChannelOperationStep[] = expectedCreateIdentity
    ? [{
        name: "product-create-identity-readback",
        ok: createIdentityMatches,
        status: readback.state ? 200 : 422,
        data: {
          sellerpilotVerification:
            createIdentityMatches
              ? "SMARTSTORE_CREATE_IDENTITIES_VERIFIED"
              : "SMARTSTORE_CREATE_IDENTITIES_MISMATCH",
          expectedOriginProductNo: expectedCreateIdentity.originProductNo,
          expectedChannelProductNo: expectedCreateIdentity.channelProductNo,
          officialOriginProductNo: officialOriginProductNo || null,
          officialChannelProductNo: officialChannelProductNo || null,
        },
      }]
    : [];
  return result(
    input,
    [
      ...steps,
      ...(readback.searchProductReadback
        ? [
            step(
              "seller-code-publication-readback",
              readback.searchProductReadback,
            ),
          ]
        : []),
      step(
        "origin-product-publication-readback",
        readback.originProductReadback,
      ),
      ...(readback.channelProductReadback
        ? [
            step(
              "channel-product-publication-readback",
              readback.channelProductReadback,
            ),
          ]
        : []),
      ...createIdentityStep,
      publicationStateVerificationStep(
        input.channel,
        readback.state,
        readback.failureCode,
      ),
    ],
    remoteId,
    undefined,
    createIdentityMatches ? readback.state : undefined,
  );
}

export async function executeSmartstore(input: ExecuteInput) {
  if (input.channel !== "smartstore")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:smartstore");
  const contentRepair = smartstoreContentRepairBinding(input.arguments);
  if (contentRepair && input.operation !== "listing.update") {
    throw new Error("SMARTSTORE_CONTENT_REPAIR_UPDATE_ONLY");
  }
  let prevalidatedCreateBody: Record<string, unknown> | undefined;
  if (input.operation === "listing.create") {
    smartstoreStrictCreateRequested(input.arguments);
    prevalidatedCreateBody = smartstoreBodyForPublicationIntent(
      input,
      objectValue(input.arguments, "body"),
    );
    assertSmartstoreCreateBodyReady(prevalidatedCreateBody);
  }
  const storedAccessToken = readStoredNaverAccessToken(input.payload);
  let token = storedAccessToken
    ? { accessToken: storedAccessToken }
    : await fetchNaverAccessToken(input.payload);
  const request = async (
    requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">,
  ) => {
    let remote = await naverRequest({
      ...requestInput,
      accessToken: token.accessToken,
    });
    if (
      remote.response.status === 401 &&
      textValue(remote.data, "code") === "GW.AUTHN"
    ) {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({
        ...requestInput,
        accessToken: token.accessToken,
      });
    }
    return remote;
  };
  if (input.operation === "categories.list") {
    const categoryId = stringArgument(input.arguments, "categoryId", false);
    const query = new URLSearchParams();
    if (booleanArgument(input.arguments, "leafOnly", true))
      query.set("last", "true");
    const remote = categoryId
      ? await request({
          method: "GET",
          path: `/v1/categories/${pathSegment(categoryId)}`,
        })
      : await request({ method: "GET", path: "/v1/categories", query });
    return result(input, [step("category", remote)], categoryId || undefined);
  }
  if (input.operation === "categories.suggest") {
    const remote = await request({
      method: "GET",
      path: "/v1/categories",
      query: new URLSearchParams({ last: "true" }),
    });
    return result(input, [step("category-tree", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const query = new URLSearchParams({ categoryId });
    const [category, attributes, values, options] = await Promise.all([
      request({
        method: "GET",
        path: `/v1/categories/${pathSegment(categoryId)}`,
      }),
      request({
        method: "GET",
        path: "/v1/product-attributes/attributes",
        query,
      }),
      request({
        method: "GET",
        path: "/v1/product-attributes/attribute-values",
        query,
      }),
      request({ method: "GET", path: "/v1/options/standard-options", query }),
    ]);
    return result(
      input,
      [
        step("category", category),
        naverOptionalCategoryMetadataStep("attributes", attributes),
        naverOptionalCategoryMetadataStep("attribute-values", values),
        naverOptionalCategoryMetadataStep("standard-options", options),
      ],
      categoryId,
    );
  }
  if (input.operation === "categories.validate") {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await request({
      method: "GET",
      path: `/v1/categories/${pathSegment(categoryId)}`,
    });
    return result(input, [step("category-validation", remote)], categoryId);
  }
  if (input.operation === "listing.create") {
    const body = prevalidatedCreateBody ?? smartstoreBodyForPublicationIntent(
      input,
      objectValue(input.arguments, "body"),
    );
    const originProduct = objectValue(body, "originProduct", false);
    const detailAttribute = objectValue(
      originProduct,
      "detailAttribute",
      false,
    );
    const sellerCodeInfo = objectValue(
      detailAttribute,
      "sellerCodeInfo",
      false,
    );
    const sellerManagementCode = textValue(
      sellerCodeInfo,
      "sellerManagementCode",
    );
    if (!sellerManagementCode) throw new Error("NAVER_SELLER_MANAGEMENT_CODE_MISSING");
    const searchRemote = await request({
      method: "POST", path: "/v1/products/search", body: {
        searchKeywordType: "SELLER_CODE", sellerManagementCode,
        page: 1, size: 50, orderType: "NO",
      },
    });
    try {
      assertSmartstoreCreateAbsence(searchRemote);
    } catch (error) {
      const code = error instanceof Error ? error.message : "NAVER_DUPLICATE_PREFLIGHT_FAILED";
      return result(input, [{
        name: "product-duplicate-preflight", ok: false,
        status: searchRemote.response.ok ? 409 : searchRemote.response.status,
        data: { error: code, sellerpilotVerification: "NAVER_PREWRITE_REJECTED" },
      }]);
    }
    const createRemote = await request({
      method: "POST",
      path: "/v2/products",
      body,
    });
    const steps = [step("product-create", createRemote)];
    if (!steps[0].ok) return result(input, steps);
    const createIdentity = smartstoreCreateIdentity(createRemote.data);
    const remoteId = createIdentity?.originProductNo
      ?? (createRemote.data.originProductNo === undefined
        ? undefined
        : String(createRemote.data.originProductNo));
    if (!createIdentity) {
      return result(input, [
        ...steps,
        {
          name: "product-create-identity",
          ok: false,
          status: 422,
          data: {
            sellerpilotVerification: "SMARTSTORE_CREATE_IDENTITIES_MISSING",
          },
        },
      ], remoteId);
    }
    if (!remoteId) return result(input, steps);
    const readbackRemote = await request({
      method: "GET",
      path: `/v2/products/origin-products/${pathSegment(remoteId)}`,
    });
    const readbackStep = step("product-readback", readbackRemote);
    readbackStep.ok =
      readbackStep.ok &&
      Boolean(
        readbackRemote.data.originProduct &&
          typeof readbackRemote.data.originProduct === "object",
      );
    steps.push(readbackStep);
    return smartstoreListingResultWithPublicationReadback(
      input,
      steps,
      remoteId,
      request,
      createIdentity ?? undefined,
    );
  }
  if (input.operation === "listing.update") {
    const remoteId = stringArgument(input.arguments, "originProductNo");
    const originProductNo = pathSegment(remoteId);
    const patchBody = objectValue(input.arguments, "body");
    const requestedOriginProduct = objectValue(
      patchBody,
      "originProduct",
      false,
    );
    const requestedDetailAttribute = objectValue(
      requestedOriginProduct,
      "detailAttribute",
      false,
    );
    const requestedSellerCodeInfo = objectValue(
      requestedDetailAttribute,
      "sellerCodeInfo",
      false,
    );
    const sellerSku =
      contentRepair?.sellerSku ??
      textValue(requestedSellerCodeInfo, "sellerManagementCode");
    let searchPreflightRemote: RemoteResponse | undefined;
    let preflightRemote: RemoteResponse | undefined;
    let channelPreflightRemote: RemoteResponse | undefined;
    const identity = await readSmartstoreUpdateIdentity({
      request: async (requestInput) => {
        const remote = await request(requestInput);
        if (requestInput.path === "/v1/products/search")
          searchPreflightRemote = remote;
        else if (
          requestInput.path === `/v2/products/origin-products/${remoteId}`
        )
          preflightRemote = remote;
        else if (
          requestInput.path.startsWith("/v2/products/channel-products/")
        ) {
          channelPreflightRemote = remote;
        }
        return remote;
      },
      originProductNo: remoteId,
      sellerSku: sellerSku || undefined,
      expectedChannelProductNo: contentRepair?.channelProductNo,
    });
    if (!searchPreflightRemote || !preflightRemote || !channelPreflightRemote) {
      throw new Error("NAVER_UPDATE_IDENTITY_READBACK_INCOMPLETE");
    }
    const preflightStep = step("product-update-preflight", preflightRemote);
    const currentOriginProduct = identity.currentOriginProduct;
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: "SMARTSTORE_EXISTING_PRODUCT_VERIFIED",
      sellerpilotIdentitySource:
        "complete_seller_code_search_and_exact_product_paths",
      sellerpilotOriginProductNo: identity.originProductNo,
      sellerpilotChannelProductNo: identity.channelProductNo,
    };
    const channelPreflightStep = step(
      "channel-product-update-preflight",
      channelPreflightRemote,
    );
    const currentChannelProduct = identity.currentChannelProduct;
    channelPreflightStep.data = {
      ...channelPreflightStep.data,
      sellerpilotVerification: "SMARTSTORE_CHANNEL_PRODUCT_VERIFIED",
    };
    const currentBody = {
      originProduct: currentOriginProduct,
      smartstoreChannelProduct: currentChannelProduct,
    };
    const mergedBody = contentRepair
      ? prepareSmartstoreContentRepairBody({
          argumentsValue: input.arguments,
          currentOriginProduct,
          currentChannelProduct,
          phase: "prepared",
        })
      : smartstoreBodyForPublicationIntent(
          input,
          mergeListingUpdatePatch(currentBody, patchBody) as Record<
            string,
            unknown
          >,
        );
    const remote = await request({
      method: "PUT",
      path: `/v2/products/origin-products/${originProductNo}`,
      body: mergedBody,
    });
    const updateStep = step("product-update", remote);
    if (!updateStep.ok)
      return result(
        input,
        [preflightStep, channelPreflightStep, updateStep],
        remoteId,
      );
    if (contentRepair) {
      let searchPostwriteRemote: RemoteResponse | undefined;
      let originPostwriteRemote: RemoteResponse | undefined;
      let channelPostwriteRemote: RemoteResponse | undefined;
      let verification: ReturnType<
        typeof verifySmartstoreContentRepairPostwrite
      >;
      try {
        const postwriteIdentity = await readSmartstoreUpdateIdentity({
          request: async (requestInput) => {
            const postwriteRemote = await request(requestInput);
            if (requestInput.path === "/v1/products/search")
              searchPostwriteRemote = postwriteRemote;
            else if (
              requestInput.path === `/v2/products/origin-products/${remoteId}`
            ) {
              originPostwriteRemote = postwriteRemote;
            } else if (
              requestInput.path.startsWith("/v2/products/channel-products/")
            ) {
              channelPostwriteRemote = postwriteRemote;
            }
            return postwriteRemote;
          },
          originProductNo: remoteId,
          sellerSku: contentRepair.sellerSku,
          expectedChannelProductNo: contentRepair.channelProductNo,
        });
        if (
          !searchPostwriteRemote ||
          !originPostwriteRemote ||
          !channelPostwriteRemote
        ) {
          throw new Error(
            "NAVER_UPDATE_POSTWRITE_IDENTITY_READBACK_INCOMPLETE",
          );
        }
        verification = verifySmartstoreContentRepairPostwrite({
          expectedBody: mergedBody,
          currentOriginProduct: postwriteIdentity.currentOriginProduct,
          currentChannelProduct: postwriteIdentity.currentChannelProduct,
          expectedProtectedBodySha256: contentRepair.protectedBodySha256,
        });
      } catch (error) {
        const safeCode =
          error instanceof Error &&
          /^NAVER_UPDATE_[A-Z0-9_]+$/u.test(error.message)
            ? error.message
            : "NAVER_UPDATE_POSTWRITE_IDENTITY_UNVERIFIED";
        return result(
          input,
          [
            preflightStep,
            channelPreflightStep,
            updateStep,
            ...(searchPostwriteRemote
              ? [step("seller-code-postwrite-readback", searchPostwriteRemote)]
              : []),
            ...(originPostwriteRemote
              ? [
                  step(
                    "origin-product-postwrite-readback",
                    originPostwriteRemote,
                  ),
                ]
              : []),
            ...(channelPostwriteRemote
              ? [
                  step(
                    "channel-product-postwrite-readback",
                    channelPostwriteRemote,
                  ),
                ]
              : []),
            {
              name: "smartstore-content-repair-postwrite-identity",
              ok: false,
              status: 422,
              data: {
                sellerpilotVerification:
                  "SMARTSTORE_CONTENT_REPAIR_POSTWRITE_IDENTITY_UNVERIFIED",
                sellerpilotFailureCode: safeCode,
              },
            },
          ],
          remoteId,
        );
      }
      const verificationStep: ChannelOperationStep = {
        name: "smartstore-content-repair-postwrite-verification",
        ok: verification.ok,
        status: verification.ok ? 200 : 422,
        data: {
          sellerpilotVerification: verification.ok
            ? "SMARTSTORE_CONTENT_REPAIR_MUTABLE_FIELDS_VERIFIED"
            : "SMARTSTORE_CONTENT_REPAIR_MUTABLE_FIELDS_MISMATCH",
          sellerpilotMismatchPaths: verification.mismatches.slice(0, 40),
        },
      };
      const listingResult = result(
        input,
        [
          preflightStep,
          channelPreflightStep,
          updateStep,
          step("seller-code-postwrite-readback", searchPostwriteRemote),
          step("origin-product-postwrite-readback", originPostwriteRemote),
          step("channel-product-postwrite-readback", channelPostwriteRemote),
          verificationStep,
        ],
        remoteId,
      );
      if (!listingResult.ok) return listingResult;
      const prewriteHashes = smartstoreContentRepairBodyHashes(currentBody);
      return {
        ...listingResult,
        smartstoreContentRepair: {
          contract: "smartstore_existing_content_repair_mutation_v1" as const,
          originProductNo: identity.originProductNo,
          channelProductNo: identity.channelProductNo,
          baselineBodySha256: prewriteHashes.baselineBodySha256,
          prewriteProtectedBodySha256: prewriteHashes.protectedBodySha256,
          prewriteOriginResponseSha256: createHash("sha256")
            .update(externalDetailCanonical(preflightRemote.data))
            .digest("hex"),
          prewriteChannelResponseSha256: createHash("sha256")
            .update(externalDetailCanonical(channelPreflightRemote.data))
            .digest("hex"),
        },
      };
    }
    const readbackRemote = await request({
      method: "GET",
      path: `/v2/products/origin-products/${originProductNo}`,
    });
    const readbackStep = listingUpdateReadbackStep(
      "product-readback",
      readbackRemote,
      input.channel,
      input.arguments,
    );
    const listingResult = await smartstoreListingResultWithPublicationReadback(
      input,
      [preflightStep, channelPreflightStep, updateStep, readbackStep],
      remoteId,
      request,
    );
    return listingResult;
  }
  if (input.operation === "listing.stop") {
    const originProductNo = pathSegment(
      stringArgument(input.arguments, "originProductNo"),
    );
    const remote = await request({
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/change-status`,
      body: {
        ...objectValue(input.arguments, "body", false),
        statusType: "SUSPENSION",
      },
    });
    return smartstoreListingResultWithPublicationReadback(
      input,
      [step("status-stop", remote)],
      decodeURIComponent(originProductNo),
      request,
    );
  }
  if (input.operation === "price.update") {
    const remote = await request({
      method: "PUT",
      path: "/v1/products/origin-products/bulk-update",
      body: objectValue(input.arguments, "body"),
    });
    return result(input, [step("bulk-price", remote)]);
  }
  if (input.operation === "inventory.update") {
    const originProductNo = pathSegment(
      stringArgument(input.arguments, "originProductNo"),
    );
    const quantity = integerArgument(input.arguments, "quantity", {
      min: 0,
      max: 99_999_999,
    });
    if (
      stringArgument(input.arguments, "mode", false) === "origin-product" ||
      !input.arguments.body
    ) {
      const readback = await request({
        method: "GET",
        path: `/v2/products/origin-products/${originProductNo}`,
      });
      const readbackStep = step("inventory-item-readback", readback);
      if (!readbackStep.ok)
        return result(
          input,
          [readbackStep],
          decodeURIComponent(originProductNo),
        );
      const originProduct = objectValue(readback.data, "originProduct", false);
      if (!Object.keys(originProduct).length)
        return result(
          input,
          [{ ...readbackStep, ok: false }],
          decodeURIComponent(originProductNo),
        );
      const body = {
        ...readback.data,
        originProduct: { ...originProduct, stockQuantity: quantity },
      };
      const writeRemote = await request({
        method: "PUT",
        path: `/v2/products/origin-products/${originProductNo}`,
        body,
      });
      const writeStep = step("origin-product-stock", writeRemote);
      if (!writeStep.ok)
        return result(
          input,
          [readbackStep, writeStep],
          decodeURIComponent(originProductNo),
        );
      const verificationRemote = await request({
        method: "GET",
        path: `/v2/products/origin-products/${originProductNo}`,
      });
      const verificationProduct = objectValue(
        verificationRemote.data,
        "originProduct",
        false,
      );
      return result(
        input,
        [
          readbackStep,
          writeStep,
          inventoryQuantityVerificationStep(
            "inventory-readback",
            verificationRemote,
            quantity,
            verificationProduct.stockQuantity,
          ),
        ],
        decodeURIComponent(originProductNo),
      );
    }
    const body = objectValue(input.arguments, "body");
    const expectations = smartstoreOptionStockExpectations(body);
    if (!expectations.length) {
      return result(
        input,
        [
          {
            name: "option-stock-preflight",
            ok: false,
            status: 400,
            data: {
              sellerpilotVerification: "INVENTORY_OPTION_EXPECTATIONS_INVALID",
            },
          },
        ],
        decodeURIComponent(originProductNo),
      );
    }
    const remote = await request({
      method: "PUT",
      path: `/v1/products/origin-products/${originProductNo}/option-stock`,
      body,
    });
    const writeStep = step("option-stock", remote);
    if (!writeStep.ok)
      return result(input, [writeStep], decodeURIComponent(originProductNo));
    const readbackRemote = await request({
      method: "GET",
      path: `/v2/products/origin-products/${originProductNo}`,
    });
    return result(
      input,
      [
        writeStep,
        smartstoreOptionStockReadbackStep(readbackRemote, expectations),
      ],
      decodeURIComponent(originProductNo),
    );
  }

  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
