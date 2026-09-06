import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import sharp from "sharp";
import ts from "typescript";
import * as zod from "zod";

import {
  collectSmartstoreManualAdoptionReadback,
  smartstoreManualAdoptionCredentialCauseCode,
  smartstoreManualAdoptionReadbackStateSchema,
  smartstoreManualAdoptionRequestSchema,
  SmartstoreManualAdoptionError,
} from "../lib/server-smartstore-manual-adoption";
import * as manualAdoptionContract from "../lib/server-smartstore-manual-adoption";
import type { RemoteResponse } from "../lib/channels/protocols";

const sellerSku = "AUTO-780720401E2D4E4EA45F";
const originProductNo = "13688607602";
const channelProductNo = "13749310594";
const productId = "11111111-1111-4111-8111-111111111111";
const listingId = "22222222-2222-4222-8222-222222222222";
const readbackJobId = "33333333-3333-4333-8333-333333333333";
const receiptId = "66666666-6666-4666-8666-666666666666";
const attestationId = "77777777-7777-4777-8777-777777777777";
const privateMarker = "PRIVATE_CREDENTIAL_OR_PROVIDER_TEXT";
const routeSource = await readFile(
  new URL("../app/api/admin/products/[id]/smartstore-manual-adoption/route.ts", import.meta.url),
  "utf8",
);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const stateBase = {
  contract: "smartstore_manual_adoption_readback_enqueue_v1",
  productId,
  listingId,
  jobId: readbackJobId,
  reused: false,
  receiptId: null,
  attestationId: null,
  originProductNo: null,
  channelProductNo: null,
  providerMutationPerformed: false,
  contentVerified: false,
  normalUpdateEligible: false,
} as const;

function queuedState(overrides: Record<string, unknown> = {}) {
  return {
    ...stateBase,
    status: "queued",
    reason: "READBACK_QUEUED",
    ...overrides,
  };
}

function runningState(overrides: Record<string, unknown> = {}) {
  return {
    ...stateBase,
    status: "running",
    reason: "READBACK_RUNNING",
    reused: true,
    ...overrides,
  };
}

function reconciliationState() {
  return {
    ...stateBase,
    status: "reconciliation_required",
    reason: "READBACK_RECONCILIATION_REQUIRED",
    reused: true,
  };
}

function verifiedState(overrides: Record<string, unknown> = {}) {
  return {
    ...stateBase,
    status: "verified",
    reason: "ADOPTION_ALREADY_VERIFIED",
    reused: true,
    receiptId,
    attestationId,
    originProductNo,
    channelProductNo,
    contentVerified: true,
    normalUpdateEligible: true,
    ...overrides,
  };
}

function blockedState(
  reason: "PREPARE_BLOCKED" | "READBACK_FAILED" | "NO_READBACK_JOB",
  overrides: Record<string, unknown> = {},
) {
  return {
    ...stateBase,
    status: "blocked",
    reason,
    reused: true,
    ...overrides,
  };
}

async function callRoute(input: {
  method?: "GET" | "POST";
  rpcData: unknown;
  rpcError?: { message?: string; code?: string } | null;
  body?: unknown;
  routeProductId?: string;
  query?: string;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const logs: Array<{ message: string; details: Record<string, unknown> }> = [];
  const context = vm.createContext({
    exports: {},
    Request,
    Response,
    URL,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "zod") return zod;
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({
            user: { id: "88888888-8888-4888-8888-888888888888" },
            serviceClient: {
              rpc: async (rpcName: string, args: Record<string, unknown>) => {
                calls.push({ name: rpcName, args });
                return { data: input.rpcData, error: input.rpcError ?? null };
              },
            },
          }),
          isAdminApiError: (value: unknown) => value instanceof Response,
        };
      }
      if (name.endsWith("/server-smartstore-manual-adoption")) {
        return manualAdoptionContract;
      }
      throw new Error(`unexpected module ${name}`);
    },
    console: {
      error(message: string, details: Record<string, unknown>) {
        logs.push({ message, details });
      },
    },
  });
  vm.runInContext(compiledRoute, context, { timeout: 1_000 });
  const method = input.method ?? "POST";
  const routeProductId = input.routeProductId ?? productId;
  const request = new Request(
    `https://fixture.invalid/api/admin/products/${routeProductId}/smartstore-manual-adoption${input.query ?? ""}`,
    method === "POST"
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body ?? { confirmReadOnlyAdoption: true }),
        }
      : { method },
  );
  const routeResponse = await context.exports[method](request, {
    params: Promise.resolve({ id: routeProductId }),
  });
  return { calls, logs, routeResponse };
}

function imageUrl(index: number) {
  return `https://shop-phinf.pstatic.net/20260907/detail-${index}.jpg`;
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: Response.json(data, { status }),
    data,
    text: JSON.stringify(data),
  };
}

function providerFixture() {
  const detailImageUrls = Array.from({ length: 8 }, (_, index) => imageUrl(index + 1));
  const search = {
    contents: [{
      originProductNo: Number(originProductNo),
      channelProducts: [{
        channelProductNo: Number(channelProductNo),
        sellerManagementCode: sellerSku,
      }],
    }],
    page: 1,
    size: 50,
    totalElements: 1,
    totalPages: 1,
    first: true,
    last: true,
  };
  const origin = {
    originProduct: {
      name: "검증된 수동 등록 상품",
      statusType: "SALE",
      salePrice: 3_190,
      stockQuantity: 10,
      detailContent: detailImageUrls.map((url) => `<img src="${url}">`).join(""),
      images: {
        representativeImage: { url: imageUrl(0) },
        optionalImages: detailImageUrls.map((url) => ({ url })),
      },
      detailAttribute: {
        sellerCodeInfo: { sellerManagementCode: sellerSku },
      },
    },
    smartstoreChannelProduct: {
      channelProductName: "검증된 수동 등록 상품",
      channelProductDisplayStatusType: "ON",
      naverShoppingRegistration: true,
    },
  };
  const channel = {
    originProduct: structuredClone(origin.originProduct),
    smartstoreChannelProduct: {
      channelProductName: "검증된 수동 등록 상품",
      channelProductDisplayStatusType: "ON",
      naverShoppingRegistration: true,
    },
  };
  return { channel, detailImageUrls, origin, search };
}

async function imageBytes(index: number) {
  return sharp({
    create: {
      width: 600,
      height: 600,
      channels: 3,
      background: { r: index * 20, g: 255 - index * 20, b: 100 },
    },
  }).png().toBuffer();
}

test("browser request accepts only an explicit read-only adoption confirmation", () => {
  assert.deepEqual(
    smartstoreManualAdoptionRequestSchema.parse({ confirmReadOnlyAdoption: true }),
    { confirmReadOnlyAdoption: true },
  );
  for (const request of [
    {},
    { confirmReadOnlyAdoption: false },
    { confirmReadOnlyAdoption: true, credentialId: crypto.randomUUID() },
    { confirmReadOnlyAdoption: true, readback: { forged: true } },
    { confirmReadOnlyAdoption: true, normalUpdateEligible: true },
  ]) {
    assert.equal(smartstoreManualAdoptionRequestSchema.safeParse(request).success, false);
  }
});

test("token exchange failures become only allowlisted credential cause codes for the Mac worker", async () => {
  for (const code of [
    "NAVER_CREDENTIALS_MISSING",
    "NAVER_AUTH_FAILED",
    "NAVER_IP_NOT_ALLOWED",
    "NAVER_PROVIDER_UNAVAILABLE",
    "NAVER_TOKEN_EXCHANGE_FAILED",
  ]) {
    assert.equal(smartstoreManualAdoptionCredentialCauseCode(new Error(code)), code);
  }
  assert.equal(
    smartstoreManualAdoptionCredentialCauseCode(new TypeError(privateMarker)),
    "NAVER_TOKEN_EXCHANGE_NETWORK_FAILED",
  );
  assert.equal(
    smartstoreManualAdoptionCredentialCauseCode({ name: "TimeoutError", message: privateMarker }),
    "NAVER_TOKEN_EXCHANGE_TIMEOUT",
  );
  assert.equal(
    smartstoreManualAdoptionCredentialCauseCode(new Error(privateMarker)),
    "NAVER_TOKEN_EXCHANGE_UNKNOWN",
  );
  await assert.rejects(
    collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
      accessToken: async () => {
        throw new Error("NAVER_CREDENTIALS_MISSING");
      },
    }),
    (error: unknown) => error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE"
      && error.causeCode === "NAVER_CREDENTIALS_MISSING",
  );
});

test("queue state schema binds status, reason, identities, and verification flags", () => {
  for (const value of [
    queuedState(),
    runningState(),
    reconciliationState(),
    verifiedState(),
    blockedState("PREPARE_BLOCKED", { listingId: null, jobId: null }),
    blockedState("READBACK_FAILED"),
    blockedState("NO_READBACK_JOB", { listingId: null, jobId: null }),
  ]) {
    assert.equal(smartstoreManualAdoptionReadbackStateSchema.safeParse(value).success, true);
  }
  for (const value of [
    { ...queuedState(), reason: "READBACK_RUNNING" },
    { ...queuedState(), contentVerified: true },
    { ...verifiedState(), receiptId: null },
    { ...verifiedState(), providerRaw: { hidden: true } },
  ]) {
    assert.equal(smartstoreManualAdoptionReadbackStateSchema.safeParse(value).success, false);
  }
});

test("POST enqueues only a server-derived readback job and returns 202", async () => {
  const result = await callRoute({ rpcData: queuedState() });
  assert.equal(result.routeResponse.status, 202);
  assert.deepEqual(structuredClone(result.calls), [{
    name: "sellerpilot_service_enqueue_smartstore_manual_adoption_readback",
    args: {
      p_actor: "88888888-8888-4888-8888-888888888888",
      p_product_id: productId,
    },
  }]);
  const body = await result.routeResponse.json();
  assert.equal(body.status, "queued");
  assert.equal(body.jobId, readbackJobId);
  assert.equal(body.apiCreateSucceeded, false);
  assert.equal(body.providerMutationPerformed, false);
  assert.doesNotMatch(JSON.stringify(body), /credential|readback|READBACK_QUEUED/u);
});

test("a repeated POST reuses the exact running job instead of enqueueing another identity", async () => {
  const result = await callRoute({ rpcData: runningState() });
  assert.equal(result.routeResponse.status, 202);
  assert.equal(result.calls.length, 1);
  const body = await result.routeResponse.json();
  assert.equal(body.status, "running");
  assert.equal(body.jobId, readbackJobId);
  assert.equal(body.reused, true);
});

test("GET polls product-scoped status without accepting browser job or credential identity", async () => {
  const result = await callRoute({ method: "GET", rpcData: runningState() });
  assert.equal(result.routeResponse.status, 202);
  assert.deepEqual(structuredClone(result.calls), [{
    name: "sellerpilot_service_get_smartstore_adoption_readback_status",
    args: {
      p_actor: "88888888-8888-4888-8888-888888888888",
      p_product_id: productId,
    },
  }]);

  const forgedIdentity = await callRoute({
    method: "GET",
    rpcData: runningState(),
    query: `?jobId=${readbackJobId}`,
  });
  assert.equal(forgedIdentity.routeResponse.status, 400);
  assert.equal(forgedIdentity.calls.length, 0);
});

test("every adoption route RPC identifier fits PostgreSQL NAMEDATALEN", () => {
  const rpcNames = [...routeSource.matchAll(/"(sellerpilot_[a-z0-9_]+)"/gu)]
    .map((match) => match[1]!);
  assert.ok(rpcNames.length >= 2);
  for (const rpcName of rpcNames) {
    assert.ok(Buffer.byteLength(rpcName, "utf8") <= 63, `${rpcName} exceeds 63 bytes`);
  }
  assert.ok(rpcNames.includes("sellerpilot_service_get_smartstore_adoption_readback_status"));
});

test("verified queue status preserves the existing UI-safe success contract", async () => {
  const result = await callRoute({ method: "GET", rpcData: verifiedState() });
  assert.equal(result.routeResponse.status, 200);
  const body = await result.routeResponse.json();
  assert.deepEqual(body, {
    ok: true,
    status: "verified",
    receiptId,
    attestationId,
    productId,
    listingId,
    originProductNo,
    channelProductNo,
    normalUpdateEligible: true,
    apiCreateSucceeded: false,
    providerMutationPerformed: false,
    contentVerified: true,
    reused: true,
    message: "기존 상품 연결 확인 완료",
  });
});

test("reconciliation stops polling and never re-enqueues", async () => {
  const result = await callRoute({ method: "GET", rpcData: reconciliationState() });
  assert.equal(result.routeResponse.status, 409);
  assert.equal(result.calls[0]?.name, "sellerpilot_service_get_smartstore_adoption_readback_status");
  const body = await result.routeResponse.json();
  assert.equal(body.status, "reconciliation_required");
  assert.equal(body.jobId, readbackJobId);
  assert.doesNotMatch(JSON.stringify(body), /READBACK_RECONCILIATION_REQUIRED/u);
});

for (const [reason, expectedStatus, expectedMode] of [
  ["PREPARE_BLOCKED", 409, "smartstore_manual_adoption_not_ready"],
  ["READBACK_FAILED", 409, "smartstore_manual_adoption_readback_failed"],
  ["NO_READBACK_JOB", 404, "smartstore_manual_adoption_job_not_found"],
] as const) {
  test(`${reason} becomes a safe terminal response`, async () => {
    const nullIdentity = reason === "NO_READBACK_JOB" || reason === "PREPARE_BLOCKED";
    const result = await callRoute({
      method: "GET",
      rpcData: blockedState(reason, nullIdentity ? { listingId: null, jobId: null } : {}),
    });
    assert.equal(result.routeResponse.status, expectedStatus);
    const body = await result.routeResponse.json();
    assert.equal(body.mode, expectedMode);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(reason, "u"));
  });
}

test("malformed or cross-product service output fails closed without leaking values", async () => {
  for (const rpcData of [
    { ...queuedState(), providerRaw: privateMarker },
    queuedState({ productId: "99999999-9999-4999-8999-999999999999" }),
  ]) {
    const result = await callRoute({ rpcData });
    assert.equal(result.routeResponse.status, 503);
    const body = await result.routeResponse.json();
    assert.equal(body.mode, "smartstore_manual_adoption_backend_unavailable");
    assert.doesNotMatch(JSON.stringify({ body, logs: result.logs }), new RegExp(privateMarker, "u"));
  }
});

test("known lineage RPC failures remain safe 409 responses", async () => {
  const result = await callRoute({
    rpcData: null,
    rpcError: {
      code: "P0001",
      message: `SMARTSTORE_MANUAL_ADOPTION_SOURCE_TUPLE_OR_APPROVAL_DRIFT:${privateMarker}`,
    },
  });
  assert.equal(result.routeResponse.status, 409);
  const body = await result.routeResponse.json();
  assert.equal(body.mode, "smartstore_manual_adoption_not_ready");
  assert.doesNotMatch(JSON.stringify({ body, logs: result.logs }), new RegExp(privateMarker, "u"));
});
test("official search and two GETs discover one exact product and preserve eight image hash positions", async () => {
  const fixture = providerFixture();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const result = await collectSmartstoreManualAdoptionReadback({
    credential: { access_token: "secret-not-returned" },
    target: { sellerSku },
  }, {
    accessToken: async () => "secret-not-returned",
    now: () => new Date("2026-09-07T04:00:00.000Z"),
    request: async (input) => {
      calls.push({ method: input.method, path: input.path, body: input.body });
      if (input.path === "/v1/products/search") return remote(fixture.search);
      if (input.path.endsWith(originProductNo)) return remote(fixture.origin);
      if (input.path.endsWith(channelProductNo)) return remote(fixture.channel);
      throw new Error(`unexpected request ${input.method} ${input.path}`);
    },
    downloadImage: async (url) => ({
      bytes: await imageBytes(fixture.detailImageUrls.indexOf(url) + 1),
      contentType: "image/png",
    }),
  });

  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
    "POST /v1/products/search",
    `GET /v2/products/origin-products/${originProductNo}`,
    `GET /v2/products/channel-products/${channelProductNo}`,
  ]);
  assert.deepEqual(calls[0]?.body, {
    searchKeywordType: "SELLER_CODE",
    sellerManagementCode: sellerSku,
    page: 1,
    size: 50,
    orderType: "NO",
  });
  assert.equal(result.contract, "smartstore_official_manual_adoption_readback_v1");
  assert.equal(result.source, "smartstore_official_api_readback_v1");
  assert.equal(result.providerMutationPerformed, false);
  assert.deepEqual(result.detailImageUrls, fixture.detailImageUrls);
  assert.equal(result.detailImagePixelSha256s.length, 8);
  assert.equal(new Set(result.detailImagePixelSha256s).size, 8);
  assert.deepEqual(Object.keys(result).sort(), [
    "channelReadback",
    "contract",
    "detailImagePixelSha256s",
    "detailImageUrls",
    "observedAt",
    "originReadback",
    "providerMutationPerformed",
    "searchReadback",
    "source",
  ]);
  assert.deepEqual(Object.keys(result.searchReadback).sort(), [
    "httpStatus", "method", "path", "request", "response",
  ]);
  assert.deepEqual(Object.keys(result.originReadback).sort(), [
    "httpStatus", "method", "path", "request", "response",
  ]);
  assert.deepEqual(Object.keys(result.channelReadback).sort(), [
    "httpStatus", "method", "path", "request", "response",
  ]);
  assert.equal(result.originReadback.request, null);
  assert.equal(result.channelReadback.request, null);
  assert.doesNotMatch(JSON.stringify(result), /secret-not-returned/u);
});

test("ambiguous SELLER_CODE search fails before any product GET or image download", async () => {
  const fixture = providerFixture();
  const calls: string[] = [];
  let downloads = 0;
  fixture.search.contents.push(structuredClone(fixture.search.contents[0]!));
  fixture.search.totalElements = 2;
  await assert.rejects(
    collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
      accessToken: async () => "token",
      request: async (input) => {
        calls.push(input.path);
        return remote(fixture.search);
      },
      downloadImage: async () => {
        downloads += 1;
        return { bytes: await imageBytes(1), contentType: "image/png" };
      },
    }),
    (error: unknown) => error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_SEARCH_IDENTITY_MISMATCH",
  );
  assert.deepEqual(calls, ["/v1/products/search"]);
  assert.equal(downloads, 0);
});

for (const [label, mutate] of [
  ["missing pagination evidence", (search: Record<string, unknown>) => {
    delete search.totalElements;
  }],
  ["a hidden next page", (search: Record<string, unknown>) => {
    search.totalElements = 51;
    search.totalPages = 2;
    search.last = false;
  }],
  ["string pagination metadata", (search: Record<string, unknown>) => {
    search.totalElements = "1";
  }],
  ["inconsistent zero total pages", (search: Record<string, unknown>) => {
    search.totalPages = 0;
  }],
] as const) {
  test(`${label} cannot prove the SELLER_CODE result is unique`, async () => {
    const fixture = providerFixture();
    mutate(fixture.search);
    const calls: string[] = [];
    await assert.rejects(
      collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
        accessToken: async () => "token",
        request: async (input) => {
          calls.push(input.path);
          return remote(fixture.search);
        },
        downloadImage: async () => {
          throw new Error("incomplete search must not download images");
        },
      }),
      (error: unknown) => error instanceof SmartstoreManualAdoptionError
        && error.code === "SMARTSTORE_MANUAL_SEARCH_UNVERIFIED",
    );
    assert.deepEqual(calls, ["/v1/products/search"]);
  });
}

for (const [label, changedPath, changedStatus, expectedCode] of [
  ["search 201", "/v1/products/search", 201, "SMARTSTORE_MANUAL_SEARCH_UNVERIFIED"],
  ["origin 202", `/v2/products/origin-products/${originProductNo}`, 202, "SMARTSTORE_MANUAL_ORIGIN_HTTP_STATUS_INVALID"],
  ["channel 206", `/v2/products/channel-products/${channelProductNo}`, 206, "SMARTSTORE_MANUAL_CHANNEL_HTTP_STATUS_INVALID"],
] as const) {
  test(`official ${label} never becomes HTTP 200 evidence`, async () => {
    const fixture = providerFixture();
    let downloads = 0;
    await assert.rejects(
      collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
        accessToken: async () => "token",
        request: async (input) => {
          const status = input.path === changedPath ? changedStatus : 200;
          if (input.path === "/v1/products/search") return remote(fixture.search, status);
          if (input.path.endsWith(originProductNo)) return remote(fixture.origin, status);
          return remote(fixture.channel, status);
        },
        downloadImage: async () => {
          downloads += 1;
          return { bytes: await imageBytes(1), contentType: "image/png" };
        },
      }),
      (error: unknown) => error instanceof SmartstoreManualAdoptionError
        && error.code === expectedCode,
    );
    assert.equal(downloads, 0);
  });
}

for (const [label, changedPath, expectedCode] of [
  ["origin", `/v2/products/origin-products/${originProductNo}`, "SMARTSTORE_MANUAL_ORIGIN_PROVIDER_REJECTED"],
  ["channel", `/v2/products/channel-products/${channelProductNo}`, "SMARTSTORE_MANUAL_CHANNEL_PROVIDER_REJECTED"],
] as const) {
  test(`official ${label} 200 response with a provider error code is rejected safely`, async () => {
    const fixture = providerFixture();
    let downloads = 0;
    await assert.rejects(
      collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
        accessToken: async () => "token",
        request: async (input) => {
          const data = input.path === "/v1/products/search"
            ? fixture.search
            : input.path.endsWith(originProductNo)
              ? fixture.origin
              : fixture.channel;
          return remote(
            input.path === changedPath ? { ...data, code: "PROVIDER_REJECTED" } : data,
          );
        },
        downloadImage: async () => {
          downloads += 1;
          return { bytes: await imageBytes(1), contentType: "image/png" };
        },
      }),
      (error: unknown) => error instanceof SmartstoreManualAdoptionError
        && error.code === expectedCode,
    );
    assert.equal(downloads, 0);
  });
}

test("official v2 GET bodies need no undocumented product-number echoes", async () => {
  const fixture = providerFixture();
  let downloads = 0;
  const result = await collectSmartstoreManualAdoptionReadback(
    { credential: {}, target: { sellerSku } },
    {
      accessToken: async () => "token",
      request: async (input) => input.path === "/v1/products/search"
        ? remote(fixture.search)
        : input.path.endsWith(originProductNo)
          ? remote(fixture.origin)
          : remote(fixture.channel),
      downloadImage: async (url) => {
        downloads += 1;
        return {
          bytes: await imageBytes(fixture.detailImageUrls.indexOf(url) + 1),
          contentType: "image/png",
        };
      },
    },
  );
  assert.equal(result.originReadback.path, `/v2/products/origin-products/${originProductNo}`);
  assert.equal(result.channelReadback.path, `/v2/products/channel-products/${channelProductNo}`);
  assert.equal(downloads, 8);
});

for (const [label, mutate, expectedCode] of [
  ["missing originProduct", (fixture: ReturnType<typeof providerFixture>) => {
    delete (fixture.origin as Record<string, unknown>).originProduct;
  }, "SMARTSTORE_MANUAL_ORIGIN_PAYLOAD_INVALID"],
  ["missing smartstoreChannelProduct", (fixture: ReturnType<typeof providerFixture>) => {
    delete (fixture.channel as Record<string, unknown>).smartstoreChannelProduct;
  }, "SMARTSTORE_MANUAL_CHANNEL_PAYLOAD_INVALID"],
  ["missing channel originProduct", (fixture: ReturnType<typeof providerFixture>) => {
    delete (fixture.channel as Record<string, unknown>).originProduct;
  }, "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PAYLOAD_INVALID"],
  ["origin response ID drift", (fixture: ReturnType<typeof providerFixture>) => {
    (fixture.origin as Record<string, unknown>).originProductNo = 99999999999;
  }, "SMARTSTORE_MANUAL_ORIGIN_IDENTITY_MISMATCH"],
  ["channel response ID drift", (fixture: ReturnType<typeof providerFixture>) => {
    (fixture.channel.smartstoreChannelProduct as Record<string, unknown>).originProductNo = 99999999999;
  }, "SMARTSTORE_MANUAL_CHANNEL_IDENTITY_MISMATCH"],
  ["origin seller code drift", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.origin.originProduct.detailAttribute.sellerCodeInfo.sellerManagementCode = "OTHER-SKU";
  }, "SMARTSTORE_MANUAL_ORIGIN_SELLER_SKU_MISMATCH"],
  ["channel seller code drift", (fixture: ReturnType<typeof providerFixture>) => {
    (fixture.channel.smartstoreChannelProduct as Record<string, unknown>).sellerManagementCode = "OTHER-SKU";
  }, "SMARTSTORE_MANUAL_CHANNEL_SELLER_SKU_MISMATCH"],
  ["origin is not on sale", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.origin.originProduct.statusType = "OUTOFSTOCK";
  }, "SMARTSTORE_MANUAL_ORIGIN_STATUS_MISMATCH"],
  ["channel is not displayed", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.channel.smartstoreChannelProduct.channelProductDisplayStatusType = "SUSPENSION";
  }, "SMARTSTORE_MANUAL_CHANNEL_STATUS_MISMATCH"],
  ["channel origin seller code drift", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.channel.originProduct.detailAttribute.sellerCodeInfo.sellerManagementCode = "OTHER-SKU";
  }, "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_SELLER_SKU_MISMATCH"],
  ["channel origin is not on sale", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.channel.originProduct.statusType = "OUTOFSTOCK";
  }, "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_STATUS_MISMATCH"],
  ["channel origin critical content drift", (fixture: ReturnType<typeof providerFixture>) => {
    fixture.channel.originProduct.name = "다른 상품";
  }, "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PRODUCT_MISMATCH"],
] as const) {
  test(`${label} has a safe granular failure before image verification`, async () => {
    const fixture = providerFixture();
    mutate(fixture);
    let downloads = 0;
    await assert.rejects(
      collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
        accessToken: async () => "token",
        request: async (input) => input.path === "/v1/products/search"
          ? remote(fixture.search)
          : input.path.endsWith(originProductNo)
            ? remote(fixture.origin)
            : remote(fixture.channel),
        downloadImage: async () => {
          downloads += 1;
          return { bytes: await imageBytes(1), contentType: "image/png" };
        },
      }),
      (error: unknown) => error instanceof SmartstoreManualAdoptionError
        && error.code === expectedCode,
    );
    assert.equal(downloads, 0);
  });
}

test("cross-bound origin/channel identity fails closed before image verification", async () => {
  const fixture = providerFixture();
  (fixture.channel.smartstoreChannelProduct as Record<string, unknown>).originProductNo = 99999999999;
  let downloads = 0;
  await assert.rejects(
    collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
      accessToken: async () => "token",
      request: async (input) => input.path === "/v1/products/search"
        ? remote(fixture.search)
        : input.path.endsWith(originProductNo)
          ? remote(fixture.origin)
          : remote(fixture.channel),
      downloadImage: async () => {
        downloads += 1;
        return { bytes: await imageBytes(1), contentType: "image/png" };
      },
    }),
    (error: unknown) => error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_CHANNEL_IDENTITY_MISMATCH",
  );
  assert.equal(downloads, 0);
});

test("eight URLs with repeated decoded pixels do not become verified content", async () => {
  const fixture = providerFixture();
  const repeated = await imageBytes(1);
  await assert.rejects(
    collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
      accessToken: async () => "token",
      request: async (input) => input.path === "/v1/products/search"
        ? remote(fixture.search)
        : input.path.endsWith(originProductNo)
          ? remote(fixture.origin)
          : remote(fixture.channel),
      downloadImage: async () => ({ bytes: repeated, contentType: "image/png" }),
    }),
    (error: unknown) => error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_DETAIL_IMAGES_NOT_DISTINCT",
  );
});

test("a syntactically valid but undersized image cannot become approved detail content", async () => {
  const fixture = providerFixture();
  const tiny = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  }).png().toBuffer();
  await assert.rejects(
    collectSmartstoreManualAdoptionReadback({ credential: {}, target: { sellerSku } }, {
      accessToken: async () => "token",
      request: async (input) => input.path === "/v1/products/search"
        ? remote(fixture.search)
        : input.path.endsWith(originProductNo)
          ? remote(fixture.origin)
          : remote(fixture.channel),
      downloadImage: async () => ({ bytes: tiny, contentType: "image/png" }),
    }),
    (error: unknown) => error instanceof SmartstoreManualAdoptionError
      && error.code === "SMARTSTORE_MANUAL_DETAIL_IMAGE_INVALID",
  );
});
