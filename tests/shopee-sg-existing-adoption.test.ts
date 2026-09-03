import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeProviderListingLineageVerification,
  type VerificationDependencies,
} from "../lib/channels/listing-lineage-verification";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";
import {
  shopeeSgExistingAdoptionBinding,
  shopeeSgExistingAdoptionIdentity,
  verifyShopeeSgExistingAdoptionReadback,
} from "../lib/channels/shopee-sg-existing-adoption";
import type { RemoteResponse, SecretPayload } from "../lib/channels/protocols";

const JOB_ID = "91000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "91000000-0000-4000-8000-000000000002";

function marker() {
  return {
    expectedRemoteId: shopeeSgExistingAdoptionIdentity.itemId,
    market: "SG",
    targetId: shopeeSgExistingAdoptionIdentity.shopId,
    shopId: shopeeSgExistingAdoptionIdentity.shopId,
    sellerpilotShopeeSgExistingAdoption: {
      contract: "sellerpilot_shopee_sg_existing_adoption_v1",
      productId: shopeeSgExistingAdoptionIdentity.productId,
      itemId: shopeeSgExistingAdoptionIdentity.itemId,
      sku: shopeeSgExistingAdoptionIdentity.sku,
      merchantId: shopeeSgExistingAdoptionIdentity.merchantId,
      shopId: shopeeSgExistingAdoptionIdentity.shopId,
      market: "SG",
      locale: "en-SG",
      currency: "SGD",
      providerStatus: "UNLIST",
      detailImageCount: 8,
    },
  };
}

function credential(): SecretPayload {
  const accessTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const refreshTokenExpiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return {
    partner_id: "2031489",
    partner_key: "private-partner-key",
    main_account_id: "4940266",
    merchant_id: shopeeSgExistingAdoptionIdentity.merchantId,
    shop_id: shopeeSgExistingAdoptionIdentity.shopId,
    access_token: "private-access-token",
    refresh_token: "private-refresh-token",
    access_token_expires_at: accessTokenExpiresAt,
    refresh_token_expires_at: refreshTokenExpiresAt,
    provider_account_identity_version: "v1",
    provider_account_subject: "shopee:main:4940266",
    shopee_targets: [
      { type: "merchant", id: shopeeSgExistingAdoptionIdentity.merchantId },
      {
        type: "shop",
        id: shopeeSgExistingAdoptionIdentity.shopId,
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
      },
    ],
  };
}

const gallery = Array.from({ length: 9 }, (_, index) => `sg-image-${index + 1}`);

function remoteItem(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      item_list: [{
        item_id: Number(shopeeSgExistingAdoptionIdentity.itemId),
        item_sku: shopeeSgExistingAdoptionIdentity.sku,
        item_status: "UNLIST",
        currency: "SGD",
        current_price: 16.77,
        item_name: "Reusable Cable Organizer Clips for Home and Office",
        description: "Keep charging cables neatly organized with durable reusable clips designed for desks, kitchens, and travel.",
        image: { image_id_list: gallery },
        ...overrides,
      }],
    },
  };
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

function dependencies(
  shopeeRequest: VerificationDependencies["shopeeRequest"],
): VerificationDependencies {
  const unchanged = async (payload: SecretPayload) => ({
    payload,
    refreshed: false as const,
    credentialExpiresAt: null,
  });
  const unsupported = async (): Promise<RemoteResponse> => {
    throw new Error("unexpected provider request");
  };
  return {
    ensureShopeeAccessToken: unchanged,
    ensureLazadaAccessToken: unchanged,
    ensureEbayAccessToken: unchanged,
    shopeeRequest,
    lazadaRequest: unsupported,
    ebayRequest: unsupported,
    ebayTradingRequest: unsupported,
    qoo10Request: unsupported,
  } as VerificationDependencies;
}

test("Shopee SG adoption marker accepts only the exact pre-approved identity", () => {
  assert.deepEqual(shopeeSgExistingAdoptionBinding(marker()), marker().sellerpilotShopeeSgExistingAdoption);
  assert.equal(shopeeSgExistingAdoptionBinding({
    ...marker(),
    sellerpilotShopeeSgExistingAdoption: {
      ...marker().sellerpilotShopeeSgExistingAdoption,
      itemId: "53717126191",
    },
  }), null);
  assert.equal(shopeeSgExistingAdoptionBinding({
    ...marker(),
    sellerpilotShopeeSgExistingAdoption: {
      ...marker().sellerpilotShopeeSgExistingAdoption,
      unexpected: true,
    },
  }), null);
});

test("Shopee SG adoption readback returns bounded evidence for exact seller, shop, locale, currency, UNLIST state, and 1+8 images", () => {
  const evidence = verifyShopeeSgExistingAdoptionReadback({
    argumentsValue: marker(),
    credentialPayload: credential(),
    shopRemoteData: { response: { shop_id: 1719148844, shop_name: "private seller" } },
    itemRemoteData: remoteItem(),
  });
  assert.ok(evidence);
  assert.equal(evidence.itemId, "53717126190");
  assert.equal(evidence.sku, "QA-20260823-CC-001");
  assert.equal(evidence.price, 16.77);
  assert.equal(evidence.galleryImageCount, 9);
  assert.equal(evidence.detailImageCount, 8);
  assert.match(evidence.titleDigest, /^[a-f0-9]{64}$/u);
  assert.match(evidence.descriptionDigest, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(evidence), /Reusable Cable|private seller|access-token/u);
});

test("Shopee SG adoption readback fails closed for every material identity mismatch", () => {
  const base = {
    argumentsValue: marker(),
    credentialPayload: credential(),
    shopRemoteData: { response: { shop_id: 1719148844 } },
    itemRemoteData: remoteItem(),
  };
  const cases: Array<[string, Parameters<typeof verifyShopeeSgExistingAdoptionReadback>[0]]> = [
    ["merchant", { ...base, credentialPayload: { ...credential(), merchant_id: "5511565", shopee_targets: [] } }],
    ["shop", { ...base, shopRemoteData: { response: { shop_id: 1719148845 } } }],
    ["item", { ...base, itemRemoteData: remoteItem({ item_id: 53717126191 }) }],
    ["sku", { ...base, itemRemoteData: remoteItem({ item_sku: "DIFFERENT" }) }],
    ["status", { ...base, itemRemoteData: remoteItem({ item_status: "NORMAL" }) }],
    ["currency", { ...base, itemRemoteData: remoteItem({ currency: "MYR" }) }],
    ["ambiguous price", { ...base, itemRemoteData: remoteItem({
      current_price: undefined,
      price_info: [{ current_price: 16.77, currency: "SGD" }, { current_price: 17.77, currency: "SGD" }],
    }) }],
    ["locale", { ...base, itemRemoteData: remoteItem({
      item_name: "케이블 정리 클립",
      description: "책상 위의 충전 케이블을 깔끔하게 정리할 수 있는 재사용 가능한 클립입니다.",
    }) }],
    ["images", { ...base, itemRemoteData: remoteItem({ image: { image_id_list: gallery.slice(0, 8) } }) }],
  ];
  for (const [name, value] of cases) {
    assert.equal(verifyShopeeSgExistingAdoptionReadback(value), null, name);
  }
});

test("listing.lineage.verify transports the exact adoption evidence through the worker contract", async () => {
  const paths: string[] = [];
  const result = await executeProviderListingLineageVerification({
    channel: "shopee",
    payload: credential(),
    environment: "production",
    arguments: marker(),
  }, dependencies(async ({ path, query }) => {
    paths.push(path);
    if (path.endsWith("get_shop_info")) {
      return remote({ response: { shop_id: 1719148844, shop_name: "private seller" } });
    }
    assert.equal(query?.get("item_id_list"), "53717126190");
    return remote(remoteItem());
  }));
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.shopeeAdoption?.providerStatus, "UNLIST");
  assert.deepEqual(paths, ["/api/v2/shop/get_shop_info", "/api/v2/product/get_item_base_info"]);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result,
  }).success, true);
  assert.doesNotMatch(JSON.stringify(result), /private seller|private-access-token|Reusable Cable/u);
});

test("listing.lineage.verify rejects the approved item when one adoption proof changes", async () => {
  await assert.rejects(executeProviderListingLineageVerification({
    channel: "shopee",
    payload: credential(),
    environment: "production",
    arguments: marker(),
  }, dependencies(async ({ path }) => path.endsWith("get_shop_info")
    ? remote({ response: { shop_id: 1719148844 } })
    : remote(remoteItem({ item_status: "NORMAL" })))),
  /SHOPEE_SG_EXISTING_ADOPTION_READBACK_MISMATCH/u);
});

test("Shopee SG adoption refuses stale OAuth instead of refreshing or calling the provider", async () => {
  const staleCredential = credential();
  staleCredential.access_token_expires_at = new Date(Date.now() - 60_000).toISOString();
  staleCredential.shopee_targets = [{
    type: "shop",
    id: shopeeSgExistingAdoptionIdentity.shopId,
    access_token: "stale-access-token",
    refresh_token: "private-refresh-token",
    access_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  }];
  let ensureCalls = 0;
  let providerCalls = 0;
  const injected = dependencies(async () => {
    providerCalls += 1;
    return remote({});
  });
  injected.ensureShopeeAccessToken = async () => {
    ensureCalls += 1;
    throw new Error("must not refresh");
  };
  await assert.rejects(executeProviderListingLineageVerification({
    channel: "shopee",
    payload: staleCredential,
    environment: "production",
    arguments: marker(),
  }, injected), /SHOPEE_SG_EXISTING_ADOPTION_FRESH_OAUTH_REQUIRED/u);
  assert.equal(ensureCalls, 0);
  assert.equal(providerCalls, 0);
});

test("Shopee SG adoption API checks static egress and worker readiness before enqueue", async () => {
  const route = await readFile(new URL("../app/api/admin/products/[id]/shopee-existing-adoption/route.ts", import.meta.url), "utf8");
  const staticEgressIndex = route.indexOf("sellerpilot_service_serverless_static_egress_status");
  const runtimeIndex = route.indexOf("sellerpilot_service_serverless_cs_wakeup_status");
  const enqueueIndex = route.indexOf("sellerpilot_service_enqueue_shopee_sg_existing_adoption");
  assert.ok(staticEgressIndex >= 0);
  assert.ok(runtimeIndex >= 0);
  assert.ok(enqueueIndex > staticEgressIndex);
  assert.ok(enqueueIndex > runtimeIndex);
  assert.match(route, /STATIC_EGRESS_REQUIRED|SERVERLESS_STATIC_EGRESS_REQUIRED/u);
  assert.match(route, /serverless_worker_required/u);
});
