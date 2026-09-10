import assert from "node:assert/strict";
import test from "node:test";
import { processCommerceGatewayJob } from "../scripts/commerce-gateway-job.mjs";

const jobId = "71000000-0000-4000-8000-000000000001";
const claimToken = "71000000-0000-4000-8000-000000000002";
const credentialId = "71000000-0000-4000-8000-000000000003";
const vendorId = "A00012345";
const sellerSku = "SELLERPILOT-LOCAL-BOUNDARY-001";

function validBody() {
  return {
    sellerProductName: "로컬 전송 경계 검증 상품",
    displayProductName: "로컬 전송 경계 검증 상품",
    brand: "SellerPilotBrand",
    displayCategoryCode: 59631,
    requested: false,
    items: [{
      itemName: "로컬 전송 경계 검증 옵션",
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
      images: [{
        imageOrder: 0,
        imageType: "REPRESENTATION",
        vendorPath: "https://cdn.example/item.jpg",
      }],
      contents: [{
        contentsType: "IMAGE",
        contentDetails: [{
          content: "https://cdn.example/detail.jpg",
          detailType: "IMAGE",
        }],
      }],
    }],
  };
}

function job(body: Record<string, unknown>) {
  return {
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "coupang",
    operation: "listing.create",
    environment: "production",
    request: {
      arguments: {
        body,
        sellerpilotCoupangCreateTransmission: {
          contract: "sellerpilot_coupang_create_transmission_v1",
        },
      },
    },
    credential: {
      vendor_id: vendorId,
      access_key: "fixture-access",
      secret_key: "fixture-secret",
    },
  };
}

function heartbeat() {
  return {
    start: async () => undefined,
    assertHealthy: async () => undefined,
    stop: async () => undefined,
  };
}

test("local Coupang CREATE seals the exact final body at the executor POST boundary", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const persistence: Array<{ path: string; body: Record<string, unknown> }> = [];
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
    await processCommerceGatewayJob(job(validBody()), {
      createGatewayHeartbeat: heartbeat,
      persistWorkerCompletion: async (path: string, body: Record<string, unknown>) => {
        persistence.push({ path, body: structuredClone(body) });
        if (path === "/api/channel-gateway/worker/begin-mutation") events.push("seal");
        return Response.json({ status: "recorded" });
      },
      prepareListingArguments: async (input: { arguments: Record<string, unknown> }) => ({
        arguments: input.arguments,
        mediaMutationObserved: false,
      }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const begins = persistence.filter(({ path }) =>
    path === "/api/channel-gateway/worker/begin-mutation");
  assert.equal(begins.length, 1);
  assert.deepEqual(events.slice(0, 2), ["seal", "post"]);
  assert.deepEqual(begins[0]?.body.providerBody, postedBody);
  assert.equal((begins[0]?.body.providerBody as Record<string, unknown>).vendorId, vendorId);
  assert.equal(persistence.find(({ path }) =>
    path === "/api/channel-gateway/worker/complete")?.body.status, "succeeded");
});

test("local Coupang CREATE records no mutation boundary and performs zero POSTs when final body validation fails", async () => {
  const originalFetch = globalThis.fetch;
  const persistence: Array<{ path: string; body: Record<string, unknown> }> = [];
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ code: "SUCCESS" });
  };
  try {
    await processCommerceGatewayJob(job({ sellerProductName: "invalid" }), {
      createGatewayHeartbeat: heartbeat,
      persistWorkerCompletion: async (path: string, body: Record<string, unknown>) => {
        persistence.push({ path, body: structuredClone(body) });
        return Response.json({ status: "recorded" });
      },
      prepareListingArguments: async (input: { arguments: Record<string, unknown> }) => ({
        arguments: input.arguments,
        mediaMutationObserved: false,
      }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(providerCalls, 0);
  assert.equal(persistence.filter(({ path }) =>
    path === "/api/channel-gateway/worker/begin-mutation").length, 0);
  assert.equal(persistence.find(({ path }) =>
    path === "/api/channel-gateway/worker/complete")?.body.status, "failed");
});
