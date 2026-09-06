import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import sharp from "sharp";
import ts from "typescript";
import * as zod from "zod";

import {
  collectSmartstoreManualAdoptionReadback,
  smartstoreManualAdoptionCommitSchema,
  smartstoreManualAdoptionPreparationSchema,
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
const sourceJobId = "33333333-3333-4333-8333-333333333333";
const sourceAttemptId = "44444444-4444-4444-8444-444444444444";
const credentialId = "55555555-5555-4555-8555-555555555555";
const receiptId = "66666666-6666-4666-8666-666666666666";
const attestationId = "77777777-7777-4777-8777-777777777777";
const digest = "a".repeat(64);
const routeSource = await readFile(
  new URL("../app/api/admin/products/[id]/smartstore-manual-adoption/route.ts", import.meta.url),
  "utf8",
);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const prepareBase = {
  contract: "smartstore_manual_adoption_prepare_v1",
  productId,
  sellerSku,
  remoteCreationOriginAsserted: false,
  apiCreateSucceeded: false,
  providerMutationPerformed: false,
  normalUpdateEligibilityScope: "database_linkage_only",
  publicationGateOpenAsserted: false,
} as const;

function blockedPreparation(reason: string, overrides: Record<string, unknown> = {}) {
  return {
    ...prepareBase,
    status: "blocked",
    reason,
    listingId: null,
    sourceJobId: null,
    sourceAttemptId: null,
    credentialId: null,
    originProductNo: null,
    channelProductNo: null,
    approvalRevision: null,
    contentSha256: null,
    manifestDigest: null,
    receiptId: null,
    attestationId: null,
    provenance: null,
    contentVerified: false,
    normalUpdateEligible: false,
    reused: false,
    ...overrides,
  };
}

async function callRoute(
  preparedData: unknown,
  preparedError: { message: string } | null = null,
) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let providerCollections = 0;
  const context = vm.createContext({
    AbortSignal,
    exports: {},
    Request,
    Response,
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
                if (rpcName === "sellerpilot_service_prepare_smartstore_manual_adoption") {
                  return { data: preparedData, error: preparedError };
                }
                throw new Error(`unexpected RPC ${rpcName}`);
              },
            },
          }),
          isAdminApiError: (value: unknown) => value instanceof Response,
        };
      }
      if (name.endsWith("/server-smartstore-manual-adoption")) {
        return {
          ...manualAdoptionContract,
          collectSmartstoreManualAdoptionReadback: async () => {
            providerCollections += 1;
            throw new Error("blocked preparation must not reach provider readback");
          },
        };
      }
      throw new Error(`unexpected module ${name}`);
    },
  });
  vm.runInContext(compiledRoute, context, { timeout: 1_000 });
  const request = new Request(`https://fixture.invalid/api/admin/products/${productId}/smartstore-manual-adoption`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmReadOnlyAdoption: true }),
  });
  const routeResponse = await context.exports.POST(request, {
    params: Promise.resolve({ id: productId }),
  });
  return { calls, providerCollections, routeResponse };
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
    originProductNo: Number(originProductNo),
    smartstoreChannelProductNo: Number(channelProductNo),
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
  };
  const channel = {
    originProductNo: Number(originProductNo),
    smartstoreChannelProductNo: Number(channelProductNo),
    smartstoreChannelProduct: {
      originProductNo: Number(originProductNo),
      channelProductNo: Number(channelProductNo),
      channelProductName: "검증된 수동 등록 상품",
      channelProductDisplayStatusType: "ON",
      sellerManagementCode: sellerSku,
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

test("preparation and commit schemas preserve blocked nullability and exact verified invariants", () => {
  assert.equal(
    smartstoreManualAdoptionPreparationSchema.safeParse(
      blockedPreparation("source_count=0"),
    ).success,
    true,
  );
  assert.equal(
    smartstoreManualAdoptionPreparationSchema.safeParse(blockedPreparation("tuple_drift", {
      listingId,
      sourceJobId,
      sourceAttemptId,
      credentialId,
      approvalRevision: 1,
      contentSha256: digest,
      manifestDigest: digest,
    })).success,
    true,
  );

  const committed = {
    contract: "smartstore_manual_adoption_verified_v1",
    status: "verified",
    receiptId,
    attestationId,
    productId,
    listingId,
    sourceJobId,
    sourceAttemptId,
    credentialId,
    originProductNo,
    channelProductNo,
    sellerSku,
    normalUpdateEligible: true,
    apiCreateSucceeded: false,
    providerMutationPerformed: false,
    contentVerified: true,
    provenance: "manual_adoption_verified",
    remoteCreationOriginAsserted: false,
    normalUpdateEligibilityScope: "database_linkage_only",
    publicationGateOpenAsserted: false,
    sourcePreserved: true,
    reused: false,
  };
  assert.equal(smartstoreManualAdoptionCommitSchema.safeParse(committed).success, true);
  assert.equal(smartstoreManualAdoptionCommitSchema.safeParse({
    ...committed,
    reused: true,
  }).success, false);
  assert.equal(smartstoreManualAdoptionCommitSchema.safeParse({
    ...committed,
    providerRaw: { forged: true },
  }).success, false);
});

for (const [reason, expectedMessage, overrides] of [
  [
    "SOURCE_RECONCILIATION_REQUIRED",
    "이 상품에 연결할 스마트스토어 등록 실패 기록을 찾지 못해 기존 상품 연결을 시작하지 않았습니다.",
    {},
  ],
  ["SOURCE_TUPLE_OR_APPROVAL_NOT_CURRENT", "현재 상품·판매자 계정·승인 이미지와 기존 스마트스토어 등록 기록이 모두 일치하지 않아 연결하지 않았습니다.", {
    listingId,
    sourceJobId,
    sourceAttemptId,
    credentialId,
    approvalRevision: 1,
    contentSha256: digest,
    manifestDigest: digest,
  }],
] as const) {
  test(`legitimate ${reason} preparation remains a 409 without privileged follow-up`, async () => {
    const result = await callRoute(blockedPreparation(reason, overrides));
    assert.equal(result.routeResponse.status, 409);
    assert.equal(result.routeResponse.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(result.calls.map((call) => call.name), [
      "sellerpilot_service_prepare_smartstore_manual_adoption",
    ]);
    assert.equal(result.providerCollections, 0);
    const body = await result.routeResponse.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, "blocked");
    assert.equal(body.message, expectedMessage);
    assert.doesNotMatch(body.message, /SOURCE_|TUPLE|APPROVAL/u);
    assert.doesNotMatch(JSON.stringify(body), /credential|sourceJob|sourceAttempt|contentSha|manifest/u);
  });
}

for (const [sqlCode, expectedStatus, expectedMode] of [
  ["SMARTSTORE_MANUAL_ADOPTION_REMOTE_CONTENT_MISMATCH", 409, "smartstore_manual_adoption_content_mismatch"],
  ["SMARTSTORE_MANUAL_ADOPTION_DETAIL_CONTENT_MISMATCH", 409, "smartstore_manual_adoption_content_mismatch"],
  ["SMARTSTORE_MANUAL_ADOPTION_SOURCE_TUPLE_OR_APPROVAL_DRIFT", 409, "smartstore_manual_adoption_not_ready"],
  ["SMARTSTORE_MANUAL_ADOPTION_SEARCH_RESPONSE_INCOMPLETE", 409, "smartstore_manual_adoption_provider_readback_unverified"],
  ["SMARTSTORE_MANUAL_ADOPTION_OWNER_REQUIRED", 403, "smartstore_manual_adoption_owner_required"],
  ["SMARTSTORE_MANUAL_ADOPTION_DEPENDENCY_MISSING", 503, "smartstore_manual_adoption_backend_unavailable"],
] as const) {
  test(`${sqlCode} maps to a safe ${expectedStatus} response`, async () => {
    const marker = "PRIVATE_DATABASE_DETAIL";
    const result = await callRoute(null, { message: `${sqlCode}: ${marker}` });
    assert.equal(result.routeResponse.status, expectedStatus);
    assert.equal(result.routeResponse.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(result.providerCollections, 0);
    const body = await result.routeResponse.json();
    assert.equal(body.mode, expectedMode);
    assert.equal(body.status, "blocked");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(`${sqlCode}|${marker}`, "u"));
  });
}

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
  ["origin 202", `/v2/products/origin-products/${originProductNo}`, 202, "SMARTSTORE_MANUAL_PROVIDER_IDENTITY_MISMATCH"],
  ["channel 206", `/v2/products/channel-products/${channelProductNo}`, 206, "SMARTSTORE_MANUAL_PROVIDER_IDENTITY_MISMATCH"],
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

test("cross-bound origin/channel identity fails closed before image verification", async () => {
  const fixture = providerFixture();
  fixture.channel.smartstoreChannelProduct.originProductNo = 99999999999;
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
      && error.code === "SMARTSTORE_MANUAL_PROVIDER_IDENTITY_MISMATCH",
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
