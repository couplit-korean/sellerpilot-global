import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  coupangDurableCreateReconciliationContract,
  executeCoupangDurableCreateReconciliation,
} = await import("../lib/product-registration/coupang/durable-create-reconciliation");

const vendorId = "A00012345";
const sourceJobId = "51000000-0000-4000-8000-000000000001";
const sourceAttemptId = "52000000-0000-4000-8000-000000000001";
const listingId = "53000000-0000-4000-8000-000000000001";
const sourceProductId = "54000000-0000-4000-8000-000000000001";
const credentialId = "55000000-0000-4000-8000-000000000001";
const credentialVaultSecretId = "56000000-0000-4000-8000-000000000001";
const officialSnapshotId = "57000000-0000-4000-8000-000000000001";
const transmissionId = "58000000-0000-4000-8000-000000000001";
const providerBodySealId = "59000000-0000-4000-8000-000000000001";
const sourceRequestSha256 = "a".repeat(64);
const baseSku = "COUPANG-DURABLE-RECOVERY";
const sellerSkus = [`${baseSku}-RED-M`, `${baseSku}-BLUE-L`];
const sellerProductId = "987654321";
const credentialPayload = { vendor_id: vendorId };
const credentialSecretSha256 = createHash("sha256")
  .update(`{"vendor_id":"${vendorId}"}`)
  .digest("hex");

function sourceArguments() {
  return {
    sellerpilotCoupangBaseSku: baseSku,
    facts: {
      coupangOptionRows: [{
        skuSuffix: "RED-M",
        itemName: "빨강 M",
        barcode: "8802259030799",
        modelNo: "",
        emptyBarcodeReason: "",
        salePrice: 12_300,
        stock: 7,
        unitCount: 1,
        purchaseOptions: [{ name: "색상", value: "빨강" }],
      }, {
        skuSuffix: "BLUE-L",
        itemName: "파랑 L",
        barcode: "",
        modelNo: "MODEL-BLUE-L",
        emptyBarcodeReason: "제조사 바코드 미부여",
        salePrice: 13_400,
        stock: 9,
        unitCount: 1,
        purchaseOptions: [{ name: "색상", value: "파랑" }],
      }],
    },
    body: {
      displayCategoryCode: 59631,
      sellerProductName: "복구 검증 상품",
      brand: "SellerPilot",
      deliveryChargeType: "FREE",
      deliveryCharge: 0,
      freeShipOverAmount: 0,
      items: [{
        itemName: "복구 검증 상품",
        externalVendorSku: baseSku,
        barcode: "8802259030799",
        modelNo: "",
        originalPrice: 12_300,
        salePrice: 12_300,
        maximumBuyCount: 7,
        unitCount: 1,
        outboundShippingTimeDay: 2,
        attributes: [{ attributeTypeName: "수량", attributeValueName: "1개" }],
        notices: [{
          noticeCategoryName: "기타 재화",
          noticeCategoryDetailName: "품명 및 모델명",
          content: "복구 검증 상품",
        }],
        certifications: [],
      }],
    },
  };
}

function argumentsValue(overrides: Record<string, unknown> = {}) {
  return {
    contract: coupangDurableCreateReconciliationContract,
    sourceJobId,
    sourceAttemptId,
    listingId,
    sourceProductId,
    sourceRequestSha256,
    expectedVendorId: vendorId,
    expectedCredentialId: credentialId,
    expectedCredentialVersion: 7,
    expectedCredentialFingerprint: "credential-fingerprint-7",
    expectedCredentialVaultSecretId: credentialVaultSecretId,
    expectedCredentialSecretSha256: credentialSecretSha256,
    expectedCredentialSellerAccountKeySource: "credential_incarnation_v1",
    expectedOfficialSourceSnapshotId: officialSnapshotId,
    expectedOfficialSourceSnapshotDigestSha256: "b".repeat(64),
    expectedTransmissionId: transmissionId,
    expectedTransmissionDigestSha256: "c".repeat(64),
    expectedProviderBodySealId: providerBodySealId,
    expectedProviderBodySha256: "d".repeat(64),
    expectedSellerSkus: sellerSkus,
    sourceArguments: sourceArguments(),
    ...overrides,
  };
}

function sellerProduct() {
  return {
    sellerProductId: Number(sellerProductId),
    vendorId,
    items: sellerSkus.map((externalVendorSku, index) => ({
      sellerProductItemId: 3333 + index,
      externalVendorSku,
      itemName: index === 0 ? "빨강 M" : "파랑 L",
    })),
  };
}

function executor(options: {
  lookupVendorId?: string;
  continuation?: boolean;
  divergentIds?: boolean;
  product?: Record<string, unknown>;
  onSale?: boolean;
} = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const request = async (input: { method: string; path: string }) => {
    calls.push({ method: input.method, path: input.path });
    if (input.path.includes("/external-vendor-sku-codes/")) {
      const sku = decodeURIComponent(input.path.split("/").at(-1) ?? "");
      return {
        response: new Response(null, { status: 200 }),
        data: {
          code: "SUCCESS",
          data: [{
            sellerProductId: options.divergentIds && sku === sellerSkus[1]
              ? Number(sellerProductId) + 1
              : Number(sellerProductId),
            vendorId: options.lookupVendorId ?? vendorId,
            externalVendorSku: sku,
          }],
          ...(options.continuation ? { nextToken: "page-2" } : {}),
        },
      };
    }
    if (input.path.includes("/vendor-items/")) {
      return {
        response: new Response(null, { status: 200 }),
        data: { code: "SUCCESS", data: { onSale: options.onSale ?? true } },
      };
    }
    return {
      response: new Response(null, { status: 200 }),
      data: { code: "SUCCESS", data: options.product ?? sellerProduct() },
    };
  };
  return { calls, request };
}

test("durable Coupang CREATE reconciliation performs exact GET-only recovery for every option SKU", async () => {
  const fixture = executor();
  const result = await executeCoupangDurableCreateReconciliation({
    payload: credentialPayload,
    arguments: argumentsValue(),
  }, { request: fixture.request as never });
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.verifiedRemoteId, sellerProductId);
  assert.deepEqual(result.evidence.sellerSkus, sellerSkus);
  assert.deepEqual(result.evidence.sellerProductItemIds, ["3333", "3334"]);
  assert.deepEqual(result.evidence.itemBindings, [
    { sellerSku: sellerSkus[0], sellerProductItemId: "3333" },
    { sellerSku: sellerSkus[1], sellerProductItemId: "3334" },
  ]);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["GET", "GET", "GET"]);
  assert.equal(fixture.calls.some((call) => call.method !== "GET"), false);
});

test("durable recovery carries a compatible official publication GET into internal completion", async () => {
  const product = sellerProduct();
  product.requested = true;
  product.statusName = "APPROVED";
  product.items = (product.items as Array<Record<string, unknown>>).map((item, index) => ({
    ...item,
    vendorItemId: 9000 + index,
    images: [],
    contents: [],
  }));
  const arguments_ = argumentsValue();
  arguments_.sourceArguments = {
    ...sourceArguments(),
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: "c".repeat(64),
    publicationExpectedImageCount: 0,
  };
  const fixture = executor({ product, onSale: true });
  const result = await executeCoupangDurableCreateReconciliation({
    payload: credentialPayload,
    arguments: arguments_ as never,
  }, { request: fixture.request as never });
  assert.equal(result.publicationStateContract, "verified_remote_state_v1");
  assert.equal(result.publicationIntent, "live");
  assert.equal(result.publicationFulfilled, true);
  assert.equal(result.remoteState?.visibility, "live");
  assert.equal(result.remoteState?.resources.sellerProductId, sellerProductId);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["GET", "GET", "GET", "GET", "GET"]);
  assert.equal(fixture.calls.some((call) => call.method !== "GET"), false);
});

test("durable recovery normalizes provider item order into exact source SKU bindings", async () => {
  const product = sellerProduct();
  product.items = [...product.items].reverse();
  const fixture = executor({ product });
  const result = await executeCoupangDurableCreateReconciliation({
    payload: credentialPayload,
    arguments: argumentsValue(),
  }, { request: fixture.request as never });
  assert.deepEqual(result.evidence.itemBindings, [
    { sellerSku: sellerSkus[0], sellerProductItemId: "3333" },
    { sellerSku: sellerSkus[1], sellerProductItemId: "3334" },
  ]);
  assert.deepEqual(result.evidence.sellerProductItemIds, ["3333", "3334"]);
});

test("durable recovery reports a verified pending publication without claiming fulfillment", async () => {
  const product = sellerProduct();
  product.requested = true;
  product.statusName = "PENDING";
  product.items = (product.items as Array<Record<string, unknown>>).map((item, index) => ({
    ...item,
    vendorItemId: 9000 + index,
    images: [],
    contents: [],
  }));
  const arguments_ = argumentsValue();
  arguments_.sourceArguments = {
    ...sourceArguments(),
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedFingerprint: "c".repeat(64),
    publicationExpectedImageCount: 0,
  };
  const result = await executeCoupangDurableCreateReconciliation({
    payload: credentialPayload,
    arguments: arguments_ as never,
  }, { request: executor({ product, onSale: false }).request as never });
  assert.equal(result.remoteState?.visibility, "pending_review");
  assert.equal(result.publicationFulfilled, false);
});

test("durable reconciliation rejects a request not bound to the active credential vendor", async () => {
  const fixture = executor();
  await assert.rejects(
    executeCoupangDurableCreateReconciliation({
      payload: credentialPayload,
      arguments: argumentsValue({ expectedVendorId: "A00099999" }),
    }, { request: fixture.request as never }),
    /COUPANG_CREATE_RECONCILIATION_VENDOR_MISMATCH/u,
  );
  assert.equal(fixture.calls.length, 0);
});

test("durable reconciliation rejects source SKU or Vault secret digest drift before GET", async () => {
  for (const input of [
    {
      payload: credentialPayload,
      arguments: argumentsValue({ expectedSellerSkus: [...sellerSkus].reverse() }),
      expected: /SOURCE_SKU_MISMATCH/u,
    },
    {
      payload: { ...credentialPayload, secret_key: "rotated" },
      arguments: argumentsValue(),
      expected: /CREDENTIAL_SECRET_MISMATCH/u,
    },
  ]) {
    const fixture = executor();
    await assert.rejects(
      executeCoupangDurableCreateReconciliation({
        payload: input.payload,
        arguments: input.arguments,
      }, { request: fixture.request as never }),
      input.expected,
    );
    assert.equal(fixture.calls.length, 0);
  }
});

test("durable reconciliation leaves ambiguous provider evidence unresolved without a write", async () => {
  for (const fixture of [
    executor({ lookupVendorId: "A00099999" }),
    executor({ continuation: true }),
    executor({ divergentIds: true }),
  ]) {
    await assert.rejects(
      executeCoupangDurableCreateReconciliation({
        payload: credentialPayload,
        arguments: argumentsValue(),
      }, { request: fixture.request as never }),
      /COUPANG_CREATE_RECONCILIATION_(?:AMBIGUOUS|IDENTITY_MISMATCH)/u,
    );
    assert.equal(fixture.calls.some((call) => call.method !== "GET"), false);
  }
});

test("durable reconciliation rejects a final seller-product readback with missing option identity", async () => {
  const product = sellerProduct();
  product.items = product.items.slice(0, 1);
  const fixture = executor({ product });
  await assert.rejects(
    executeCoupangDurableCreateReconciliation({
      payload: credentialPayload,
      arguments: argumentsValue(),
    }, { request: fixture.request as never }),
    /COUPANG_CREATE_RECONCILIATION_READBACK_MISMATCH/u,
  );
  assert.equal(fixture.calls.some((call) => call.method !== "GET"), false);
});
