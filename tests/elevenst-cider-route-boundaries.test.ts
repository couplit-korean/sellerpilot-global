import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";
import { isElevenstProcessedFoodCategory, elevenstProcessedFoodNotificationFields, elevenstProcessedFoodProductNameNoticeCode } from "../lib/channels/elevenst-listing";
import { elevenstProviderAvailabilityReceiptContract } from "../lib/channels/elevenst-new-product-input";
import { elevenstNewProductSourceApprovalContract, elevenstNewProductSourceApprovalRequestSchema, elevenstNewProductSourceApprovalWriterRpc } from "../lib/product-registration/elevenst/new-product-source-approval";

const actorId = "10000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000002";
const productId = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const responseApi = { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) };
const isRecord = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value);

function body() {
  return {
    contract: elevenstNewProductSourceApprovalContract,
    approvalRequestId: "40000000-0000-4000-8000-000000000001",
    expectedDraftVersion: 12, productId, credentialId, market: "KR", targetId: "",
    notices: elevenstProcessedFoodNotificationFields.filter(field => field.code !== elevenstProcessedFoodProductNameNoticeCode).map(field => ({
      code: field.code, value: `확인된 값 ${field.code}`, sourceKind: "product_label",
      sourceSha256: "a".repeat(64), capturedAt: "2026-09-14T01:00:00Z",
    })),
    sellerOfficeAccountSha256: "b".repeat(64), sellerVerifiedAt: "2026-09-14T01:00:00Z",
    availability: { contract: elevenstProviderAvailabilityReceiptContract, state: "available", observedAt: "2026-09-14T01:00:00Z" },
    shipping: { shippingFeeKrw: 3000, bundleDeliveryCode: "Y", outboundAddressId: "1234", returnAddressId: "5678" },
    returns: { returnFeeKrw: 3000, exchangeFeeKrw: 6000, asDetail: "판매자 문의", returnExchangeDetail: "확인된 반품지" },
  };
}

function context() {
  const paths = ["overview", "feature", "dimensions", "contents", "usage", "lifestyle", "quality", "notice"].map(role =>
    `results/50000000-0000-4000-8000-000000000001/claims/60000000-0000-4000-8000-000000000001/detail-${role}.png`);
  const hashes = paths.map((_, index) => index.toString(16).repeat(64));
  return {
    contract: "sellerpilot_elevenst_new_product_approval_context_v1", actorId, ownerId, productId,
    categoryId: "1009792", productUpdatedAt: "2026-09-14T01:00:00Z", productRevision: 1, productApprovalRevision: 1,
    productName: "나랑드 사이다 500ml 1병", sellerProductCode: "TEST-500", inventoryQuantity: 10,
    credentialId, credentialVersion: 4, draftVersion: 12, approvedPriceKrw: 3000, approvedQuantity: 10,
    brand: "나랑드", countryOfOrigin: "대한민국", conditionCode: "01",
    productImagePaths: paths.slice(0, 4), detailImagePaths: paths,
    productImageSha256s: hashes.slice(0, 4), detailImageSha256s: hashes, detailManifestDigest: "d".repeat(64),
  };
}

async function approvalRoute(automatic: Record<string, unknown>, requestBody = body(), failReceipt = false) {
  const source = await readFile(new URL("../app/api/admin/elevenst/new-product-source-approval/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // Execute the actual complete route with external dependencies injected. Storage
  // byte verification itself has separate real-Blob regressions; here its exact
  // server-provided expectations and rejection-before-save contract are tested.
  const implementation = ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => node.getText(ast)).join("\n").replace(/^export /gmu, "");
  const calls: string[] = [];
  const observed: { receipt?: Record<string, unknown>; payload?: unknown; target?: unknown } = {};
  const serviceClient = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "sellerpilot_service_elevenst_new_product_approval_context") {
        observed.target = args.p_target_id;
        return { data: automatic, error: null };
      }
      if (name === "sellerpilot_decrypt_credential") return { data: { fixture: true }, error: null };
      assert.equal(name, elevenstNewProductSourceApprovalWriterRpc);
      observed.payload = args.p_payload;
      return { data: { status: "approved", sourceId: "70000000-0000-4000-8000-000000000001", approvalPayloadSha256: "f".repeat(64) }, error: null };
    },
    storage: { from: (bucket: string) => ({
      createSignedUrls: async (paths: string[]) => {
        calls.push(`sign:${bucket}`);
        return { data: paths.map(path => ({ signedUrl: `https://storage.example.test/${path}` })), error: null };
      },
      download: async () => { throw new Error("receipt dependency should own downloads"); },
    }) },
  };
  const dependencies = {
    NextResponse: responseApi, z,
    authenticateAdminRequest: async () => ({ user: { id: actorId }, serviceClient }),
    isAdminApiError: () => false,
    buildElevenstCreateCredentialRequestBinding: () => ({ sellerIdSha256: "b".repeat(64) }),
    elevenstNewProductSourceApprovalRequestSchema, elevenstNewProductSourceApprovalWriterRpc,
    buildElevenstNewProductSourceApproval: async () => ({ payload: { policySource: { content: {} } } }),
    readElevenstApprovalObjectReceipts: async (input: Record<string, unknown>) => {
      calls.push("verify-bytes"); observed.receipt = input;
      if (failReceipt) throw new Error("ELEVENST_OBJECT_SHA256_MISMATCH");
      return { imageObjectReceipts: [{ verified: true }] };
    },
  };
  const execute = new Function(...Object.keys(dependencies), ts.transpileModule(`${implementation}\nreturn POST;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText)(...Object.values(dependencies)) as (request: Request) => Promise<Response>;
  return { response: await execute(new Request("https://app.example.test/api/approval", { method: "POST", body: JSON.stringify(requestBody) })), calls, observed };
}

test("actual approval route rejects a stale draft before credential access, signing, bytes or save", async () => {
  const result = await approvalRoute({ ...context(), draftVersion: 13 });
  assert.equal(result.response.status, 409);
  assert.equal((await result.response.json()).code, "ELEVENST_NEW_PRODUCT_SOURCE_APPROVAL_CONTEXT_STALE");
  assert.deepEqual(result.calls, ["sellerpilot_service_elevenst_new_product_approval_context"]);
});

test("actual cider approval route rejects missing/malformed hashes and original-photo fallback before credential access", async () => {
  for (const change of [
    { productImageSha256s: undefined }, { detailImageSha256s: undefined },
    { detailImageSha256s: ["a".repeat(64)] }, { productImageSha256s: Array(4).fill("invalid") },
    { productImagePaths: Array.from({ length: 4 }, (_, i) => `${ownerId}/original-${i}.png`) },
  ]) {
    const result = await approvalRoute({ ...context(), ...change });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.calls, ["sellerpilot_service_elevenst_new_product_approval_context"]);
  }
});

test("actual approval route retains blank domestic target and forwards exact server SHA expectations before saving", async () => {
  const automatic = context();
  const result = await approvalRoute(automatic);
  assert.equal(result.response.status, 200);
  assert.equal(result.observed.target, "");
  assert.deepEqual(result.observed.receipt, {
    ownerId, productImagePaths: automatic.productImagePaths, detailImagePaths: automatic.detailImagePaths,
    detailImageBucket: "sellerpilot-ai", productImageSha256s: automatic.productImageSha256s,
    detailImageSha256s: automatic.detailImageSha256s, detailManifestDigest: automatic.detailManifestDigest,
  });
  assert.ok(result.calls.indexOf("verify-bytes") < result.calls.indexOf(elevenstNewProductSourceApprovalWriterRpc));
  assert.deepEqual(result.observed.payload, { policySource: { content: { imageObjectReceipts: [{ verified: true }] } } });
  const rejected = await approvalRoute(automatic, body(), true);
  assert.equal(rejected.response.status, 503);
  assert.equal(rejected.calls.includes(elevenstNewProductSourceApprovalWriterRpc), false);
});

async function createBranch(assignmentCategory: string | null, productCategory: string) {
  const source = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
  const start = source.indexOf("  const elevenstCreateProduct =");
  const end = source.indexOf('  if (channel === "ebay" && operation === "listing.create")', start);
  assert.ok(start > 0 && end > start);
  assert.ok(end < source.indexOf('"sellerpilot_claim_channel_operation"'));
  const preparedInputs: Record<string, unknown>[] = [];
  const dependencies = {
    isRecord, isElevenstProcessedFoodCategory, channel: "elevenst", operation: "listing.create", environment: "production",
    elevenstCreateCredentialVersion: 4, NextResponse: responseApi, serviceClient: {},
    verifiedPublishContext: { ownerId, assignments: assignmentCategory ? [{ channel: "elevenst", environment: "production", market: "KR", status: "confirmed", categoryId: assignmentCategory }] : [] },
    parsed: { data: { productId, credentialId, market: "KR", targetId: "" } },
    prepareElevenstNewProductCreateBeforeClaimFromRpc: async (input: Record<string, unknown>) => {
      preparedInputs.push(input);
      return { ok: true, arguments: { product: { dispCtgrNo: input.categoryId, selPrc: "3000" }, fromApprovedSource: true } };
    },
  };
  const compiled = ts.transpileModule(`return (async () => {
    let effectiveArguments = { product: { dispCtgrNo: ${JSON.stringify(productCategory)}, selPrc: "1" } };
    let effectiveCurrency = "USD"; let effectivePrice = 1;
    ${source.slice(start, end)}
    return { effectiveArguments, effectiveCurrency, effectivePrice };
  })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const outcome = await new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { outcome, preparedInputs };
}

test("actual CREATE route rejects exchanged food categories or unconfirmed cider before source preparation and claim", async () => {
  for (const [assignment, product] of [["1009792", "1346631"], ["1346631", "1009792"], [null, "1009792"], ["1009792", "1341821"]]) {
    const result = await createBranch(assignment, product!);
    assert.equal(result.outcome.status, 409);
    assert.equal((await result.outcome.json()).code, "ELEVENST_NEW_PRODUCT_SERVER_SOURCE_IDENTITY_INVALID");
    assert.equal(result.preparedInputs.length, 0);
  }
});

test("actual CREATE route prepares each exact confirmed food category and adopts only server-approved arguments/price", async () => {
  for (const category of ["1009792", "1346631"]) {
    const result = await createBranch(category, category);
    assert.equal(result.preparedInputs.length, 1);
    assert.equal(result.preparedInputs[0].categoryId, category);
    assert.equal(result.preparedInputs[0].ownerId, ownerId);
    assert.equal(result.outcome.effectiveArguments.product.dispCtgrNo, category);
    assert.equal(result.outcome.effectiveArguments.fromApprovedSource, true);
    assert.equal(result.outcome.effectivePrice, 3000);
    assert.equal(result.outcome.effectiveCurrency, "KRW");
  }
});
