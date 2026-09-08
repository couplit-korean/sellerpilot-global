import { elevenstVerifiedSkuAbsence } from "../../channels/elevenst-create-preflight";
import { step, type ChannelOperationStep } from "../../channels/operation-step";
import { stringArgument, pathSegment } from "../../channels/operation-values";
import { createHash } from "node:crypto";
import {
  elevenstCategoryRequest,
  elevenstSellerXmlRequest,
  type RemoteResponse,
} from "../../channels/protocols";
import {
  elevenstShippingContractErrorMessage,
  validateElevenstListingArguments,
} from "../../channels/elevenst-listing";
import { elevenstVerifiedListingRemoteState } from "../../channels/elevenst-listing-publication";
import {
  assertElevenstExactExistingUpdate,
  elevenstExactExistingBaselineVerified,
  elevenstExactExistingCreateForbidden,
  elevenstExactExistingLiveReadbackVerified,
  elevenstExactExistingStagedReadbackVerified,
  elevenstExactExistingUpdateTarget,
} from "../../channels/elevenst-exact-existing-publication";
import {
  elevenstExactExistingUpdateProjectionDigestInput,
  elevenstListingUpdateProjectionDigestInput,
  verifyListingUpdateReadback,
} from "../../channels/listing-update";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
  type VerifiedListingRemoteState,
} from "../../channels/listing-publication-state";
import {
  type ExecuteInput,
  result,
  operationDelay,
  booleanArgument,
} from "../execution-shared";

export function elevenstXmlEscape(value: string) {
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

export function elevenstXmlNode(name: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (!/^[A-Za-z][A-Za-z0-9_:-]*$/.test(name))
    throw new Error("ELEVENST_PAYLOAD_TAG_INVALID");
  if (Array.isArray(value))
    return value.map((item) => elevenstXmlNode(name, item)).join("");
  if (typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>)
      .map(([childName, childValue]) => elevenstXmlNode(childName, childValue))
      .join("");
    return `<${name}>${children}</${name}>`;
  }
  return `<${name}>${elevenstXmlEscape(String(value))}</${name}>`;
}

export function elevenstProductPayload(
  argumentsValue: Record<string, unknown>,
) {
  const product = validateElevenstListingArguments(argumentsValue);
  return `<?xml version="1.0" encoding="UTF-8"?>${elevenstXmlNode("Product", product)}`;
}

export function elevenstVerifiedStep(
  name: string,
  remote: RemoteResponse,
  verified = true,
): ChannelOperationStep {
  const remoteStep = step(name, remote);
  const accepted = remote.data.accepted === true && verified;
  return {
    ...remoteStep,
    ok: remoteStep.ok && accepted,
    data: {
      ...remoteStep.data,
      sellerpilotVerification: accepted
        ? "ELEVENST_RESPONSE_VERIFIED"
        : "ELEVENST_RESPONSE_UNVERIFIED",
    },
  };
}

export function elevenstPrewriteFailureStep(
  name: string,
  error: unknown,
  status = 422,
): ChannelOperationStep {
  const raw = error instanceof Error ? error.message : "";
  const safeCode = /^ELEVENST_[A-Z0-9_:-]+$/u.test(raw)
    ? raw
    : "ELEVENST_PREWRITE_VALIDATION_FAILED";
  return {
    name,
    ok: false,
    status,
    data: {
      error: safeCode,
      ...(elevenstShippingContractErrorMessage(safeCode)
        ? { errorMessage: elevenstShippingContractErrorMessage(safeCode) }
        : {}),
      sellerpilotVerification: "ELEVENST_PREWRITE_REJECTED",
    },
  };
}

export function elevenstUnavailableRemote(message: string): RemoteResponse {
  return {
    response: new Response(null, { status: 503 }),
    text: "",
    data: { accepted: false, errorMessage: message },
  };
}

export function elevenstPublicationExpectation(input: ExecuteInput) {
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

export function elevenstPublicationReadbackStep(
  remote: RemoteResponse,
  remoteState: VerifiedListingRemoteState | null,
): ChannelOperationStep {
  const readbackStep = elevenstVerifiedStep(
    "product-publication-readback",
    remote,
    Boolean(remoteState),
  );
  return {
    ...readbackStep,
    data: {
      ...readbackStep.data,
      sellerpilotVerification: readbackStep.ok
        ? "ELEVENST_PUBLICATION_STATE_VERIFIED"
        : "ELEVENST_PUBLICATION_STATE_UNVERIFIED",
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

export type ElevenstCategory = {
  categoryId: string;
  categoryName: string;
  parentCategoryId: string;
  depth: number;
  leaf: boolean;
  categoryPath: string;
};

export function elevenstCategories(remote: RemoteResponse) {
  return Array.isArray(remote.data.items)
    ? remote.data.items.filter((item): item is ElevenstCategory =>
        Boolean(
          item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as ElevenstCategory).categoryId === "string" &&
            typeof (item as ElevenstCategory).categoryName === "string",
        ),
      )
    : [];
}

export function elevenstCategoryResult(
  remote: RemoteResponse,
  items: ElevenstCategory[],
  accepted = remote.data.accepted === true,
): RemoteResponse {
  return {
    response: remote.response,
    text: "",
    data: {
      accepted,
      items,
      totalCount: items.length,
      ...(!accepted
        ? { errorMessage: "11번가 공식 말단 카테고리로 확인되지 않았습니다." }
        : {}),
    },
  };
}

export function elevenstCategoryScore(
  query: string,
  category: ElevenstCategory,
) {
  const normalizedQuery = query
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const candidate =
    `${category.categoryPath} ${category.categoryName}`.toLocaleLowerCase();
  const words = [
    ...new Set(normalizedQuery.split(/\s+/).filter((word) => word.length > 1)),
  ];
  const matched = words.filter((word) => candidate.includes(word)).length;
  const cableOrganizerBoost =
    /(케이블|전선|cable|cord)/u.test(normalizedQuery) &&
    /(정리|클립|홀더|organizer|clip)/u.test(normalizedQuery) &&
    /(케이블|전선).*(정리|클립|홀더)|(?:정리|클립|홀더).*(?:케이블|전선)/u.test(
      candidate,
    )
      ? 1_000
      : 0;
  const cableClipLeafBoost =
    /(클립|clip|holder)/u.test(normalizedQuery) &&
    /케이블\s*정리소품/u.test(category.categoryName)
      ? 400
      : 0;
  const relevance =
    cableOrganizerBoost +
    cableClipLeafBoost +
    matched * 100 +
    (candidate.includes(normalizedQuery) ? 500 : 0);
  return relevance > 0 ? relevance + category.depth : 0;
}

export async function executeElevenst(input: ExecuteInput) {
  if (input.channel !== "elevenst")
    throw new Error("PRODUCT_CHANNEL_MISMATCH:elevenst");
  if (
    input.operation === "listing.create" &&
    listingPublicationIntentFromArguments(input.arguments) === "safe_test"
  ) {
    return result(input, [
      elevenstPrewriteFailureStep(
        "safe-test-prewrite-fence",
        new Error("ELEVENST_SAFE_TEST_CREATE_UNSUPPORTED"),
      ),
    ]);
  }
  if (
    input.operation === "listing.create" &&
    input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion &&
    input.arguments.verificationOnly === true
  ) {
    return result(input, [
      elevenstPrewriteFailureStep(
        "verification-only-prewrite-fence",
        new Error("ELEVENST_VERIFICATION_ONLY_CREATE_UNSUPPORTED"),
      ),
    ]);
  }
  if (input.operation === "categories.list") {
    const parentCategoryId = stringArgument(
      input.arguments,
      "categoryId",
      false,
    );
    const remote = await elevenstCategoryRequest();
    const categories = elevenstCategories(remote);
    const items = parentCategoryId
      ? categories.filter((item) => item.parentCategoryId === parentCategoryId)
      : categories.filter((item) => item.parentCategoryId === "0");
    const narrowed = elevenstCategoryResult(remote, items);
    return result(
      input,
      [elevenstVerifiedStep("category-list", narrowed)],
      parentCategoryId || undefined,
    );
  }
  if (input.operation === "categories.suggest") {
    const query = stringArgument(input.arguments, "query");
    const remote = await elevenstCategoryRequest();
    const items = elevenstCategories(remote)
      .filter((item) => item.leaf)
      .map((item) => ({ item, score: elevenstCategoryScore(query, item) }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || right.item.depth - left.item.depth,
      )
      .slice(0, 25)
      .map(({ item, score }) => ({
        ...item,
        confidence: Math.min(0.99, 0.45 + score / 2_000),
      }));
    const narrowed = elevenstCategoryResult(
      remote,
      items,
      remote.data.accepted === true && items.length > 0,
    );
    return result(input, [
      elevenstVerifiedStep("category-suggestions", narrowed),
    ]);
  }
  if (
    input.operation === "categories.attributes" ||
    input.operation === "categories.validate"
  ) {
    const categoryId = stringArgument(input.arguments, "categoryId");
    const remote = await elevenstCategoryRequest();
    const category = elevenstCategories(remote).find(
      (item) => item.categoryId === categoryId,
    );
    const validLeaf = Boolean(category?.leaf);
    const narrowed = elevenstCategoryResult(
      remote,
      category ? [category] : [],
      remote.data.accepted === true && validLeaf,
    );
    narrowed.data.attributes = [];
    return result(
      input,
      [
        elevenstVerifiedStep(
          input.operation === "categories.attributes"
            ? "category-attributes"
            : "category-validation",
          narrowed,
          validLeaf,
        ),
      ],
      categoryId,
    );
  }
  if (input.operation === "listing.create") {
    if (
      elevenstExactExistingCreateForbidden({ argumentsValue: input.arguments })
    ) {
      return result(input, [
        elevenstPrewriteFailureStep(
          "product-duplicate-create-fence",
          new Error("ELEVENST_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN"),
        ),
      ]);
    }
    let product: Record<string, unknown>;
    try {
      product = validateElevenstListingArguments(input.arguments);
    } catch (error) {
      return result(input, [
        elevenstPrewriteFailureStep("product-contract-validation", error),
      ]);
    }
    const sellerProductCode = String(product.sellerPrdCd ?? "").trim();
    const categoryId = String(product.dispCtgrNo ?? "").trim();

    let categoryRemote: RemoteResponse;
    try {
      categoryRemote = await elevenstCategoryRequest();
    } catch (error) {
      return result(input, [
        elevenstPrewriteFailureStep("category-validation", error, 503),
      ]);
    }
    const category = elevenstCategories(categoryRemote).find(
      (item) => item.categoryId === categoryId,
    );
    const categoryVerified =
      categoryRemote.data.accepted === true && category?.leaf === true;
    if (!categoryVerified) {
      const narrowed = elevenstCategoryResult(
        categoryRemote,
        category ? [category] : [],
        false,
      );
      return result(input, [
        elevenstVerifiedStep("category-validation", narrowed, false),
      ]);
    }

    const findExistingProduct = async () => {
      const remote = await elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/prodmarketservice/sellerprodcode/${pathSegment(sellerProductCode)}`,
      });
      const productNo = String(remote.data.productNo ?? "").trim();
      if (productNo) return { remote, productNo };
      const resultCode = String(remote.data.resultCode ?? "").trim();
      const bodyBytes = Number(remote.data.lookupBodyBytes);
      const notFound = elevenstVerifiedSkuAbsence(remote);
      if (!notFound) {
        const safeResultCode =
          resultCode
            .toUpperCase()
            .replace(/[^A-Z0-9]/gu, "_")
            .slice(0, 40) || "NONE";
        const safeRoot =
          String(remote.data.lookupDocumentRoot ?? "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/gu, "_")
            .slice(0, 40) || "NONE";
        const safeBodyBytes =
          Number.isSafeInteger(bodyBytes) && bodyBytes >= 0 ? bodyBytes : 0;
        throw new Error(
          `ELEVENST_IDEMPOTENCY_LOOKUP_UNVERIFIED:HTTP_${remote.response.status}:CODE_${safeResultCode}:ROOT_${safeRoot}:BYTES_${safeBodyBytes}`,
        );
      }
      return null;
    };

    let reconciled: Awaited<ReturnType<typeof findExistingProduct>>;
    try {
      reconciled = await findExistingProduct();
    } catch (error) {
      return result(input, [
        elevenstPrewriteFailureStep("product-idempotency-read", error, 503),
      ]);
    }
    let createRemote: RemoteResponse;
    let productNo = "";
    let createStep: ChannelOperationStep | null = null;
    let providerCreateAcceptedStep: ChannelOperationStep | null = null;
    if (reconciled) {
      createRemote = reconciled.remote;
      productNo = reconciled.productNo;
      createStep = elevenstVerifiedStep(
        "product-create-reconcile",
        createRemote,
        true,
      );
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
        createStep = elevenstVerifiedStep(
          "product-create-reconcile",
          createRemote,
          true,
        );
      }
      if (!productNo)
        productNo = String(createRemote.data.productNo ?? "").trim();
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
          createStep = elevenstVerifiedStep(
            "product-create-reconcile",
            createRemote,
            true,
          );
        }
      }
      if (!createStep) {
        providerCreateAcceptedStep = elevenstVerifiedStep(
          "product-create-accepted",
          createRemote,
        );
        createStep = elevenstVerifiedStep(
          "product-create",
          createRemote,
          Boolean(productNo),
        );
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

    const readExactProduct = () =>
      elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/prodmarketservice/prodmarket/${pathSegment(productNo)}`,
      });
    const publicationExpectation = elevenstPublicationExpectation(input);
    let readbackRemote: RemoteResponse | null = null;
    let readbackVerified = false;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3 && !readbackVerified; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await readExactProduct();
      } catch {
        readbackRemote = elevenstUnavailableRemote(
          "11번가 상품 생성 후 재조회 응답을 확인하지 못했습니다.",
        );
        continue;
      }
      const readbackProduct =
        readbackRemote.data.product &&
        typeof readbackRemote.data.product === "object" &&
        !Array.isArray(readbackRemote.data.product)
          ? (readbackRemote.data.product as Record<string, unknown>)
          : {};
      const identityVerified =
        readbackRemote.data.accepted === true &&
        String(readbackRemote.data.productNo ?? readbackProduct.prdNo ?? "") ===
          productNo &&
        String(readbackProduct.sellerPrdCd ?? "") === sellerProductCode;
      remoteState = publicationExpectation
        ? elevenstVerifiedListingRemoteState({
            operation: input.operation,
            remoteId: productNo,
            product: readbackProduct,
            expectedSellerProductCode: sellerProductCode,
            ...publicationExpectation,
          })
        : null;
      readbackVerified =
        identityVerified && (!publicationExpectation || Boolean(remoteState));
    }
    if (!readbackRemote) throw new Error("ELEVENST_READBACK_MISSING");
    const readbackStep = publicationExpectation
      ? elevenstPublicationReadbackStep(readbackRemote, remoteState)
      : elevenstVerifiedStep(
          "product-readback",
          readbackRemote,
          readbackVerified,
        );
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
        stopRemote = elevenstUnavailableRemote(
          "11번가 검증 상품의 전시 중지 응답을 확인하지 못했습니다.",
        );
      }
      steps.push(elevenstVerifiedStep("verification-stop-display", stopRemote));
    }
    const operationResult = result(
      input,
      steps,
      productNo,
      undefined,
      remoteState ?? undefined,
    );
    operationResult.publicUrl = `https://www.11st.co.kr/products/${pathSegment(productNo)}`;
    return operationResult;
  }
  if (input.operation === "listing.update") {
    const productNo = pathSegment(stringArgument(input.arguments, "productNo"));
    let product: Record<string, unknown>;
    let snapshotMutableFingerprint: string;
    const exactExistingPublication = elevenstExactExistingUpdateTarget(
      input.arguments,
    );
    try {
      product = validateElevenstListingArguments(input.arguments);
      if (exactExistingPublication)
        assertElevenstExactExistingUpdate(input.arguments);
      snapshotMutableFingerprint = stringArgument(
        input.arguments,
        "sellerpilotSnapshotMutableFingerprint",
      );
      if (!/^[a-f0-9]{64}$/u.test(snapshotMutableFingerprint)) {
        throw new Error("ELEVENST_UPDATE_SNAPSHOT_FINGERPRINT_INVALID");
      }
    } catch (error) {
      return result(input, [
        elevenstPrewriteFailureStep("product-contract-validation", error),
      ]);
    }
    const sellerProductCode = String(product.sellerPrdCd ?? "").trim();
    const readExactProduct = () =>
      elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/prodmarketservice/prodmarket/${productNo}`,
      });

    let beforeRemote: RemoteResponse;
    try {
      beforeRemote = await readExactProduct();
    } catch (error) {
      return result(
        input,
        [elevenstPrewriteFailureStep("product-update-preflight", error, 503)],
        decodeURIComponent(productNo),
      );
    }
    const beforeProduct =
      beforeRemote.data.product &&
      typeof beforeRemote.data.product === "object" &&
      !Array.isArray(beforeRemote.data.product)
        ? (beforeRemote.data.product as Record<string, unknown>)
        : {};
    const identityVerified =
      beforeRemote.data.accepted === true &&
      String(beforeRemote.data.productNo ?? beforeProduct.prdNo ?? "") ===
        decodeURIComponent(productNo) &&
      String(beforeProduct.sellerPrdCd ?? "") === sellerProductCode;
    const beforeMutableFingerprint = Object.keys(beforeProduct).length
      ? createHash("sha256")
          .update(
            exactExistingPublication
              ? elevenstExactExistingUpdateProjectionDigestInput(beforeProduct)
              : elevenstListingUpdateProjectionDigestInput(beforeProduct),
          )
          .digest("hex")
      : "";
    const snapshotVerified =
      beforeMutableFingerprint === snapshotMutableFingerprint;
    const exactBaselineVerified =
      !exactExistingPublication ||
      elevenstExactExistingBaselineVerified(beforeProduct);
    const beforeVerified =
      identityVerified && snapshotVerified && exactBaselineVerified;
    const beforeStep = elevenstVerifiedStep(
      "product-update-preflight",
      beforeRemote,
      beforeVerified,
    );
    beforeStep.data = {
      ...beforeStep.data,
      sellerpilotSnapshotMutableProjectionMatched: snapshotVerified,
      ...(exactExistingPublication
        ? {
            sellerpilotExactExistingBaselineStatus105Verified:
              exactBaselineVerified,
          }
        : {}),
      ...(identityVerified && snapshotVerified && !exactBaselineVerified
        ? {
            error: "ELEVENST_EXACT_EXISTING_BASELINE_STATUS_REQUIRED",
            message:
              "정확한 기존 11번가 상품이 판매중지 상태 105인지 확인되지 않아 PUT을 시작하지 않았습니다.",
            sellerpilotVerification:
              "ELEVENST_EXACT_EXISTING_BASELINE_STATUS_REQUIRED",
          }
        : {}),
      ...(identityVerified && !snapshotVerified
        ? {
            error: "ELEVENST_UPDATE_SNAPSHOT_DRIFT",
            message:
              "11번가 원격 상품 내용이 마지막 신뢰 스냅샷과 달라 전체 XML 수정을 차단했습니다. 판매자센터 상태를 조정하고 새 신뢰 스냅샷을 만든 뒤 다시 시도해 주세요.",
            sellerpilotReconciliationRequired: true,
            sellerpilotVerification: "ELEVENST_UPDATE_SNAPSHOT_DRIFT",
          }
        : {}),
    };
    if (!beforeStep.ok)
      return result(input, [beforeStep], decodeURIComponent(productNo));

    const updateRemote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodservices/product/${productNo}`,
      body: elevenstProductPayload(input.arguments),
    });
    const updateVerified =
      updateRemote.response.status === 200 &&
      String(updateRemote.data.resultCode ?? "") === "200" &&
      String(updateRemote.data.productNo ?? "") ===
        decodeURIComponent(productNo);
    const updateStep = elevenstVerifiedStep(
      "product-update",
      updateRemote,
      updateVerified,
    );
    if (updateRemote.response.ok && updateRemote.data.accepted === true) {
      updateStep.data.sellerpilotMutation = "accepted";
    }
    if (!updateStep.ok)
      return result(
        input,
        [beforeStep, updateStep],
        decodeURIComponent(productNo),
      );

    const publicationExpectation = elevenstPublicationExpectation(input);
    if (exactExistingPublication) {
      let stagedRemote: RemoteResponse | null = null;
      let stagedVerified = false;
      let alreadyLive = false;
      let stagedRemoteState: VerifiedListingRemoteState | null = null;
      for (let attempt = 0; attempt < 3 && !stagedVerified; attempt += 1) {
        if (attempt > 0) await operationDelay(800 * attempt);
        try {
          stagedRemote = await readExactProduct();
        } catch {
          stagedRemote = elevenstUnavailableRemote(
            "11번가 상품 수정 내용의 판매 재개 전 재조회 응답을 확인하지 못했습니다.",
          );
          continue;
        }
        const stagedProduct =
          stagedRemote.data.product &&
          typeof stagedRemote.data.product === "object" &&
          !Array.isArray(stagedRemote.data.product)
            ? (stagedRemote.data.product as Record<string, unknown>)
            : {};
        const stagedIdentityVerified =
          stagedRemote.data.accepted === true &&
          String(stagedRemote.data.productNo ?? stagedProduct.prdNo ?? "") ===
            decodeURIComponent(productNo) &&
          String(stagedProduct.sellerPrdCd ?? "") === sellerProductCode;
        const stagedContent = verifyListingUpdateReadback(
          "elevenst",
          input.arguments,
          stagedRemote.data,
        );
        const exactStaged = elevenstExactExistingStagedReadbackVerified(
          input.arguments,
          stagedProduct,
        );
        const exactLive = elevenstExactExistingLiveReadbackVerified(
          input.arguments,
          stagedProduct,
        );
        alreadyLive = stagedIdentityVerified && stagedContent.ok && exactLive;
        stagedVerified =
          stagedIdentityVerified &&
          stagedContent.ok &&
          (exactStaged || exactLive);
        stagedRemoteState =
          alreadyLive && publicationExpectation
            ? elevenstVerifiedListingRemoteState({
                operation: input.operation,
                remoteId: decodeURIComponent(productNo),
                product: stagedProduct,
                expectedSellerProductCode: sellerProductCode,
                ...publicationExpectation,
              })
            : null;
        stagedRemote.data.sellerpilotMismatches =
          stagedContent.mismatches.slice(0, 50);
      }
      if (!stagedRemote) throw new Error("ELEVENST_STAGED_READBACK_MISSING");
      const stagedStep = elevenstVerifiedStep(
        alreadyLive ? "listing-readback" : "listing-staged-readback",
        stagedRemote,
        stagedVerified &&
          (!alreadyLive ||
            !publicationExpectation ||
            Boolean(stagedRemoteState)),
      );
      stagedStep.data = {
        ...stagedStep.data,
        sellerpilotMismatches: stagedRemote.data.sellerpilotMismatches,
        sellerpilotExactExistingStagedStatus105Verified:
          stagedVerified && !alreadyLive,
        sellerpilotExactExistingAlreadyLiveStatus103Verified:
          stagedVerified && alreadyLive,
      };
      if (alreadyLive && publicationExpectation) {
        stagedStep.data = {
          ...stagedStep.data,
          ...elevenstPublicationReadbackStep(stagedRemote, stagedRemoteState)
            .data,
          sellerpilotMismatches: stagedRemote.data.sellerpilotMismatches,
          sellerpilotExactExistingStagedStatus105Verified: false,
          sellerpilotExactExistingAlreadyLiveStatus103Verified: true,
        };
      }
      if (!stagedStep.ok || alreadyLive) {
        return result(
          input,
          [beforeStep, updateStep, stagedStep],
          decodeURIComponent(productNo),
          undefined,
          stagedRemoteState ?? undefined,
        );
      }

      let restartRemote: RemoteResponse;
      try {
        restartRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "PUT",
          path: `/rest/prodstatservice/stat/restartdisplay/${productNo}`,
        });
      } catch {
        restartRemote = elevenstUnavailableRemote(
          "11번가 판매중지 해제 응답을 확인하지 못했습니다.",
        );
      }
      const restartMessage = String(restartRemote.data.resultMessage ?? "");
      const restartVerified =
        restartRemote.response.status === 200 &&
        restartRemote.data.accepted === true &&
        String(restartRemote.data.resultCode ?? "") === "200" &&
        /\[\s*STAT\s*:\s*103\s*\]/iu.test(restartMessage);
      const restartStep = elevenstVerifiedStep(
        "restart-display",
        restartRemote,
        restartVerified,
      );
      if (restartRemote.response.ok && restartRemote.data.accepted === true) {
        restartStep.data.sellerpilotMutation = "accepted";
      }
      if (!restartStep.ok) {
        return result(
          input,
          [beforeStep, updateStep, stagedStep, restartStep],
          decodeURIComponent(productNo),
        );
      }

      let finalRemote: RemoteResponse | null = null;
      let finalVerified = false;
      let finalRemoteState: VerifiedListingRemoteState | null = null;
      for (let attempt = 0; attempt < 3 && !finalVerified; attempt += 1) {
        if (attempt > 0) await operationDelay(800 * attempt);
        try {
          finalRemote = await readExactProduct();
        } catch {
          finalRemote = elevenstUnavailableRemote(
            "11번가 판매중지 해제 후 재조회 응답을 확인하지 못했습니다.",
          );
          continue;
        }
        const finalProduct =
          finalRemote.data.product &&
          typeof finalRemote.data.product === "object" &&
          !Array.isArray(finalRemote.data.product)
            ? (finalRemote.data.product as Record<string, unknown>)
            : {};
        const finalIdentityVerified =
          finalRemote.data.accepted === true &&
          String(finalRemote.data.productNo ?? finalProduct.prdNo ?? "") ===
            decodeURIComponent(productNo) &&
          String(finalProduct.sellerPrdCd ?? "") === sellerProductCode;
        const finalContent = verifyListingUpdateReadback(
          "elevenst",
          input.arguments,
          finalRemote.data,
        );
        finalRemoteState = publicationExpectation
          ? elevenstVerifiedListingRemoteState({
              operation: input.operation,
              remoteId: decodeURIComponent(productNo),
              product: finalProduct,
              expectedSellerProductCode: sellerProductCode,
              ...publicationExpectation,
            })
          : null;
        finalVerified =
          finalIdentityVerified &&
          finalContent.ok &&
          elevenstExactExistingLiveReadbackVerified(
            input.arguments,
            finalProduct,
          ) &&
          (!publicationExpectation || Boolean(finalRemoteState));
        finalRemote.data.sellerpilotMismatches = finalContent.mismatches.slice(
          0,
          50,
        );
      }
      if (!finalRemote) throw new Error("ELEVENST_READBACK_MISSING");
      const finalStep = elevenstVerifiedStep(
        "listing-readback",
        finalRemote,
        finalVerified,
      );
      if (publicationExpectation) {
        finalStep.data = {
          ...elevenstPublicationReadbackStep(finalRemote, finalRemoteState)
            .data,
          sellerpilotMismatches: finalRemote.data.sellerpilotMismatches,
        };
      }
      return result(
        input,
        [beforeStep, updateStep, stagedStep, restartStep, finalStep],
        decodeURIComponent(productNo),
        undefined,
        finalRemoteState ?? undefined,
      );
    }

    let readbackRemote: RemoteResponse | null = null;
    let readbackVerified = false;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3 && !readbackVerified; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await readExactProduct();
      } catch {
        readbackRemote = elevenstUnavailableRemote(
          "11번가 상품 수정 후 재조회 응답을 확인하지 못했습니다.",
        );
        continue;
      }
      const readbackProduct =
        readbackRemote.data.product &&
        typeof readbackRemote.data.product === "object" &&
        !Array.isArray(readbackRemote.data.product)
          ? (readbackRemote.data.product as Record<string, unknown>)
          : {};
      const identityVerified =
        readbackRemote.data.accepted === true &&
        String(readbackRemote.data.productNo ?? readbackProduct.prdNo ?? "") ===
          decodeURIComponent(productNo) &&
        String(readbackProduct.sellerPrdCd ?? "") === sellerProductCode;
      const contentVerified = verifyListingUpdateReadback(
        "elevenst",
        input.arguments,
        readbackRemote.data,
      );
      remoteState = publicationExpectation
        ? elevenstVerifiedListingRemoteState({
            operation: input.operation,
            remoteId: decodeURIComponent(productNo),
            product: readbackProduct,
            expectedSellerProductCode: sellerProductCode,
            ...publicationExpectation,
          })
        : null;
      readbackVerified =
        identityVerified &&
        contentVerified.ok &&
        (!exactExistingPublication ||
          elevenstExactExistingLiveReadbackVerified(
            input.arguments,
            readbackProduct,
          )) &&
        (!publicationExpectation || Boolean(remoteState));
      readbackRemote.data.sellerpilotMismatches =
        contentVerified.mismatches.slice(0, 50);
    }
    if (!readbackRemote) throw new Error("ELEVENST_READBACK_MISSING");
    const readbackStep = elevenstVerifiedStep(
      "listing-readback",
      readbackRemote,
      readbackVerified,
    );
    if (publicationExpectation) {
      readbackStep.data = {
        ...elevenstPublicationReadbackStep(readbackRemote, remoteState).data,
        sellerpilotMismatches: readbackRemote.data.sellerpilotMismatches,
      };
    }
    return result(
      input,
      [beforeStep, updateStep, readbackStep],
      decodeURIComponent(productNo),
      undefined,
      remoteState ?? undefined,
    );
  }
  if (input.operation === "listing.stop") {
    const productNo = pathSegment(stringArgument(input.arguments, "productNo"));
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodstatservice/stat/stopdisplay/${productNo}`,
    });
    const stopStep = elevenstVerifiedStep("stop-display", remote);
    if (!stopStep.ok)
      return result(input, [stopStep], decodeURIComponent(productNo));
    const publicationExpectation = elevenstPublicationExpectation(input);
    if (!publicationExpectation)
      return result(input, [stopStep], decodeURIComponent(productNo));

    let readbackRemote: RemoteResponse | null = null;
    let readbackStep: ChannelOperationStep | null = null;
    let remoteState: VerifiedListingRemoteState | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await operationDelay(800 * attempt);
      try {
        readbackRemote = await elevenstSellerXmlRequest({
          payload: input.payload,
          method: "GET",
          path: `/rest/prodmarketservice/prodmarket/${productNo}`,
        });
      } catch {
        readbackRemote = elevenstUnavailableRemote(
          "11번가 상품 전시 중지 후 재조회 응답을 확인하지 못했습니다.",
        );
      }
      const readbackProduct =
        readbackRemote.data.product &&
        typeof readbackRemote.data.product === "object" &&
        !Array.isArray(readbackRemote.data.product)
          ? (readbackRemote.data.product as Record<string, unknown>)
          : {};
      remoteState = elevenstVerifiedListingRemoteState({
        operation: input.operation,
        remoteId: decodeURIComponent(productNo),
        product: readbackProduct,
        ...publicationExpectation,
      });
      readbackStep = elevenstPublicationReadbackStep(
        readbackRemote,
        remoteState,
      );
      if (readbackStep.ok) {
        return result(
          input,
          [stopStep, readbackStep],
          decodeURIComponent(productNo),
          undefined,
          remoteState ?? undefined,
        );
      }
    }
    return result(
      input,
      [stopStep, readbackStep!],
      decodeURIComponent(productNo),
    );
  }

  throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
}
