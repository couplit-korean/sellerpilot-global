import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { completeCommerceClaim } from "../lib/channels/commerce-completion";
import {
  applyLazadaGatewayCreateProviderResult,
  assertLazadaGatewayCreateReceipt,
  gateLazadaGatewayCreateCompletion,
  lazadaMyCreateGetRecoveryReceiptRpc,
  lazadaMyCreatePostReceiptRpc,
} from "../lib/product-registration/lazada/my-create-gateway-receipt";
import {
  lazadaMyCreateCurrentStateContract,
  lazadaMyCreateGetRecoveryReceiptContract,
  lazadaMyCreateOfficialEvidenceFromBytes,
  lazadaUtf8Sha256,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "../lib/product-registration/lazada/my-create-raw-readback";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM = "22222222-2222-4222-8222-222222222222";
const CREDENTIAL_ID = "61111111-1111-4111-8111-111111111111";
const ITEM_ID = "987654321";
const SKU_A = "SP-MY-A";
const SKU_B = "SP-MY-B";
const NAME = "SellerPilot Storage Organizer";
const DESCRIPTION = "Verified English description for the MY listing.";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/r7-${index + 1}.jpg`,
);
const FINGERPRINT = "a".repeat(64);

function argumentsValue(sellerSkus = [SKU_A, SKU_B]) {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    request: {
      Request: {
        Product: {
          PrimaryCategory: "10100205",
          Images: { Image: [...IMAGES] },
          Attributes: { name: NAME, description: DESCRIPTION },
          Skus: {
            Sku: sellerSkus.map((sellerSku) => ({
              SellerSku: sellerSku,
              price: "19.90",
              quantity: "3",
              Status: "inactive",
            })),
          },
        },
      },
    },
  };
}

function currentSource(
  overrides: Partial<LazadaMyCreateCurrentSourceSnapshot> = {},
): LazadaMyCreateCurrentSourceSnapshot {
  return {
    contract: lazadaMyCreateCurrentStateContract,
    productId: "71111111-1111-4111-8111-111111111111",
    productStatus: "draft",
    productDemo: false,
    productOnHand: 3,
    productUpdatedAt: "2026-09-10T00:00:00.000Z",
    listingStatus: "draft",
    listingRemoteId: null,
    listingUpdatedAt: "2026-09-10T00:00:00.000Z",
    credentialId: CREDENTIAL_ID,
    credentialStatus: "active",
    credentialVersion: 1,
    ...overrides,
  };
}

function postResponse(skuList: Array<{ seller_sku: string; sku_id: string }>) {
  return JSON.stringify({
    code: "0",
    data: { item_id: ITEM_ID, sku_list: skuList },
  });
}

function itemGetResponse(skus = [
  { SellerSku: SKU_B, SkuId: "2", Status: "inactive" },
  { SellerSku: SKU_A, SkuId: "1", Status: "inactive" },
]) {
  return JSON.stringify({
    code: "0",
    data: {
      item_id: ITEM_ID,
      primary_category: "10100205",
      status: "inactive",
      locale: "ms-MY",
      images: IMAGES,
      attributes: { name: NAME, description: DESCRIPTION },
      skus,
    },
  });
}

function officialEvidence() {
  return lazadaMyCreateOfficialEvidenceFromBytes({
    postRequest: {
      method: "POST",
      path: "/product/create",
      body: argumentsValue(),
    },
    postResponseBytes: postResponse([
      { seller_sku: SKU_B, sku_id: "2" },
      { seller_sku: SKU_A, sku_id: "1" },
    ]),
    itemGetRequest: {
      method: "GET",
      path: "/product/item/get",
      params: { item_id: ITEM_ID },
    },
    itemGetResponseBytes: itemGetResponse(),
    imageRaw: JSON.stringify(IMAGES),
    contentRaw: `${NAME}\n${DESCRIPTION}`,
    localeRaw: "ms-MY",
  });
}

function getRecoveryReceipt(sellerSku = SKU_A) {
  const requestBytes = JSON.stringify({
    method: "GET",
    path: "/product/item/get",
    params: { item_id: ITEM_ID },
  });
  const responseBytes = itemGetResponse([
    { SellerSku: sellerSku, SkuId: "1", Status: "inactive" },
  ]);
  return {
    contract: lazadaMyCreateGetRecoveryReceiptContract,
    receiptKind: "get_recovery" as const,
    method: "GET" as const,
    path: "/product/item/get" as const,
    requestBytes,
    responseBytes,
    requestSha256: lazadaUtf8Sha256(requestBytes),
    responseSha256: lazadaUtf8Sha256(responseBytes),
    imageRaw: JSON.stringify(IMAGES),
    contentRaw: `${NAME}\n${DESCRIPTION}`,
    localeRaw: "ms-MY",
  };
}

function remoteState() {
  return {
    verified: true as const,
    visibility: "non_public" as const,
    providerStatus: "inactive",
    verifiedAt: "2026-09-10T00:02:00.000Z",
    evidence: {
      identityVerified: true,
      statusVerified: true,
      localeVerified: true,
      fingerprintVerified: true,
      imageCountVerified: true,
    },
    resources: { itemId: ITEM_ID, country: "my" },
    locale: "ms-MY",
    fingerprint: FINGERPRINT,
    imageCount: 8,
  };
}

function operationResult(input: {
  ok?: boolean;
  receiptKind?: "post_create" | "get_recovery" | null;
  officialEvidence?: unknown;
  getRecoveryReceipt?: unknown;
  extraStep?: { name: string; ok: boolean; status: number; data: Record<string, unknown> };
}) {
  const readbackData: Record<string, unknown> = {
    code: "0",
    data: { item_id: ITEM_ID },
  };
  if (input.receiptKind === "post_create") {
    readbackData.receiptKind = "post_create";
    readbackData.officialEvidence = input.officialEvidence ?? officialEvidence();
  }
  if (input.receiptKind === "get_recovery") {
    readbackData.receiptKind = "get_recovery";
    readbackData.getRecoveryReceipt = input.getRecoveryReceipt ?? getRecoveryReceipt();
  }
  const steps = [
    input.receiptKind === "get_recovery"
      ? null
      : {
        name: "/product/create",
        ok: true,
        status: 200,
        data: { code: "0", data: { item_id: ITEM_ID } },
      },
    {
      name: "listing-readback",
      ok: true,
      status: 200,
      data: readbackData,
    },
    input.extraStep,
  ].filter(Boolean) as Array<{
    name: string;
    ok: boolean;
    status: number;
    data: Record<string, unknown>;
  }>;
  return {
    ok: input.ok ?? true,
    channel: "lazada" as const,
    operation: "listing.create" as const,
    steps,
    remoteId: ITEM_ID,
    publicationIntent: "safe_test" as const,
    publicationStateContract: "verified_remote_state_v1" as const,
    remoteState: remoteState(),
    publicationFulfilled: true,
    safeMessage: "Lazada create readback",
  };
}

test("public path: CreateProduct without officialEvidence cannot complete", () => {
  const result = operationResult({ receiptKind: null, ok: true });
  const gated = gateLazadaGatewayCreateCompletion({
    status: "succeeded",
    result,
    argumentsValue: argumentsValue(),
    jobId: JOB_ID,
  });
  assert.equal(gated.ok, false);
  assert.match(String(gated.error), /LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED/u);

  const provider = applyLazadaGatewayCreateProviderResult(result, argumentsValue());
  assert.equal(provider.ok, false);
  assert.equal(
    provider.steps.at(-1)?.data.error,
    "LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED",
  );
});

test("public path: POST vs GET-recovery receipts call distinct r7 RPCs and ignore SKU order", () => {
  const post = assertLazadaGatewayCreateReceipt({
    jobId: JOB_ID,
    result: operationResult({ receiptKind: "post_create" }),
    argumentsValue: argumentsValue([SKU_B, SKU_A]),
  });
  assert.equal(post.kind, "post_create");
  assert.equal(post.store.rpc, lazadaMyCreatePostReceiptRpc);
  assert.equal(post.store.arguments.p_http_method, "POST");
  assert.equal(post.store.arguments.p_http_path, "/product/create");

  const recovered = assertLazadaGatewayCreateReceipt({
    jobId: JOB_ID,
    result: operationResult({
      receiptKind: "get_recovery",
      getRecoveryReceipt: getRecoveryReceipt(SKU_A),
    }),
    argumentsValue: argumentsValue([SKU_A]),
  });
  assert.equal(recovered.kind, "get_recovery");
  assert.equal(recovered.store.rpc, lazadaMyCreateGetRecoveryReceiptRpc);
  assert.equal(recovered.store.arguments.p_http_method, "GET");
  assert.equal(recovered.store.arguments.p_http_path, "/product/item/get");
});

test("public path: shape-only readback plus fabricated status cannot complete", () => {
  const result = operationResult({
    receiptKind: "post_create",
    officialEvidence: {
      ...officialEvidence(),
      imageRaw: JSON.stringify(IMAGES),
      contentRaw: `${NAME}\n${DESCRIPTION}`,
      localeRaw: "ms-MY",
      itemGetResponseBytes: JSON.stringify({
        code: "0",
        data: {
          item_id: ITEM_ID,
          status: "inactive",
          skus: [
            { SellerSku: SKU_A, SkuId: "1", Status: "inactive" },
            { SellerSku: SKU_B, SkuId: "2", Status: "inactive" },
          ],
        },
        remoteState: { verified: true },
        providerStatus: "FABRICATED-INACTIVE",
      }),
    },
  });
  const gated = gateLazadaGatewayCreateCompletion({
    status: "succeeded",
    result,
    argumentsValue: argumentsValue(),
    jobId: JOB_ID,
  });
  assert.equal(gated.ok, false);
  assert.match(
    String(gated.error),
    /LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE|LAZADA_MY_CREATE_OFFICIAL_EVIDENCE_REQUIRED/u,
  );
});

test("public path: GET-only recovery cannot synthesize CreateProduct from /products/get", () => {
  const productsGet = JSON.stringify({
    code: "0",
    data: {
      total_products: 1,
      products: [{ item_id: ITEM_ID, skus: [{ SellerSku: SKU_A, SkuId: "1" }] }],
    },
  });
  const result = {
    ...operationResult({ receiptKind: null, ok: true }),
    steps: [{
      name: "/products/get",
      ok: true,
      status: 200,
      data: {
        sku_list: [{ seller_sku: SKU_A, sku_id: "1" }],
        synthesizedCreateResponse: { item_id: ITEM_ID },
        body: productsGet,
      },
    }],
  };
  const provider = applyLazadaGatewayCreateProviderResult(
    result,
    { ...argumentsValue([SKU_A]), sellerpilotLazadaCreateReceiptKind: "get_recovery" },
  );
  assert.equal(provider.ok, false);
  assert.equal(
    provider.steps.at(-1)?.data.error,
    "LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE",
  );
});

test("public path: current source CAS detects drift when updated_at is unchanged", () => {
  const claimed = currentSource();
  const result = operationResult({ receiptKind: "post_create" });
  result.steps[1].data.claimedCurrentSource = claimed;
  result.steps[1].data.currentSource = currentSource({ productOnHand: 0 });
  assert.throws(
    () => assertLazadaGatewayCreateReceipt({
      jobId: JOB_ID,
      result,
      argumentsValue: argumentsValue(),
      listingId: "81111111-1111-4111-8111-111111111111",
    }),
    /LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT/u,
  );
});

test("commerce-completion calls r7 POST receipt RPC and refuses missing evidence", async () => {
  const calls: Array<{ name: string }> = [];
  const job = {
    id: JOB_ID,
    claim_token: CLAIM,
    credential_id: CREDENTIAL_ID,
    channel: "lazada" as const,
    operation: "listing.create",
    environment: "production" as const,
    request: { arguments: argumentsValue() },
    credential: {},
    attempt_count: 1,
  };
  const context = {
    status: "running",
    channel: "lazada",
    operation: "listing.create",
  };
  const missing = await completeCommerceClaim(
    {
      rpc: async (name) => {
        calls.push({ name });
        if (name === "sellerpilot_service_serverless_cs_completion_context") {
          return { data: context, error: null };
        }
        return { data: { status: "completed" }, error: null };
      },
    },
    "token-hash",
    job,
    {
      jobId: JOB_ID,
      claimToken: CLAIM,
      status: "succeeded",
      result: operationResult({ receiptKind: null }),
    },
  );
  assert.equal(missing, "unavailable");
  assert.equal(
    calls.some((call) => call.name === "sellerpilot_service_complete_serverless_cs_transaction"),
    false,
  );

  const stored: string[] = [];
  const completed = await completeCommerceClaim(
    {
      rpc: async (name) => {
        stored.push(name);
        if (name === "sellerpilot_service_serverless_cs_completion_context") {
          return { data: context, error: null };
        }
        if (name === lazadaMyCreatePostReceiptRpc) {
          return { data: { id: JOB_ID }, error: null };
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        return { data: null, error: { code: "unexpected" } };
      },
    },
    "token-hash",
    job,
    {
      jobId: JOB_ID,
      claimToken: CLAIM,
      status: "succeeded",
      result: operationResult({ receiptKind: "post_create" }),
    },
  );
  assert.notEqual(completed, "unavailable");
  assert.equal(stored.includes(lazadaMyCreatePostReceiptRpc), true);
  assert.equal(
    stored.indexOf(lazadaMyCreatePostReceiptRpc)
      < stored.indexOf("sellerpilot_service_complete_serverless_cs_transaction"),
    true,
  );

  const recovered: string[] = [];
  const getCompleted = await completeCommerceClaim(
    {
      rpc: async (name) => {
        recovered.push(name);
        if (name === "sellerpilot_service_serverless_cs_completion_context") {
          return { data: context, error: null };
        }
        if (name === lazadaMyCreateGetRecoveryReceiptRpc) {
          return { data: { id: JOB_ID }, error: null };
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        return { data: null, error: { code: "unexpected" } };
      },
    },
    "token-hash",
    {
      ...job,
      request: {
        arguments: {
          ...argumentsValue([SKU_A]),
          sellerpilotLazadaCreateReceiptKind: "get_recovery",
        },
      },
    },
    {
      jobId: JOB_ID,
      claimToken: CLAIM,
      status: "succeeded",
      result: operationResult({
        receiptKind: "get_recovery",
        getRecoveryReceipt: getRecoveryReceipt(SKU_A),
      }),
    },
  );
  assert.notEqual(getCompleted, "unavailable");
  assert.equal(recovered.includes(lazadaMyCreateGetRecoveryReceiptRpc), true);
  assert.equal(recovered.includes(lazadaMyCreatePostReceiptRpc), false);
});

test("serverless-gateway and commerce-gateway-job take the same r7 receipt path", async () => {
  const [
    gateway,
    completion,
    worker,
    provider,
    job,
  ] = await Promise.all([
    readFile(new URL("../lib/channels/serverless-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-completion.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-worker-completion.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/commerce-gateway-job.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(gateway, /completeCommerceClaim/);
  assert.match(completion, /lazadaGatewayCreateArgumentsFromJobRequest\(job\.request\)/);
  assert.match(completion, /gated\.store\.rpc/);
  assert.match(worker, /lazadaGatewayCreateArgumentsFromJobRequest\(job\.request\)/);
  assert.match(worker, /gated\.store\.rpc/);
  assert.match(provider, /applyLazadaGatewayCreateProviderResult/);
  assert.match(provider, /lazadaGetRecoveryCreate/);
  assert.match(job, /applyLazadaGatewayCreateProviderResult\(result, operationArguments\)/);
  assert.match(job, /lazadaGetRecoveryCreate/);
  assert.match(job, /runWithProviderReadOnlyTransport\(executeListingOperation\)/);
  assert.match(job, /\/api\/channel-gateway\/worker\/complete/);
});
