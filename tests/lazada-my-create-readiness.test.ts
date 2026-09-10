import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaMyCreateCompletion,
  assertLazadaMyCreateReadiness,
  lazadaMyDeliveryPolicyContract,
  lazadaMyEnglishContentApprovalContract,
  lazadaMyEnglishContentSha256,
  lazadaMyReturnPolicyContract,
  type LazadaMyCreateReadinessInput,
} from "../lib/product-registration/lazada/my-create-readiness";
import {
  lazadaMyCreateCurrentStateContract,
  lazadaMyCreateOfficialEvidenceFromBytes,
  type LazadaMyCreateCurrentSourceSnapshot,
} from "../lib/product-registration/lazada/my-create-raw-readback";
import {
  withLazadaProviderAccountIdentity,
} from "../lib/channels/provider-account-identity";
import type { RemoteResponse } from "../lib/channels/protocols";

const APP_KEY = "137451";
const CREDENTIAL_ID = "61111111-1111-4111-8111-111111111111";
const SELLER_ID = "300872000183";
const SHORT_CODE = "MY4NNISR2D";
const SELLER_SKU = "SP-MY-READY-001";
const CATEGORY_ID = "10100205";
const FINGERPRINT = "a".repeat(64);
const REDIRECT_URI = "https://sellerpilot.example/";
const ROTATED_AT = "2026-09-10T00:00:00.000Z";
const VERIFIED_AT = "2026-09-10T00:01:00.000Z";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/ready-${index + 1}.jpg`,
);

function remote(data: Record<string, unknown>): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    data,
    text: JSON.stringify(data),
  };
}

function credential() {
  return withLazadaProviderAccountIdentity({
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
}

function argumentsValue() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: FINGERPRINT,
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
          Images: { Image: IMAGES },
          Attributes: {
            name: "SellerPilot Verified Storage Organizer",
            description: "A durable storage organizer with verified dimensions and contents.",
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
              Images: { Image: IMAGES },
            }],
          },
        },
      },
    },
  };
}

function readinessInput(): LazadaMyCreateReadinessInput {
  const args = argumentsValue();
  const state = `sellerpilot-lazada-my-${"b".repeat(32)}`;
  return {
    expected: {
      appKey: APP_KEY,
      appName: "Couplit Commerce",
      redirectUri: REDIRECT_URI,
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
      redirectUri: REDIRECT_URI,
      responseType: "code",
      country: "my",
      state,
    },
    callback: {
      clientId: APP_KEY,
      redirectUri: REDIRECT_URI,
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
    credential: credential(),
    credentialRotatedAt: ROTATED_AT,
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
        data: [{ category_id: CATEGORY_ID, name: "Storage Organizers", leaf: true }],
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
      data: { module: [{ brand_id: "30768", name: "SellerPilot Fixture Brand" }] },
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
          is_default: true,
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
      returnCondition: "Current MY account return settings reviewed for this product",
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

function itemReadback() {
  const product = argumentsValue().request.Request.Product;
  return {
    code: "0",
    data: {
      item_id: "987654321",
      primary_category: CATEGORY_ID,
      status: "inactive",
      locale: "ms-MY",
      images: IMAGES,
      attributes: product.Attributes,
      skus: [{
        ...product.Skus.Sku[0],
        SkuId: "555001",
        special_price: 0,
        Url: "https://www.lazada.com.my/products/i987654321.html",
      }],
    },
  };
}

function currentSource(): LazadaMyCreateCurrentSourceSnapshot {
  return {
    contract: lazadaMyCreateCurrentStateContract,
    productId: "71111111-1111-4111-8111-111111111111",
    productStatus: "draft",
    productDemo: false,
    productOnHand: 3,
    productUpdatedAt: ROTATED_AT,
    listingStatus: "draft",
    listingRemoteId: null,
    listingUpdatedAt: ROTATED_AT,
    credentialId: CREDENTIAL_ID,
    credentialStatus: "active",
    credentialVersion: 1,
  };
}

function officialEvidence(createResponse: unknown, readback: unknown) {
  const product = argumentsValue().request.Request.Product;
  return lazadaMyCreateOfficialEvidenceFromBytes({
    postRequest: {
      method: "POST",
      path: "/product/create",
      body: argumentsValue(),
    },
    postResponseBytes: JSON.stringify(createResponse),
    itemGetRequest: {
      method: "GET",
      path: "/product/item/get",
      params: { item_id: "987654321" },
    },
    itemGetResponseBytes: JSON.stringify(readback),
    imageRaw: JSON.stringify(IMAGES),
    contentRaw: `${product.Attributes.name}\n${product.Attributes.description}`,
    localeRaw: "ms-MY",
  });
}

test("Lazada MY create readiness binds OAuth, Commerce seller, target, official metadata and policies", () => {
  const verified = assertLazadaMyCreateReadiness(readinessInput());
  assert.deepEqual({
    sellerId: verified.sellerId,
    shortCode: verified.shortCode,
    categoryLanguageCode: verified.categoryLanguageCode,
    publicationLocale: verified.publicationLocale,
    sellerSkus: verified.sellerSkus,
    imageCount: verified.productImageCount,
    price: verified.targetPriceMyr,
    stock: verified.quantity,
    delivery: verified.deliveryOption,
  }, {
    sellerId: SELLER_ID,
    shortCode: SHORT_CODE,
    categoryLanguageCode: "en_US",
    publicationLocale: "ms-MY",
    sellerSkus: [SELLER_SKU],
    imageCount: 8,
    price: 19.9,
    stock: 3,
    delivery: "standard",
  });
});

test("Lazada MY completion requires the CreateProduct IDs and exact GetProductItem readback", () => {
  const input = readinessInput();
  const readiness = assertLazadaMyCreateReadiness(input);
  const createResponse = {
    code: "0",
    data: {
      item_id: "987654321",
      sku_list: [{ seller_sku: SELLER_SKU, sku_id: "555001" }],
    },
  };
  const readback = itemReadback();
  const snapshot = currentSource();
  const completion = assertLazadaMyCreateCompletion({
    readiness,
    argumentsValue: input.argumentsValue,
    createResponse,
    itemReadback: readback,
    verifiedAt: "2026-09-10T00:03:00.000Z",
    officialEvidence: officialEvidence(createResponse, readback),
    claimedCurrentSource: snapshot,
    currentSource: snapshot,
  });
  assert.equal(completion.itemId, "987654321");
  assert.equal(completion.visibility, "non_public");
  assert.deepEqual(completion.skuIds, ["555001"]);
  assert.equal(completion.remoteState.verified, true);
});

test("Lazada MY create rejects a mismatched short code or credential lineage", () => {
  const shortCodeMismatch = readinessInput();
  shortCodeMismatch.target.shortCode = "OTHER-STORE";
  assert.throws(
    () => assertLazadaMyCreateReadiness(shortCodeMismatch),
    /LAZADA_MY_TARGET_IDENTITY_MISMATCH/u,
  );

  const credentialMismatch = readinessInput();
  credentialMismatch.scope.workerCredentialId =
    "81111111-1111-4111-8111-111111111111";
  assert.throws(
    () => assertLazadaMyCreateReadiness(credentialMismatch),
    /LAZADA_MY_CREATE_SCOPE_MISMATCH/u,
  );
});

test("Lazada MY create cannot substitute another app or omit a required Commerce scope", () => {
  const wrongApp = readinessInput();
  wrongApp.credential.app_key = "cs-bot-app";
  assert.throws(
    () => assertLazadaMyCreateReadiness(wrongApp),
    /LAZADA_MY_COMMERCE_CREDENTIAL_IDENTITY_MISMATCH/u,
  );

  const missingScope = readinessInput();
  missingScope.commerceApp.scopes = missingScope.commerceApp.scopes.filter(
    (scope) => scope !== "Seller Information",
  );
  assert.throws(
    () => assertLazadaMyCreateReadiness(missingScope),
    /LAZADA_MY_COMMERCE_APP_SCOPE_INVALID/u,
  );
});

test("Lazada MY create rejects non-English category requests, the documented GetProducts overflow and unknown brand IDs", () => {
  const localized = readinessInput();
  localized.category.attributesRequest.params.language_code = "ms_MY";
  assert.throws(
    () => assertLazadaMyCreateReadiness(localized),
    /LAZADA_MY_ENGLISH_CATEGORY_CONTRACT_INVALID/u,
  );

  const overflow = readinessInput();
  overflow.sellerSkuLookup.params.limit = "100";
  assert.throws(
    () => assertLazadaMyCreateReadiness(overflow),
    /LAZADA_MY_SELLER_SKU_LOOKUP_CONTRACT_INVALID/u,
  );

  const unknownBrand = readinessInput();
  unknownBrand.brandCatalog = { code: "0", data: { module: [] } };
  assert.throws(
    () => assertLazadaMyCreateReadiness(unknownBrand),
    /LAZADA_MY_BRAND_ID_NOT_IN_CATALOG/u,
  );
});

test("Lazada MY create rejects stale content, delivery and return approvals", () => {
  for (const key of [
    "englishContentApproval",
    "deliveryPolicy",
    "returnPolicy",
  ] as const) {
    const input = readinessInput();
    const evidence = input[key] as Record<string, unknown>;
    evidence[key === "englishContentApproval" ? "approvedAt" : "verifiedAt"] =
      "2026-09-09T23:59:59.000Z";
    assert.throws(
      () => assertLazadaMyCreateReadiness(input),
      /LAZADA_MY_CREATE_POLICY_EVIDENCE_STALE/u,
    );
  }
});

test("Lazada MY completion rejects a different item, SKU or provider visibility", () => {
  const input = readinessInput();
  const readiness = assertLazadaMyCreateReadiness(input);
  const createResponse = {
    code: "0",
    data: {
      item_id: "987654321",
      sku_list: [{ seller_sku: SELLER_SKU, sku_id: "555001" }],
    },
  };
  const snapshot = currentSource();
  const differentItem = itemReadback();
  differentItem.data.item_id = "987654322";
  assert.throws(() => assertLazadaMyCreateCompletion({
    readiness,
    argumentsValue: input.argumentsValue,
    createResponse,
    itemReadback: differentItem,
    verifiedAt: "2026-09-10T00:03:00.000Z",
    officialEvidence: officialEvidence(createResponse, differentItem),
    claimedCurrentSource: snapshot,
    currentSource: snapshot,
  }), /LAZADA_MY_CREATE_RESPONSE_IDENTITY_INVALID/u);

  const liveInsteadOfSafe = itemReadback();
  liveInsteadOfSafe.data.status = "active";
  liveInsteadOfSafe.data.skus[0].Status = "active";
  assert.throws(() => assertLazadaMyCreateCompletion({
    readiness,
    argumentsValue: input.argumentsValue,
    createResponse,
    itemReadback: liveInsteadOfSafe,
    verifiedAt: "2026-09-10T00:03:00.000Z",
    officialEvidence: officialEvidence(createResponse, liveInsteadOfSafe),
    claimedCurrentSource: snapshot,
    currentSource: snapshot,
  }), /LAZADA_MY_CREATE_OFFICIAL_READBACK_INCOMPLETE/u);
});
