import assert from "node:assert/strict";
import test from "node:test";
import type { LazadaMyCreateReadinessInput } from
  "../lib/product-registration/lazada/my-create-readiness";
import {
  assertLazadaMyCreateReadiness,
  lazadaMyDeliveryPolicyContract,
  lazadaMyEnglishContentApprovalContract,
  lazadaMyEnglishContentSha256,
  lazadaMyReturnPolicyContract,
} from "../lib/product-registration/lazada/my-create-readiness";
import {
  assertLazadaMyCreatePrewriteReceipt,
  runLazadaMyCreatePrewrite,
} from "../lib/product-registration/lazada/my-create-prewrite";
import {
  lazadaMyCreateCurrentStateContract,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "../lib/product-registration/lazada/my-create-raw-readback";
import { withLazadaProviderAccountIdentity } from
  "../lib/channels/provider-account-identity";
import type { RemoteResponse } from "../lib/channels/protocols";

const APP_KEY = "137451";
const CREDENTIAL_ID = "61111111-1111-4111-8111-111111111111";
const SELLER_ID = "300872000183";
const SHORT_CODE = "MY4NNISR2D";
const SELLER_SKU = "SP-MY-PREWRITE-001";
const CATEGORY_ID = "10100205";
const VERIFIED_AT = "2026-09-10T00:01:00.000Z";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/prewrite-${index + 1}.jpg`,
);

function remote(data: Record<string, unknown>): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status: 200 }),
    data,
    text: JSON.stringify(data),
  };
}

function argumentsValue() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    country: "my",
    sellerpilotExpectedSellerId: SELLER_ID,
    sellerpilotExpectedPrimaryCategory: CATEGORY_ID,
    sellerpilotLazadaMyCreateContext: {
      contract: "lazada_my_listing_create_context_v1",
      productId: "71111111-1111-4111-8111-111111111111",
      sellerSku: SELLER_SKU,
      sourceCurrency: "KRW",
      sourcePriceKrw: 4_975,
      market: "MY",
      locale: "ms-MY",
      sellerId: SELLER_ID,
      targetCurrency: "MYR",
      targetPriceMyr: 19.9,
      quantity: 3,
      categoryId: CATEGORY_ID,
      categoryConfirmedAt: VERIFIED_AT,
      sellerMode: "standard",
      sellerModeVerifiedAt: VERIFIED_AT,
      sellerModeEvidenceSource: "lazada-open-platform-seller-get",
    },
    sellerpilotLazadaPricePolicy: {
      contract: "lazada_krw_myr_reference_price_v1",
      sourceCurrency: "KRW",
      sourcePriceKrw: 4_975,
      targetCurrency: "MYR",
      targetPriceMyr: 19.9,
      rate: {
        krwPerMyr: 250,
        fetchedAt: VERIFIED_AT,
        asOf: VERIFIED_AT,
        source: "fixture reference",
        sourceUrl: "https://example.test/rates",
        frequency: "minute-market",
      },
    },
    request: {
      Request: {
        Product: {
          PrimaryCategory: CATEGORY_ID,
          Images: { Image: [...IMAGES] },
          Attributes: {
            name: "SellerPilot Verified Storage Organizer",
            description: "A durable storage organizer with verified dimensions.",
            short_description: "Verified MY product content",
            brand_id: "30768",
            delivery_option_sof: "No",
          },
          Skus: {
            Sku: [{
              SellerSku: SELLER_SKU,
              price: "19.90",
              quantity: "3",
              package_content: "1 storage organizer",
              package_weight: "0.32",
              package_length: "30",
              package_width: "20",
              package_height: "10",
              Status: "inactive",
              Images: { Image: [...IMAGES] },
            }],
          },
        },
      },
    },
  };
}

function readinessInput(): LazadaMyCreateReadinessInput {
  const args = argumentsValue();
  const credential = withLazadaProviderAccountIdentity({
    app_key: APP_KEY,
    access_token: "fixture-access-token",
    country: "my",
  }, {
    account_platform: "seller_center",
    country_user_info: [{
      country: "my",
      seller_id: SELLER_ID,
      user_id: "300872000184",
      short_code: SHORT_CODE,
    }],
  }).payload;
  const state = `sellerpilot-lazada-my-${"b".repeat(32)}`;
  return {
    expected: {
      appKey: APP_KEY,
      appName: "Couplit Commerce",
      redirectUri: "https://sellerpilot.example/",
      credentialId: CREDENTIAL_ID,
      sellerId: SELLER_ID,
      shortCode: SHORT_CODE,
    },
    commerceApp: {
      appKey: APP_KEY,
      appName: "Couplit Commerce",
      status: "Online",
      authorizationKind: "seller",
      scopes: [
        "Product Management",
        "Product Information",
        "Price Stock",
        "Catalogue",
        "Seller Information",
      ],
      evidenceSource: "lazada-open-platform-console",
      verifiedAt: VERIFIED_AT,
    },
    authorization: {
      clientId: APP_KEY,
      redirectUri: "https://sellerpilot.example/",
      responseType: "code",
      country: "my",
      state,
    },
    callback: {
      clientId: APP_KEY,
      redirectUri: "https://sellerpilot.example/",
      country: "my",
      state,
      credentialId: CREDENTIAL_ID,
    },
    scope: {
      uiCredentialId: CREDENTIAL_ID,
      routeCredentialId: CREDENTIAL_ID,
      workerCredentialId: CREDENTIAL_ID,
      operation: "listing.create",
      country: "my",
      market: "MY",
    },
    credential,
    credentialRotatedAt: "2026-09-10T00:00:00.000Z",
    sellerGatewayResult: {
      ok: true,
      channel: "lazada",
      operation: "shops.get",
      steps: [{
        name: "seller-info",
        ok: true,
        status: 200,
        data: {
          code: "0",
          data: {
            seller_id: SELLER_ID,
            short_code: SHORT_CODE,
            status: "ACTIVE",
            marketplaceEaseMode: false,
          },
        },
      }],
    },
    sellerVerifiedAt: VERIFIED_AT,
    target: {
      credentialId: CREDENTIAL_ID,
      targetId: SELLER_ID,
      shortCode: SHORT_CODE,
      marketCode: "MY",
      locale: "ms-MY",
      language: "Bahasa Melayu",
      currency: "MYR",
      verifiedAt: VERIFIED_AT,
    },
    argumentsValue: args,
    category: {
      treeRequest: {
        path: "/category/tree/get",
        params: { language_code: "en_US" },
      },
      treeResponse: {
        code: "0",
        data: [{ category_id: CATEGORY_ID, leaf: true }],
      },
      attributesRequest: {
        path: "/category/attributes/get",
        params: {
          primary_category_id: CATEGORY_ID,
          language_code: "en_US",
        },
      },
      attributesResponse: {
        code: "0",
        data: [
          { name: "name", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
          { name: "description", input_type: "richText", is_mandatory: 1, attribute_type: "normal" },
          { name: "brand", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
          { name: "delivery_option_sof", input_type: "singleselect", is_mandatory: 1, attribute_type: "normal", options: [{ en_name: "Yes" }, { en_name: "No" }] },
          { name: "price", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
          { name: "quantity", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
        ],
      },
    },
    brandCatalog: {
      code: "0",
      data: { module: [{ brand_id: "30768", name: "Fixture Brand" }] },
    },
    sellerSkuLookup: {
      path: "/products/get",
      params: {
        filter: "all",
        sku_seller_list: JSON.stringify([SELLER_SKU]),
        options: "1",
        limit: "50",
        offset: "0",
      },
      remote: remote({ code: "0", data: { total_products: 0, products: [] } }),
    },
    shipmentProviders: {
      code: "0",
      data: {
        shipment_providers: [{
          name: "LGS-FM43",
          enabled_delivery_options: ["standard"],
        }],
      },
    },
    deliveryPolicy: {
      contract: lazadaMyDeliveryPolicyContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      shipmentProvider: "LGS-FM43",
      deliveryOption: "standard",
      deliveryOptionSof: "No",
      verifiedAt: VERIFIED_AT,
      approvedForCreate: true,
    },
    returnPolicy: {
      contract: lazadaMyReturnPolicyContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      source: "lazada-seller-center",
      returnCondition: "Current MY return policy reviewed",
      verifiedAt: VERIFIED_AT,
      approvedForCreate: true,
    },
    englishContentApproval: {
      contract: lazadaMyEnglishContentApprovalContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      languageCode: "en_US",
      contentSha256: lazadaMyEnglishContentSha256(args),
      approvedAt: VERIFIED_AT,
      approvedForCreate: true,
    },
    authoritativeRate: {
      krwPerMyr: 250,
      fetchedAt: VERIFIED_AT,
      asOf: VERIFIED_AT,
      source: "fixture reference",
      sourceUrl: "https://example.test/rates",
      frequency: "minute-market",
    },
    now: new Date("2026-09-10T00:02:00.000Z"),
  };
}

function currentSource(): LazadaMyCreateCurrentSourceSnapshot {
  return {
    contract: lazadaMyCreateCurrentStateContract,
    productId: "71111111-1111-4111-8111-111111111111",
    productStatus: "draft",
    productDemo: false,
    productOnHand: 3,
    productUpdatedAt: VERIFIED_AT,
    listingStatus: "draft",
    listingRemoteId: null,
    listingUpdatedAt: VERIFIED_AT,
    credentialId: CREDENTIAL_ID,
    credentialStatus: "active",
    credentialVersion: 1,
  };
}

function withCurrent(hooks: {
  assertLeaseHealthy: () => Promise<void>;
  beginProviderMutation: () => Promise<void>;
}) {
  const snapshot = currentSource();
  return {
    claimedCurrentSource: snapshot,
    hooks: {
      readCurrentSource: async () => snapshot,
      ...hooks,
    },
  };
}

async function run(input: LazadaMyCreateReadinessInput) {
  const events: string[] = [];
  const output = await runLazadaMyCreatePrewrite({
    readinessInput: input,
    request: {
      path: "/product/create",
      method: "POST",
      argumentsValue: input.argumentsValue,
    },
    ...withCurrent({
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("begin"); },
    }),
    createProduct: async (request) => {
      events.push(`provider:${request.path}`);
      return { code: "0" };
    },
  });
  return { events, output };
}

test("Lazada MY prewrite issues only exact CreateProduct after a complete 010 receipt", async () => {
  const { events, output } = await run(readinessInput());
  assert.deepEqual(events, ["lease", "begin", "provider:/product/create"]);
  assert.equal(output.receipt.categoryLanguageCode, "en_US");
  assert.equal(output.receipt.productImageCount, 8);
  assert.deepEqual(output.receipt.sellerSkus, [SELLER_SKU]);
  assert.equal(output.receipt.shipmentProvider, "LGS-FM43");
  assert.match(output.receipt.requestSha256, /^[a-f0-9]{64}$/u);
});

test("Lazada MY prewrite rejects every delegated readiness bypass before provider mutation", async () => {
  const cases: Array<{
    name: string;
    mutate: (input: LazadaMyCreateReadinessInput) => void;
    expected: RegExp;
  }> = [
    {
      name: "GetProducts limit",
      mutate: (input) => { input.sellerSkuLookup.params.limit = "100"; },
      expected: /LAZADA_MY_SELLER_SKU_LOOKUP_CONTRACT_INVALID/u,
    },
    {
      name: "English category metadata",
      mutate: (input) => { input.category.attributesRequest.params.language_code = "ms_MY"; },
      expected: /LAZADA_MY_ENGLISH_CATEGORY_CONTRACT_INVALID/u,
    },
    {
      name: "brand catalog",
      mutate: (input) => { input.brandCatalog = { code: "0", data: { module: [] } }; },
      expected: /LAZADA_MY_BRAND_ID_NOT_IN_CATALOG/u,
    },
    {
      name: "shipment provider",
      mutate: (input) => { input.shipmentProviders = { code: "0", data: { shipment_providers: [] } }; },
      expected: /LAZADA_MY_SHIPMENT_PROVIDER_MISMATCH/u,
    },
    {
      name: "return approval",
      mutate: (input) => { input.returnPolicy = {}; },
      expected: /LAZADA_MY_RETURN_POLICY_REQUIRED/u,
    },
    {
      name: "eight approved images",
      mutate: (input) => {
        const product = (input.argumentsValue.request as {
          Request: { Product: { Images: { Image: string[] } } };
        }).Request.Product;
        product.Images.Image.pop();
      },
      expected: /LAZADA_MY_CREATE_EXACT_EIGHT_IMAGES_REQUIRED/u,
    },
    {
      name: "SellerSku absence",
      mutate: (input) => {
        input.sellerSkuLookup.remote = remote({
          code: "0",
          data: { total_products: 1, products: [{ item_id: "99" }] },
        });
      },
      expected: /LAZADA_CREATE_SELLER_SKU_ALREADY_EXISTS/u,
    },
  ];

  for (const candidate of cases) {
    const input = readinessInput();
    candidate.mutate(input);
    const events: string[] = [];
    await assert.rejects(runLazadaMyCreatePrewrite({
      readinessInput: input,
      request: {
        path: "/product/create",
        method: "POST",
        argumentsValue: input.argumentsValue,
      },
      ...withCurrent({
        assertLeaseHealthy: async () => { events.push("lease"); },
        beginProviderMutation: async () => { events.push("begin"); },
      }),
      createProduct: async () => {
        events.push("provider");
        return null;
      },
    }), candidate.expected, candidate.name);
    assert.deepEqual(events, [], candidate.name);
  }
});

test("Lazada MY prewrite rejects a different payload and wrong provider endpoint with zero calls", async () => {
  for (const candidate of [
    { path: "/product/update", method: "POST", mutate: false },
    { path: "/product/create", method: "GET", mutate: false },
    { path: "/product/create", method: "POST", mutate: true },
  ]) {
    const input = readinessInput();
    const requestArguments = structuredClone(input.argumentsValue);
    if (candidate.mutate) {
      const product = (requestArguments.request as {
        Request: { Product: { Skus: { Sku: Array<{ quantity: string }> } } };
      }).Request.Product;
      product.Skus.Sku[0].quantity = "4";
    }
    let calls = 0;
    await assert.rejects(runLazadaMyCreatePrewrite({
      readinessInput: input,
      request: {
        path: candidate.path,
        method: candidate.method,
        argumentsValue: requestArguments,
      },
      ...withCurrent({
        assertLeaseHealthy: async () => { calls += 1; },
        beginProviderMutation: async () => { calls += 1; },
      }),
      createProduct: async () => { calls += 1; },
    }), candidate.mutate
      ? /LAZADA_MY_CREATE_PREWRITE_ARGUMENTS_MISMATCH/u
      : /LAZADA_MY_CREATE_PROVIDER_REQUEST_INVALID/u);
    assert.equal(calls, 0);
  }
});

test("Lazada MY prewrite revalidates evidence after the last lease wait", async () => {
  const input = readinessInput();
  const events: string[] = [];
  await assert.rejects(runLazadaMyCreatePrewrite({
    readinessInput: input,
    request: {
      path: "/product/create",
      method: "POST",
      argumentsValue: input.argumentsValue,
    },
    ...withCurrent({
      assertLeaseHealthy: async () => {
        events.push("lease");
        input.sellerSkuLookup.params.limit = "100";
      },
      beginProviderMutation: async () => { events.push("begin"); },
    }),
    createProduct: async () => { events.push("provider"); },
  }), /LAZADA_MY_SELLER_SKU_LOOKUP_CONTRACT_INVALID/u);
  assert.deepEqual(events, ["lease"]);
});

test("Lazada MY prewrite receipt rejects post-validation payload tampering", async () => {
  const input = readinessInput();
  const readiness = assertLazadaMyCreateReadiness(input);
  const { output } = await run(input);
  const tampered = structuredClone(input.argumentsValue);
  const product = (tampered.request as {
    Request: { Product: { Attributes: { name: string } } };
  }).Request.Product;
  product.Attributes.name = "Tampered name";
  await assert.rejects(assertLazadaMyCreatePrewriteReceipt({
    receipt: output.receipt,
    readiness,
    argumentsValue: tampered,
  }), /LAZADA_MY_CREATE_PREWRITE_RECEIPT_MISMATCH/u);
});
