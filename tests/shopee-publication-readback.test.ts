import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation, type ChannelOperationResult } from "../lib/channels/operations";
import {
  normalizeShopeeListingPublicationReadback,
  readShopeeGlobalListingPublicationState,
  shopeeGlobalPublishArgumentsForIntent,
} from "../lib/channels/provider-shopee-publication-readback";
import { verifyShopeeGlobalListingPostPublish } from "../lib/channels/provider-shopee-post-publish-runtime";
import type { RemoteResponse } from "../lib/channels/protocols";

const FINGERPRINT = "a".repeat(64);
const IMAGE_IDS = Array.from({ length: 8 }, (_, index) => `image-${index + 1}`);

function mutationArguments(status = "UNLIST") {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: status === "UNLIST" ? "safe_test" : "live",
    publicationExpectedLocale: "en-SG",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    globalProduct: true,
    country: "sg",
    publish: {
      shop_id: 1001,
      shop_region: "SG",
      item: {
        item_name: "Verified cup",
        description: "Exact localized description",
        image: { image_id_list: IMAGE_IDS },
        item_status: status,
      },
    },
  };
}

function localItemData(status = "UNLIST") {
  return {
    error: "",
    request_id: "readback-request",
    response: {
      item_list: [{
        item_id: 9001,
        item_status: status,
        item_name: "Verified cup",
        description: "Exact localized description",
        image: { image_id_list: IMAGE_IDS },
      }],
    },
  };
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    }),
    data,
    text,
  };
}

test("Shopee global publication shaping uses UNLIST for safe_test and NORMAL for live", () => {
  const publish = mutationArguments().publish;
  assert.equal(
    (shopeeGlobalPublishArgumentsForIntent(publish, "safe_test").item as Record<string, unknown>).item_status,
    "UNLIST",
  );
  assert.equal(
    (shopeeGlobalPublishArgumentsForIntent(publish, "live").item as Record<string, unknown>).item_status,
    "NORMAL",
  );
  assert.equal(publish.item.item_status, "UNLIST", "the original request must remain unchanged");
});

test("Shopee base-info normalization distinguishes live, review, and non-public states with exact evidence", () => {
  for (const [status, visibility] of [
    ["NORMAL", "live"],
    ["REVIEWING", "pending_review"],
    ["UNLIST", "non_public"],
  ] as const) {
    const normalized = normalizeShopeeListingPublicationReadback({
      operation: "listing.create",
      remoteId: "9001",
      remoteData: localItemData(status),
      mutationArguments: {
        ...mutationArguments(status === "UNLIST" ? "UNLIST" : "NORMAL"),
        globalItemId: "7001",
      },
      credentialShopId: "1001",
      expectedLocale: "en-SG",
      expectedFingerprint: FINGERPRINT,
      expectedImageCount: 8,
      verifiedAt: "2026-08-30T00:00:00.000Z",
    });
    assert.equal(normalized.remoteState?.visibility, visibility);
    assert.equal(normalized.remoteState?.imageCount, 8);
    assert.deepEqual(normalized.remoteState?.resources, {
      localItemId: "9001",
      shopId: "1001",
      globalItemId: "7001",
    });
    assert.equal(normalized.checks.fingerprintVerified, true);
  }
});

test("Shopee readback counts all eight approved details behind a representative gallery image or extended description", () => {
  const representative = "representative-image";
  const galleryRemote = localItemData("NORMAL");
  galleryRemote.response.item_list[0].image.image_id_list = [representative, ...IMAGE_IDS];
  const gallery = normalizeShopeeListingPublicationReadback({
    operation: "listing.create",
    remoteId: "9001",
    remoteData: galleryRemote,
    mutationArguments: {
      ...mutationArguments("NORMAL"),
      globalItemId: "7001",
      sellerpilotProviderDetailImageIds: IMAGE_IDS,
      publish: {
        ...mutationArguments("NORMAL").publish,
        item: {
          ...mutationArguments("NORMAL").publish.item,
          image: { image_id_list: [representative, ...IMAGE_IDS] },
        },
      },
    },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });
  assert.equal(gallery.imageCount, 8);
  assert.equal(gallery.remoteState?.imageCount, 8);

  const extendedRemote = localItemData("NORMAL");
  extendedRemote.response.item_list[0].description_info = {
    extended_description: {
      field_list: IMAGE_IDS.map((imageId) => ({
        field_type: "image",
        image_info: { image_id: imageId },
      })),
    },
  };
  const extended = normalizeShopeeListingPublicationReadback({
    operation: "listing.create",
    remoteId: "9001",
    remoteData: extendedRemote,
    mutationArguments: {
      ...mutationArguments("NORMAL"),
      globalItemId: "7001",
      sellerpilotProviderDetailImageIds: IMAGE_IDS,
    },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });
  assert.equal(extended.imageCount, 8);
  assert.equal(extended.remoteState?.imageCount, 8);

  const missingExtended = localItemData("NORMAL");
  missingExtended.response.item_list[0].image.image_id_list = [representative, ...IMAGE_IDS.slice(0, 7)];
  const missing = normalizeShopeeListingPublicationReadback({
    operation: "listing.create",
    remoteId: "9001",
    remoteData: missingExtended,
    mutationArguments: {
      ...mutationArguments("NORMAL"),
      globalItemId: "7001",
      sellerpilotProviderDetailImageIds: IMAGE_IDS,
      publish: {
        ...mutationArguments("NORMAL").publish,
        item: {
          ...mutationArguments("NORMAL").publish.item,
          image: { image_id_list: [representative, ...IMAGE_IDS.slice(0, 7)] },
        },
      },
    },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });
  assert.equal(missing.imageCount, 8);
  assert.equal(missing.checks.imageCountVerified, false);
  assert.equal(missing.remoteState, undefined);
});

test("Shopee independent readback ignores only unresolved pre-upload image and attribute placeholders", () => {
  const representative = "representative-image";
  const remoteData = localItemData("NORMAL");
  remoteData.response.item_list[0].image.image_id_list = [representative, ...IMAGE_IDS];
  remoteData.response.item_list[0].attribute_list = [{
    attribute_id: 501,
    attribute_value_list: [{ value_id: 601 }],
  }];
  const source = mutationArguments("NORMAL");
  source.publish.item.image = { image_id_list: [] };
  source.publish.item.attribute_list = [];
  Object.assign(source.publish.item, {
    category_id: 100123,
    brand: { brand_id: 0, original_brand_name: "Unbranded" },
    condition: "NEW",
    weight: 0.1,
  });
  const normalized = normalizeShopeeListingPublicationReadback({
    operation: "listing.create",
    remoteId: "9001",
    remoteData,
    mutationArguments: { ...source, globalItemId: "7001" },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });
  assert.equal(normalized.checks.contentVerified, true);
  assert.equal(normalized.remoteState?.imageCount, 8);
});

test("Shopee publication evidence fails shut on wrong shop, market, mutable content, or image count", () => {
  const base = {
    operation: "listing.create" as const,
    remoteId: "9001",
    mutationArguments: { ...mutationArguments(), globalItemId: "7001" },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  };
  assert.equal(normalizeShopeeListingPublicationReadback({
    ...base,
    credentialShopId: "1002",
    remoteData: localItemData(),
  }).remoteState, undefined);
  assert.equal(normalizeShopeeListingPublicationReadback({
    ...base,
    mutationArguments: mutationArguments(),
    remoteData: localItemData(),
  }).remoteState, undefined);
  assert.equal(normalizeShopeeListingPublicationReadback({
    ...base,
    expectedLocale: "ms-MY",
    remoteData: localItemData(),
  }).remoteState, undefined);
  assert.equal(normalizeShopeeListingPublicationReadback({
    ...base,
    remoteData: {
      ...localItemData(),
      response: { item_list: [{ ...localItemData().response.item_list[0], item_name: "Wrong" }] },
    },
  }).remoteState, undefined);
  assert.equal(normalizeShopeeListingPublicationReadback({
    ...base,
    remoteData: {
      ...localItemData(),
      response: { item_list: [{ ...localItemData().response.item_list[0], image: { image_id_list: IMAGE_IDS.slice(0, 7) } }] },
    },
  }).remoteState, undefined);
});

test("Shopee publication evidence fails shut when base-info returns duplicate immutable item ids", () => {
  const correctItem = localItemData("NORMAL").response.item_list[0];
  const attacked = normalizeShopeeListingPublicationReadback({
    operation: "listing.create",
    remoteId: "9001",
    remoteData: {
      error: "",
      response: {
        item_list: [
          correctItem,
          {
            ...correctItem,
            item_name: "Attacker controlled product",
            description: "Attacker controlled description",
          },
        ],
      },
    },
    mutationArguments: { ...mutationArguments("NORMAL"), globalItemId: "7001" },
    credentialShopId: "1001",
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });

  assert.equal(attacked.remoteState, undefined);
  assert.equal(attacked.checks.identityVerified, false);
});

test("Shopee SG global CREATE fails shut when publish.shop_region is SG but strict context and evidence are missing", async () => {
  const arguments_ = mutationArguments("NORMAL");
  delete (arguments_ as Record<string, unknown>).country;
  assert.equal(arguments_.publish.shop_region, "SG");
  assert.equal((arguments_ as Record<string, unknown>).sellerpilotShopeeSgCreateContext, undefined);
  assert.equal((arguments_ as Record<string, unknown>).sellerpilotShopeeSgPreparedCreateEvidence, undefined);

  const readback = await readShopeeGlobalListingPublicationState({
    merchantPayload: { merchant_id: "2001" },
    shopPayload: { shop_id: "1001" },
    environment: "production",
    operation: "listing.create",
    globalItemId: "7001",
    localItemId: "9001",
    shopId: "1001",
    mutationArguments: arguments_,
    expectedLocale: "en-SG",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  }, {
    merchantRequest: async ({ path }) => path.endsWith("get_global_item_info")
      ? remote({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } })
      : remote({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } }),
    shopRequest: async () => remote(localItemData("NORMAL")),
  });

  assert.equal(readback.globalIdentityVerified, true);
  assert.equal(readback.publishedLinkageVerified, true);
  assert.equal(readback.localTransportVerified, true);
  assert.equal(Object.values(readback.checks).every(Boolean), true);
  assert.equal(readback.strictCreateVerified, false);
  assert.equal(readback.remoteState, undefined);
});

test("Shopee final local GET rejects item-shaped non-2xx and provider-error responses before normalization", async () => {
  const arguments_ = mutationArguments("NORMAL");
  arguments_.country = "my";
  arguments_.publicationExpectedLocale = "ms-MY";
  arguments_.publish.shop_region = "MY";
  for (const [label, localRemote] of [
    ["non-2xx", remote(localItemData("NORMAL"), 502)],
    ["provider error", remote({ ...localItemData("NORMAL"), error: "provider_error" })],
  ] as const) {
    const readback = await readShopeeGlobalListingPublicationState({
      merchantPayload: { merchant_id: "2001" },
      shopPayload: { shop_id: "1001" },
      environment: "production",
      operation: "listing.create",
      globalItemId: "7001",
      localItemId: "9001",
      shopId: "1001",
      mutationArguments: arguments_,
      expectedLocale: "ms-MY",
      expectedFingerprint: FINGERPRINT,
      expectedImageCount: 8,
    }, {
      merchantRequest: async ({ path }) => path.endsWith("get_global_item_info")
        ? remote({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } })
        : remote({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } }),
      shopRequest: async () => localRemote,
    });

    assert.equal(readback.globalIdentityVerified, true, label);
    assert.equal(readback.publishedLinkageVerified, true, label);
    assert.equal(readback.localTransportVerified, false, label);
    assert.equal(readback.imageCount, 0, label);
    assert.equal(readback.checks.identityVerified, false, label);
    assert.equal(readback.remoteState, undefined, label);
  }
});

test("Shopee verified global safe publication forces UNLIST and is finalized only by local base-info readback", async () => {
  const originalFetch = globalThis.fetch;
  let publishBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/add_global_item")) {
      return Response.json({ error: "", response: { global_item_id: 7001 } });
    }
    if (url.includes("/get_global_item_info")) {
      return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } });
    }
    if (url.includes("/create_publish_task")) {
      publishBody = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ error: "", response: { publish_task_id: 8001 } });
    }
    if (url.includes("/get_publish_task_result")) {
      return Response.json({ error: "", response: { publish_status: "SUCCESS" } });
    }
    if (url.includes("/get_published_list")) {
      return Response.json({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } });
    }
    throw new Error(`Unexpected Shopee request: ${url}`);
  };
  try {
    const genericArguments = mutationArguments();
    const arguments_ = {
      ...genericArguments,
      country: "my",
      publicationExpectedLocale: "ms-MY",
      publish: {
        ...genericArguments.publish,
        shop_region: "MY",
      },
      body: { global_item_name: "Verified cup" },
    };
    const providerResult = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.create",
      payload: {
        partner_id: "1",
        partner_key: "secret",
        merchant_id: "2001",
        access_token: "merchant-access",
      },
      arguments: arguments_,
      environment: "production",
    });
    assert.equal(providerResult.remoteId, "9001");
    assert.equal(providerResult.ok, false, "the merchant-scoped phase cannot claim publication without the shop readback");
    assert.equal((publishBody.item as Record<string, unknown>).item_status, "UNLIST");

    const initialRemoteState = normalizeShopeeListingPublicationReadback({
      operation: "listing.create",
      remoteId: "9001",
      remoteData: localItemData(),
      mutationArguments: { ...arguments_, globalItemId: "7001" },
      credentialShopId: "1001",
      expectedLocale: "ms-MY",
      expectedFingerprint: FINGERPRINT,
      expectedImageCount: 8,
    }).remoteState!;
    const publicationAssetBinding = { contract: "sellerpilot_provider_asset_binding_v1", digest: "b".repeat(64) };
    const finalized = await verifyShopeeGlobalListingPostPublish({
      result: {
        ...providerResult,
        remoteState: {
          ...initialRemoteState,
          evidence: { ...initialRemoteState.evidence, publicationAssetBinding },
        },
      },
      merchantCredential: { merchant_id: "2001" },
      shopCredential: { shop_id: "1001" },
      arguments: arguments_,
      environment: "production",
      signal: new AbortController().signal,
      hooks: { assertLeaseHealthy: async () => undefined, beginProviderMutation: async () => undefined },
    }, {
      shopeeRequest: async () => remote(localItemData()),
      shopeeMerchantRequest: async ({ path }) => path.endsWith("get_global_item_info")
        ? remote({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } })
        : remote({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } }),
    });
    assert.equal(finalized.ok, true);
    assert.equal(finalized.remoteState?.visibility, "non_public");
    assert.deepEqual(finalized.remoteState?.resources, {
      localItemId: "9001",
      shopId: "1001",
      globalItemId: "7001",
    });
    assert.equal(finalized.publicationFulfilled, true);
    assert.deepEqual(finalized.remoteState?.evidence.publicationAssetBinding, publicationAssetBinding);
    assert.equal(finalized.steps.at(-1)?.name, "local-item-publication-readback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee live REVIEWING readback remains pending and never counts as published", async () => {
  const genericArguments = mutationArguments("NORMAL");
  const args = {
    ...genericArguments,
    country: "my",
    publicationExpectedLocale: "ms-MY",
    globalItemId: "7001",
    publish: {
      ...genericArguments.publish,
      shop_region: "MY",
    },
  };
  const initial: ChannelOperationResult = {
    ok: false,
    channel: "shopee",
    operation: "listing.create",
    steps: [{ name: "publish-task", ok: true, status: 200, data: {} }],
    remoteId: "9001",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    safeMessage: "awaiting exact state",
  };
  const finalized = await verifyShopeeGlobalListingPostPublish({
    result: initial,
    merchantCredential: { merchant_id: "2001" },
    shopCredential: { shop_id: "1001" },
    arguments: args,
    environment: "production",
    signal: new AbortController().signal,
    hooks: { assertLeaseHealthy: async () => undefined, beginProviderMutation: async () => undefined },
  }, {
    shopeeRequest: async () => remote(localItemData("REVIEWING")),
    shopeeMerchantRequest: async ({ path }) => path.endsWith("get_global_item_info")
      ? remote({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } })
      : remote({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } }),
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.remoteState?.visibility, "pending_review");
  assert.equal(finalized.publicationFulfilled, false);
});

test("Shopee stop binds the requested local item id and verifies UNLIST with a GET", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/unlist_item")) return Response.json({ error: "", request_id: "write-request", response: {} });
    return Response.json(localItemData());
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.stop",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "1001", access_token: "shop-access" },
      arguments: {
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "en-SG",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 0,
        country: "sg",
        body: { item_id: 9001 },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "9001");
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(calls.some((url) => url.includes("/get_item_base_info")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee listing update verifies the same local item, localized fields, status and eight images", async () => {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/update_item")) return Response.json({ error: "", request_id: "update-request", response: {} });
    reads += 1;
    return Response.json(reads === 1
      ? { error: "", response: { item_list: [{ item_id: 9001, item_status: "NORMAL" }] } }
      : localItemData("NORMAL"));
  };
  try {
    const result = await executeChannelOperation({
      channel: "shopee",
      operation: "listing.update",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "1001", access_token: "shop-access" },
      arguments: {
        publicationStateContract: "verified_remote_state_v1",
        publicationIntent: "live",
        publicationExpectedLocale: "en-SG",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 8,
        country: "sg",
        localItemId: "9001",
        body: {
          item_id: 9001,
          item_name: "Verified cup",
          description: "Exact localized description",
          image: { image_id_list: IMAGE_IDS },
        },
      },
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "9001");
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.locale, "en-SG");
    assert.equal(reads, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee safe_test direct local create is rejected before a provider call", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({});
  };
  try {
    await assert.rejects(executeChannelOperation({
      channel: "shopee",
      operation: "listing.create",
      payload: { partner_id: "1", partner_key: "secret", shop_id: "1001", access_token: "shop-access" },
      arguments: {
        ...mutationArguments(),
        globalProduct: false,
        body: {},
      },
      environment: "production",
    }), /SHOPEE_SAFE_TEST_REQUIRES_GLOBAL_PUBLISH/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
