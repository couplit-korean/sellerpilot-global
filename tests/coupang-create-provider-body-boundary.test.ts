import assert from "node:assert/strict";
import test from "node:test";
import { executeCoupang } from "../lib/product-registration/channels/coupang";

const vendorId = "A00012345";
const sellerSku = "SELLERPILOT-BOUNDARY-001";

function inputBody() {
  return {
    sellerProductName: "전송 경계 검증 상품",
    displayProductName: "전송 경계 검증 상품",
    brand: "SellerPilotBrand",
    displayCategoryCode: 59631,
    deliveryCharge: 3000,
    requested: false,
    items: [{
      itemName: "전송 경계 검증 옵션",
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
      notices: [{
        noticeCategoryName: "기타 재화",
        noticeCategoryDetailName: "품명",
        content: "전송 경계 검증 상품",
      }],
      images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://cdn.example/item.jpg" }],
      contents: [{ contentsType: "IMAGE", contentDetails: [{ content: "https://cdn.example/detail.jpg", detailType: "IMAGE" }] }],
    }],
  };
}

function execute(
  providerMutationHooks: NonNullable<Parameters<typeof executeCoupang>[0]["providerMutationHooks"]>,
  body: Record<string, unknown> = inputBody(),
) {
  return executeCoupang({
    channel: "coupang",
    operation: "listing.create",
    payload: {
      vendor_id: vendorId,
      access_key: "fixture-access",
      secret_key: "fixture-secret",
    },
    arguments: {
      body,
      sellerpilotCoupangCreateTransmission: { contract: "sellerpilot_coupang_create_transmission_v1" },
    },
    environment: "production",
    providerMutationHooks,
  });
}

test("Coupang seals the exact same final body immediately before one CREATE POST", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  let sealedBody: Record<string, unknown> | undefined;
  let postedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_request, init) => {
    if (init?.method === "POST") {
      events.push("post");
      postedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ code: "SUCCESS", data: 987654321 });
    }
    return Response.json({ code: "SUCCESS", data: {
      sellerProductId: 987654321,
      vendorId,
      statusName: "임시저장",
      requested: false,
      items: [{ sellerProductItemId: 123456789, externalVendorSku: sellerSku }],
    } });
  };
  try {
    const result = await execute({
      assertLeaseHealthy: async () => { events.push("lease"); },
      begin: async (boundary) => {
        events.push("seal");
        sealedBody = structuredClone(boundary?.providerBody);
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events.slice(0, 4), ["lease", "seal", "lease", "post"]);
    assert.deepEqual(postedBody, sealedBody);
    assert.equal(events.filter((event) => event === "post").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang performs zero provider calls when exact-body sealing fails", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (_request, init) => {
    if (init?.method === "POST") providerCalls += 1;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    await assert.rejects(execute({
      assertLeaseHealthy: async () => undefined,
      begin: async () => { throw new Error("SEAL_REJECTED"); },
    }), /SEAL_REJECTED/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stable provider-body mutations are rejected before every Coupang POST", async () => {
  const cases: Array<[string, (body: ReturnType<typeof inputBody>) => void]> = [
    ["deliveryCharge", (body) => { body.deliveryCharge = 7777; }],
    ["attribute", (body) => { body.items[0].attributes[0].attributeValueName = "파랑"; }],
    ["notice", (body) => { body.items[0].notices[0].content = "변조 품명"; }],
    ["requested", (body) => { body.requested = true; }],
  ];
  const originalFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (_request, init) => {
    if (init?.method === "POST") posts += 1;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    for (const [name, mutate] of cases) {
      const body = structuredClone(inputBody());
      mutate(body);
      await assert.rejects(execute({
        assertLeaseHealthy: async () => undefined,
        begin: async ({ providerBody }) => {
          assert.deepEqual(providerBody, { ...body, vendorId });
          throw new Error(`DB_EXACT_BODY_SEAL_REJECTED:${name}`);
        },
      }, body), new RegExp(`DB_EXACT_BODY_SEAL_REJECTED:${name}`));
    }
    assert.equal(posts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a transmission-bound CREATE cannot bypass the provider-body hook", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (_request, init) => {
    if (init?.method === "POST") providerCalls += 1;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    await assert.rejects(executeCoupang({
      channel: "coupang",
      operation: "listing.create",
      payload: { vendor_id: vendorId, access_key: "a", secret_key: "s" },
      arguments: {
        body: inputBody(),
        sellerpilotCoupangCreateTransmission: { contract: "sellerpilot_coupang_create_transmission_v1" },
      },
      environment: "production",
    }), /COUPANG_CREATE_PROVIDER_BODY_FENCE_REQUIRED/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
