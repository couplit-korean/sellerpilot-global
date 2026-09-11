import { step, requestIdentifier, type ChannelOperationStep } from "../../channels/operation-step";
import { stringArgument, integerArgument, stringMap } from "../../channels/operation-values";
import { qoo10Request, type RemoteResponse } from "../../channels/protocols";
import { qoo10ProductionPlace, qoo10ResultMessage } from "../../channels/qoo10";
import { normalizeQoo10ListingPublicationReadback, type Qoo10PublicationReadbackVerification, type Qoo10RollbackRecoveryReadbackExpectation } from "../../channels/qoo10-listing-publication";
import { qoo10S1ActivationArgument, qoo10S1ActivationArgumentsValid, qoo10S1ActivationBinding, qoo10ExactSuccessResultCode, verifyQoo10S1ActivationReadback } from "../../channels/qoo10-listing-activation";
import { qoo10DetailImageUrls, qoo10ListingCreateExpectation, runQoo10ListingCreateProviderPreflight, type Qoo10ListingCreateExpectation } from "../../channels/qoo10-listing-create-preflight";

import { marketplaceChannelDetailImageCount } from "../../channels/marketplace-image-contract";
import { qoo10RollbackUpdateRecoveryArgument, qoo10RollbackUpdateRecoveryBinding } from "../../channels/listing-update";
import { listingPublicationIntentFromArguments, listingRemoteStateContractVersion, type VerifiedListingRemoteState } from "../../channels/listing-publication-state";
import { type ExecuteInput, result, operationDelay, type ChannelOperationName, inventoryQuantityVerificationStep, listingUpdateReadbackStep } from "../execution-shared";

export function qoo10DetailHtml(value: unknown, depth = 0): string {
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
    if (
      ["itemdetail", "itemdescription", "description"].includes(
        key.toLowerCase(),
      ) &&
      typeof item === "string"
    ) {
      return item;
    }
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = qoo10DetailHtml(item, depth + 1);
    if (found) return found;
  }
  return "";
}

export function qoo10ImageCount(html: string) {
  return (html.match(/(?:<|&lt;)img\b/gi) ?? []).length;
}

export function qoo10SetNewGoodsMainImageContentId(
  resultObject: unknown,
  remoteId: string,
) {
  if (
    !resultObject ||
    typeof resultObject !== "object" ||
    Array.isArray(resultObject)
  )
    return undefined;
  const record = resultObject as Record<string, unknown>;
  const resultRemoteId =
    typeof record.GdNo === "string" || typeof record.GdNo === "number"
      ? String(record.GdNo).trim()
      : "";
  const rawContentId = record.BIContentsNo;
  const contentId =
    typeof rawContentId === "string" || typeof rawContentId === "number"
      ? String(rawContentId).trim()
      : "";
  return resultRemoteId === remoteId && /^[1-9]\d{5,19}$/u.test(contentId)
    ? contentId
    : undefined;
}

export function qoo10UpdateResponseIdentities(resultObject: unknown) {
  if (
    !resultObject ||
    typeof resultObject !== "object" ||
    Array.isArray(resultObject)
  )
    return [];
  const record = resultObject as Record<string, unknown>;
  return ["GdNo", "ItemCode", "itemCode"].flatMap((alias) => {
    if (!Object.hasOwn(record, alias)) return [];
    const value = record[alias];
    const normalized =
      typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
    return [{ alias, value: normalized }];
  });
}

export function qoo10ExplicitProviderRejection(remote: RemoteResponse) {
  if (!remote.response.ok || !Object.hasOwn(remote.data, "ResultCode"))
    return false;
  const resultCode = remote.data.ResultCode;
  if (resultCode === undefined || resultCode === null) return false;
  const normalized = String(resultCode).trim();
  return Boolean(normalized) && normalized !== "0";
}

export function qoo10UnavailableResponse(message: string): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { ResultMsg: message },
  };
}

export function qoo10S1ActivationResponseStep(remote: RemoteResponse) {
  const ownResultCode = Object.hasOwn(remote.data, "ResultCode");
  const resultCode = ownResultCode ? String(remote.data.ResultCode) : "";
  const accepted = remote.response.ok && ownResultCode && resultCode === "0";
  const explicitRejection =
    remote.response.ok && ownResultCode && /^-?[1-9]\d*$/u.test(resultCode);
  return {
    accepted,
    explicitRejection,
    step: {
      name: "qoo10-s1-activation",
      ok: accepted,
      status: remote.response.status,
      requestId: requestIdentifier(remote.data),
      data: {
        ...remote.data,
        sellerpilotVerification: accepted
          ? "QOO10_S1_ACTIVATION_ACCEPTED"
          : explicitRejection
            ? "QOO10_S1_ACTIVATION_EXPLICITLY_REJECTED"
            : "QOO10_S1_ACTIVATION_OUTCOME_AMBIGUOUS",
        sellerpilotExactResultCodeObserved: ownResultCode ? resultCode : null,
        ...(accepted ? { sellerpilotMutation: "accepted" } : {}),
        ...(explicitRejection ? { sellerpilotNoWriteConfirmed: true } : {}),
        ...(!accepted && !explicitRejection
          ? { sellerpilotReconciliationRequired: true }
          : {}),
      },
    } satisfies ChannelOperationStep,
  };
}

export function qoo10S1ActivationReadbackStep(input: {
  remote: RemoteResponse;
  arguments: Record<string, unknown>;
  expectedStatus: "S1" | "S2";
  outcomeAmbiguous: boolean;
}) {
  const base = step("qoo10-s1-activation-post-readback", input.remote);
  const verification = verifyQoo10S1ActivationReadback({
    arguments: input.arguments,
    resultObject: input.remote.data.ResultObject,
    expectedStatus: input.expectedStatus,
  });
  const exactProviderSuccess =
    input.remote.response.ok && qoo10ExactSuccessResultCode(input.remote.data);
  const ok = exactProviderSuccess && verification.ok && !input.outcomeAmbiguous;
  return {
    step: {
      ...base,
      ok,
      data: {
        ...base.data,
        sellerpilotVerification: ok
          ? input.expectedStatus === "S2"
            ? "QOO10_S1_ACTIVATION_S2_CONTENT_VERIFIED"
            : "QOO10_S1_ACTIVATION_REJECTION_S1_VERIFIED"
          : "QOO10_S1_ACTIVATION_POST_READBACK_UNVERIFIED",
        sellerpilotExpectedProviderStatus: input.expectedStatus,
        sellerpilotActualProviderStatus:
          verification.publication.providerStatus || null,
        sellerpilotExactResultCodeVerified: exactProviderSuccess,
        sellerpilotPublicationChecks: verification.publication.checks,
        sellerpilotPublicationDiagnostics: verification.publication.diagnostics,
        sellerpilotActivationContentChecks: verification.checks,
        ...(!ok ? { sellerpilotReconciliationRequired: true } : {}),
      },
    } satisfies ChannelOperationStep,
    remoteState: ok ? verification.publication.remoteState : undefined,
  };
}

export function qoo10RollbackRecoveryExpectation(
  expectedState: Omit<
    Qoo10RollbackRecoveryReadbackExpectation,
    "detailImageUrls"
  >,
  detailHtml: string,
): Qoo10RollbackRecoveryReadbackExpectation {
  return {
    ...expectedState,
    detailImageUrls: qoo10DetailImageUrls(detailHtml),
  };
}

export function qoo10VerificationStep(
  ok: boolean,
  status: number,
  imageCount: number,
): ChannelOperationStep {
  return {
    name: "detail-image-readback",
    ok,
    status,
    data: {
      ResultCode: ok ? 0 : -9999,
      ResultMsg: ok
        ? "DETAIL_IMAGES_VERIFIED"
        : "QOO10_DETAIL_IMAGE_READBACK_MISSING",
      detailImageCount: imageCount,
    },
  };
}

export function qoo10PublicationExpectation(input: ExecuteInput) {
  if (
    input.arguments.publicationStateContract !==
    listingRemoteStateContractVersion
  )
    return null;
  const expectedLocale =
    typeof input.arguments.publicationExpectedLocale === "string"
      ? input.arguments.publicationExpectedLocale
      : "";
  const expectedFingerprint =
    typeof input.arguments.publicationExpectedFingerprint === "string"
      ? input.arguments.publicationExpectedFingerprint
      : "";
  const expectedImageCount =
    typeof input.arguments.publicationExpectedImageCount === "number"
      ? input.arguments.publicationExpectedImageCount
      : Number.NaN;
  return { expectedLocale, expectedFingerprint, expectedImageCount };
}

export function qoo10PublicationReadbackStep(
  remote: RemoteResponse,
  verification: Qoo10PublicationReadbackVerification,
): ChannelOperationStep {
  const readbackStep = step("GetItemDetailInfo-publication-readback", remote);
  const remoteState = verification.remoteState;
  const verified = readbackStep.ok && Boolean(remoteState);
  const providerResultMessage = qoo10ResultMessage(readbackStep.data);
  return {
    ...readbackStep,
    ok: verified,
    data: {
      ...readbackStep.data,
      ...(!verified
        ? {
          ResultMsg: "QOO10_PUBLICATION_STATE_UNVERIFIED",
          ...(providerResultMessage
            ? { sellerpilotProviderResultMessage: providerResultMessage }
            : {}),
        }
        : {}),
      sellerpilotVerification: verified
        ? "QOO10_PUBLICATION_STATE_VERIFIED"
        : "QOO10_PUBLICATION_STATE_UNVERIFIED",
      providerStatus: verification.providerStatus || null,
      actualImageCount: verification.imageCount,
      sellerpilotPublicationChecks: verification.checks,
      sellerpilotPublicationDiagnostics: verification.diagnostics,
      ...(remoteState
        ? {
          sellerpilotRemoteVisibility: remoteState.visibility,
          sellerpilotProviderStatus: remoteState.providerStatus,
          sellerpilotDetailImageCount: remoteState.imageCount,
        }
        : { sellerpilotReconciliationRequired: true }),
    },
  };
}

export function qoo10RollbackRecoveryReadbackStep(input: {
  phase: "pre_activation" | "post_activation" | "update_rejection_s1";
  remote: RemoteResponse;
  publication: Qoo10PublicationReadbackVerification;
  mutable: ChannelOperationStep;
  expectedDetailImages: number;
}) {
  const publicationStep = qoo10PublicationReadbackStep(
    input.remote,
    input.publication,
  );
  const expectedStatus = input.phase === "post_activation" ? "S2" : "S1";
  const expectedVisibility =
    input.phase === "post_activation" ? "live" : "non_public";
  const statusVerified =
    input.publication.providerStatus.trim().toUpperCase() === expectedStatus &&
    input.publication.remoteState?.visibility === expectedVisibility;
  const exactImagesVerified =
    input.expectedDetailImages === marketplaceChannelDetailImageCount &&
    input.publication.imageCount === marketplaceChannelDetailImageCount;
  const ok =
    publicationStep.ok &&
    input.mutable.ok &&
    statusVerified &&
    exactImagesVerified;
  return {
    ...publicationStep,
    name:
      input.phase === "pre_activation"
        ? "qoo10-rollback-pre-activation-readback"
        : input.phase === "post_activation"
          ? "qoo10-rollback-post-activation-readback"
          : "qoo10-rollback-update-rejection-s1-readback",
    ok,
    data: {
      ...publicationStep.data,
      sellerpilotMutableVerification:
        input.mutable.data.sellerpilotVerification,
      sellerpilotMismatchPaths: input.mutable.data.sellerpilotMismatchPaths,
      sellerpilotExpectedProviderStatus: expectedStatus,
      sellerpilotExactDetailImageCount: marketplaceChannelDetailImageCount,
      sellerpilotVerification: ok
        ? input.phase === "pre_activation"
          ? "QOO10_ROLLBACK_S1_CONTENT_VERIFIED"
          : input.phase === "post_activation"
            ? "QOO10_ROLLBACK_S2_PUBLICATION_VERIFIED"
            : "QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED"
        : input.phase === "pre_activation"
          ? "QOO10_ROLLBACK_S1_CONTENT_UNVERIFIED"
          : input.phase === "post_activation"
            ? "QOO10_ROLLBACK_S2_PUBLICATION_UNVERIFIED"
            : "QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED",
      ...(!ok ? { sellerpilotReconciliationRequired: true } : {}),
    },
  } satisfies ChannelOperationStep;
}

export function qoo10InventoryQuantity(
  value: unknown,
  itemCode: string,
  depth = 0,
): unknown {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const records = value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    );
    const matching = records.find(
      (item) => String(item.ItemCode ?? item.GdNo ?? "") === itemCode,
    );
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
    if (typeof quantity === "string" || typeof quantity === "number")
      return quantity;
  }
  for (const nested of Object.values(recordValue)) {
    const found = qoo10InventoryQuantity(nested, itemCode, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export type Qoo10ItemPriceSnapshot = {
  itemCode: string;
  price: number | null;
  quantity: number | null;
  currency: string | null;
};

export function qoo10Integer(value: unknown, minimum: number) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

export function qoo10RecordValue(
  recordValue: Record<string, unknown>,
  names: readonly string[],
) {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  return Object.entries(recordValue).find(([name]) =>
    normalizedNames.has(name.toLowerCase()),
  )?.[1];
}

export function qoo10ItemPriceSnapshots(
  value: unknown,
  depth = 0,
  snapshots: Qoo10ItemPriceSnapshot[] = [],
) {
  if (depth > 8 || value === null || value === undefined) return snapshots;
  if (Array.isArray(value)) {
    for (const item of value)
      qoo10ItemPriceSnapshots(item, depth + 1, snapshots);
    return snapshots;
  }
  if (typeof value !== "object") return snapshots;
  const recordValue = value as Record<string, unknown>;
  const rawItemCode = qoo10RecordValue(recordValue, ["ItemCode"]);
  if (typeof rawItemCode === "string" || typeof rawItemCode === "number") {
    const itemCode = String(rawItemCode).trim();
    if (itemCode) {
      const rawCurrency = qoo10RecordValue(recordValue, [
        "Currency",
        "CurrencyCode",
        "CurrencyCd",
      ]);
      const currency =
        typeof rawCurrency === "string" &&
          /^[A-Za-z]{3}$/.test(rawCurrency.trim())
          ? rawCurrency.trim().toUpperCase()
          : null;
      snapshots.push({
        itemCode,
        price: qoo10Integer(qoo10RecordValue(recordValue, ["ItemPrice"]), 1),
        quantity: qoo10Integer(qoo10RecordValue(recordValue, ["ItemQty"]), 0),
        currency,
      });
    }
  }
  for (const nested of Object.values(recordValue)) {
    qoo10ItemPriceSnapshots(nested, depth + 1, snapshots);
  }
  return snapshots;
}

export function qoo10SingleItemPriceSnapshot(value: unknown) {
  const snapshots = qoo10ItemPriceSnapshots(value);
  return snapshots.length === 1 ? snapshots[0] : null;
}

export function qoo10PricePrewriteStep(
  remote: RemoteResponse,
  expectedItemCode: string,
  expectedCurrency: string,
) {
  const readbackStep = step("GetItemDetailInfo-before-price", remote);
  const snapshot = qoo10SingleItemPriceSnapshot(remote.data.ResultObject);
  const verified =
    readbackStep.ok &&
    snapshot?.itemCode === expectedItemCode &&
    snapshot.price !== null &&
    snapshot.quantity !== null &&
    snapshot.currency === expectedCurrency;
  return {
    snapshot,
    step: {
      ...readbackStep,
      ok: verified,
      data: {
        ...readbackStep.data,
        expectedItemCode,
        actualItemCode: snapshot?.itemCode ?? null,
        expectedCurrency,
        actualCurrency: snapshot?.currency ?? null,
        currentPrice: snapshot?.price ?? null,
        preservedQuantity: snapshot?.quantity ?? null,
        sellerpilotVerification: verified
          ? "QOO10_PRICE_PREWRITE_SNAPSHOT_VERIFIED"
          : "QOO10_PRICE_PREWRITE_SNAPSHOT_MISMATCH",
      },
    } satisfies ChannelOperationStep,
  };
}

export function qoo10PriceReadbackStep(
  remote: RemoteResponse,
  expected: { itemCode: string; price: number; currency: string },
): ChannelOperationStep {
  const readbackStep = step("GetItemDetailInfo-after-price", remote);
  const snapshot = qoo10SingleItemPriceSnapshot(remote.data.ResultObject);
  const mismatches = [
    ...(snapshot?.itemCode === expected.itemCode ? [] : ["ItemCode"]),
    ...(snapshot?.price === expected.price ? [] : ["ItemPrice"]),
    ...(snapshot?.currency === expected.currency ? [] : ["Currency"]),
  ];
  const verified = readbackStep.ok && mismatches.length === 0;
  return {
    ...readbackStep,
    ok: verified,
    data: {
      ...readbackStep.data,
      expectedItemCode: expected.itemCode,
      actualItemCode: snapshot?.itemCode ?? null,
      expectedPrice: expected.price,
      actualPrice: snapshot?.price ?? null,
      expectedCurrency: expected.currency,
      actualCurrency: snapshot?.currency ?? null,
      sellerpilotMismatchFields: mismatches,
      sellerpilotVerification: verified
        ? "QOO10_PRICE_IDENTITY_CURRENCY_VALUE_VERIFIED"
        : "QOO10_PRICE_IDENTITY_CURRENCY_VALUE_MISMATCH",
      ...(!verified ? { sellerpilotReconciliationRequired: true } : {}),
    },
  };
}

export function qoo10PriceUpdateRequest(
  input: ExecuteInput,
  suppliedParams: Record<string, string>,
) {
  const itemCode =
    suppliedParams.ItemCode ||
    stringArgument(input.arguments, "remoteId", false);
  if (!/^\d{9,10}$/.test(itemCode))
    throw new Error("CHANNEL_ARGUMENT_INVALID:ItemCode");

  const rawPrices = [
    suppliedParams.Price,
    suppliedParams.ItemPrice,
    stringArgument(input.arguments, "price", false),
  ].filter((value) => value !== undefined && value !== "");
  const prices = rawPrices.map((value) => qoo10Integer(value, 1));
  if (
    !prices.length ||
    prices.some((value) => value === null) ||
    new Set(prices).size !== 1
  ) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:Price");
  }
  const price = prices[0]!;

  const currency = (
    stringArgument(input.arguments, "currency", false) ||
    suppliedParams.Currency ||
    suppliedParams.CurrencyCode
  )
    .trim()
    .toUpperCase();
  if (currency !== "JPY") throw new Error("CHANNEL_ARGUMENT_INVALID:currency");
  return { itemCode, price, currency };
}

export async function executeQoo10(input: ExecuteInput) {
  if (input.channel !== "qoo10")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:qoo10");
  const suppliedParams = stringMap(input.arguments, "params");
  if (
    [
      "categories.list",
      "categories.suggest",
      "categories.attributes",
      "categories.validate",
    ].includes(input.operation)
  ) {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "CommonInfoLookup",
      method: "GetCatagoryListAll",
      params: { ...suppliedParams, lang_cd: "JA" },
    });
    const categoryStep = step("GetCatagoryListAll", remote);
    if (
      input.operation === "categories.list" ||
      input.operation === "categories.suggest"
    ) {
      return result(input, [categoryStep]);
    }

    const categoryId = stringArgument(input.arguments, "categoryId");
    const rows = Array.isArray(remote.data.ResultObject)
      ? remote.data.ResultObject.filter(
        (value): value is Record<string, unknown> =>
          Boolean(
            value && typeof value === "object" && !Array.isArray(value),
          ),
      )
      : [];
    const matches = rows.filter(
      (row) => String(row.CATE_S_CD ?? "").trim() === categoryId,
    );
    const exactLeaf =
      matches.length === 1 &&
      [
        "CATE_L_CD",
        "CATE_L_NM",
        "CATE_M_CD",
        "CATE_M_NM",
        "CATE_S_CD",
        "CATE_S_NM",
      ].every((key) => String(matches[0]?.[key] ?? "").trim());
    const verified =
      categoryStep.ok && /^\d{9}$/u.test(categoryId) && exactLeaf;
    return result(
      input,
      [
        {
          ...categoryStep,
          ok: verified,
          data: {
            ...categoryStep.data,
            ResultObject: matches,
            sellerpilotVerification: verified
              ? "QOO10_EXACT_JA_LEAF_CATEGORY_VERIFIED"
              : "QOO10_EXACT_JA_LEAF_CATEGORY_UNVERIFIED",
            categoryId,
            exactLeafMatchCount: matches.length,
          },
        },
      ],
      categoryId,
    );
  }

  const activationMarkerSupplied = Object.hasOwn(
    input.arguments,
    qoo10S1ActivationArgument,
  );
  const activationBinding = qoo10S1ActivationBinding(input.arguments);
  if (
    activationMarkerSupplied !== (input.operation === "listing.activate") ||
    (input.operation === "listing.activate" &&
      (!activationBinding || !qoo10S1ActivationArgumentsValid(input.arguments)))
  ) {
    return result(
      input,
      [
        {
          name: "qoo10-s1-activation-prewrite-fence",
          ok: false,
          status: 422,
          data: {
            ResultCode: -9999,
            ResultMsg: "QOO10_S1_ACTIVATION_CONTEXT_INVALID",
            sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
            sellerpilotNoWriteConfirmed: true,
          },
        },
      ],
      activationBinding?.remoteId ?? suppliedParams.ItemCode,
    );
  }
  if (input.operation === "listing.activate" && activationBinding) {
    // This dedicated recovery operation deliberately starts at the mutation.
    // The server-owned verifier binding proves the preceding S1 readback; a
    // preflight GET here would reopen a race between verification and write.
    let activationRemote: RemoteResponse;
    try {
      activationRemote = await qoo10Request({
        payload: input.payload,
        service: "ItemsBasic",
        method: "EditGoodsStatus",
        params: { ItemCode: activationBinding.remoteId, Status: "2" },
      });
    } catch {
      activationRemote = qoo10UnavailableResponse(
        "QOO10_S1_ACTIVATION_RESPONSE_UNAVAILABLE",
      );
    }
    const activation = qoo10S1ActivationResponseStep(activationRemote);

    // Never repeat EditGoodsStatus automatically. One read-only observation is
    // the only call allowed after the single activation attempt.
    let readbackRemote: RemoteResponse;
    try {
      readbackRemote = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: {
          ItemCode: activationBinding.remoteId,
          SellerCode: activationBinding.expectedSellerCode ?? "",
        },
      });
    } catch {
      readbackRemote = qoo10UnavailableResponse(
        "QOO10_S1_ACTIVATION_POST_READBACK_UNAVAILABLE",
      );
    }
    const postReadback = qoo10S1ActivationReadbackStep({
      remote: readbackRemote,
      arguments: input.arguments,
      expectedStatus: activation.accepted ? "S2" : "S1",
      outcomeAmbiguous: !activation.accepted && !activation.explicitRejection,
    });
    const verifiedTerminalRemoteState =
      (activation.accepted || activation.explicitRejection) &&
        postReadback.step.ok
        ? postReadback.remoteState
        : undefined;
    return result(
      input,
      [activation.step, postReadback.step],
      activationBinding.remoteId,
      undefined,
      verifiedTerminalRemoteState,
    );
  }
  if (
    input.operation === "listing.create" &&
    listingPublicationIntentFromArguments(input.arguments) === "safe_test"
  ) {
    return result(input, [
      {
        name: "safe-test-prewrite-fence",
        ok: false,
        status: 422,
        data: {
          ResultCode: -9999,
          ResultMsg: "QOO10_SAFE_TEST_CREATE_UNSUPPORTED",
          sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
        },
      },
    ]);
  }
  if (input.operation === "listing.stop" && suppliedParams.Status !== "1") {
    return result(
      input,
      [
        {
          name: "stop-status-prewrite-fence",
          ok: false,
          status: 422,
          data: {
            ResultCode: -9002,
            ResultMsg: "QOO10_STOP_REQUIRES_ON_QUEUE_STATUS_1",
            sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
          },
        },
      ],
      suppliedParams.ItemCode,
    );
  }
  const rollbackRecoveryMarkerSupplied = Object.hasOwn(
    input.arguments,
    qoo10RollbackUpdateRecoveryArgument,
  );
  const rollbackRecovery = qoo10RollbackUpdateRecoveryBinding(input.arguments);

  const updateRecovery = rollbackRecovery;
  const rollbackRecoveryReadbackExpectation = updateRecovery
    ? qoo10RollbackRecoveryExpectation(
      updateRecovery.expectedState,
      suppliedParams.ItemDescription ?? "",
    )
    : null;
  if (
    rollbackRecoveryMarkerSupplied &&
    (input.operation !== "listing.update" ||
      !rollbackRecovery ||
      rollbackRecovery.remoteId !== suppliedParams.ItemCode ||
      !["1", "2", "3"].includes(suppliedParams.ProductionPlaceType ?? "") ||
      !(suppliedParams.ProductionPlace ?? "").trim() ||
      Object.hasOwn(suppliedParams, "StandardImage") ||
      qoo10ImageCount(suppliedParams.ItemDescription ?? "") !==
      marketplaceChannelDetailImageCount ||
      rollbackRecoveryReadbackExpectation?.detailImageUrls.length !==
      marketplaceChannelDetailImageCount ||
      input.arguments.publicationStateContract !==
      listingRemoteStateContractVersion ||
      listingPublicationIntentFromArguments(input.arguments) !== "live" ||
      input.arguments.publicationExpectedLocale !== "ja-JP" ||
      typeof input.arguments.publicationExpectedFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(input.arguments.publicationExpectedFingerprint) ||
      input.arguments.publicationExpectedImageCount !==
      marketplaceChannelDetailImageCount)
  ) {
    return result(
      input,
      [
        {
          name: "qoo10-rollback-recovery-prewrite-fence",
          ok: false,
          status: 422,
          data: {
            ResultCode: -9999,
            ResultMsg: "QOO10_ROLLBACK_RECOVERY_CONTEXT_INVALID",
            sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
          },
        },
      ],
      suppliedParams.ItemCode,
    );
  }

  const exactPrewriteSteps: ChannelOperationStep[] = [];


  let strictCreateExpectation: Qoo10ListingCreateExpectation | null = null;
  let sellerAccountIdentityDigest = "";
  let createPreflightSteps: ChannelOperationStep[] = exactPrewriteSteps;
  // Every Qoo10 create is a strict publication write. Do not retain a legacy
  // direct-call lane that can skip account/category/shipping/SellerCode checks:
  // a provider acknowledgement from that lane cannot be safely distinguished
  // from a duplicate or a create issued against the wrong seller account.
  if (input.operation === "listing.create") {
    const localPreflight = qoo10ListingCreateExpectation({
      arguments: input.arguments,
      payload: input.payload,
    });
    if (!localPreflight.ok) {
      return result(input, [
        {
          name: "qoo10-create-contract-preflight",
          ok: false,
          status: 422,
          data: {
            ResultCode: -9999,
            ResultMsg: localPreflight.code,
            sellerpilotVerification: "QOO10_CREATE_CONTRACT_UNVERIFIED",
            sellerpilotMismatchFields: localPreflight.mismatchFields,
          },
        },
      ]);
    }
    strictCreateExpectation = localPreflight.expectation;
    const providerPreflight = await runQoo10ListingCreateProviderPreflight({
      payload: input.payload,
      expectation: strictCreateExpectation,
      request: qoo10Request,
    });
    createPreflightSteps = [
      {
        name: "qoo10-create-contract-preflight",
        ok: true,
        status: 200,
        data: {
          ResultCode: 0,
          ResultMsg: "QOO10_CREATE_CONTRACT_VERIFIED",
          sellerpilotVerification: "QOO10_CREATE_CONTRACT_VERIFIED",
          market: strictCreateExpectation.context.market,
          locale: strictCreateExpectation.context.locale,
          sourceCurrency: strictCreateExpectation.context.sourceCurrency,
          sourcePrice: strictCreateExpectation.context.sourcePrice,
          approvalRevision: strictCreateExpectation.approval.approvalRevision,
          approvalContentSha256:
            strictCreateExpectation.approval.approvalContentSha256,
          approvalPayloadDigest:
            strictCreateExpectation.approval.approvalPayloadDigest,
          fulfillmentEvidenceRevision:
            strictCreateExpectation.approval.fulfillmentEvidenceRevision,
          fulfillmentEvidenceObservedAt:
            strictCreateExpectation.approval.fulfillmentEvidenceObservedAt,
          fulfillmentEvidenceExpiresAt:
            strictCreateExpectation.approval.fulfillmentEvidenceExpiresAt,
          fulfillmentEvidenceDigest:
            strictCreateExpectation.approval.fulfillmentEvidenceDigest,
          dispatchPlaceId:
            strictCreateExpectation.approval.dispatchPlaceId,
          returnPolicyId:
            strictCreateExpectation.approval.returnPolicyId,
          dispatchPlaceDigest:
            strictCreateExpectation.approval.dispatchPlaceDigest,
          returnPolicyDigest:
            strictCreateExpectation.approval.returnPolicyDigest,
          currency: strictCreateExpectation.context.currency,
          retailPrice: strictCreateExpectation.retailPrice,
          price: strictCreateExpectation.price,
          quantity: strictCreateExpectation.quantity,
          categoryCode: strictCreateExpectation.categoryCode,
          shippingNo: strictCreateExpectation.shippingNo,
          representativeImageDigest:
            strictCreateExpectation.standardImageDigest,
          detailImageDigest: strictCreateExpectation.detailImageDigest,
          publicationAssetDigest:
            strictCreateExpectation.publicationAssetDigest,
          detailImageCount: strictCreateExpectation.detailImageUrls.length,
          providerDetailHtmlMaximumBytes: 2_000_000_000,
          sellerpilotTransportMaximumBytes: 120_000,
        },
      },
      ...providerPreflight.steps,
    ];
    if (
      !providerPreflight.ok ||
      !providerPreflight.sellerAccountIdentityDigest
    ) {
      return result(input, createPreflightSteps);
    }
    sellerAccountIdentityDigest = providerPreflight.sellerAccountIdentityDigest;
  }
  const inventoryQuantity =
    input.operation === "inventory.update"
      ? integerArgument(input.arguments, "quantity", {
        min: 0,
        max: 99_999_999,
      })
      : null;
  const params =
    input.operation === "inventory.update"
      ? {
        ...suppliedParams,
        ItemCode:
          suppliedParams.ItemCode ||
          stringArgument(input.arguments, "remoteId", false),
        Qty: String(inventoryQuantity),
      }
      : suppliedParams;
  if (input.operation === "inventory.update") delete params.ItemQty;
  if (params.ProductionPlace)
    params.ProductionPlace = qoo10ProductionPlace(params.ProductionPlace);
  const map: Partial<
    Record<
      ChannelOperationName,
      { service: string; method: string; version?: string }
    >
  > = {
    "listing.create": {
      service: "ItemsBasic",
      method: "SetNewGoods",
      version: "1.1",
    },
    "listing.update": { service: "ItemsBasic", method: "UpdateGoods" },
    "listing.stop": { service: "ItemsBasic", method: "EditGoodsStatus" },
    "price.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
    "inventory.update": { service: "ItemsOrder", method: "SetGoodsPriceQty" },
  };

  if (input.operation === "price.update") {
    const request = qoo10PriceUpdateRequest(input, suppliedParams);
    const beforeRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: request.itemCode, SellerCode: "" },
    });
    const before = qoo10PricePrewriteStep(
      beforeRemote,
      request.itemCode,
      request.currency,
    );
    if (
      !before.step.ok ||
      before.snapshot?.quantity === null ||
      before.snapshot?.quantity === undefined
    ) {
      return result(input, [before.step], request.itemCode);
    }

    // The current QAPI contract names these fields Price and Qty. Preserve the
    // exact pre-write quantity so a price-only action cannot silently reset
    // inventory through SetGoodsPriceQty's documented Qty default.
    const updateRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsOrder",
      method: "SetGoodsPriceQty",
      params: {
        ItemCode: request.itemCode,
        Price: String(request.price),
        Qty: String(before.snapshot.quantity),
      },
    });
    const updateStep = step("SetGoodsPriceQty", updateRemote);
    if (!updateStep.ok)
      return result(input, [before.step, updateStep], request.itemCode);

    // QAPI warns that the public product page can take up to ten minutes to
    // reflect a change. A single bounded serverless request cannot turn a
    // missing immediate readback into success; the release gate remains closed
    // until an explicit-currency terminal readback contract exists.
    const afterRemote = await qoo10Request({
      payload: input.payload,
      service: "ItemsLookup",
      method: "GetItemDetailInfo",
      version: "1.2",
      params: { ItemCode: request.itemCode, SellerCode: "" },
    });
    return result(
      input,
      [before.step, updateStep, qoo10PriceReadbackStep(afterRemote, request)],
      request.itemCode,
    );
  }
  const definition = map[input.operation];
  if (!definition)
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  if (input.operation === "listing.create" && strictCreateExpectation) {
    const finalApproval = qoo10ListingCreateExpectation({
      arguments: input.arguments,
      payload: input.payload,
    });
    const unchanged = finalApproval.ok
      && finalApproval.expectation.approval.approvalPayloadDigest
        === strictCreateExpectation.approval.approvalPayloadDigest;
    createPreflightSteps.push({
      name: "qoo10-create-final-approval-freshness-prewrite",
      ok: unchanged,
      status: unchanged ? 200 : 422,
      data: {
        ResultCode: unchanged ? 0 : -9999,
        ResultMsg: unchanged
          ? "QOO10_CREATE_FINAL_APPROVAL_FRESHNESS_VERIFIED"
          : "QOO10_CREATE_FINAL_APPROVAL_FRESHNESS_UNVERIFIED",
        sellerpilotVerification: unchanged
          ? "QOO10_CREATE_FINAL_APPROVAL_FRESHNESS_VERIFIED"
          : "QOO10_CREATE_FINAL_APPROVAL_FRESHNESS_UNVERIFIED",
        fulfillmentEvidenceExpiresAt:
          strictCreateExpectation.approval.fulfillmentEvidenceExpiresAt,
        ...(!finalApproval.ok
          ? { sellerpilotMismatchFields: finalApproval.mismatchFields }
          : {}),
      },
    });
    if (!unchanged) return result(input, createPreflightSteps);
    strictCreateExpectation = finalApproval.expectation;
    const durableFulfillmentSourceSupplied = Object.hasOwn(
      input.arguments,
      "sellerpilotQoo10CreateFulfillmentDurableSource",
    );
    if (durableFulfillmentSourceSupplied && !input.providerMutationHooks) {
      return result(input, [
        ...createPreflightSteps,
        {
          name: "qoo10-create-fulfillment-mutation-fence",
          ok: false,
          status: 422,
          data: {
            ResultCode: -9999,
            ResultMsg: "QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_REQUIRED",
            sellerpilotVerification: "QOO10_PREWRITE_REJECTED",
            sellerpilotNoWriteConfirmed: true,
          },
        },
      ]);
    }
    if (durableFulfillmentSourceSupplied && input.providerMutationHooks) {
      await input.providerMutationHooks.assertLeaseHealthy();
      await input.providerMutationHooks.begin();
      await input.providerMutationHooks.assertLeaseHealthy();
      createPreflightSteps.push({
      name: "qoo10-create-fulfillment-mutation-fence",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        ResultMsg: "QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_VERIFIED",
        sellerpilotVerification: "QOO10_CREATE_FULFILLMENT_MUTATION_FENCE_VERIFIED",
      },
      });
    }
  }
  const remote = await qoo10Request({
    payload: input.payload,
    ...definition,
    params,
  });
  const createStep = step(definition.method, remote);
  const resultObject = remote.data.ResultObject;
  const responseIdentities = qoo10UpdateResponseIdentities(resultObject);
  const responseRemoteId =
    typeof resultObject === "string" || typeof resultObject === "number"
      ? String(resultObject)
      : resultObject &&
        typeof resultObject === "object" &&
        !Array.isArray(resultObject)
        ? ["GdNo", "ItemCode", "itemCode"]
          .map((key) => (resultObject as Record<string, unknown>)[key])
          .find(
            (value): value is string | number =>
              typeof value === "string" || typeof value === "number",
          )
          ?.toString()
        : undefined;
  const responseIdentityMismatch = Boolean(
    updateRecovery &&
    responseIdentities.length > 0 &&
    (new Set(responseIdentities.map((identity) => identity.value)).size !==
      1 ||
      responseIdentities.some(
        (identity) =>
          !identity.value ||
          identity.value !== updateRecovery.remoteId ||
          identity.value !== params.ItemCode,
      )),
  );
  if (updateRecovery && responseIdentityMismatch) {
    return result(
      input,
      [
        ...createPreflightSteps,
        createStep,
        {
          name: "qoo10-rollback-update-response-identity-mismatch",
          ok: false,
          status: remote.response.status,
          requestId: createStep.requestId,
          data: {
            ...remote.data,
            ResultMsg: "QOO10_ROLLBACK_UPDATE_RESPONSE_IDENTITY_MISMATCH",
            sellerpilotProviderResultMessage:
              qoo10ResultMessage(remote.data) || null,
            sellerpilotVerification:
              "QOO10_ROLLBACK_UPDATE_RESPONSE_IDENTITY_MISMATCH",
            sellerpilotExpectedRemoteId: updateRecovery.remoteId,
            sellerpilotExpectedItemCode: params.ItemCode,
            sellerpilotResponseIdentities: Object.fromEntries(
              responseIdentities.map((identity) => [
                identity.alias,
                identity.value || null,
              ]),
            ),
            sellerpilotReconciliationRequired: true,
          },
        },
      ],
      updateRecovery.remoteId,
    );
  }
  const remoteId =
    updateRecovery?.remoteId ??
    responseRemoteId ??
    (input.operation === "listing.update" || input.operation === "listing.stop"
      ? params.ItemCode
      : undefined);
  if (input.operation === "listing.create" && strictCreateExpectation && createStep.ok) {
    const createResponseIdentities = qoo10UpdateResponseIdentities(resultObject);
    const resultRecord =
      resultObject && typeof resultObject === "object" && !Array.isArray(resultObject)
        ? resultObject as Record<string, unknown>
        : null;
    const responseGdNo = resultRecord &&
      (typeof resultRecord.GdNo === "string" || typeof resultRecord.GdNo === "number")
      ? String(resultRecord.GdNo).trim()
      : "";
    const createResponseIdentityVerified =
      /^\d{9,10}$/u.test(responseGdNo) &&
      responseRemoteId === responseGdNo &&
      createResponseIdentities.length >= 1 &&
      createResponseIdentities.every((identity) => identity.value === responseGdNo);
    if (!createResponseIdentityVerified) {
      return result(
        input,
        [
          ...createPreflightSteps,
          createStep,
          {
            name: "qoo10-create-response-identity",
            ok: false,
            status: remote.response.status,
            requestId: createStep.requestId,
            data: {
              ResultCode: -9999,
              ResultMsg: "QOO10_CREATE_RESPONSE_IDENTITY_UNVERIFIED",
              sellerpilotVerification:
                "QOO10_CREATE_RESPONSE_IDENTITY_UNVERIFIED",
              sellerpilotOfficialIdentityField: "GdNo",
              sellerpilotObservedIdentityAliases:
                createResponseIdentities.map((identity) => identity.alias),
              sellerpilotObservedRemoteIdFormatValid:
                /^\d{9,10}$/u.test(responseGdNo),
              sellerpilotMutation: "accepted",
              sellerpilotReconciliationRequired: true,
              sellerpilotAutomaticRetryAllowed: false,
            },
          },
        ],
        responseRemoteId,
      );
    }
  }
  const expectedRepresentativeImageContentId =
    input.operation === "listing.create" && remoteId
      ? qoo10SetNewGoodsMainImageContentId(resultObject, remoteId)
      : undefined;
  if (input.operation === "inventory.update") {
    const itemCode = params.ItemCode;
    if (!createStep.ok)
      return result(input, [createStep], itemCode || remoteId);
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
      if (lastVerification.ok)
        return result(
          input,
          [createStep, lastVerification],
          itemCode || remoteId,
        );
    }
    return result(input, [createStep, lastVerification!], itemCode || remoteId);
  }
  if (input.operation === "listing.stop") {
    if (!createStep.ok || !remoteId)
      return result(input, [createStep], remoteId);
    const expectation = qoo10PublicationExpectation(input);
    if (!expectation) return result(input, [createStep], remoteId);
    let lastReadbackStep: ChannelOperationStep | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      let readback: RemoteResponse;
      try {
        readback = await qoo10Request({
          payload: input.payload,
          service: "ItemsLookup",
          method: "GetItemDetailInfo",
          version: "1.2",
          params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
        });
      } catch {
        readback = {
          response: new Response(null, { status: 503 }),
          text: "",
          data: {
            ResultCode: -9999,
            ResultMsg: "QOO10_PUBLICATION_READBACK_UNAVAILABLE",
          },
        };
      }
      const verification = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        ...expectation,
      });
      const remoteState = verification.remoteState;
      lastReadbackStep = qoo10PublicationReadbackStep(readback, verification);
      if (lastReadbackStep.ok) {
        return result(
          input,
          [createStep, lastReadbackStep],
          remoteId,
          undefined,
          remoteState,
        );
      }
    }
    return result(input, [createStep, lastReadbackStep!], remoteId);
  }
  const publicationExpectation = qoo10PublicationExpectation(input);
  if (
    updateRecovery &&
    rollbackRecoveryReadbackExpectation &&
    publicationExpectation &&
    qoo10ExplicitProviderRejection(remote)
  ) {
    let rejectionReadbackStep: ChannelOperationStep | null = null;
    let rejectionRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: {
          ItemCode: updateRecovery.remoteId,
          SellerCode: params.SellerCode ?? "",
        },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: "listing.update",
        remoteId: updateRecovery.remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation,
        ...publicationExpectation,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-update-rejection-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      rejectionReadbackStep = qoo10RollbackRecoveryReadbackStep({
        phase: "update_rejection_s1",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages:
          rollbackRecoveryReadbackExpectation.detailImageUrls.length,
      });
      if (rejectionReadbackStep.ok && publication.remoteState) {
        rejectionRemoteState = publication.remoteState;
        break;
      }
    }
    return result(
      input,
      [...createPreflightSteps, createStep, rejectionReadbackStep!],
      updateRecovery.remoteId,
      undefined,
      rejectionRemoteState,
    );
  }
  if (
    (input.operation !== "listing.create" &&
      input.operation !== "listing.update") ||
    !createStep.ok ||
    !remoteId
  ) {
    return result(input, [...createPreflightSteps, createStep], remoteId);
  }

  // SetNewGoods accepts ItemDescription, but Qoo10 exposes a dedicated
  // EditGoodsContents method for the public product-detail surface. Persist the
  // same verified HTML through that method before treating the create as done.
  const detailHtml = params.ItemDescription ?? "";
  const expectedDetailImages = qoo10ImageCount(detailHtml);
  const minimumExpectedDetailImages =
    input.arguments.sellerpilotContentMode === "manual_mvp"
      ? 1
      : marketplaceChannelDetailImageCount;
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
  let readbackAccepted = false;
  let updateReadbackStep: ChannelOperationStep | null = null;
  if (updateRecovery) {
    if (!detailUpdateStep.ok || !publicationExpectation) {
      return result(
        input,
        [...createPreflightSteps, createStep, detailUpdateStep],
        remoteId,
      );
    }
    // Keep the confirmed S1 item non-public while validating the just-written
    // content. Only an exact mutable-field and eight-image S1 readback may
    // cross the separate activation mutation.
    let preActivationStep: ChannelOperationStep | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation!,
        ...publicationExpectation!,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-pre-activation-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      preActivationStep = qoo10RollbackRecoveryReadbackStep({
        phase: "pre_activation",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages,
      });
      if (preActivationStep.ok) {

        break;
      }
    }
    if (!preActivationStep?.ok) {
      return result(
        input,
        [
          ...createPreflightSteps,
          createStep,
          detailUpdateStep,
          preActivationStep!,
        ],
        remoteId,
      );
    }

    // This one exact product remains S1 after the corrected update. A fresh
    // verifier must bind the observed localized copy before root opens the
    // separate, single-use listing.activate permit in the final release.


    const activation = await qoo10Request({
      payload: input.payload,
      service: "ItemsBasic",
      method: "EditGoodsStatus",
      params: { ItemCode: remoteId, Status: "2" },
    });
    const activationStep = step("qoo10-rollback-recovery-activate", activation);
    if (!activationStep.ok) {
      return result(
        input,
        [
          ...createPreflightSteps,
          createStep,
          detailUpdateStep,
          preActivationStep,
          activationStep,
        ],
        remoteId,
      );
    }

    let postActivationStep: ChannelOperationStep | null = null;
    let activatedRemoteState: VerifiedListingRemoteState | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await operationDelay(750 * attempt);
      const readback = await qoo10Request({
        payload: input.payload,
        service: "ItemsLookup",
        method: "GetItemDetailInfo",
        version: "1.2",
        params: { ItemCode: remoteId, SellerCode: params.SellerCode ?? "" },
      });
      const publication = normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        expectedRecovery: rollbackRecoveryReadbackExpectation!,
        ...publicationExpectation!,
      });
      const mutable = listingUpdateReadbackStep(
        "qoo10-rollback-post-activation-mutable-readback",
        readback,
        input.channel,
        input.arguments,
      );
      postActivationStep = qoo10RollbackRecoveryReadbackStep({
        phase: "post_activation",
        remote: readback,
        publication,
        mutable,
        expectedDetailImages,
      });
      if (postActivationStep.ok && publication.remoteState) {
        activatedRemoteState = publication.remoteState;
        break;
      }
    }
    return result(
      input,
      [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
        preActivationStep,
        activationStep,
        postActivationStep!,
      ],
      remoteId,
      undefined,
      activatedRemoteState,
    );
  }
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
    readbackAccepted = readbackStep.ok;
    readbackImageCount = qoo10ImageCount(
      qoo10DetailHtml(readback.data.ResultObject),
    );
    const publicationVerification = publicationExpectation
      ? normalizeQoo10ListingPublicationReadback({
        operation: input.operation,
        remoteId,
        resultObject: readback.data.ResultObject,
        expectedSellerCode: params.SellerCode || undefined,
        ...(strictCreateExpectation
          ? {
            expectedCreate: strictCreateExpectation,
            expectedSellerAccountIdentityDigest:
              sellerAccountIdentityDigest,
            ...(expectedRepresentativeImageContentId
              ? { expectedRepresentativeImageContentId }
              : {}),
          }
          : {}),
        ...publicationExpectation,
      })
      : null;
    const remoteState = publicationVerification?.remoteState;
    const publicationReadbackStep = publicationVerification
      ? qoo10PublicationReadbackStep(readback, publicationVerification)
      : null;
    if (
      readbackStep.ok &&
      expectedDetailImages >= minimumExpectedDetailImages &&
      readbackImageCount >= expectedDetailImages &&
      (!publicationReadbackStep || publicationReadbackStep.ok)
    ) {
      if (input.operation === "listing.update") {
        updateReadbackStep = listingUpdateReadbackStep(
          "detail-image-readback",
          readback,
          input.channel,
          input.arguments,
        );
        updateReadbackStep.ok =
          updateReadbackStep.ok && readbackImageCount >= expectedDetailImages;
        updateReadbackStep.data = {
          ...updateReadbackStep.data,
          detailImageCount: readbackImageCount,
        };
        if (!updateReadbackStep.ok) continue;
        return result(
          input,
          [
            ...createPreflightSteps,
            createStep,
            detailUpdateStep,
            updateReadbackStep,
            ...(publicationReadbackStep ? [publicationReadbackStep] : []),
          ],
          remoteId,
          undefined,
          remoteState,
        );
      }
      return result(
        input,
        [
          ...createPreflightSteps,
          createStep,
          detailUpdateStep,
          qoo10VerificationStep(true, readbackStatus, readbackImageCount),
          ...(publicationReadbackStep ? [publicationReadbackStep] : []),
        ],
        remoteId,
        undefined,
        remoteState,
      );
    }
    if (publicationReadbackStep && !publicationReadbackStep.ok)
      updateReadbackStep = publicationReadbackStep;
  }

  if (input.operation === "listing.update") {
    updateReadbackStep ??= {
      ...qoo10VerificationStep(false, readbackStatus, readbackImageCount),
      data: {
        ...qoo10VerificationStep(false, readbackStatus, readbackImageCount)
          .data,
        sellerpilotVerification: "LISTING_MUTABLE_FIELDS_MISMATCH",
      },
    };
    return result(
      input,
      [
        ...createPreflightSteps,
        createStep,
        detailUpdateStep,
        updateReadbackStep,
      ],
      remoteId,
    );
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
  const detailImagesVerified =
    readbackAccepted &&
    expectedDetailImages >= minimumExpectedDetailImages &&
    readbackImageCount >= expectedDetailImages;
  return result(
    input,
    [
      ...createPreflightSteps,
      createStep,
      detailUpdateStep,
      qoo10VerificationStep(
        detailImagesVerified,
        readbackStatus,
        readbackImageCount,
      ),
      ...(updateReadbackStep ? [updateReadbackStep] : []),
      step("rollback-missing-detail", rollback),
    ],
    remoteId,
  );
}
