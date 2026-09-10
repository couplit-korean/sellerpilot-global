import assert from "node:assert/strict";
import test from "node:test";

import { completeCommerceClaim } from "../lib/channels/commerce-completion";
import { executeServerlessGatewayProviderJob } from "../lib/channels/commerce-provider";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import { bindShopeeSgListingCreateArguments } from "../lib/channels/shopee-sg-listing-create";
import { executeShopee } from "../lib/product-registration/channels/shopee";
import type { ExecuteInput } from "../lib/product-registration/execution-shared";
import {
  executeShopeeSgCreateRuntime,
  shopeeSgCreateResumeContract,
  shopeeSgCreateStageContract,
  type ShopeeSgCreateResumeReceipt,
  type ShopeeSgExecuteRuntimeDependencies,
} from "../lib/product-registration/shopee/execute-create-runtime";
import {
  shopeeSgCreateExecutionLineageArgument,
  shopeeSgCreateExecutionLineageContract,
} from "../lib/product-registration/shopee/target-lineage-readiness";

const credentialId = "22222222-2222-4222-8222-222222222222";
const shopId = "1719148844";
const merchantId = "5511564";
const sku = "AUTO-780720401E2D4E4EA45F";
const roles = [
  "detail-hero", "detail-overview", "detail-feature-one", "detail-feature-two",
  "detail-specification", "detail-use", "detail-care", "detail-closing",
];

function image(index: number) {
  const digest = index.toString(16).padStart(64, "0");
  const objectPath = `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
  return {
    publicUrl: `https://qa-project.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`,
    objectPath,
    contentSha256: digest,
  };
}

function strictArguments() {
  const bound = bindShopeeSgListingCreateArguments({
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "en-SG",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 1,
      approvedManifestDigest: "b".repeat(64),
      approvedDetailImages: roles.map((role, index) => ({
        role,
        approvedObjectPath: `results/20000000-0000-4000-8000-000000000001/claims/30000000-0000-4000-8000-000000000001/${index + 1}.png`,
        approvedSourceSha256: (index + 1).toString(16).padStart(64, "0"),
        ...image(index + 1),
      })),
      providerImageSurface: "buyer_visible",
      providerTransportImages: roles.map((role, index) => ({
        role,
        ...image(index + 1),
      })),
    },
    imageUrls: [
      image(9).publicUrl,
      ...Array.from({ length: 8 }, (_value, index) => image(index + 1).publicUrl),
    ],
    body: {
      global_item_name: "Lotte Sand Milk Cream Biscuits 315g Pack of 6",
      description: "This product is made with premium quality materials and includes detailed information for your easy use and care.",
      brand: { brand_id: 101, original_brand_name: "Fixture Brand" },
      attribute_list: [{ attribute_id: 100010, attribute_value_list: [{ value_id: 580 }] }],
      weight: 0.4,
      dimension: { package_length: 20, package_width: 15, package_height: 12 },
      days_to_ship: 4,
      condition: "NEW",
      seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
    },
    publish: { item: {
      item_name: "Lotte Sand Milk Cream Biscuits 315g - 6 Packs",
      description: "This product is made with premium quality materials and includes detailed information for your easy use and care.",
      brand: { brand_id: 101, original_brand_name: "Fixture Brand" },
      attribute_list: [{ attribute_id: 100010, attribute_value_list: [{ value_id: 580 }] }],
      weight: 0.4,
      dimension: { package_length: 20, package_width: 15, package_height: 12 },
      days_to_ship: 4,
      condition: "NEW",
      seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
      logistic: [{ logistic_id: 18036, enabled: true }],
    } },
  }, {
    contract: "sellerpilot_shopee_sg_listing_create_context_v2",
    productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
    sku,
    sourceCurrency: "KRW",
    sourcePriceKrw: 25_000,
    market: "SG",
    locale: "en-SG",
    targetId: shopId,
    targetCurrency: "SGD",
    targetPriceSgd: 25,
    targetPriceSource: "stored_channel_price",
    globalCurrency: "USD",
    globalPriceUsd: 20,
    globalPriceSource: "stored_global_price",
    quantity: 3,
    categoryId: "100787",
    categoryPath: ["Food & Beverages", "Snacks", "Biscuits, Cookies & Wafers"],
    categoryConfirmedAt: "2026-09-10T03:30:00.000Z",
    rate: {
      krwPerSgd: 1_000,
      krwPerUsd: 1_250,
      fetchedAt: "2026-09-10T03:59:00.000Z",
      asOf: "2026-09-10T03:59:00.000Z",
      source: "Coinbase Data API",
      sourceUrl: "https://docs.cdp.coinbase.com/coinbase-app/track-apis/exchange-rates",
      frequency: "minute-market",
    },
  });
  bound.merchantId = merchantId;
  bound[shopeeSgCreateExecutionLineageArgument] = {
    contract: shopeeSgCreateExecutionLineageContract,
    credentialId,
    credentialVersion: 81,
    targetId: shopId,
    marketCode: "SG",
  };
  const body = bound.body as Record<string, unknown>;
  const publish = bound.publish as Record<string, unknown>;
  const item = publish.item as Record<string, unknown>;
  body.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  item.seller_stock = [{ location_id: "SG-LOC", stock: 3 }];
  return bound;
}

function credential() {
  const future = "2099-01-01T00:00:00.000Z";
  return {
    partner_id: "2031489",
    partner_key: "partner-secret-long-enough",
    merchant_id: merchantId,
    shop_id: shopId,
    main_account_id: merchantId,
    provider_account_identity_version: "v1",
    provider_account_subject: `shopee:main:${merchantId}`,
    authorization_expires_at: future,
    shopee_targets: [
      {
        type: "merchant",
        id: merchantId,
        access_token: "merchant-access",
        refresh_token: "merchant-refresh",
        access_token_expires_at: future,
        refresh_token_expires_at: future,
      },
      {
        type: "shop",
        id: shopId,
        access_token: "shop-access",
        refresh_token: "shop-refresh",
        access_token_expires_at: future,
        refresh_token_expires_at: future,
      },
    ],
  };
}

test("strict SG create bypasses the old listing prepare and generic fence", async () => {
  const argumentsValue = strictArguments();
  const job: GatewayClaim = {
    id: "33333333-3333-4333-8333-333333333333",
    claim_token: "44444444-4444-4444-8444-444444444444",
    credential_id: credentialId,
    channel: "shopee",
    operation: "listing.create",
    environment: "production",
    request: { arguments: argumentsValue },
    credential: credential(),
    attempt_count: 1,
  };
  const fenceOptions: unknown[] = [];
  let captured = false;
  const result = await executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => undefined,
      beginProviderMutation: async (options) => { fenceOptions.push(options); },
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      readShopeeSgCreateStageState: async () => ({
        contract: shopeeSgCreateStageContract,
        status: "ready",
        genericProviderMutationStarted: false,
        nextSequence: 0,
        completedStages: [],
      }),
      beginShopeeSgCreateStage: async () => ({
        contract: shopeeSgCreateStageContract,
        status: "started",
        sequence: 0,
      }),
      completeShopeeSgCreateStage: async () => ({
        contract: shopeeSgCreateStageContract,
        status: "completed",
        sequence: 0,
      }),
      readShopeeSgCreateResume: async () => null,
      recordShopeeSgGlobalCreateReadback: async () => undefined,
    },
  }, async (input) => {
    assert.equal(input.arguments, argumentsValue);
    assert.equal(input.providerMutationHooks?.gatewayCredentialId, credentialId);
    assert.equal(typeof input.providerMutationHooks?.readShopeeSgCreateStageState, "function");
    assert.equal(typeof input.providerMutationHooks?.beginShopeeSgCreateStage, "function");
    assert.equal(typeof input.providerMutationHooks?.completeShopeeSgCreateStage, "function");
    assert.equal(typeof input.providerMutationHooks?.readShopeeSgCreateResume, "function");
    assert.equal(typeof input.providerMutationHooks?.recordShopeeSgGlobalCreateReadback, "function");
    await input.providerMutationHooks?.begin();
    captured = true;
    return {
      ok: false,
      channel: "shopee",
      operation: "listing.create",
      steps: [{ name: "fixture-stop", ok: false, status: 409, data: {} }],
      safeMessage: "fixture stop before provider",
    };
  });
  assert.equal(captured, true);
  assert.equal(result.ok, false);
  assert.deepEqual(fenceOptions, [undefined]);
});

test("executeShopee rejects request-owned Global resume identifiers before reads or writes", async () => {
  const argumentsValue = strictArguments();
  argumentsValue.globalItemId = "7001";
  let reads = 0;
  let writes = 0;
  await assert.rejects(executeShopee({
    channel: "shopee",
    operation: "listing.create",
    payload: { ...credential(), access_token: "merchant-access" },
    shopeeShopCredential: { ...credential(), access_token: "shop-access" },
    arguments: argumentsValue,
    environment: "production",
    providerMutationHooks: {
      gatewayCredentialId: credentialId,
      assertLeaseHealthy: async () => undefined,
      begin: async () => { writes += 1; },
      readShopeeSgCreateStageState: async () => { reads += 1; return null; },
      beginShopeeSgCreateStage: async () => { writes += 1; return null; },
      completeShopeeSgCreateStage: async () => { writes += 1; return null; },
      readShopeeSgCreateResume: async () => { reads += 1; return null; },
      recordShopeeSgGlobalCreateReadback: async () => { writes += 1; },
    },
  }), /SHOPEE_SG_BROWSER_RESUME_ID_FORBIDDEN/u);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

function providerResponse(data: Record<string, unknown>, ok = true) {
  return {
    response: new Response(JSON.stringify(data), {
      status: ok ? 200 : 502,
      headers: { "content-type": "application/json" },
    }),
    data,
    text: JSON.stringify(data),
  };
}

function executeInput(input: {
  readReceipt: () => Promise<ShopeeSgCreateResumeReceipt | null>;
  recordReceipt: (value: {
    globalItemId: string;
    createResponse: Record<string, unknown>;
    readbackResponse: Record<string, unknown>;
    preparedArguments: Record<string, unknown>;
  }) => Promise<void>;
  fences: unknown[];
  durable: {
    genericProviderMutationStarted: boolean;
    completedStages: Array<Record<string, unknown>>;
    startedStages: Map<number, Record<string, unknown>>;
  };
  loseCompletionResponseAt?: number;
  capture?: (value: Record<string, unknown>) => void;
}) {
  const base = credential();
  return {
    channel: "shopee" as const,
    operation: "listing.create" as const,
    payload: { ...base, access_token: "merchant-access", merchant_id: merchantId },
    shopeeShopCredential: { ...base, access_token: "shop-access", shop_id: shopId },
    arguments: strictArguments(),
    environment: "production" as const,
    signal: new AbortController().signal,
    providerMutationHooks: {
      gatewayCredentialId: credentialId,
      assertLeaseHealthy: async () => undefined,
      begin: async () => {
        input.fences.push(undefined);
        input.durable.genericProviderMutationStarted = true;
      },
      readShopeeSgCreateStageState: async () => ({
        contract: shopeeSgCreateStageContract,
        status: "ready",
        genericProviderMutationStarted: input.durable.genericProviderMutationStarted,
        nextSequence: input.durable.completedStages.length,
        completedStages: input.durable.completedStages,
        startedStage: input.durable.startedStages.values().next().value ?? null,
      }),
      beginShopeeSgCreateStage: async (stage) => {
        const completed = input.durable.completedStages[stage.sequence];
        if (completed) return {
          contract: shopeeSgCreateStageContract,
          status: "completed",
          sequence: stage.sequence,
          outputId: completed.outputId,
        };
        assert.equal(stage.sequence, input.durable.completedStages.length);
        assert.equal(input.durable.startedStages.has(stage.sequence), false);
        input.durable.startedStages.set(stage.sequence, stage);
        return {
          contract: shopeeSgCreateStageContract,
          status: "started",
          sequence: stage.sequence,
        };
      },
      completeShopeeSgCreateStage: async (stage) => {
        assert.ok(input.durable.startedStages.delete(stage.sequence));
        input.durable.completedStages.push({
          ...stage,
          result: undefined,
        });
        if (input.loseCompletionResponseAt === stage.sequence) {
          throw new Error("fixture completion response lost");
        }
        return {
          contract: shopeeSgCreateStageContract,
          status: "completed",
          sequence: stage.sequence,
          outputId: stage.outputId,
        };
      },
      readShopeeSgCreateResume: input.readReceipt,
      recordShopeeSgGlobalCreateReadback: async (value) => {
        await input.recordReceipt(value);
        const started = input.durable.startedStages.get(9);
        assert.ok(started);
        input.durable.startedStages.delete(9);
        input.durable.completedStages.push({
          ...started,
          outputId: value.globalItemId,
          globalItemId: value.globalItemId,
        });
      },
      captureShopeeSgPreparedArguments: input.capture,
    },
  } satisfies ExecuteInput;
}

function providerRuntime(state: {
  globalExists: boolean;
  localExists: boolean;
  globalPosts: number;
  localPosts: number;
  uploads: number;
  loseGlobalResponse?: boolean;
  loseLocalResponse?: boolean;
}): ShopeeSgExecuteRuntimeDependencies {
  const globalItem = () => ({
    global_item_id: 7001,
    global_item_sku: sku,
    global_item_name: "Lotte Sand Milk Cream Biscuits 315g Pack of 6",
    category_id: 100787,
    original_price: 20,
    normal_stock: 3,
    seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
  });
  const localItem = () => ({
    item_id: 8001,
    item_sku: sku,
    item_name: "Lotte Sand Milk Cream Biscuits 315g - 6 Packs",
    category_id: 200787,
    original_price: 25,
    normal_stock: 3,
    seller_stock: [{ location_id: "SG-LOC", stock: 3 }],
    logistic_info: [{ logistic_id: 18036, enabled: true }],
  });
  return {
    wait: async () => undefined,
    uploadImage: async (_payload, _environment, _url, _signal, hooks) => {
      const completedImageId = await hooks.beginProviderMutation();
      if (completedImageId) return completedImageId;
      state.uploads += 1;
      return `image-${state.uploads}`;
    },
    merchantRequest: async ({ method, path }) => {
      if (method === "POST" && path.endsWith("add_global_item")) {
        state.globalPosts += 1;
        state.globalExists = true;
        if (state.loseGlobalResponse) {
          state.loseGlobalResponse = false;
          throw new Error("fixture Global response lost");
        }
        return providerResponse({ error: "", response: { global_item_id: 7001 } });
      }
      if (method === "POST" && path.endsWith("create_publish_task")) {
        state.localPosts += 1;
        state.localExists = true;
        if (state.loseLocalResponse) {
          state.loseLocalResponse = false;
          throw new Error("fixture local response lost");
        }
        return providerResponse({ error: "", response: { publish_task_id: 7101 } });
      }
      if (method === "POST" && path.endsWith("get_merchant_warehouse_list")) {
        return providerResponse({ error: null, response: {
          warehouse_list: [{ warehouse_id: 9001, location_id: "SG-LOC", warehouse_name: "API Pickup" }],
          cursor: { next_id: null, page_size: 30 },
        } });
      }
      if (method === "POST" && path.endsWith("get_warehouse_eligible_shop_list")) {
        return providerResponse({ error: null, response: {
          shop_list: [{ shop_id: Number(shopId), shop_name: "gjrxn.sg" }],
          cursor: { next_id: null, page_size: 30 },
        } });
      }
      if (path.endsWith("get_merchant_info")) {
        return providerResponse({ error: "", response: { merchant_id: Number(merchantId) } });
      }
      if (path.endsWith("get_category")) return providerResponse({ error: "", response: { category_list: [
        { category_id: 100629, parent_category_id: 0, display_category_name: "Food & Beverages", has_children: true },
        { category_id: 100646, parent_category_id: 100629, display_category_name: "Snacks", has_children: true },
        { category_id: 100787, parent_category_id: 100646, display_category_name: "Biscuits, Cookies & Wafers", has_children: false },
      ] } });
      if (path.endsWith("get_attribute_tree")) return providerResponse({ error: "", response: { list: [{
        category_id: 100787,
        attribute_tree: [{
          attribute_id: 100010,
          mandatory: true,
          attribute_info: { input_type: 1, max_value_count: 1, mandatory_region: ["SG"] },
          attribute_value_list: [{ value_id: 580, name: "6 Months" }],
        }],
      }] } });
      if (path.endsWith("get_brand_list")) return providerResponse({ error: "", response: {
        brand_list: [{ brand_id: 101, display_brand_name: "Fixture Brand" }],
        has_next_page: false,
        next_offset: 0,
        is_mandatory: true,
        input_type: "DROP_DOWN",
      } });
      if (path.endsWith("get_global_item_list")) return providerResponse({ error: "", response: {
        global_item_list: state.globalExists ? [{ global_item_id: 7001 }] : [],
        total_count: state.globalExists ? 1 : 0,
        has_next_page: false,
      } });
      if (path.endsWith("get_global_item_info")) return providerResponse({ error: "", response: {
        global_item_list: state.globalExists ? [globalItem()] : [],
      } });
      if (path.endsWith("get_global_item_limit")) return providerResponse({ error: "", response: {
        global_item_image_count_limit: { min_limit: 1, max_limit: 9 },
        extended_description_limit: { description_image_num_min: 0, description_image_num_max: 8 },
      } });
      if (path.endsWith("get_publish_task_result")) return providerResponse({ error: "", response: {
        publish_status: "SUCCESS",
      } });
      if (path.endsWith("get_published_list")) return providerResponse({ error: "", response: {
        published_item: state.localExists ? [{
          global_item_id: 7001,
          shop_id: Number(shopId),
          item_id: 8001,
        }] : [],
      } });
      throw new Error(`unexpected merchant ${method} ${path}`);
    },
    shopRequest: async ({ path }) => {
      if (path.endsWith("get_shop_info")) return providerResponse({ error: "", response: {
        shop_id: Number(shopId), region: "SG",
      } });
      if (path.endsWith("category_recommend")) return providerResponse({ error: "", response: {
        category_id: [200787],
      } });
      if (path.endsWith("get_category")) return providerResponse({ error: "", response: {
        category_list: [{ category_id: 200787, has_children: false }],
      } });
      if (path.endsWith("get_channel_list")) return providerResponse({ error: "", response: {
        logistics_channel_list: [{
          logistics_channel_id: 18036,
          enabled: true,
          compulsory_channel: false,
          fee_type: "NO_SELECTION",
          weight_limit: { item_min_weight: 0, item_max_weight: 30 },
          item_max_dimension: { length: 100, width: 100, height: 100, dimension_sum: 300 },
        }],
      } });
      if (path.endsWith("get_item_list")) return providerResponse({ error: "", response: {
        item: [], total_count: 0, has_next_page: false,
      } });
      if (path.endsWith("get_item_limit")) return providerResponse({ error: "", response: {
        item_image_count_limit: { min_limit: 1, max_limit: 9 },
        extended_description_limit: { description_image_num_min: 0, description_image_num_max: 8 },
      } });
      if (path.endsWith("get_item_base_info")) return providerResponse({ error: "", response: {
        item_list: state.localExists ? [localItem()] : [],
      } });
      throw new Error(`unexpected shop GET ${path}`);
    },
  };
}

test("actual execute runtime creates once, resumes local-only, then reconciles with zero writes", async () => {
  let receipt: ShopeeSgCreateResumeReceipt | null = null;
  const firstDurable = {
    genericProviderMutationStarted: false,
    completedStages: [] as Array<Record<string, unknown>>,
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const firstState = {
    globalExists: false, localExists: false, globalPosts: 0, localPosts: 0, uploads: 0,
  };
  const firstFences: unknown[] = [];
  let capturedGlobalItemId = "";
  const firstInput = executeInput({
    fences: firstFences,
    durable: firstDurable,
    readReceipt: async () => null,
    recordReceipt: async (value) => {
      const evidence = value.preparedArguments.sellerpilotShopeeSgCreatePrewriteEvidence as Record<string, unknown>;
      receipt = {
        contract: shopeeSgCreateResumeContract,
        sourceJobId: "55555555-5555-4555-8555-555555555555",
        credentialId,
        credentialVersion: 81,
        merchantId,
        shopId,
        requestFingerprint: "a".repeat(64),
        globalItemId: value.globalItemId,
        preparedArguments: value.preparedArguments,
      };
      assert.equal(evidence.contract, "sellerpilot_shopee_sg_create_prewrite_v1");
    },
    capture: (value) => { capturedGlobalItemId = String(value.globalItemId ?? ""); },
  });
  const created = await executeShopeeSgCreateRuntime(
    firstInput,
    providerRuntime(firstState),
  );
  assert.equal(created.remoteId, "8001");
  assert.deepEqual(created.shopeeSgCreateCompletionMap, {
    sameTransactionAsLocalPublish: true,
    globalItemId: "7001",
    localItemId: "8001",
  });
  assert.deepEqual(
    { global: firstState.globalPosts, local: firstState.localPosts, uploads: firstState.uploads },
    { global: 1, local: 1, uploads: 9 },
  );
  assert.equal(firstFences.length, 1);
  assert.equal(firstDurable.completedStages.length, 11);
  assert.equal(capturedGlobalItemId, "7001");
  assert.ok(receipt);

  const resumeState = {
    globalExists: true, localExists: false, globalPosts: 0, localPosts: 0, uploads: 0,
  };
  const resumeFences: unknown[] = [];
  const resumeDurable = {
    genericProviderMutationStarted: false,
    completedStages: firstDurable.completedStages.slice(0, 10),
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const resumed = await executeShopeeSgCreateRuntime(executeInput({
    fences: resumeFences,
    durable: resumeDurable,
    readReceipt: async () => receipt,
    recordReceipt: async () => { throw new Error("resume must not record a second Global receipt"); },
  }), providerRuntime(resumeState));
  assert.equal(resumed.remoteId, "8001");
  assert.deepEqual(resumed.shopeeSgCreateCompletionMap, {
    sameTransactionAsLocalPublish: true,
    globalItemId: "7001",
    localItemId: "8001",
  });
  assert.deepEqual(
    { global: resumeState.globalPosts, local: resumeState.localPosts, uploads: resumeState.uploads },
    { global: 0, local: 1, uploads: 0 },
  );
  assert.equal(resumeFences.length, 1);
  assert.equal(resumeDurable.completedStages.length, 11);

  const recoveredState = {
    globalExists: true, localExists: true, globalPosts: 0, localPosts: 0, uploads: 0,
  };
  const recoveredFences: unknown[] = [];
  const recoveredDurable = {
    genericProviderMutationStarted: true,
    completedStages: firstDurable.completedStages,
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const recovered = await executeShopeeSgCreateRuntime(executeInput({
    fences: recoveredFences,
    durable: recoveredDurable,
    readReceipt: async () => receipt,
    recordReceipt: async () => { throw new Error("recovery must not record a second Global receipt"); },
  }), providerRuntime(recoveredState));
  assert.equal(recovered.remoteId, "8001");
  assert.deepEqual(
    { global: recoveredState.globalPosts, local: recoveredState.localPosts, uploads: recoveredState.uploads },
    { global: 0, local: 0, uploads: 0 },
  );
  assert.equal(recoveredFences.length, 0);
});

test("a lost image-stage completion response resumes without a duplicate provider write", async () => {
  const durable = {
    genericProviderMutationStarted: false,
    completedStages: [] as Array<Record<string, unknown>>,
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const state = {
    globalExists: false, localExists: false, globalPosts: 0, localPosts: 0, uploads: 0,
  };
  let receipt: ShopeeSgCreateResumeReceipt | null = null;
  await assert.rejects(executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    loseCompletionResponseAt: 0,
    readReceipt: async () => receipt,
    recordReceipt: async () => { throw new Error("Global must not run before image resume"); },
  }), providerRuntime(state)), /completion response lost/u);
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 1, global: 0, local: 0 },
  );
  assert.equal(durable.completedStages.length, 1);

  const result = await executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => receipt,
    recordReceipt: async (value) => {
      receipt = {
        contract: shopeeSgCreateResumeContract,
        sourceJobId: "55555555-5555-4555-8555-555555555555",
        credentialId,
        credentialVersion: 81,
        merchantId,
        shopId,
        requestFingerprint: "a".repeat(64),
        globalItemId: value.globalItemId,
        preparedArguments: value.preparedArguments,
      };
    },
  }), providerRuntime(state));
  assert.equal(result.remoteId, "8001");
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 9, global: 1, local: 1 },
  );
  assert.equal(durable.completedStages.length, 11);
});

test("a lost provider image response remains uncertain and a retry performs zero uploads", async () => {
  const durable = {
    genericProviderMutationStarted: false,
    completedStages: [] as Array<Record<string, unknown>>,
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const state = {
    globalExists: false, localExists: false, globalPosts: 0, localPosts: 0, uploads: 0,
  };
  const lostResponseRuntime = providerRuntime(state);
  lostResponseRuntime.uploadImage = async (
    _payload, _environment, _url, _signal, hooks,
  ) => {
    const completedImageId = await hooks.beginProviderMutation();
    if (completedImageId) return completedImageId;
    state.uploads += 1;
    throw new Error("fixture provider image response lost after upload call");
  };
  await assert.rejects(executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => null,
    recordReceipt: async () => { throw new Error("Global must not run"); },
  }), lostResponseRuntime), /provider image response lost/u);
  assert.equal(state.uploads, 1);
  assert.equal(durable.completedStages.length, 0);
  assert.equal(durable.startedStages.get(0)?.stage, "image-upload");

  await assert.rejects(executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => null,
    recordReceipt: async () => { throw new Error("Global must not run"); },
  }), providerRuntime(state)), /SHOPEE_SG_IMAGE_STAGE_RESPONSE_UNCERTAIN/u);
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 1, global: 0, local: 0 },
  );
});

test("lost Global and local responses converge through exact official reads without duplicate writes", async () => {
  const durable = {
    genericProviderMutationStarted: false,
    completedStages: [] as Array<Record<string, unknown>>,
    startedStages: new Map<number, Record<string, unknown>>(),
  };
  const state = {
    globalExists: false,
    localExists: false,
    globalPosts: 0,
    localPosts: 0,
    uploads: 0,
    loseGlobalResponse: true,
    loseLocalResponse: false,
  };
  let receipt: ShopeeSgCreateResumeReceipt | null = null;
  const recordReceipt = async (value: {
    globalItemId: string;
    createResponse: Record<string, unknown>;
    readbackResponse: Record<string, unknown>;
    preparedArguments: Record<string, unknown>;
  }) => {
    receipt = {
      contract: shopeeSgCreateResumeContract,
      sourceJobId: "55555555-5555-4555-8555-555555555555",
      credentialId,
      credentialVersion: 81,
      merchantId,
      shopId,
      requestFingerprint: "a".repeat(64),
      globalItemId: value.globalItemId,
      preparedArguments: value.preparedArguments,
    };
  };

  await assert.rejects(executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => receipt,
    recordReceipt,
  }), providerRuntime(state)), /Global response lost/u);
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 9, global: 1, local: 0 },
  );
  assert.equal(durable.completedStages.length, 9);
  assert.equal(durable.startedStages.get(9)?.stage, "global-item-create");

  state.loseLocalResponse = true;
  await assert.rejects(executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => receipt,
    recordReceipt,
  }), providerRuntime(state)), /local response lost/u);
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 9, global: 1, local: 1 },
  );
  assert.ok(receipt);
  assert.equal(durable.completedStages.length, 10);
  assert.equal(durable.startedStages.get(10)?.stage, "local-publish");

  const reconciled = await executeShopeeSgCreateRuntime(executeInput({
    durable,
    fences: [],
    readReceipt: async () => receipt,
    recordReceipt: async () => { throw new Error("Global receipt must not repeat"); },
  }), providerRuntime(state));
  assert.equal(reconciled.remoteId, "8001");
  assert.deepEqual(
    { uploads: state.uploads, global: state.globalPosts, local: state.localPosts },
    { uploads: 9, global: 1, local: 1 },
  );
  assert.equal(durable.completedStages.length, 11);
  assert.equal(durable.startedStages.size, 0);
});

function shopeeCreateCompletionJob() {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    claim_token: "44444444-4444-4444-8444-444444444444",
    credential_id: credentialId,
    channel: "shopee" as const,
    operation: "listing.create" as const,
    environment: "production" as const,
    request: { arguments: {} },
    credential: {},
    attempt_count: 1,
  };
}

function shopeeCreateSucceededCompletion(map?: Record<string, unknown>) {
  return {
    jobId: "33333333-3333-4333-8333-333333333333",
    claimToken: "44444444-4444-4444-8444-444444444444",
    status: "succeeded" as const,
    result: {
      ok: true,
      channel: "shopee" as const,
      operation: "listing.create" as const,
      steps: [{ name: "local-publish", ok: true, status: 200, data: {} }],
      remoteId: "8001",
      safeMessage: "Shopee SG create completed",
      ...(map ? { shopeeSgCreateCompletionMap: map } : {}),
    },
  };
}

test("generic internal completion rejects Shopee SG success without atomic mapping", async () => {
  let rpcCalls = 0;
  const result = await completeCommerceClaim(
    { rpc: async () => { rpcCalls += 1; return { data: { status: "completed" }, error: null }; } },
    "a".repeat(64),
    shopeeCreateCompletionJob(),
    shopeeCreateSucceededCompletion(),
  );
  assert.equal(result, "unavailable");
  assert.equal(rpcCalls, 0);
});

test("generic internal completion accepts Shopee SG success only with same-transaction mapping", async () => {
  let rpcCalls = 0;
  const result = await completeCommerceClaim(
    { rpc: async () => { rpcCalls += 1; return { data: { status: "completed" }, error: null }; } },
    "a".repeat(64),
    shopeeCreateCompletionJob(),
    shopeeCreateSucceededCompletion({
      sameTransactionAsLocalPublish: true,
      globalItemId: "7001",
      localItemId: "8001",
    }),
  );
  assert.equal(result, "completed");
  assert.equal(rpcCalls, 0);
});
