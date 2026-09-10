import assert from "node:assert/strict";
import test from "node:test";
import { executeCoupang } from "../lib/product-registration/channels/coupang";
import { verifyCoupangCreateReadback } from "../lib/product-registration/coupang/create-readback";

const vendorId = "A00012345";
const sellerProductId = "987654321";
const sellerSku = "SELLERPILOT-GENERAL-001";

function requestBody() {
  return {
    sellerProductName: "일반 등록 검증 상품",
    brand: "SellerPilotBrand",
    requested: false,
    items: [{
      itemName: "일반 등록 검증 옵션",
      externalVendorSku: sellerSku,
      barcode: "8802259030799",
      emptyBarcode: false,
      maximumBuyCount: 1,
      unitCount: 1,
      attributes: [{
        attributeTypeName: "수량",
        attributeValueName: "1개",
        exposed: "EXPOSED",
      }],
    }],
  };
}

async function createWithReadback(readback: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => init?.method === "POST"
    ? Response.json({ code: "SUCCESS", data: Number(sellerProductId) })
    : Response.json({ code: "SUCCESS", data: readback });
  try {
    return await executeCoupang({
      channel: "coupang",
      operation: "listing.create",
      payload: {
        vendor_id: vendorId,
        access_key: "fixture-access",
        secret_key: "fixture-secret",
      },
      arguments: { body: requestBody() },
      environment: "production",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function validReadback(overrides: Record<string, unknown> = {}) {
  return {
    sellerProductId: Number(sellerProductId),
    vendorId,
    statusName: "임시저장",
    requested: false,
    items: [{
      sellerProductItemId: 123456789,
      externalVendorSku: sellerSku,
    }],
    ...overrides,
  };
}

test("Coupang CREATE readback binds product, vendor, seller SKU and option item ID", async () => {
  const result = await createWithReadback(validReadback());
  assert.equal(result.ok, true);
  assert.equal(
    result.steps.at(-1)?.data.sellerpilotCreateIdentity,
    "COUPANG_CREATE_IDENTITY_VERIFIED",
  );
  assert.equal(
    result.steps.at(-1)?.data.sellerpilotObservedSellerProductItemIdCount,
    1,
  );
});

test("Coupang CREATE fails closed when the authenticated vendor is not the readback owner", async () => {
  const result = await createWithReadback(validReadback({ vendorId: "A00999999" }));
  assert.equal(result.ok, false);
  assert.equal(
    result.steps.at(-1)?.data.sellerpilotCreateIdentity,
    "COUPANG_CREATE_VENDOR_ID_MISMATCH",
  );
});

test("Coupang CREATE fails closed on SKU substitution or a missing option item ID", async () => {
  const substituted = await createWithReadback(validReadback({
    items: [{ sellerProductItemId: 123456789, externalVendorSku: "OTHER-SKU" }],
  }));
  assert.equal(substituted.ok, false);
  assert.equal(
    substituted.steps.at(-1)?.data.sellerpilotCreateIdentity,
    "COUPANG_CREATE_SELLER_SKU_MISMATCH",
  );

  const missingItemId = await createWithReadback(validReadback({
    items: [{ externalVendorSku: sellerSku }],
  }));
  assert.equal(missingItemId.ok, false);
  assert.equal(
    missingItemId.steps.at(-1)?.data.sellerpilotCreateIdentity,
    "COUPANG_CREATE_ITEM_ID_MISSING",
  );
});

test("Coupang readback rejects an incomplete or structurally invalid requested SKU set", () => {
  for (const items of [
    [],
    [{}],
    [{ externalVendorSku: sellerSku }, {}],
    [{ externalVendorSku: sellerSku }, { externalVendorSku: sellerSku }],
    [{ externalVendorSku: sellerSku }, "invalid-item"],
  ]) {
    const verification = verifyCoupangCreateReadback({
      requestBody: { items },
      sellerProduct: validReadback(),
      expectedVendorId: vendorId,
      expectedSellerProductId: sellerProductId,
    });
    assert.equal(verification.ok, false, JSON.stringify(items));
    assert.equal(verification.code, "COUPANG_CREATE_SELLER_SKU_MISMATCH");
  }
});

test("Coupang malformed CREATE items fail before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    await assert.rejects(
      executeCoupang({
        channel: "coupang",
        operation: "listing.create",
        payload: {
          vendor_id: vendorId,
          access_key: "fixture-access",
          secret_key: "fixture-secret",
        },
        arguments: { body: { brand: "SellerPilotBrand", items: [{ externalVendorSku: "" }, null] } },
        environment: "production",
      }),
      /COUPANG_CREATE_ITEMS_REQUIRED_OR_INVALID/,
    );
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
