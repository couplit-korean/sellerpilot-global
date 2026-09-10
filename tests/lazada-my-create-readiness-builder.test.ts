import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLazadaMyCreateReadinessInput,
  lazadaMyCreateReadinessBlockerContract,
  type LazadaMyCreateApprovedOperatorEvidence,
  type LazadaMyCreateProviderRead,
  type LazadaMyCreateReadinessBuilderDependencies,
  type LazadaMyCreateServerEvidence,
} from "../lib/product-registration/lazada/my-create-readiness-builder";
import {
  lazadaMyDeliveryPolicyContract,
  lazadaMyEnglishContentApprovalContract,
  lazadaMyEnglishContentSha256,
  lazadaMyReturnPolicyContract,
} from "../lib/product-registration/lazada/my-create-readiness";
import { runLazadaMyCreatePrewrite } from
  "../lib/product-registration/lazada/my-create-prewrite";
import { lazadaMyCreateCurrentStateContract } from
  "../lib/product-registration/lazada/my-create-raw-readback";
import { withLazadaProviderAccountIdentity } from
  "../lib/channels/provider-account-identity";
import type { RemoteResponse } from "../lib/channels/protocols";

const REVISION = "listing-revision-012";
const OBSERVED_AT = "2026-09-10T01:01:00.000Z";
const ROTATED_AT = "2026-09-10T01:00:00.000Z";
const CREDENTIAL_ID = "61111111-1111-4111-8111-111111111111";
const SELLER_ID = "300872000183";
const SHORT_CODE = "MY4NNISR2D";
const CATEGORY_ID = "10100205";
const SELLER_SKU = "SP-MY-BUILDER-001";
const IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/builder-${index + 1}.jpg`,
);

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

function argumentsValue() {
  return {
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "c".repeat(64),
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
    request: {
      Request: {
        Product: {
          PrimaryCategory: CATEGORY_ID,
          Images: { Image: [...IMAGES] },
          Attributes: {
            name: "SellerPilot Current Storage Organizer",
            description: "Current English content approved for this MY listing.",
            short_description: "Current approved content",
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

function serverEvidence(): LazadaMyCreateServerEvidence {
  const args = argumentsValue();
  const state = `sellerpilot-lazada-my-${"d".repeat(32)}`;
  return {
    revision: REVISION,
    observedAt: OBSERVED_AT,
    source: "sellerpilot-server-create-context",
    expected: {
      appKey: "137451",
      appName: "Couplit Commerce",
      redirectUri: "https://sellerpilot.example/",
      credentialId: CREDENTIAL_ID,
      sellerId: SELLER_ID,
      shortCode: SHORT_CODE,
    },
    commerceApp: {
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
      evidenceSource: "lazada-open-platform-console",
      verifiedAt: OBSERVED_AT,
    },
    authorization: {
      clientId: "137451",
      redirectUri: "https://sellerpilot.example/",
      responseType: "code",
      country: "my",
      state,
    },
    callback: {
      clientId: "137451",
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
    credential: withLazadaProviderAccountIdentity({
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
    }).payload,
    credentialRotatedAt: ROTATED_AT,
    oauthEvidence: {
      revision: REVISION,
      source: "sellerpilot-server-oauth-lineage",
      credentialId: CREDENTIAL_ID,
      appKey: "137451",
      country: "my",
      completedAt: ROTATED_AT,
    },
    targetEvidence: {
      revision: REVISION,
      source: "sellerpilot-server-target",
      credentialId: CREDENTIAL_ID,
      sellerId: SELLER_ID,
      market: "MY",
      verifiedAt: OBSERVED_AT,
    },
    target: {
      credentialId: CREDENTIAL_ID,
      targetId: SELLER_ID,
      shortCode: SHORT_CODE,
      marketCode: "MY",
      locale: "ms-MY",
      language: "Bahasa Melayu",
      currency: "MYR",
      verifiedAt: OBSERVED_AT,
    },
    argumentsValue: args,
  };
}

function operatorEvidence(
  args: ReturnType<typeof argumentsValue>,
): LazadaMyCreateApprovedOperatorEvidence {
  return {
    revision: REVISION,
    source: "sellerpilot-approved-operator-evidence",
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
}

function providerResponse(request: LazadaMyCreateProviderRead) {
  switch (request.path) {
    case "/seller/get":
      return remote({
        code: "0",
        data: {
          seller_id: SELLER_ID,
          short_code: SHORT_CODE,
          status: "ACTIVE",
          marketplaceEaseMode: false,
        },
      });
    case "/products/get":
      return remote({ code: "0", data: { total_products: 0, products: [] } });
    case "/category/tree/get":
      return remote({
        code: "0",
        data: [{ category_id: CATEGORY_ID, leaf: true }],
      });
    case "/category/attributes/get":
      return remote({
        code: "0",
        data: [
          { name: "name", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
          { name: "description", input_type: "richText", is_mandatory: 1, attribute_type: "normal" },
          { name: "brand", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
          { name: "delivery_option_sof", input_type: "singleselect", is_mandatory: 1, attribute_type: "normal", options: [{ en_name: "Yes" }, { en_name: "No" }] },
          { name: "price", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
          { name: "quantity", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
        ],
      });
    case "/category/brands/query":
      return remote({
        code: "0",
        data: { module: [{ brand_id: "30768", name: "Fixture Brand" }] },
      });
    case "/shipment/providers/get":
      return remote({
        code: "0",
        data: {
          shipment_providers: [{
            name: "LGS-FM43",
            enabled_delivery_options: ["standard"],
          }],
        },
      });
  }
}

function dependencies(input: {
  reads: LazadaMyCreateProviderRead[];
  revisionChecks: string[];
  override?: (request: LazadaMyCreateProviderRead) => RemoteResponse | undefined;
  failRevisionAt?: number;
}): LazadaMyCreateReadinessBuilderDependencies {
  return {
    assertRevisionCurrent: async (revision) => {
      input.revisionChecks.push(revision);
      if (input.failRevisionAt === input.revisionChecks.length) {
        throw new Error("LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE");
      }
    },
    readProvider: async (request) => {
      input.reads.push(request);
      return input.override?.(request) ?? providerResponse(request);
    },
    loadAuthoritativeRate: async () => ({
      krwPerMyr: 250,
      fetchedAt: OBSERVED_AT,
      asOf: OBSERVED_AT,
      source: "fixture reference",
      sourceUrl: "https://example.test/rates",
      frequency: "minute-market",
    }),
  };
}

async function build(input: {
  evidence?: LazadaMyCreateServerEvidence;
  operator?: LazadaMyCreateApprovedOperatorEvidence;
  override?: (request: LazadaMyCreateProviderRead) => RemoteResponse | undefined;
  failRevisionAt?: number;
} = {}) {
  const evidence = input.evidence ?? serverEvidence();
  const reads: LazadaMyCreateProviderRead[] = [];
  const revisionChecks: string[] = [];
  const result = await buildLazadaMyCreateReadinessInput({
    evidence,
    operatorEvidence: input.operator ?? operatorEvidence(
      evidence.argumentsValue as ReturnType<typeof argumentsValue>,
    ),
    signal: new AbortController().signal,
    now: new Date("2026-09-10T01:02:00.000Z"),
    dependencies: dependencies({
      reads,
      revisionChecks,
      override: input.override,
      failRevisionAt: input.failRevisionAt,
    }),
  });
  return { result, reads, revisionChecks };
}

test("Lazada MY builder gathers one revision with the exact official GET plan", async () => {
  const { result, reads, revisionChecks } = await build();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(reads.map(({ path, params }) => ({ path, params })), [
    { path: "/seller/get", params: {} },
    {
      path: "/products/get",
      params: {
        filter: "all",
        sku_seller_list: JSON.stringify([SELLER_SKU]),
        options: "1",
        limit: "50",
        offset: "0",
      },
    },
    { path: "/category/tree/get", params: { language_code: "en_US" } },
    {
      path: "/category/attributes/get",
      params: {
        primary_category_id: CATEGORY_ID,
        language_code: "en_US",
      },
    },
    {
      path: "/category/brands/query",
      params: { startRow: "0", pageSize: "200" },
    },
    { path: "/shipment/providers/get", params: {} },
  ]);
  assert.ok(reads.every((request) =>
    request.method === "GET" && request.revision === REVISION));
  assert.deepEqual(revisionChecks, [REVISION, REVISION, REVISION]);
  assert.equal(result.readiness.sellerId, SELLER_ID);
  assert.equal(result.readiness.productImageCount, 8);
});

test("Lazada MY builder output connects to 011 as the only CreateProduct callback", async () => {
  const { result } = await build();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const events: string[] = [];
  const snapshot = {
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
  } as const;
  await runLazadaMyCreatePrewrite({
    readinessInput: result.readinessInput,
    request: {
      path: "/product/create",
      method: "POST",
      argumentsValue: result.readinessInput.argumentsValue,
    },
    claimedCurrentSource: snapshot,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("begin"); },
      readCurrentSource: async () => snapshot,
    },
    createProduct: async ({ path }) => { events.push(`create:${path}`); },
  });
  assert.deepEqual(events, ["lease", "begin", "create:/product/create"]);
});

test("Lazada MY builder paginates the official brand catalog until the exact brand ID", async () => {
  const { result, reads } = await build({
    override: (request) => {
      if (request.path !== "/category/brands/query") return undefined;
      if (request.params.startRow === "0") {
        return remote({
          code: "0",
          data: {
            module: Array.from({ length: 200 }, (_, index) => ({
              brand_id: String(index + 1),
              name: `Brand ${index + 1}`,
            })),
          },
        });
      }
      return remote({
        code: "0",
        data: { module: [{ brand_id: "30768", name: "Fixture Brand" }] },
      });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    reads.filter((request) => request.path === "/category/brands/query")
      .map((request) => request.params),
    [
      { startRow: "0", pageSize: "200" },
      { startRow: "200", pageSize: "200" },
    ],
  );
});

test("Lazada MY builder returns structured blockers for missing or browser-only evidence", async () => {
  const evidence = serverEvidence();
  const operator = operatorEvidence(
    evidence.argumentsValue as ReturnType<typeof argumentsValue>,
  );
  operator.returnPolicy = null;
  const missing = await build({ evidence, operator });
  assert.deepEqual(missing.reads, []);
  assert.deepEqual(missing.result, {
    ok: false,
    blocker: {
      contract: lazadaMyCreateReadinessBlockerContract,
      revision: REVISION,
      stage: "server_context",
      code: "LAZADA_MY_CREATE_OPERATOR_EVIDENCE_REQUIRED",
      sellerpilotNoCreateConfirmed: true,
    },
  });

  const browserBoolean = serverEvidence();
  (browserBoolean.commerceApp as unknown as Record<string, unknown>).status = true;
  const browser = await build({ evidence: browserBoolean });
  assert.equal(browser.result.ok, false);
  if (!browser.result.ok) {
    assert.equal(browser.result.blocker.stage, "readiness");
    assert.equal(browser.result.blocker.code, "LAZADA_MY_COMMERCE_APP_SCOPE_INVALID");
    assert.equal(browser.result.blocker.sellerpilotNoCreateConfirmed, true);
  }
});

test("Lazada MY builder never converts provider failure or an existing historical SKU into create permission", async () => {
  for (const candidate of ["brand-failure", "existing-sku"] as const) {
    let createCalls = 0;
    const output = await build({
      override: (request) => {
        if (candidate === "brand-failure"
            && request.path === "/category/brands/query") {
          return remote({ code: "IllegalAccessToken", error: "denied" }, 401);
        }
        if (candidate === "existing-sku" && request.path === "/products/get") {
          return remote({
            code: "0",
            data: { total_products: 1, products: [{ item_id: "historical-item" }] },
          });
        }
        return undefined;
      },
    });
    if (output.result.ok) {
      const snapshot = {
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
      } as const;
      await runLazadaMyCreatePrewrite({
        readinessInput: output.result.readinessInput,
        request: {
          path: "/product/create",
          method: "POST",
          argumentsValue: output.result.readinessInput.argumentsValue,
        },
        claimedCurrentSource: snapshot,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => undefined,
          readCurrentSource: async () => snapshot,
        },
        createProduct: async () => { createCalls += 1; },
      });
    }
    assert.equal(createCalls, 0);
    assert.equal(output.result.ok, false);
    if (!output.result.ok) {
      assert.equal(output.result.blocker.sellerpilotNoCreateConfirmed, true);
      assert.equal(output.result.blocker.stage,
        candidate === "brand-failure" ? "provider_read" : "readiness");
    }
  }
});

test("Lazada MY builder checks the server revision before, after, and after validation", async () => {
  for (const failRevisionAt of [1, 2, 3]) {
    let createCalls = 0;
    const output = await build({ failRevisionAt });
    if (output.result.ok) createCalls += 1;
    assert.equal(createCalls, 0);
    assert.equal(output.result.ok, false);
    if (!output.result.ok) {
      assert.equal(output.result.blocker.stage, "revision");
      assert.equal(output.result.blocker.code,
        "LAZADA_MY_CREATE_EVIDENCE_REVISION_STALE");
    }
  }
});
