import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteResponse } from "../lib/channels/protocols";
import { withLazadaProviderAccountIdentity } from
  "../lib/channels/provider-account-identity";
import {
  lazadaMyDeliveryPolicyContract,
  lazadaMyEnglishContentApprovalContract,
  lazadaMyEnglishContentSha256,
  lazadaMyReturnPolicyContract,
} from "../lib/product-registration/lazada/my-create-readiness";
import {
  buildLazadaMyCreateReadinessInput,
  type LazadaMyCreateProviderRead,
} from "../lib/product-registration/lazada/my-create-readiness-builder";
import {
  produceLazadaMyCreateEvidence,
  type LazadaMyCreateApprovalSnapshot,
  type LazadaMyCreateCommerceAppSnapshot,
  type LazadaMyCreateCredentialSnapshot,
  type LazadaMyCreateEvidenceKey,
  type LazadaMyCreateEvidenceProducerDependencies,
  type LazadaMyCreateOAuthSnapshot,
  type LazadaMyCreateProductSnapshot,
  type LazadaMyCreateTargetSnapshot,
} from "../lib/product-registration/lazada/my-create-evidence-producer";

const PRODUCT_ID = "71111111-1111-4111-8111-111111111111";
const CREDENTIAL_ID = "61111111-1111-4111-8111-111111111111";
const SELLER_ID = "300872000183";
const SHORT_CODE = "MY4NNISR2D";
const SELLER_SKU = "SP-MY-PRODUCER-001";
const CATEGORY_ID = "10100205";
const REVISION = "listing-revision-014";
const ROTATED_AT = "2026-09-10T03:00:00.000Z";
const OBSERVED_AT = "2026-09-10T03:01:00.000Z";
const STATE = `sellerpilot-lazada-my-${"f".repeat(32)}`;
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/producer-${index + 1}.jpg`,
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
    publicationExpectedFingerprint: "9".repeat(64),
    publicationExpectedImageCount: 8,
    country: "my",
    sellerpilotExpectedSellerId: SELLER_ID,
    sellerpilotExpectedPrimaryCategory: CATEGORY_ID,
    sellerpilotLazadaMyCreateContext: {
      contract: "lazada_my_listing_create_context_v1",
      productId: PRODUCT_ID,
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
      categoryConfirmedAt: OBSERVED_AT,
      sellerMode: "standard",
      sellerModeVerifiedAt: OBSERVED_AT,
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
        fetchedAt: OBSERVED_AT,
        asOf: OBSERVED_AT,
        source: "fixture reference",
        sourceUrl: "https://example.test/rates",
        frequency: "minute-market",
      },
    },
    request: { Request: { Product: {
      PrimaryCategory: CATEGORY_ID,
      Images: { Image: [...IMAGES] },
      Attributes: {
        name: "SellerPilot Server Evidence Organizer",
        description: "Current approved English content for the MY product.",
        short_description: "Approved server evidence",
        brand_id: "30768",
        delivery_option_sof: "No",
      },
      Skus: { Sku: [{
        SellerSku: SELLER_SKU,
        price: "19.90",
        quantity: "3",
        package_content: "1 organizer",
        package_weight: "0.32",
        package_length: "30",
        package_width: "20",
        package_height: "10",
        Status: "inactive",
        Images: { Image: [...IMAGES] },
      }] },
    } } },
  };
}

function key(): LazadaMyCreateEvidenceKey {
  return {
    source: "sellerpilot-server-listing-claim",
    operation: "listing.create",
    productId: PRODUCT_ID,
    credentialId: CREDENTIAL_ID,
    targetId: SELLER_ID,
    revision: REVISION,
    observedAt: OBSERVED_AT,
  };
}

function credentialPayload() {
  return withLazadaProviderAccountIdentity({
    app_key: "137451",
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

function snapshots() {
  const args = argumentsValue();
  const common = {
    productId: PRODUCT_ID,
    credentialId: CREDENTIAL_ID,
    targetId: SELLER_ID,
    revision: REVISION,
    observedAt: OBSERVED_AT,
  };
  const product: LazadaMyCreateProductSnapshot = {
    ...common,
    source: "sellerpilot-rpc-product-create-context",
    productId: PRODUCT_ID,
    argumentsValue: args,
  };
  const credential: LazadaMyCreateCredentialSnapshot = {
    ...common,
    source: "sellerpilot-rpc-active-vault-credential",
    credentialId: CREDENTIAL_ID,
    channel: "lazada",
    environment: "production",
    status: "active",
    version: 7,
    lastRotatedAt: ROTATED_AT,
    sellerAccountKeySource: "provider_certified_v1",
    sellerAccountVerifiedAt: OBSERVED_AT,
    secretPayload: credentialPayload(),
  };
  const oauth: LazadaMyCreateOAuthSnapshot = {
    ...common,
    source: "sellerpilot-rpc-oauth-callback-lineage",
    credentialId: CREDENTIAL_ID,
    appKey: "137451",
    country: "my",
    redirectUri: "https://sellerpilot.example/",
    responseType: "code",
    authorizationState: STATE,
    callbackState: STATE,
    callbackClaimed: true,
    oauthComplete: true,
    completedAt: ROTATED_AT,
  };
  const target: LazadaMyCreateTargetSnapshot = {
    ...common,
    source: "sellerpilot-rpc-current-target-discovery",
    credentialId: CREDENTIAL_ID,
    targetId: SELLER_ID,
    shortCode: SHORT_CODE,
    marketCode: "MY",
    locale: "ms-MY",
    language: "Bahasa Melayu",
    currency: "MYR",
    remoteStatus: "ACTIVE",
    verifiedAt: OBSERVED_AT,
  };
  const app: LazadaMyCreateCommerceAppSnapshot = {
    ...common,
    source: "sellerpilot-rpc-commerce-app-attestation",
    appKey: "137451",
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
    verifiedAt: OBSERVED_AT,
  };
  const approval: LazadaMyCreateApprovalSnapshot = {
    ...common,
    source: "sellerpilot-rpc-approved-operator-evidence",
    productId: PRODUCT_ID,
    credentialId: CREDENTIAL_ID,
    targetId: SELLER_ID,
    deliveryPolicy: {
      contract: lazadaMyDeliveryPolicyContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      shipmentProvider: "LGS-FM43",
      deliveryOption: "standard",
      deliveryOptionSof: "No",
      verifiedAt: OBSERVED_AT,
      approvedForCreate: true,
    },
    returnPolicy: {
      contract: lazadaMyReturnPolicyContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      source: "lazada-seller-center",
      returnCondition: "Current MY return policy reviewed",
      verifiedAt: OBSERVED_AT,
      approvedForCreate: true,
    },
    englishContentApproval: {
      contract: lazadaMyEnglishContentApprovalContract,
      credentialId: CREDENTIAL_ID,
      market: "MY",
      sellerId: SELLER_ID,
      languageCode: "en_US",
      contentSha256: lazadaMyEnglishContentSha256(args),
      approvedAt: OBSERVED_AT,
      approvedForCreate: true,
    },
  };
  return { product, credential, oauth, target, app, approval };
}

function dependencies(input: {
  mutate?: (value: ReturnType<typeof snapshots>) => void;
  missing?: keyof ReturnType<typeof snapshots>;
  staleRevisionAt?: number;
} = {}) {
  const values = snapshots();
  input.mutate?.(values);
  const calls: string[] = [];
  let revisionCalls = 0;
  const load = <K extends keyof typeof values>(name: K) => async () => {
    calls.push(name);
    return input.missing === name ? null : values[name];
  };
  const result: LazadaMyCreateEvidenceProducerDependencies = {
    assertRevisionCurrent: async () => {
      revisionCalls += 1;
      calls.push(`revision:${revisionCalls}`);
      if (input.staleRevisionAt === revisionCalls) {
        throw new Error("LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE");
      }
    },
    loadProductSnapshot: load("product"),
    loadCredentialSnapshot: load("credential"),
    loadOAuthSnapshot: load("oauth"),
    loadTargetSnapshot: load("target"),
    loadCommerceAppSnapshot: load("app"),
    loadApprovalSnapshot: load("approval"),
  };
  return { calls, result };
}

function providerResponse(request: LazadaMyCreateProviderRead) {
  switch (request.path) {
    case "/seller/get":
      return remote({ code: "0", data: {
        seller_id: SELLER_ID,
        short_code: SHORT_CODE,
        status: "ACTIVE",
        marketplaceEaseMode: false,
      } });
    case "/products/get":
      return remote({ code: "0", data: { total_products: 0, products: [] } });
    case "/category/tree/get":
      return remote({ code: "0", data: [{ category_id: CATEGORY_ID, leaf: true }] });
    case "/category/attributes/get":
      return remote({ code: "0", data: [
        { name: "name", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
        { name: "description", input_type: "richText", is_mandatory: 1, attribute_type: "normal" },
        { name: "brand", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
        { name: "delivery_option_sof", input_type: "singleselect", is_mandatory: 1, attribute_type: "normal", options: [{ en_name: "Yes" }, { en_name: "No" }] },
        { name: "price", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
        { name: "quantity", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
      ] });
    case "/category/brands/query":
      return remote({ code: "0", data: { module: [{ brand_id: "30768", name: "Fixture Brand" }] } });
    case "/shipment/providers/get":
      return remote({ code: "0", data: { shipment_providers: [{
        name: "LGS-FM43",
        enabled_delivery_options: ["standard"],
      }] } });
  }
}

test("Lazada MY producer emits the exact 012 DTO from one server/RPC evidence revision", async () => {
  const deps = dependencies();
  const produced = await produceLazadaMyCreateEvidence({
    key: key(),
    dependencies: deps.result,
  });
  assert.equal(produced.ok, true);
  if (!produced.ok) return;
  assert.deepEqual(deps.calls, [
    "revision:1", "product", "credential", "oauth", "target", "app",
    "approval", "revision:2",
  ]);
  assert.equal(produced.builderInput.evidence.expected.sellerId, SELLER_ID);
  assert.equal(produced.builderInput.evidence.credentialRotatedAt, ROTATED_AT);
  assert.equal(produced.builderInput.evidence.oauthEvidence.appKey, "137451");
  assert.equal(produced.builderInput.evidence.targetEvidence.verifiedAt, OBSERVED_AT);
  assert.equal(produced.builderInput.operatorEvidence.revision, REVISION);
  assert.equal(Object.isFrozen(produced.builderInput.evidence.credential), true);

  const providerCalls: LazadaMyCreateProviderRead[] = [];
  const built = await buildLazadaMyCreateReadinessInput({
    ...produced.builderInput,
    signal: new AbortController().signal,
    now: new Date("2026-09-10T03:02:00.000Z"),
    dependencies: {
      assertRevisionCurrent: async (revision) => {
        assert.equal(revision, REVISION);
      },
      readProvider: async (request) => {
        providerCalls.push(request);
        return providerResponse(request);
      },
      loadAuthoritativeRate: async () => ({
        krwPerMyr: 250,
        fetchedAt: OBSERVED_AT,
        asOf: OBSERVED_AT,
        source: "fixture reference",
        sourceUrl: "https://example.test/rates",
        frequency: "minute-market",
      }),
    },
  });
  assert.equal(built.ok, true);
  assert.equal(providerCalls.some((call) =>
    call.path === "/products/get" && call.params.limit === "50"), true);
  assert.equal(providerCalls.every((call) =>
    call.credential === produced.builderInput.evidence.credential), true);
});

test("Lazada MY producer returns a no-provider blocker for every missing server snapshot", async () => {
  for (const missing of [
    "product", "credential", "oauth", "target", "app", "approval",
  ] as const) {
    let providerCalls = 0;
    const deps = dependencies({ missing });
    const produced = await produceLazadaMyCreateEvidence({
      key: key(),
      dependencies: deps.result,
    });
    if (produced.ok) providerCalls += 1;
    assert.equal(produced.ok, false);
    assert.equal(providerCalls, 0);
    if (!produced.ok) {
      assert.equal(produced.blocker.stage,
        missing === "app" ? "commerce_app" : missing);
      assert.equal(produced.blocker.sellerpilotNoProviderRequestConfirmed, true);
      assert.equal(produced.blocker.sellerpilotNoCreateConfirmed, true);
    }
  }
});

test("Lazada MY producer rejects browser markers before every RPC loader", async () => {
  let providerCalls = 0;
  const deps = dependencies();
  const produced = await produceLazadaMyCreateEvidence({
    key: { ...key(), source: "browser-app-online" as never },
    dependencies: deps.result,
  });
  if (produced.ok) providerCalls += 1;
  assert.equal(produced.ok, false);
  assert.deepEqual(deps.calls, []);
  assert.equal(providerCalls, 0);
  if (!produced.ok) {
    assert.equal(produced.blocker.stage, "selection");
    assert.equal(produced.blocker.code, "LAZADA_MY_CREATE_SERVER_SELECTION_INVALID");
  }
});

test("Lazada MY producer rejects arbitrary app Online or incomplete scopes before provider reads", async () => {
  for (const mutate of [
    (values: ReturnType<typeof snapshots>) => {
      values.app = { ...values.app, source: "browser" as never };
    },
    (values: ReturnType<typeof snapshots>) => {
      values.app = { ...values.app, scopes: values.app.scopes.filter(
        (scope) => scope !== "Seller Information",
      ) };
    },
  ]) {
    let providerCalls = 0;
    const deps = dependencies({ mutate });
    const produced = await produceLazadaMyCreateEvidence({
      key: key(), dependencies: deps.result,
    });
    if (produced.ok) providerCalls += 1;
    assert.equal(produced.ok, false);
    assert.equal(providerCalls, 0);
    if (!produced.ok) assert.equal(produced.blocker.stage, "commerce_app");
  }
});

test("Lazada MY producer rejects stale or cross-product approvals before provider reads", async () => {
  for (const mutate of [
    (values: ReturnType<typeof snapshots>) => {
      values.approval = {
        ...values.approval,
        englishContentApproval: {
          ...(values.approval.englishContentApproval as Record<string, unknown>),
          approvedAt: ROTATED_AT,
        },
      };
    },
    (values: ReturnType<typeof snapshots>) => {
      values.approval = { ...values.approval,
        productId: "81111111-1111-4111-8111-111111111111" };
    },
  ]) {
    let providerCalls = 0;
    const deps = dependencies({ mutate });
    const produced = await produceLazadaMyCreateEvidence({
      key: key(), dependencies: deps.result,
    });
    if (produced.ok) providerCalls += 1;
    assert.equal(produced.ok, false);
    assert.equal(providerCalls, 0);
    if (!produced.ok) assert.equal(produced.blocker.stage, "approval");
  }
});

test("Lazada MY producer never substitutes a historical item for the current create context", async () => {
  let providerCalls = 0;
  const deps = dependencies({
    mutate: (values) => {
      values.product = {
        ...values.product,
        argumentsValue: {
          ...values.product.argumentsValue,
          remoteId: "987654321",
        },
      };
    },
  });
  const produced = await produceLazadaMyCreateEvidence({
    key: key(), dependencies: deps.result,
  });
  if (produced.ok) providerCalls += 1;
  assert.equal(produced.ok, false);
  assert.equal(providerCalls, 0);
  if (!produced.ok) {
    assert.equal(produced.blocker.stage, "product");
    assert.equal(produced.blocker.code, "LAZADA_MY_CREATE_HISTORICAL_ITEM_FORBIDDEN");
  }
});

test("Lazada MY producer fences the revision before and after all RPC snapshots", async () => {
  for (const staleRevisionAt of [1, 2]) {
    let providerCalls = 0;
    const deps = dependencies({ staleRevisionAt });
    const produced = await produceLazadaMyCreateEvidence({
      key: key(), dependencies: deps.result,
    });
    if (produced.ok) providerCalls += 1;
    assert.equal(produced.ok, false);
    assert.equal(providerCalls, 0);
    if (!produced.ok) {
      assert.equal(produced.blocker.stage, "revision");
      assert.equal(produced.blocker.code,
        "LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE");
    }
  }
});
