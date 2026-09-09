import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
} from "../../channels/operation-values";
import {
  temuExactLong,
  temuRequest,
  type RemoteResponse,
} from "../../channels/protocols";
import { marketplaceChannelDetailImageCount } from "../../channels/marketplace-image-contract";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "../../channels/listing-publication-state";
import {
  normalizeTemuListingPublicationReadback,
  temuActivationBinding,
  temuContainmentDiscoveryBinding,
  temuCreateCorrelationMatches,
  temuExactLongGoodsId,
  temuExactGoodsListArguments,
  temuPublicationExpectedSkus,
} from "../../channels/provider-temu-publication-readback";
import {
  type ExecuteInput,
  result,
  booleanArgument,
  inventoryQuantityVerificationStep,
} from "../execution-shared";
import {
  inspectTemuGeneralCreateBody,
  normalizeTemuCreateProcessingState,
  normalizeTemuCreateReceipt,
  normalizeTemuIdentityRead,
  temuGeneralCreateIdentityQueries,
  type TemuIdentityQuery,
} from "../temu/create-contract";
import {
  readTemuAccountIdentityBinding,
  temuCreateRequiredApiScopes,
  temuSafeTestRequiredApiScopes,
  verifyTemuAccountIdentity,
} from "../temu/account-identity";
export function temuResultObject(data: Record<string, unknown>) {
  const value = data.result;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function temuGoodsMatch(value: unknown, remoteId: string, externalGoodsId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (String(item.goodsId ?? "") === remoteId &&
    [item.outGoodsSn, item.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId));
}
export function temuExternalIdentityConflict(remote: RemoteResponse) {
  const providerText = JSON.stringify(remote.data).toLowerCase();
  return (remote.response.status === 409 ||
    /external.?goods.?id[\s\S]{0,120}(?:already.?exists|duplicate)/u.test(providerText) ||
    /(?:already.?exists|duplicate)[\s\S]{0,120}external.?goods.?id/u.test(providerText));
}
export function temuStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0)
    : [];
}
export async function executeTemu(input: ExecuteInput) {
  if (input.channel !== "temu")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:temu");
  if (input.operation === "listing.publication.verify") {
    const discovery = temuContainmentDiscoveryBinding(input.arguments);
    if (!discovery || input.arguments.sellerpilotReadOnly !== true) {
      return result(input, [
        {
          name: "temu-containment-discovery-fence",
          ok: false,
          status: 422,
          data: {
            sellerpilotVerification:
              "TEMU_CONTAINMENT_DISCOVERY_CONTEXT_INVALID",
            sellerpilotNoWriteConfirmed: true,
          },
        },
      ]);
    }
    const remote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(discovery.externalGoodsId),
    });
    const discoveryStep = step("temu-containment-external-id-discovery", remote);
    const goods = temuResultObject(remote.data).goodsList;
    const matches = Array.isArray(goods)
      ? (goods.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          return false;
        const record = item as Record<string, unknown>;
        return [record.outGoodsSn, record.externalGoodsId].some((candidate) =>
          String(candidate ?? "") === discovery.externalGoodsId);
      }) as Record<string, unknown>[])
      : [];
    const recoveredGoodsId =
      matches.length === 1 ? temuExactLongGoodsId(matches[0]?.goodsId) : null;
    const exactOutcome =
      matches.length === 0 ||
      (matches.length === 1 && Boolean(recoveredGoodsId));
    discoveryStep.ok = discoveryStep.ok && exactOutcome;
    discoveryStep.data = {
      ...discoveryStep.data,
      sellerpilotVerification:
        matches.length === 0
          ? "TEMU_CONTAINMENT_DISCOVERY_NOT_VISIBLE_YET"
          : recoveredGoodsId
            ? "TEMU_CONTAINMENT_DISCOVERY_EXACT_ONE"
            : "TEMU_CONTAINMENT_DISCOVERY_COLLISION_OR_INVALID_ID",
      sellerpilotReadOnly: true,
      sellerpilotExternalGoodsId: discovery.externalGoodsId,
      sellerpilotMatchingGoodsCount: matches.length,
      ...(recoveredGoodsId
        ? { sellerpilotRecoveredGoodsId: recoveredGoodsId }
        : {}),
      ...(!exactOutcome ? { sellerpilotReconciliationRequired: true } : {}),
    };
    return result(input, [discoveryStep], recoveredGoodsId ?? undefined);
  }
  if (input.operation === "categories.list" ||
    input.operation === "categories.suggest" ||
    input.operation === "categories.attributes" ||
    input.operation === "categories.validate") {
    const goodsName =
      stringArgument(input.arguments, "goodsName", false) ||
      stringArgument(input.arguments, "query", false) ||
      stringArgument(input.arguments, "categoryId", false);
    if (!goodsName) throw new Error("CHANNEL_ARGUMENT_REQUIRED:goodsName");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.category.recommend",
      arguments: {
        goodsName,
        ...(stringArgument(input.arguments, "description", false)
          ? {
            description: stringArgument(input.arguments, "description", false),
          }
          : {}),
        ...(stringArgument(input.arguments, "imageUrl", false)
          ? { imageUrl: stringArgument(input.arguments, "imageUrl", false) }
          : {}),
      },
    });
    const categoryId = temuResultObject(remote.data).catId;
    return result(input, [step("category-recommend", remote)], categoryId === undefined ? undefined : String(categoryId));
  }
  if (input.operation === "listing.activate") {
    const activation = temuActivationBinding(input.arguments);
    const body = objectValue(input.arguments, "body", false);
    const goodsBasic = objectValue(body, "goodsBasic", false);
    const expectedRepresentativeImages = temuStringArray(goodsBasic.goodsCarouselImage);
    const expectedDetailImages = temuStringArray(goodsBasic.detailImage);
    const expectedBulletPoints = temuStringArray(goodsBasic.bulletPoints);
    const expectedSkus = temuPublicationExpectedSkus(body);
    const expectedLocale = stringArgument(input.arguments, "publicationExpectedLocale", false);
    const expectedFingerprint = stringArgument(input.arguments, "publicationExpectedFingerprint", false);
    const expectedImageCount = Number(input.arguments.publicationExpectedImageCount);
    const generalCreateInspection = inspectTemuGeneralCreateBody(body);
    const exactInput = Boolean(activation &&
      input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion &&
      listingPublicationIntentFromArguments(input.arguments) === "live" &&
      expectedLocale === "ko-KR" &&
      body.language === "ko" &&
      /^[a-f0-9]{64}$/u.test(expectedFingerprint) &&
      expectedImageCount === marketplaceChannelDetailImageCount &&
      generalCreateInspection.ok &&
      expectedRepresentativeImages.length === 1 &&
      /^https:\/\//u.test(expectedRepresentativeImages[0]) &&
      !expectedDetailImages.includes(expectedRepresentativeImages[0]) &&
      expectedDetailImages.length === marketplaceChannelDetailImageCount &&
      new Set(expectedDetailImages).size ===
      marketplaceChannelDetailImageCount &&
      expectedDetailImages.every((url) => /^https:\/\//u.test(url)) &&
      Boolean(expectedSkus));
    if (!exactInput || !activation) {
      return result(input, [
        {
          name: "temu-activation-prewrite-fence",
          ok: false,
          status: 422,
          data: {
            sellerpilotVerification: "TEMU_ACTIVATION_CONTEXT_INVALID",
            sellerpilotNoWriteConfirmed: true,
          },
        },
      ]);
    }
    const preList = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(activation.externalGoodsId),
    });
    const preStatus = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(activation.exactGoodsId)] },
    });
    const preDetail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: {
        goodsId: temuExactLong(activation.exactGoodsId),
        versionQueryType: 1,
        language: "ko",
      },
    });
    const preStock = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.sku.stock.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId) },
    });
    const prePublication = normalizeTemuListingPublicationReadback({
      operation: "listing.create",
      intent: "safe_test",
      remoteId: activation.goodsId,
      externalGoodsId: activation.externalGoodsId,
      listData: preList.data,
      publishStatusData: preStatus.data,
      detailData: preDetail.data,
      expectedLocale,
      expectedFingerprint,
      expectedRepresentativeImages,
      expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
      expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
      expectedBulletPoints,
      expectedSkus: expectedSkus!,
      stockData: preStock.data,
    });
    const preListStep = step("temu-activation-pre-list", preList);
    const preStatusStep = step("temu-activation-pre-status", preStatus);
    const preDetailStep = step("temu-activation-pre-detail", preDetail);
    const preStockStep = step("temu-activation-pre-stock", preStock);
    const preflightStep: ChannelOperationStep = {
      name: "temu-activation-non-public-preflight",
      ok: Boolean(preListStep.ok &&
        preStatusStep.ok &&
        preDetailStep.ok &&
        preStockStep.ok &&
        prePublication.remoteState &&
        ["non_public", "withdrawn"].includes(prePublication.remoteState.visibility)),
      status: prePublication.remoteState ? 200 : 422,
      data: {
        sellerpilotVerification: prePublication.remoteState
          ? "TEMU_EXACT_NON_PUBLIC_ACTIVATION_SOURCE_VERIFIED"
          : "TEMU_EXACT_NON_PUBLIC_ACTIVATION_SOURCE_UNVERIFIED",
        sellerpilotPublicationChecks: prePublication.checks,
        sellerpilotRemoteVisibility: prePublication.visibility,
      },
    };
    if (!preflightStep.ok)
      return result(input, [preflightStep], activation.goodsId);
    if (!input.providerMutationHooks) {
      return result(input, [
        preflightStep,
        {
          name: "temu-activation-provider-boundary",
          ok: false,
          status: 409,
          data: {
            sellerpilotNoWriteConfirmed: true,
            sellerpilotVerification:
              "TEMU_ACTIVATION_PROVIDER_BOUNDARY_REQUIRED",
          },
        },
      ], activation.goodsId);
    }
    await input.providerMutationHooks.assertLeaseHealthy();
    await input.providerMutationHooks.begin();
    await input.providerMutationHooks.assertLeaseHealthy();
    const activateRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.sale.status.set",
      arguments: {
        goodsId: temuExactLong(activation.exactGoodsId),
        onsale: 1,
        operationType: 1,
      },
    });
    const activateStep = step("goods-activate", activateRemote);
    const postList = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(activation.externalGoodsId),
    });
    const postStatus = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(activation.exactGoodsId)] },
    });
    const postDetail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: {
        goodsId: temuExactLong(activation.exactGoodsId),
        versionQueryType: 1,
        language: "ko",
      },
    });
    const postStock = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.sku.stock.query",
      arguments: { goodsId: temuExactLong(activation.exactGoodsId) },
    });
    const postPublication = normalizeTemuListingPublicationReadback({
      operation: "listing.create",
      intent: "live",
      remoteId: activation.goodsId,
      externalGoodsId: activation.externalGoodsId,
      listData: postList.data,
      publishStatusData: postStatus.data,
      detailData: postDetail.data,
      expectedLocale,
      expectedFingerprint,
      expectedRepresentativeImages,
      expectedDetailImages,
      requestedLanguage: "ko",
      expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
      expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
      expectedBulletPoints,
      expectedSkus: expectedSkus!,
      stockData: postStock.data,
    });
    const postListStep = step("temu-activation-post-list", postList);
    const postStatusStep = step("temu-activation-post-status", postStatus);
    const postDetailStep = step("temu-activation-post-detail", postDetail);
    const postStockStep = step("temu-activation-post-stock", postStock);
    const postStep: ChannelOperationStep = {
      name: "temu-activation-post-readback",
      ok: Boolean(postListStep.ok &&
        postStatusStep.ok &&
        postDetailStep.ok &&
        postStockStep.ok &&
        postPublication.remoteState),
      status: postPublication.remoteState ? 200 : 422,
      data: {
        sellerpilotVerification: postPublication.remoteState
          ? "TEMU_ACTIVATION_LIVE_OR_PENDING_VERIFIED"
          : "TEMU_ACTIVATION_STATE_UNVERIFIED",
        sellerpilotPublicationChecks: postPublication.checks,
        sellerpilotRemoteVisibility: postPublication.visibility,
        sellerpilotProviderStatus: postPublication.providerStatus,
        ...(!postPublication.remoteState
          ? { sellerpilotReconciliationRequired: true }
          : {}),
      },
    };
    return result(input, [preflightStep, activateStep, postStockStep, postStep], activation.goodsId, undefined, postPublication.remoteState);
  }
  if (input.operation === "listing.create") {
    const strictPublication = input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion;
    if (!strictPublication) {
      return result(input, [{
        name: "publication-prewrite",
        ok: false,
        status: 422,
        data: {
          error: "TEMU_CREATE_CONTRACT_REQUIRED",
          sellerpilotNoWriteConfirmed: true,
          sellerpilotVerification: "TEMU_CREATE_CONTRACT_REQUIRED",
        },
      }]);
    }
    const body = objectValue(input.arguments, "body");
    const goodsBasic = objectValue(body, "goodsBasic");
    const externalGoodsId = stringArgument(goodsBasic, "externalGoodsId");
    const publicationIntent = listingPublicationIntentFromArguments(input.arguments);
    const expectedLocale = stringArgument(input.arguments, "publicationExpectedLocale", false);
    const expectedFingerprint = stringArgument(input.arguments, "publicationExpectedFingerprint", false);
    const expectedImageCount = Number(input.arguments.publicationExpectedImageCount);
    const expectedRepresentativeImages = temuStringArray(goodsBasic.goodsCarouselImage);
    const expectedDetailImages = temuStringArray(goodsBasic.detailImage);
    const expectedBulletPoints = temuStringArray(goodsBasic.bulletPoints);
    const expectedSkus = temuPublicationExpectedSkus(body);
    const generalCreateInspection = strictPublication
      ? inspectTemuGeneralCreateBody(body)
      : null;
    if (strictPublication) {
      if (!generalCreateInspection?.ok) {
        return result(input, [{
          name: "publication-prewrite", ok: false, status: 422,
          data: {
            error: "TEMU_PUBLICATION_PREWRITE_INVALID",
            sellerpilotTemuCreateIssues: generalCreateInspection?.issues,
            sellerpilotTemuSkuChecks: generalCreateInspection?.skuChecks,
            sellerpilotNoWriteConfirmed: true,
            sellerpilotVerification: "TEMU_PUBLICATION_PREWRITE_REJECTED"
          }
        }]);
      }
      const providerLanguage = String(body.language ?? goodsBasic.language ?? "")
        .trim()
        .replaceAll("_", "-")
        .toLowerCase();
      const exactPublicationInput = Boolean(publicationIntent &&
        generalCreateInspection.ok &&
        expectedLocale === "ko-KR" &&
        (providerLanguage === "ko" || providerLanguage === "ko-kr") &&
        /^[a-f0-9]{64}$/u.test(expectedFingerprint) &&
        input.arguments.publicationExpectedImageCount ===
        marketplaceChannelDetailImageCount &&
        expectedRepresentativeImages.length === 1 &&
        /^https:\/\//u.test(expectedRepresentativeImages[0]) &&
        !expectedDetailImages.includes(expectedRepresentativeImages[0]) &&
        expectedDetailImages.length === marketplaceChannelDetailImageCount &&
        new Set(expectedDetailImages).size ===
        marketplaceChannelDetailImageCount &&
        expectedDetailImages.every((url) => /^https:\/\//u.test(url)) &&
        temuCreateCorrelationMatches(input.arguments, externalGoodsId) &&
        Boolean(expectedSkus));
      if (!exactPublicationInput) {
        return result(input, [
          {
            name: "publication-prewrite",
            ok: false,
            status: 422,
            data: {
              error: "TEMU_PUBLICATION_PREWRITE_INVALID",
              sellerpilotVerification: "TEMU_PUBLICATION_PREWRITE_REJECTED",
            },
          },
        ]);
      }
    }
    const steps: ChannelOperationStep[] = [];
    if (!readTemuAccountIdentityBinding(input.payload)) {
      return result(input, [{
        name: "temu-account-identity-prewrite",
        ok: false,
        status: 422,
        data: {
          sellerpilotVerification:
            "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED",
          sellerpilotNoWriteConfirmed: true,
        },
      }]);
    }
    let accountIdentityRemote: RemoteResponse;
    try {
      accountIdentityRemote = await temuRequest({
        payload: input.payload,
        type: "bg.open.accesstoken.info.get",
      });
    } catch {
      return result(input, [{
        name: "temu-account-identity-read",
        ok: false,
        status: 408,
        data: {
          sellerpilotVerification:
            "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED",
          sellerpilotNoWriteConfirmed: true,
        },
      }]);
    }
    const accountIdentityTransportStep = step(
      "temu-account-identity-read",
      accountIdentityRemote,
    );
    const accountIdentityVerification = verifyTemuAccountIdentity({
      payload: input.payload,
      response: accountIdentityRemote.data,
      responseText: accountIdentityRemote.text,
      requiredScopes: publicationIntent === "safe_test"
        ? temuSafeTestRequiredApiScopes
        : temuCreateRequiredApiScopes,
    });
    const accountIdentityStep: ChannelOperationStep = {
      name: "temu-account-identity-read",
      ok: accountIdentityTransportStep.ok && accountIdentityVerification.ok,
      status: accountIdentityTransportStep.ok
        ? accountIdentityVerification.ok ? 200 : 422
        : accountIdentityTransportStep.status,
      requestId: accountIdentityTransportStep.requestId,
      data: {
        sellerpilotVerification: accountIdentityTransportStep.ok
          ? accountIdentityVerification.verification
          : "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED",
        ...(!(accountIdentityTransportStep.ok && accountIdentityVerification.ok)
          ? { sellerpilotNoWriteConfirmed: true }
          : {}),
        ...(accountIdentityVerification.identity ? {
          sellerpilotTemuAccountSubject:
            accountIdentityVerification.identity.subject,
          sellerpilotTemuTargetId:
            accountIdentityVerification.identity.mallId,
          sellerpilotTemuRegionId:
            accountIdentityVerification.identity.regionId,
          sellerpilotTemuEndpointHost:
            accountIdentityVerification.identity.endpointHost,
          sellerpilotTemuMallType:
            accountIdentityVerification.identity.mallType,
          sellerpilotTemuScopeCount:
            accountIdentityVerification.identity.apiScopes.length,
        } : {}),
        ...(accountIdentityVerification.missingScopes ? {
          sellerpilotTemuMissingScopes:
            accountIdentityVerification.missingScopes,
        } : {}),
      },
    };
    steps.push(accountIdentityStep);
    if (!accountIdentityStep.ok) return result(input, steps);
    const identityQueries: TemuIdentityQuery[] = strictPublication
      ? temuGeneralCreateIdentityQueries(body)
      : [{
          method: "temu.local.goods.list.retrieve",
          arguments: temuExactGoodsListArguments(externalGoodsId),
        }];
    const identityReads: Array<ReturnType<typeof normalizeTemuIdentityRead>> = [];
    const identityRemoteSteps: ChannelOperationStep[] = [];
    let preflightRemote: RemoteResponse | null = null;
    for (const query of identityQueries) {
      const remote = await temuRequest({
        payload: input.payload,
        type: query.method,
        arguments: query.arguments,
      });
      preflightRemote ??= remote;
      identityRemoteSteps.push(step(
        query.arguments.outGoodsSnList
          ? "goods-create-external-goods-id-preflight"
          : "goods-create-external-sku-id-preflight",
        remote,
      ));
      if (strictPublication) {
        identityReads.push(normalizeTemuIdentityRead({ query, response: remote.data }));
      }
    }
    const preflightStep = step(
      strictPublication
        ? "goods-create-external-identity-preflight"
        : "goods-create-external-id-preflight",
      preflightRemote!,
    );
    const legacyGoods = strictPublication ? null : temuResultObject(preflightRemote!.data).goodsList;
    const legacyGoodsList = Array.isArray(legacyGoods) ? legacyGoods : null;
    const preflightListVerified = strictPublication
      ? identityReads.length === identityQueries.length && identityReads.every((read) => read.complete)
      : Boolean(legacyGoodsList);
    const preflightEmpty = strictPublication
      ? preflightListVerified && identityReads.every((read) => read.empty)
      : preflightListVerified && legacyGoodsList!.length === 0;
    const observedGoodsCount = strictPublication
      ? identityReads.reduce((sum, read) => sum + (read.observedGoodsCount ?? 0), 0)
      : preflightListVerified ? legacyGoodsList!.length : undefined;
    preflightStep.ok = identityRemoteSteps.every((candidate) => candidate.ok) && preflightEmpty;
    preflightStep.data = {
      ...preflightStep.data,
      ...(preflightListVerified && !preflightEmpty
        ? { sellerpilotReconciliationRequired: true }
        : {}),
      observedGoodsCount,
      duplicateQueryCount: identityQueries.length,
      ...(strictPublication ? { sellerpilotTemuIdentityReads: identityReads } : {}),
      sellerpilotVerification: preflightEmpty
        ? strictPublication
          ? "TEMU_EXTERNAL_GOODS_AND_SKU_IDS_AVAILABLE"
          : "TEMU_EXTERNAL_ID_AVAILABLE"
        : preflightListVerified
          ? strictPublication
            ? "TEMU_EXTERNAL_GOODS_OR_SKU_ID_ALREADY_EXISTS"
            : "TEMU_EXTERNAL_ID_ALREADY_EXISTS"
          : strictPublication
            ? "TEMU_EXTERNAL_ID_PREFLIGHT_INCOMPLETE"
            : "TEMU_EXTERNAL_ID_PREFLIGHT_UNVERIFIED",
    };
    steps.push(preflightStep);
    if (!preflightStep.ok) return result(input, steps);
    let createRemote: RemoteResponse | null = null;
    let createTransportUncertain = false;
    try {
      createRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.v3.add",
        arguments: body,
      });
    } catch {
      // A network timeout after the provider accepted the create is not proof
      // that no product exists. Reconcile by the immutable externalGoodsId and
      // never issue a second create from this execution.
      createTransportUncertain = true;
    }
    const created = createRemote ? temuResultObject(createRemote.data) : {};
    const createReceipt = strictPublication && createRemote
      ? normalizeTemuCreateReceipt({ body, response: createRemote.data })
      : null;
    let remoteId = createReceipt?.goodsId
      ?? (strictPublication ? "" : temuExactLongGoodsId(created.goodsId) ?? "");
    const createStep = createRemote ? step("goods-v3-add", createRemote) : null;
    const providerCreateAccepted = createStep?.ok === true;
    if (createStep?.ok && remoteId && (!strictPublication || createReceipt)) {
      if (createReceipt) {
        createStep.data = {
          ...createStep.data,
          sellerpilotTemuCreateReceipt: createReceipt,
          sellerpilotPublicationConfirmed: false,
          sellerpilotInternalCompletionEligible: false,
          sellerpilotVerification: "TEMU_CREATE_RECEIPT_IDENTITY_ONLY",
        };
      }
      steps.push(createStep);
    }
    else {
      if (createStep) {
        if (strictPublication && providerCreateAccepted && !createReceipt) {
          createStep.ok = false;
          createStep.status = 422;
          createStep.data = {
            ...createStep.data,
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "TEMU_CREATE_RECEIPT_IDENTITY_UNVERIFIED",
          };
        }
        if (
          !createStep.ok &&
          createRemote &&
          temuExternalIdentityConflict(createRemote)
        ) {
          createStep.data = {
            ...createStep.data,
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification:
              "TEMU_EXTERNAL_ID_COLLISION_MANUAL_RECONCILIATION",
          };
        }
        steps.push(createStep);
      }
      // A definite provider rejection must never be converted into ownership of
      // a pre-existing product with the same external ID. In particular, a
      // duplicate response is a manual reconciliation case, not permission to
      // look up and off-shelf someone else's existing listing.
      const recoveryAllowed =
        preflightEmpty &&
        temuCreateCorrelationMatches(input.arguments, externalGoodsId) &&
        (createTransportUncertain || providerCreateAccepted);
      if (!recoveryAllowed) {
        if (createTransportUncertain) {
          steps.push({
            name: "goods-v3-add",
            ok: false,
            status: 408,
            data: {
              sellerpilotReconciliationRequired: true,
              sellerpilotVerification:
                "TEMU_CREATE_TRANSPORT_UNCERTAIN_WITHOUT_LINEAGE",
            },
          });
        }
        return result(input, steps);
      }
      // Preserve a provider-accepted create marker even if the response omitted
      // goodsId. If lookup recovery also misses, the gateway must quarantine
      // this create instead of treating it as safely retryable.
      // A successful Temu create can outlive a gateway timeout. Retrying the same
      // external ID would otherwise fail as a duplicate, so recover the existing
      // product and continue the same status/image verification path.
      const reconcileRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: temuExactGoodsListArguments(externalGoodsId),
      });
      const reconcileIdentityRead = strictPublication
        ? normalizeTemuIdentityRead({
            query: identityQueries[0],
            response: reconcileRemote.data,
          })
        : null;
      const reconcileGoods = temuResultObject(reconcileRemote.data).goodsList;
      const matchingGoods = Array.isArray(reconcileGoods)
        ? (reconcileGoods.filter((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item))
            return false;
          const record = item as Record<string, unknown>;
          return [record.outGoodsSn, record.externalGoodsId].some((candidate) => String(candidate ?? "") === externalGoodsId);
        }) as Record<string, unknown>[])
        : [];
      const existing =
        matchingGoods.length === 1 ? matchingGoods[0] : undefined;
      remoteId = temuExactLongGoodsId(existing?.goodsId) ?? "";
      const reconcileStep = step("goods-reconcile", reconcileRemote);
      reconcileStep.ok =
        reconcileStep.ok &&
        (!strictPublication || reconcileIdentityRead?.complete === true) &&
        matchingGoods.length === 1 && Boolean(remoteId);
      reconcileStep.data = {
        ...reconcileStep.data,
        recoveredGoodsId: remoteId || undefined,
        matchingGoodsCount: matchingGoods.length,
        createStatus: createRemote?.response.status,
        createTransportUncertain,
        ...(reconcileIdentityRead
          ? { sellerpilotTemuIdentityRead: reconcileIdentityRead }
          : {}),
        ...(!remoteId || matchingGoods.length !== 1
          ? { sellerpilotReconciliationRequired: true }
          : {}),
        sellerpilotVerification: remoteId
          ? "EXISTING_GOODS_RECOVERED"
          : "TEMU_GOODS_RECONCILE_MISSING",
      };
      steps.push(reconcileStep);
      if (!reconcileStep.ok || !remoteId)
        return result(input, steps, remoteId || undefined);
    }
    if (!remoteId) {
      steps.push({
        name: "goods-id-exact-long-verification",
        ok: false,
        status: 422,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_GOODS_ID_NOT_EXACT_LONG",
        },
      });
      return result(input, steps);
    }
    // safe_test is a containment operation. As soon as the immutable provider
    // identity is known, request off-shelf before any fallible list/status/detail
    // readback. A later eventual-consistency miss therefore cannot leave a
    // provider-accepted create untreated or be reported as successful.
    if (strictPublication && publicationIntent === "safe_test") {
      let offShelfRemote: RemoteResponse;
      try {
        offShelfRemote = await temuRequest({
          payload: input.payload,
          type: "bg.local.goods.sale.status.set",
          arguments: {
            goodsId: temuExactLong(remoteId),
            onsale: 0,
            operationType: 1,
          },
        });
      } catch {
        steps.push({
          name: "goods-safe-test-off-shelf",
          ok: false,
          status: 408,
          data: {
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification:
              "TEMU_SAFE_TEST_OFF_SHELF_TRANSPORT_UNCERTAIN",
            sellerpilotKnownGoodsId: remoteId,
            sellerpilotKnownExternalGoodsId: externalGoodsId,
          },
        });
        return result(input, steps, remoteId);
      }
      const offShelfStep = step("goods-safe-test-off-shelf", offShelfRemote);
      steps.push(offShelfStep);
      if (!offShelfStep.ok) return result(input, steps, remoteId);
    }
    let readbackRemote: RemoteResponse;
    try {
      readbackRemote = await temuRequest({
        payload: input.payload,
        type: "temu.local.goods.list.retrieve",
        arguments: temuExactGoodsListArguments(externalGoodsId),
      });
    } catch {
      steps.push({
        name: "goods-readback",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification: "TEMU_POST_CREATE_LIST_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    const readbackStep = step(strictPublication && publicationIntent === "safe_test"
      ? "goods-safe-test-off-shelf-readback"
      : "goods-readback", readbackRemote);
    const goodsList = temuResultObject(readbackRemote.data).goodsList;
    const matched =
      Array.isArray(goodsList) &&
      goodsList.some((item) => temuGoodsMatch(item, remoteId, externalGoodsId));
    const processingState = strictPublication
      ? normalizeTemuCreateProcessingState({
          listResponse: readbackRemote.data,
          goodsId: remoteId,
          externalGoodsId,
        })
      : null;
    const terminalBeforeReview = processingState?.providerStatus === "DRAFT"
      || processingState?.providerStatus === "DELETED";
    readbackStep.ok = readbackStep.ok
      && matched
      && (!strictPublication || Boolean(processingState))
      && !terminalBeforeReview;
    readbackStep.data = {
      ...readbackStep.data,
      ...(processingState
        ? { sellerpilotTemuCreateProcessingState: processingState }
        : {}),
      sellerpilotVerification: !matched
        ? "TEMU_EXTERNAL_ID_READBACK_MISSING"
        : strictPublication && !processingState
          ? "TEMU_OFFICIAL_PROCESSING_STATE_UNVERIFIED"
          : processingState?.providerStatus === "DRAFT"
            ? "TEMU_DRAFT_NOT_SUBMITTED"
            : processingState?.providerStatus === "DELETED"
              ? "TEMU_CREATED_GOODS_DELETED"
              : "EXTERNAL_ID_AND_PROCESSING_STATE_VERIFIED",
    };
    steps.push(readbackStep);
    if (!readbackStep.ok) return result(input, steps, remoteId);
    const finalListReadbackRemote = readbackRemote;
    let publishStatusRemote: RemoteResponse;
    try {
      publishStatusRemote = await temuRequest({
        payload: input.payload,
        type: "bg.local.goods.publish.status.get",
        arguments: { goodsIdList: [temuExactLong(remoteId)] },
      });
    } catch {
      steps.push({
        name: "goods-publish-status",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification:
            "TEMU_POST_CREATE_STATUS_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    const publishStatusStep = step("goods-publish-status", publishStatusRemote);
    const publishStatuses = temuResultObject(publishStatusRemote.data).goodsPublishStatusList;
    const publishStatus = Array.isArray(publishStatuses)
      ? (publishStatuses.find((item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        String((item as Record<string, unknown>).goodsId ?? "") ===
        remoteId) as Record<string, unknown> | undefined)
      : undefined;
    publishStatusStep.ok = publishStatusStep.ok && Boolean(publishStatus);
    publishStatusStep.data = {
      ...publishStatusStep.data,
      remoteGoodsStatus: publishStatus?.status,
      remoteGoodsSubStatus: publishStatus?.subStatus,
      sellerpilotVerification: publishStatus
        ? "PUBLISH_STATUS_VERIFIED"
        : "TEMU_PUBLISH_STATUS_MISSING",
    };
    steps.push(publishStatusStep);
    if (!publishStatusStep.ok) return result(input, steps, remoteId);
    let detailRemote: RemoteResponse;
    try {
      detailRemote = await temuRequest({
        payload: input.payload,
        type: "bg.local.goods.detail.query",
        arguments: {
          goodsId: temuExactLong(remoteId),
          versionQueryType: 1,
          language: "ko",
        },
      });
    } catch {
      steps.push({
        name: "goods-detail-image-readback",
        ok: false,
        status: 408,
        data: {
          sellerpilotReconciliationRequired: true,
          sellerpilotVerification:
            "TEMU_POST_CREATE_DETAIL_TRANSPORT_UNCERTAIN",
          sellerpilotKnownGoodsId: remoteId,
          sellerpilotKnownExternalGoodsId: externalGoodsId,
        },
      });
      return result(input, steps, remoteId);
    }
    let stockRemote: RemoteResponse | null = null;
    if (strictPublication) {
      try {
        stockRemote = await temuRequest({
          payload: input.payload,
          type: "temu.local.goods.sku.stock.query",
          arguments: { goodsId: temuExactLong(remoteId) },
        });
      } catch {
        steps.push({
          name: "goods-sku-stock-readback",
          ok: false,
          status: 408,
          data: {
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification:
              "TEMU_POST_CREATE_STOCK_TRANSPORT_UNCERTAIN",
            sellerpilotKnownGoodsId: remoteId,
            sellerpilotKnownExternalGoodsId: externalGoodsId,
          },
        });
        return result(input, steps, remoteId);
      }
    }
    const detailStep = step("goods-detail-image-readback", detailRemote);
    const detail = temuResultObject(detailRemote.data);
    const gallery = objectValue(detail, "goodsGallery", false);
    const expectedCarouselImageCount = temuStringArray(goodsBasic.goodsCarouselImage).length;
    const expectedDetailImageCount = temuStringArray(goodsBasic.detailImage).length;
    const actualCarouselImageCount = temuStringArray(gallery.goodsCarouselImage).length;
    const actualDetailImageCount = temuStringArray(gallery.detailImage).length;
    const detailMatches = String(detail.goodsId ?? "") === remoteId;
    const imagesMatch = strictPublication
      ? expectedImageCount === marketplaceChannelDetailImageCount &&
      expectedRepresentativeImages.length === 1 &&
      actualCarouselImageCount === 1 &&
      temuStringArray(gallery.goodsCarouselImage)[0] ===
      expectedRepresentativeImages[0] &&
      expectedDetailImageCount === marketplaceChannelDetailImageCount &&
      actualDetailImageCount === marketplaceChannelDetailImageCount &&
      temuStringArray(gallery.detailImage).every((url, index) => url === expectedDetailImages[index])
      : actualCarouselImageCount >= expectedCarouselImageCount &&
      actualDetailImageCount >= expectedDetailImageCount;
    const publication = strictPublication
      ? normalizeTemuListingPublicationReadback({
        operation: "listing.create",
        intent: publicationIntent,
        remoteId,
        externalGoodsId,
        listData: finalListReadbackRemote.data,
        publishStatusData: publishStatusRemote.data,
        detailData: detailRemote.data,
        expectedLocale,
        expectedFingerprint,
        expectedRepresentativeImages,
        expectedDetailImages,
        requestedLanguage: "ko",
        expectedGoodsName: stringArgument(goodsBasic, "goodsName", false),
        expectedGoodsDesc: stringArgument(goodsBasic, "goodsDesc", false),
        expectedBulletPoints,
        expectedSkus: expectedSkus!,
        stockData: stockRemote!.data,
      })
      : null;
    if (stockRemote) {
      const stockStep = step("goods-sku-stock-readback", stockRemote);
      stockStep.ok = stockStep.ok && Boolean(publication?.checks.stockVerified);
      stockStep.data = {
        ...stockStep.data,
        sellerpilotVerification: publication?.checks.stockVerified
          ? "TEMU_SKU_STOCK_VERIFIED"
          : "TEMU_SKU_STOCK_MISMATCH",
      };
      steps.push(stockStep);
    }
    detailStep.ok = detailStep.ok && detailMatches && imagesMatch;
    if (strictPublication)
      detailStep.ok = detailStep.ok && Boolean(publication?.remoteState);
    detailStep.data = {
      ...detailStep.data,
      expectedCarouselImageCount,
      actualCarouselImageCount,
      expectedDetailImageCount,
      actualDetailImageCount,
      ...(publication
        ? {
          sellerpilotPublicationChecks: publication.checks,
          sellerpilotRemoteVisibility: publication.visibility,
          sellerpilotProviderStatus: publication.providerStatus,
        }
        : {}),
      sellerpilotVerification: detailStep.ok
        ? "IMAGES_VERIFIED"
        : publication && !publication.checks.skuIdentityVerified
          ? "TEMU_SKU_IDENTITY_READBACK_MISMATCH"
          : publication && !publication.checks.priceVerified
            ? "TEMU_PRICE_READBACK_MISMATCH"
            : publication && !publication.checks.stockVerified
              ? "TEMU_STOCK_READBACK_MISMATCH"
              : "TEMU_IMAGE_READBACK_MISSING",
    };
    steps.push(detailStep);
    return result(input, steps, remoteId, undefined, publication?.remoteState);
  }
  if (input.operation === "price.update") {
    const goodsId = integerArgument(input.arguments, "goodsId", { min: 1 });
    const goodsIdText = String(goodsId);
    const skuId = integerArgument(input.arguments, "skuId", { min: 1 });
    const skuIdText = String(skuId);
    const price = integerArgument(input.arguments, "price", { min: 1 });
    const currency =
      stringArgument(input.arguments, "currency", false) || "KRW";
    const reason = stringArgument(input.arguments, "reason", false);
    const rejectSkuPricing = booleanArgument(input.arguments, "rejectSkuPricing");
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.priceorder.change.sku.price",
      arguments: {
        goodsId,
        changeSkuPriceDTOList: [
          {
            ...(reason ? { reason } : {}),
            skuChangePriceBaseDTOList: [
              {
                skuId,
                newSupplierPrice: { amount: String(price), currency },
              },
            ],
          },
        ],
        ...(rejectSkuPricing ? { rejectSkuPricing: true } : {}),
      },
    });
    const priceStep = step("goods-price", remote);
    // The price-change response is the provider's per-SKU acceptance report.
    // Temu has no readback for a single pending price order, so verify from
    // successSkuList and fail closed when the SKU is reported as failed. A
    // "has not changed" rejection means the SKU already carries the requested
    // price, which is the idempotent retry outcome and counts as verified.
    const providerResult = temuResultObject(remote.data);
    const successSkus = Array.isArray(providerResult.successSkuList)
      ? providerResult.successSkuList
        .map((item) => String(item ?? ""))
        .filter(Boolean)
      : [];
    const failedSkus = Array.isArray(providerResult.failedSkuList)
      ? providerResult.failedSkuList
        .map((item) => String(item ?? ""))
        .filter(Boolean)
      : [];
    const failureReasons =
      providerResult.failedSkuReasonMap &&
        typeof providerResult.failedSkuReasonMap === "object" &&
        !Array.isArray(providerResult.failedSkuReasonMap)
        ? (providerResult.failedSkuReasonMap as Record<string, unknown>)
        : {};
    const priceAlreadySet =
      failedSkus.includes(skuIdText) &&
      /has not changed/i.test(String(failureReasons[skuIdText] ?? ""));
    const verified =
      priceStep.ok && (successSkus.includes(skuIdText) || priceAlreadySet);
    const rejectionReasons = failedSkus
      .map((sku) => String(failureReasons[sku] ?? "").trim())
      .filter(Boolean)
      .join(" · ");
    priceStep.ok = verified;
    priceStep.data = {
      ...priceStep.data,
      reason: rejectionReasons || undefined,
      requestedSkuId: skuIdText,
      remoteSuccessSkuList: successSkus,
      remoteFailedSkuList: failedSkus,
      sellerpilotVerification: verified
        ? "SKU_PRICE_VERIFIED"
        : "TEMU_SKU_PRICE_REJECTED",
    };
    return result(input, [priceStep], goodsIdText);
  }
  if (input.operation === "listing.stop") {
    const goodsId = stringArgument(input.arguments, "goodsId");
    const strictPublication =
      input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion;
    const externalGoodsId = stringArgument(input.arguments, "externalGoodsId", strictPublication);
    const exactGoodsId = temuExactLongGoodsId(goodsId);
    if (exactGoodsId === null) {
      return result(input, [
        {
          name: "goods-id-exact-long-verification",
          ok: false,
          status: 422,
          data: { sellerpilotVerification: "TEMU_GOODS_ID_NOT_EXACT_LONG" },
        },
      ]);
    }
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.sale.status.set",
      arguments: {
        goodsId: temuExactLong(exactGoodsId),
        onsale: 0,
        operationType: 1,
      },
    });
    const steps: ChannelOperationStep[] = [step("goods-off-shelf", remote)];
    if (!steps[0].ok || !strictPublication)
      return result(input, steps, goodsId);
    const listRemote = await temuRequest({
      payload: input.payload,
      type: "temu.local.goods.list.retrieve",
      arguments: temuExactGoodsListArguments(externalGoodsId),
    });
    const listStep = step("goods-off-shelf-list-readback", listRemote);
    steps.push(listStep);
    const statusRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.publish.status.get",
      arguments: { goodsIdList: [temuExactLong(exactGoodsId)] },
    });
    const statusStep = step("goods-off-shelf-status-readback", statusRemote);
    steps.push(statusStep);
    const detailRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: {
        goodsId: temuExactLong(exactGoodsId),
        versionQueryType: 1,
        language: "ko",
      },
    });
    const publication = normalizeTemuListingPublicationReadback({
      operation: "listing.stop",
      remoteId: goodsId,
      externalGoodsId,
      listData: listRemote.data,
      publishStatusData: statusRemote.data,
      detailData: detailRemote.data,
      expectedLocale: stringArgument(input.arguments, "publicationExpectedLocale", false),
      expectedFingerprint: stringArgument(input.arguments, "publicationExpectedFingerprint", false),
      expectedRepresentativeImages: [],
      expectedDetailImages: [],
      requestedLanguage: "ko",
    });
    const detailStep = step("goods-off-shelf-detail-readback", detailRemote);
    detailStep.ok = detailStep.ok && Boolean(publication.remoteState);
    detailStep.data = {
      ...detailStep.data,
      sellerpilotPublicationChecks: publication.checks,
      sellerpilotRemoteVisibility: publication.visibility,
      sellerpilotProviderStatus: publication.providerStatus,
      sellerpilotVerification: publication.remoteState
        ? "TEMU_OFF_SHELF_REVERIFIED"
        : "TEMU_OFF_SHELF_UNVERIFIED",
    };
    steps.push(detailStep);
    return result(input, steps, goodsId, undefined, publication.remoteState);
  }
  if (input.operation === "inventory.update") {
    const goodsId = stringArgument(input.arguments, "goodsId", false);
    const exactGoodsId = temuExactLongGoodsId(goodsId);
    const quantity = integerArgument(input.arguments, "quantity", {
      min: 0,
      max: 99999999,
    });
    const steps: ChannelOperationStep[] = [];
    if (!exactGoodsId) {
      return result(input, [
        {
          name: "inventory-exact-long-prewrite",
          ok: false,
          status: 422,
          data: {
            sellerpilotNoWriteConfirmed: true,
            sellerpilotVerification: "TEMU_INVENTORY_GOODS_ID_NOT_EXACT_LONG",
          },
        },
      ]);
    }
    const detail = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(exactGoodsId), versionQueryType: 1 },
    });
    const detailStep = step("inventory-item-readback", detail);
    steps.push(detailStep);
    if (!detailStep.ok) return result(input, steps, goodsId);
    const detailData = temuResultObject(detail.data);
    const skus = Array.isArray(detailData.skuList)
      ? detailData.skuList.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    const exactSkuIds = skus.map((sku) =>
      temuExactLongGoodsId(sku.skuId ?? sku.goodsSkuId));
    if (
      exactSkuIds.length === 0 ||
      exactSkuIds.some((skuId) => !skuId) ||
      new Set(exactSkuIds).size !== exactSkuIds.length
    ) {
      steps.push({
        name: "inventory-sku-exact-long-prewrite",
        ok: false,
        status: 422,
        data: {
          sellerpilotNoWriteConfirmed: true,
          sellerpilotVerification: "TEMU_INVENTORY_SKU_ID_NOT_EXACT_LONG",
        },
      });
      return result(input, steps, goodsId);
    }
    const body = {
      goodsId: temuExactLong(exactGoodsId),
      skuStockList: exactSkuIds.map((skuId) => ({
        skuId: temuExactLong(skuId!),
        stockQuantity: quantity,
      })),
    };
    const remote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.stock.edit",
      arguments: body,
    });
    const responseGoodsId = temuResultObject(remote.data).goodsId;
    const writeStep = step("goods-stock", remote);
    steps.push(writeStep);
    if (!writeStep.ok || !goodsId)
      return result(input, steps, responseGoodsId === undefined
        ? goodsId || undefined
        : String(responseGoodsId));
    const verificationRemote = await temuRequest({
      payload: input.payload,
      type: "bg.local.goods.detail.query",
      arguments: { goodsId: temuExactLong(exactGoodsId), versionQueryType: 1 },
    });
    const verificationData = temuResultObject(verificationRemote.data);
    const verificationSkus = Array.isArray(verificationData.skuList)
      ? verificationData.skuList.filter((sku): sku is Record<string, unknown> =>
        Boolean(sku) && typeof sku === "object" && !Array.isArray(sku))
      : [];
    const verificationSkuIds = verificationSkus.map((sku) =>
      temuExactLongGoodsId(sku.skuId ?? sku.goodsSkuId));
    const quantities = verificationSkus.map((sku) =>
      Number(sku.stockQuantity ?? sku.quantity));
    const exactSkuOrderVerified =
      verificationSkuIds.length === exactSkuIds.length &&
      verificationSkuIds.every((skuId, index) => skuId === exactSkuIds[index]);
    const verifiedQuantity =
      exactSkuOrderVerified &&
        quantities.length === exactSkuIds.length &&
        quantities.every((value) => value === quantity)
        ? quantity
        : Number.NaN;
    steps.push(inventoryQuantityVerificationStep("inventory-readback", verificationRemote, quantity, verifiedQuantity));
    return result(input, steps, responseGoodsId === undefined ? goodsId : String(responseGoodsId));
  }
  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
