import { step, type ChannelOperationStep } from "../../channels/operation-step";
import {
  objectValue,
  stringArgument,
  integerArgument,
  objectArray,
  pathSegment,
} from "../../channels/operation-values";
import { coupangRequest, textValue } from "../../channels/protocols";
import {
  assertCoupangExactQaCurrentProduct,
  assertCoupangExactQaInventoryReadback,
  assertCoupangExactQaUpdateReadback,
  coupangListingUpdateWrite,
} from "../../channels/coupang-listing-update";
import {
  assertCoupangExactQaProviderContract,
  coupangExactQaRepresentativeBinding,
  coupangExactQaRecoveryArgument,
  coupangExactQaRecoveryBinding,
  coupangExactQaRecoveryIdentity,
  type CoupangExactQaRecoveryBinding,
} from "../../channels/coupang-exact-qa-recovery";
import {
  coupangExactRepresentativePrewriteSnapshot,
  coupangProviderImageSnapshotSha256,
  verifyCoupangExactRepresentativeReadback,
  type CoupangProviderImageIdentity,
} from "../../channels/coupang-representative-readback";
import { listingPublicationIntentFromArguments } from "../../channels/listing-publication-state";
import {
  coupangStatusFamily,
  listingPublicationReadbackExpectation,
  readCoupangListingPublicationState,
} from "../../channels/listing-publication-readback";
import {
  type ExecuteInput,
  listingPublicationReadbackRequested,
  result,
  publicationStateVerificationStep,
  listingUpdateReadbackStep,
  booleanArgument,
  inventoryQuantityVerificationStep,
} from "../execution-shared";

export async function coupangListingResultWithPublicationReadback(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId: string,
  expectedStopVendorItemIds?: string[],
  exactRecovery?: CoupangExactQaRecoveryBinding | null,
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
          "COUPANG_PUBLICATION_EXPECTATION_MISSING",
        ),
      ],
      remoteId,
    );
  }
  const readback = await readCoupangListingPublicationState({
    operation: input.operation as
      | "listing.create"
      | "listing.update"
      | "listing.stop",
    intent: listingPublicationIntentFromArguments(input.arguments),
    remoteId,
    expected,
    ...(expectedStopVendorItemIds ? { expectedStopVendorItemIds } : {}),
    readSellerProduct: (sellerProductId) =>
      coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${pathSegment(sellerProductId)}`,
      }),
    readVendorItem: (vendorItemId) =>
      coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(vendorItemId)}/inventories`,
      }),
  });
  const readbackSteps: ChannelOperationStep[] = [];
  if (readback.sellerProductReadback) {
    readbackSteps.push(
      step(
        "seller-product-publication-readback",
        readback.sellerProductReadback,
      ),
    );
  }
  readback.vendorItemReadbacks.forEach(({ vendorItemId, remote }, index) => {
    const vendorStep = step(
      `vendor-item-publication-readback:${index + 1}`,
      remote,
    );
    vendorStep.data = {
      ...vendorStep.data,
      sellerpilotVendorItemId: vendorItemId,
    };
    readbackSteps.push(vendorStep);
  });
  if (exactRecovery?.phase === "listing.update") {
    const commerceReadback = readback.vendorItemReadbacks.find(
      ({ vendorItemId }) => vendorItemId === exactRecovery.vendorItemId,
    );
    const commerceStep: ChannelOperationStep = commerceReadback
      ? step("coupang-exact-commerce-readback", commerceReadback.remote)
      : {
          name: "coupang-exact-commerce-readback",
          ok: false,
          status: 422,
          data: {},
        };
    if (commerceStep.ok && commerceReadback) {
      try {
        const sellerProduct = readback.sellerProductReadback
          ? assertCoupangExactQaCurrentProduct(
              objectValue(readback.sellerProductReadback.data, "data", false),
              exactRecovery,
            )
          : null;
        assertCoupangExactQaInventoryReadback(
          objectValue(commerceReadback.remote.data, "data", false),
          exactRecovery,
          {
            requestedVendorItemId: commerceReadback.vendorItemId,
            authoritativeVendorItemId: String(
              sellerProduct?.item.vendorItemId ?? "",
            ),
          },
        );
      } catch {
        commerceStep.ok = false;
      }
    }
    commerceStep.data = {
      ...commerceStep.data,
      sellerpilotVerification: commerceStep.ok
        ? "COUPANG_EXACT_QA_COMMERCE_VERIFIED"
        : "COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH",
    };
    readbackSteps.push(commerceStep);
  }
  readbackSteps.push(
    publicationStateVerificationStep(
      input.channel,
      readback.state,
      readback.failureCode,
    ),
  );
  return result(
    input,
    [...steps, ...readbackSteps],
    remoteId,
    undefined,
    readback.state,
  );
}

export async function executeCoupang(input: ExecuteInput) {
  if (input.channel !== "coupang")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:coupang");
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const sellerProductsPath =
    "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products";
  if (input.operation === "categories.list") {
    // Coupang requires a display category code in the path. Code 0 returns the
    // first depth, and a returned code can be passed back to fetch its children.
    const categoryId = pathSegment(
      stringArgument(input.arguments, "categoryId", false) || "0",
    );
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}`,
    });
    return result(input, [step("categories", remote)]);
  }
  if (input.operation === "categories.suggest") {
    const body = objectValue(input.arguments, "body", false);
    const productName =
      stringArgument(input.arguments, "query", false) ||
      stringArgument(body, "productName");
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: "/v2/providers/openapi/apis/api/v1/categorization/predict",
      body: { ...body, productName },
    });
    return result(input, [step("category-suggestion", remote)]);
  }
  if (input.operation === "categories.attributes") {
    const categoryId = pathSegment(
      stringArgument(input.arguments, "categoryId"),
    );
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/category-related-metas/display-category-codes/${categoryId}`,
    });
    return result(input, [step("category-metadata", remote)], categoryId);
  }
  if (input.operation === "categories.validate") {
    const categoryId = pathSegment(
      stringArgument(input.arguments, "categoryId"),
    );
    const remote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `/v2/providers/seller_api/apis/api/v1/marketplace/meta/display-categories/${categoryId}/status`,
    });
    const statusStep = step("category-status", remote);
    const activeLeaf =
      statusStep.ok &&
      String(remote.data.code ?? "")
        .trim()
        .toUpperCase() === "SUCCESS" &&
      remote.data.data === true;
    statusStep.ok = activeLeaf;
    statusStep.data = {
      ...statusStep.data,
      sellerpilotVerification: activeLeaf
        ? "COUPANG_ACTIVE_LEAF_CATEGORY_VERIFIED"
        : "COUPANG_ACTIVE_LEAF_CATEGORY_UNVERIFIED",
    };
    return result(input, [statusStep], categoryId);
  }
  if (input.operation === "listing.update") {
    const exactRecovery = coupangExactQaRecoveryBinding(
      input.arguments,
      "listing.update",
    );
    if (
      Object.hasOwn(input.arguments, coupangExactQaRecoveryArgument) &&
      !exactRecovery
    ) {
      throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
    }
    if (exactRecovery) {
      assertCoupangExactQaProviderContract(input.arguments, "listing.update", {
        sanitizedUpdate: true,
      });
    }
    const patchBody = objectValue(input.arguments, "body");
    const remoteId = String(patchBody.sellerProductId ?? "").trim();
    if (!remoteId) throw new Error("CHANNEL_ARGUMENT_REQUIRED:sellerProductId");
    const readProduct = () =>
      coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
      });
    const preflightRemote = await readProduct();
    const preflightStep = step("listing-update-preflight", preflightRemote);
    const currentBody = objectValue(preflightRemote.data, "data", false);
    preflightStep.ok =
      preflightStep.ok &&
      String(currentBody.sellerProductId ?? "") === remoteId;
    let exactCurrentProduct: ReturnType<
      typeof assertCoupangExactQaCurrentProduct
    > | null = null;
    if (preflightStep.ok && exactRecovery) {
      try {
        exactCurrentProduct = assertCoupangExactQaCurrentProduct(
          currentBody,
          exactRecovery,
        );
      } catch {
        preflightStep.ok = false;
      }
    }
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok
        ? "COUPANG_EXISTING_LISTING_VERIFIED"
        : "COUPANG_EXISTING_LISTING_MISMATCH",
    };
    if (!preflightStep.ok) return result(input, [preflightStep], remoteId);

    const preflightSteps = [preflightStep];
    if (exactRecovery) {
      const commerceRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${pathSegment(exactRecovery.vendorItemId)}/inventories`,
      });
      const commerceStep = step(
        "listing-update-commerce-preflight",
        commerceRemote,
      );
      if (commerceStep.ok) {
        try {
          assertCoupangExactQaInventoryReadback(
            objectValue(commerceRemote.data, "data", false),
            exactRecovery,
            {
              requestedVendorItemId: exactRecovery.vendorItemId,
              authoritativeVendorItemId: String(
                exactCurrentProduct?.item.vendorItemId ?? "",
              ),
            },
          );
        } catch {
          commerceStep.ok = false;
        }
      }
      commerceStep.data = {
        ...commerceStep.data,
        sellerpilotVerification: commerceStep.ok
          ? "COUPANG_EXACT_QA_COMMERCE_VERIFIED"
          : "COUPANG_EXACT_QA_COMMERCE_READBACK_MISMATCH",
      };
      preflightSteps.push(commerceStep);
      if (!commerceStep.ok) return result(input, preflightSteps, remoteId);
    }

    const coupangUpdate = coupangListingUpdateWrite(currentBody, patchBody);
    const mergedBody = coupangUpdate.body;
    mergedBody.vendorId = vendorId;
    mergedBody.sellerProductId = patchBody.sellerProductId;
    if (listingPublicationReadbackRequested(input)) {
      mergedBody.requested =
        listingPublicationIntentFromArguments(input.arguments) === "live";
    }
    if (exactRecovery) {
      const documentStep: ChannelOperationStep = {
        name: "listing-update-document-preflight",
        ok: true,
        status: 200,
        data: {},
      };
      try {
        assertCoupangExactQaUpdateReadback(mergedBody, exactRecovery);
      } catch {
        documentStep.ok = false;
        documentStep.status = 422;
      }
      documentStep.data = {
        sellerpilotVerification: documentStep.ok
          ? "COUPANG_EXACT_QA_UPDATE_DOCUMENT_VERIFIED"
          : "COUPANG_EXACT_QA_UPDATE_DOCUMENT_MISMATCH",
      };
      preflightSteps.push(documentStep);
      if (!documentStep.ok) return result(input, preflightSteps, remoteId);
    }
    let exactPrewriteImages: CoupangProviderImageIdentity[] | null = null;
    let exactPrewriteSnapshotSha256 = "";
    if (exactRecovery) {
      const hooks = input.providerMutationHooks;
      if (!hooks?.bindCoupangRepresentativePrewrite) {
        throw new Error("COUPANG_EXACT_QA_PROVIDER_BOUNDARY_REQUIRED");
      }
      exactPrewriteImages =
        coupangExactRepresentativePrewriteSnapshot(currentBody);
      await hooks.assertLeaseHealthy();
      const boundPrewrite =
        await hooks.bindCoupangRepresentativePrewrite(exactPrewriteImages);
      exactPrewriteSnapshotSha256 = boundPrewrite.prewriteSnapshotSha256;
      if (
        exactPrewriteSnapshotSha256 !==
        coupangProviderImageSnapshotSha256(exactPrewriteImages)
      ) {
        throw new Error("COUPANG_EXACT_QA_PREWRITE_BINDING_FAILED");
      }
      await hooks.assertLeaseHealthy();
      await hooks.begin();
      await hooks.assertLeaseHealthy();
    }
    const writeRemote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: sellerProductsPath,
      body: mergedBody,
    });
    const writeStep = step("listing.update", writeRemote);
    if (!writeStep.ok)
      return result(input, [...preflightSteps, writeStep], remoteId);
    const readbackRemote = await readProduct();
    const readbackStep = listingUpdateReadbackStep(
      "listing-readback",
      readbackRemote,
      input.channel,
      {
        ...input.arguments,
        body: coupangUpdate.effectivePatch,
      },
    );
    const readbackBody = objectValue(readbackRemote.data, "data", false);
    readbackStep.ok =
      readbackStep.ok &&
      String(readbackBody.sellerProductId ?? "") === remoteId;
    if (readbackStep.ok && exactRecovery) {
      try {
        assertCoupangExactQaUpdateReadback(readbackBody, exactRecovery, {
          providerReadback: true,
        });
        const representative = coupangExactQaRepresentativeBinding(
          input.arguments,
        );
        if (!representative || !exactPrewriteImages) {
          throw new Error("COUPANG_EXACT_QA_REPRESENTATIVE_INVALID");
        }
        const providerIdentity = verifyCoupangExactRepresentativeReadback({
          currentValue: readbackBody,
          prewriteImages: exactPrewriteImages,
          argumentsValue: input.arguments,
        });
        readbackStep.data = {
          ...readbackStep.data,
          sellerpilotCoupangExactRepresentativeReadback: {
            contract: "coupang_exact_qa_representative_readback_v1",
            sellerProductId: exactRecovery.sellerProductId,
            vendorItemId: exactRecovery.vendorItemId,
            role: representative.role,
            sourceBucket: representative.sourceBucket,
            sourceObjectPath: representative.sourceObjectPath,
            sourceSha256: representative.sourceSha256,
            normalizedObjectPath: representative.normalizedObjectPath,
            contentSha256: representative.contentSha256,
            representativeImageCount: 1,
            detailImageCount: 8,
            remoteGalleryVerified: true,
            providerPrewriteSnapshotSha256: exactPrewriteSnapshotSha256,
            ...providerIdentity,
          },
        };
      } catch {
        readbackStep.ok = false;
        readbackStep.data = {
          ...readbackStep.data,
          sellerpilotVerification: "COUPANG_EXACT_QA_UPDATE_READBACK_MISMATCH",
        };
      }
    }
    return coupangListingResultWithPublicationReadback(
      input,
      [...preflightSteps, writeStep, readbackStep],
      remoteId,
      undefined,
      exactRecovery,
    );
  }
  if (input.operation === "listing.create") {
    const body: Record<string, unknown> = {
      ...objectValue(input.arguments, "body"),
      vendorId,
    };
    if (listingPublicationReadbackRequested(input)) {
      body.requested =
        listingPublicationIntentFromArguments(input.arguments) === "live";
    }
    const resumeRemoteId = stringArgument(
      input.arguments,
      "resumeRemoteId",
      false,
    );
    const writeRemote = resumeRemoteId
      ? null
      : await coupangRequest({
          payload: input.payload,
          method: "POST",
          path: sellerProductsPath,
          body,
        });
    const responseId =
      writeRemote &&
      (typeof writeRemote.data.data === "number" ||
        typeof writeRemote.data.data === "string")
        ? String(writeRemote.data.data)
        : undefined;
    const requestedId =
      typeof body.sellerProductId === "number" ||
      typeof body.sellerProductId === "string"
        ? String(body.sellerProductId)
        : undefined;
    const remoteId = resumeRemoteId || responseId || requestedId;
    const writeStep: ChannelOperationStep = writeRemote
      ? step(input.operation, writeRemote)
      : {
          name: "listing.resume",
          ok: Boolean(remoteId),
          status: 200,
          data: { sellerProductId: remoteId, resumed: true },
        };
    if (!writeStep.ok || !remoteId) return result(input, [writeStep], remoteId);
    let readbackRemote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(remoteId)}`,
    });
    const verifyReadback = (name: string) => {
      const readbackStep = step(name, readbackRemote);
      // Approval belongs to the seller-product resource itself. Item-level
      // status fields can remain SAVED after the seller product has already
      // advanced to APPROVAL_REQUESTED, so folding every nested status into
      // one string incorrectly turns an idempotent approval into a failure.
      const sellerProduct = objectValue(readbackRemote.data, "data", false);
      const readbackId = sellerProduct.sellerProductId;
      const requested = sellerProduct.requested;
      const state = coupangStatusFamily(
        sellerProduct.statusName ??
          sellerProduct.approvalStatus ??
          sellerProduct.status ??
          sellerProduct.mdId,
      );
      const identityMatches =
        readbackId !== undefined && String(readbackId) === remoteId;
      const saved =
        state.family === "draft" &&
        [
          sellerProduct.statusName,
          sellerProduct.approvalStatus,
          sellerProduct.status,
          sellerProduct.mdId,
        ].some((value) =>
          /(?:임시저장|TEMP_SAVED|\bSAVED\b)/u.test(
            String(value ?? "").toUpperCase(),
          ),
        );
      const approvalObserved =
        requested === true ||
        state.family === "pending" ||
        state.family === "approved";
      const providerAndIdentityOk = readbackStep.ok && identityMatches;
      readbackStep.ok =
        providerAndIdentityOk && (body.requested !== true || approvalObserved);
      return { readbackStep, providerAndIdentityOk, approvalObserved, saved };
    };
    let initialReadback = verifyReadback("listing-readback");
    if (body.requested !== true || initialReadback.approvalObserved) {
      initialReadback.readbackStep.ok = initialReadback.providerAndIdentityOk;
      return coupangListingResultWithPublicationReadback(
        input,
        [writeStep, initialReadback.readbackStep],
        remoteId,
      );
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
      return coupangListingResultWithPublicationReadback(
        input,
        [writeStep, initialReadback.readbackStep],
        remoteId,
      );
    }
    initialReadback.readbackStep.ok =
      initialReadback.providerAndIdentityOk && initialReadback.saved;
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
        approvalReadback.readbackStep.ok =
          approvalReadback.providerAndIdentityOk;
        break;
      }
    }
    if (approvalReadback.readbackStep.ok) {
      initialReadback.readbackStep.ok = true;
      approvalStep.ok = true;
    }
    return coupangListingResultWithPublicationReadback(
      input,
      [
        writeStep,
        initialReadback.readbackStep,
        approvalStep,
        approvalReadback.readbackStep,
      ],
      remoteId,
    );
  }
  if (input.operation === "listing.stop") {
    const exactRecovery = coupangExactQaRecoveryBinding(
      input.arguments,
      "listing.stop",
    );
    if (
      Object.hasOwn(input.arguments, coupangExactQaRecoveryArgument) &&
      !exactRecovery
    ) {
      throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
    }
    if (exactRecovery) {
      assertCoupangExactQaProviderContract(input.arguments, "listing.stop");
    }
    const sellerProductId = stringArgument(input.arguments, "sellerProductId");
    const suppliedVendorItemId = stringArgument(
      input.arguments,
      "vendorItemId",
      false,
    );
    const preflightRemote = await coupangRequest({
      payload: input.payload,
      method: "GET",
      path: `${sellerProductsPath}/${pathSegment(sellerProductId)}`,
    });
    const preflightStep = step("listing-stop-preflight", preflightRemote);
    const sellerProduct = objectValue(preflightRemote.data, "data", false);
    const items = objectArray(sellerProduct.items);
    const rawVendorItemIds = items.map((item) =>
      String(item.vendorItemId ?? "").trim(),
    );
    const vendorItemIds = [...new Set(rawVendorItemIds.filter(Boolean))];
    preflightStep.ok =
      preflightStep.ok &&
      String(sellerProduct.sellerProductId ?? "").trim() === sellerProductId &&
      items.length > 0 &&
      rawVendorItemIds.every(Boolean) &&
      vendorItemIds.length === items.length &&
      (!suppliedVendorItemId || vendorItemIds.includes(suppliedVendorItemId));
    if (preflightStep.ok && exactRecovery) {
      try {
        assertCoupangExactQaCurrentProduct(sellerProduct, exactRecovery);
        preflightStep.ok =
          sellerProductId === coupangExactQaRecoveryIdentity.sellerProductId &&
          suppliedVendorItemId ===
            coupangExactQaRecoveryIdentity.vendorItemId &&
          stringArgument(input.arguments, "sellerSku") ===
            coupangExactQaRecoveryIdentity.sellerSku &&
          vendorItemIds.length === 1 &&
          vendorItemIds[0] === coupangExactQaRecoveryIdentity.vendorItemId;
      } catch {
        preflightStep.ok = false;
      }
    }
    preflightStep.data = {
      ...preflightStep.data,
      sellerpilotVerification: preflightStep.ok
        ? "COUPANG_ALL_VENDOR_ITEMS_BOUND"
        : "COUPANG_VENDOR_ITEM_SET_UNVERIFIED",
      vendorItemIds,
    };
    if (!preflightStep.ok)
      return result(input, [preflightStep], sellerProductId);
    const steps = [preflightStep];
    for (const [index, vendorItemId] of vendorItemIds.entries()) {
      const remote = await coupangRequest({
        payload: input.payload,
        method: "PUT",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/sales/stop`,
      });
      steps.push(step(`sales-stop:${index + 1}`, remote));
    }
    return coupangListingResultWithPublicationReadback(
      input,
      steps,
      sellerProductId,
      vendorItemIds,
    );
  }
  if (input.operation === "price.update") {
    const vendorItemId = pathSegment(
      stringArgument(input.arguments, "vendorItemId"),
    );
    const price = integerArgument(input.arguments, "price", { min: 10 });
    if (price % 10 !== 0)
      throw new Error("CHANNEL_ARGUMENT_INVALID:price_must_be_10_won_unit");
    const query = new URLSearchParams({
      forceSalePriceUpdate: String(
        booleanArgument(input.arguments, "forceSalePriceUpdate"),
      ),
    });
    const remote = await coupangRequest({
      payload: input.payload,
      method: "PUT",
      path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${vendorItemId}/prices/${price}`,
      query,
    });
    return result(input, [step("price", remote)], vendorItemId);
  }
  if (input.operation === "inventory.update") {
    const quantity = integerArgument(input.arguments, "quantity", {
      min: 0,
      max: 99_999_999,
    });
    const suppliedVendorItemId = stringArgument(
      input.arguments,
      "vendorItemId",
      false,
    );
    let vendorItemIds = suppliedVendorItemId ? [suppliedVendorItemId] : [];
    const steps: ChannelOperationStep[] = [];
    const sellerProductId = stringArgument(
      input.arguments,
      "sellerProductId",
      false,
    );
    if (!vendorItemIds.length && sellerProductId) {
      const readback = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath}/${pathSegment(sellerProductId)}`,
      });
      const readbackStep = step("inventory-item-readback", readback);
      steps.push(readbackStep);
      if (!readbackStep.ok) return result(input, steps, sellerProductId);
      const data =
        readback.data.data &&
        typeof readback.data.data === "object" &&
        !Array.isArray(readback.data.data)
          ? (readback.data.data as Record<string, unknown>)
          : readback.data;
      const items = Array.isArray(data.items)
        ? data.items.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
        : [];
      vendorItemIds = items
        .map((item) => String(item.vendorItemId ?? "").trim())
        .filter(Boolean);
    }
    if (!vendorItemIds.length)
      throw new Error("CHANNEL_ARGUMENT_REQUIRED:vendorItemId");
    for (const vendorItemId of vendorItemIds) {
      const remote = await coupangRequest({
        payload: input.payload,
        method: "PUT",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/quantities/${quantity}`,
      });
      const writeStep = step("quantity", remote);
      steps.push(writeStep);
      if (!writeStep.ok) continue;
      const verificationRemote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${sellerProductsPath.replace("seller-products", "vendor-items")}/${pathSegment(vendorItemId)}/inventories`,
      });
      const verificationData =
        verificationRemote.data.data &&
        typeof verificationRemote.data.data === "object" &&
        !Array.isArray(verificationRemote.data.data)
          ? (verificationRemote.data.data as Record<string, unknown>)
          : verificationRemote.data;
      steps.push(
        inventoryQuantityVerificationStep(
          "inventory-readback",
          verificationRemote,
          quantity,
          verificationData.amountInStock ?? verificationData.quantity,
        ),
      );
    }
    return result(input, steps, sellerProductId || vendorItemIds[0]);
  }

  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
