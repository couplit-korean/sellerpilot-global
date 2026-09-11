import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EBAY_ACCOUNT_BOOTSTRAP_ABORTED,
  EBAY_ACCOUNT_BOOTSTRAP_FAILED,
  EBAY_ACCOUNT_BOOTSTRAP_FAILURE_MESSAGES,
  EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE,
  EBAY_ACCOUNT_BOOTSTRAP_PATH,
  EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED,
  EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED,
  bootstrapEbayAccount,
  buildEbayAccountBootstrapRequest,
  ebayAccountBootstrapFailureMessage,
  ebayAccountBootstrapResolvedFields,
  emptyEbayAccountBootstrapFormValues,
  type EbayAccountBootstrapFormValues,
  type EbayAccountBootstrapRequest,
} from "../lib/channels/ebay-account-bootstrap-client";

// Every test below runs against a stubbed fetch. Nothing here touches the network.
const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const target = { productId, environment: "production" as const, market: "US" };

type RecordedCall = { url: string; init: RequestInit };

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function operatorForm(overrides: Partial<EbayAccountBootstrapFormValues> = {}) {
  return { ...emptyEbayAccountBootstrapFormValues(), ...overrides };
}

function operatorFormValues() {
  return operatorForm({
    fulfillmentName: "운영자 배송 정책",
    fulfillmentHandlingTime: "1",
    fulfillmentHandlingTimeUnit: "DAY",
    shippingOptionType: "DOMESTIC",
    shippingCostType: "FLAT_RATE",
    shippingCarrierCode: "CARRIER-OPERATOR",
    shippingServiceCode: "SERVICE-OPERATOR",
    shippingFreeShipping: "false",
    shippingCostValue: "12.50",
    shippingCostCurrency: "usd",
    paymentName: "운영자 결제 정책",
    paymentMethodType: "CREDIT_CARD",
    returnName: "운영자 반품 정책",
    returnsAccepted: "true",
    returnPeriodValue: "30",
    returnPeriodUnit: "DAY",
    returnShippingCostPayer: "BUYER",
    refundMethod: "MONEY_BACK",
    returnMethod: "REPLACEMENT",
    merchantLocationKey: "warehouse-operator",
    locationName: "운영자 창고",
    locationAddressLine1: "1 Warehouse Road",
    locationAddressLine2: "Unit 2",
    locationCity: "Los Angeles",
    locationStateOrProvince: "CA",
    locationPostalCode: "90001",
    locationCountry: "us",
    locationPhone: "213-555-0100",
  });
}

function expectedRequest(): EbayAccountBootstrapRequest {
  return {
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    policies: {
      fulfillment: {
        name: "운영자 배송 정책",
        handlingTime: { value: 1, unit: "DAY" },
        shippingOptions: [{
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [{
            shippingCarrierCode: "CARRIER-OPERATOR",
            shippingServiceCode: "SERVICE-OPERATOR",
            freeShipping: false,
            shippingCost: { value: "12.50", currency: "USD" },
          }],
        }],
      },
      payment: {
        name: "운영자 결제 정책",
        paymentMethods: [{ paymentMethodType: "CREDIT_CARD" }],
      },
      return: {
        name: "운영자 반품 정책",
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
        returnMethod: "REPLACEMENT",
      },
    },
    location: {
      merchantLocationKey: "warehouse-operator",
      name: "운영자 창고",
      address: {
        addressLine1: "1 Warehouse Road",
        addressLine2: "Unit 2",
        city: "Los Angeles",
        stateOrProvince: "CA",
        postalCode: "90001",
        country: "US",
      },
      phone: "213-555-0100",
    },
  };
}

function storedHandoff() {
  return {
    productId,
    channel: "ebay",
    environment: "production",
    market: "US",
    marketplaceId: "EBAY_US",
    fulfillmentPolicyId: "fulfillment-operator",
    paymentPolicyId: "payment-operator",
    returnPolicyId: "return-operator",
    merchantLocationKey: "warehouse-operator",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

test("the operator form carries every business value and never prefills one", () => {
  const empty = emptyEbayAccountBootstrapFormValues();
  assert.deepEqual(
    Object.values(empty),
    new Array(Object.keys(empty).length).fill(""),
    "an untouched form must not seed policy names, terms or the address",
  );

  const built = buildEbayAccountBootstrapRequest(operatorFormValues(), target);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.request, expectedRequest());
});

test("the operator form blocks an incomplete request before any fetch", () => {
  const built = buildEbayAccountBootstrapRequest(emptyEbayAccountBootstrapFormValues(), target);
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, EBAY_ACCOUNT_BOOTSTRAP_INPUT_INCOMPLETE);
  assert.match(built.message, /배송 정책 이름/u);
});

test("a paid shipping service requires the operator amount and currency", () => {
  const missingAmount = buildEbayAccountBootstrapRequest(
    operatorForm({ ...operatorFormValues(), shippingCostValue: "12.5.5" }),
    target,
  );
  assert.equal(missingAmount.ok, false);
  if (!missingAmount.ok) assert.match(missingAmount.message, /배송비 금액/u);

  const freeShipping = buildEbayAccountBootstrapRequest(
    operatorForm({ ...operatorFormValues(), shippingFreeShipping: "true" }),
    target,
  );
  assert.equal(freeShipping.ok, true);
  if (!freeShipping.ok) return;
  assert.deepEqual(freeShipping.request.policies.fulfillment.shippingOptions[0]?.shippingServices, [{
    shippingCarrierCode: "CARRIER-OPERATOR",
    shippingServiceCode: "SERVICE-OPERATOR",
    freeShipping: true,
  }]);

  const unselected = buildEbayAccountBootstrapRequest(
    operatorForm({ ...operatorFormValues(), shippingFreeShipping: "" }),
    target,
  );
  assert.equal(unselected.ok, false);
  if (!unselected.ok) assert.match(unselected.message, /무료 배송 여부/u);
});

test("the client helper posts the operator terms to the bootstrap route", async () => {
  const stub = stubFetch(async () => jsonResponse({
    handoff: storedHandoff(),
    bootstrap: {
      policyCreated: { fulfillment: true, payment: false, return: false },
      locationCreated: true,
      providerWrites: 2,
      discardedStoredPolicyIds: false,
      marketplaceId: "EBAY_US",
    },
    message: "eBay 판매 정책과 위치를 확정해 저장했습니다.",
  }));
  try {
    const request = expectedRequest();
    const result = await bootstrapEbayAccount(request, "operator-token");

    assert.equal(stub.calls.length, 1);
    const [call] = stub.calls;
    assert.equal(call?.url, EBAY_ACCOUNT_BOOTSTRAP_PATH);
    assert.equal(call?.url, "/api/admin/ebay-account-bootstrap");
    assert.equal(call?.init.method, "POST");
    assert.equal(call?.init.cache, "no-store");
    assert.deepEqual(call?.init.headers, {
      "content-type": "application/json",
      authorization: "Bearer operator-token",
    });
    assert.deepEqual(JSON.parse(String(call?.init.body)), request);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.handoff, storedHandoff());
    assert.equal(result.bootstrap.providerWrites, 2);
    assert.deepEqual(result.bootstrap.policyCreated, {
      fulfillment: true,
      payment: false,
      return: false,
    });
  } finally {
    stub.restore();
  }
});

test("the client helper surfaces the route error code with its Korean message", async () => {
  const stub = stubFetch(async () => jsonResponse({
    code: "EBAY_BUSINESS_POLICY_TERMS_INVALID:fulfillment.shippingServiceCode",
    message: "eBay가 정책 또는 위치 생성을 거부했습니다. 입력값을 확인해 주세요.",
  }, 400));
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "EBAY_BUSINESS_POLICY_TERMS_INVALID:fulfillment.shippingServiceCode");
    assert.match(result.message, /판매 정책 조건/u);
    assert.match(result.message, /상세: fulfillment\.shippingServiceCode/u);
  } finally {
    stub.restore();
  }
});

test("the client helper keeps the code when the route answers without a message", async () => {
  const stub = stubFetch(async () => jsonResponse({ code: "EBAY_ACCESS_TOKEN_MISSING" }, 409));
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "EBAY_ACCESS_TOKEN_MISSING");
    assert.match(result.message, /액세스 토큰/u);
  } finally {
    stub.restore();
  }
});

test("the client helper rejects a malformed or mismatched handoff payload", async () => {
  const malformed = stubFetch(async () => jsonResponse({
    handoff: { ...storedHandoff(), merchantLocationKey: "" },
  }));
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, EBAY_ACCOUNT_BOOTSTRAP_RESPONSE_MALFORMED);
  } finally {
    malformed.restore();
  }

  const mismatched = stubFetch(async () => jsonResponse({
    handoff: { ...storedHandoff(), productId: "0f0d1a9e-1111-4222-8333-444455556666" },
  }));
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "EBAY_LISTING_HANDOFF_MISMATCH");
  } finally {
    mismatched.restore();
  }
});

test("the client helper reports a transport failure and an abort by code", async () => {
  const failing = stubFetch(async () => { throw new TypeError("fetch failed"); });
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, EBAY_ACCOUNT_BOOTSTRAP_REQUEST_FAILED);
  } finally {
    failing.restore();
  }

  const aborted = stubFetch(async () => { throw new DOMException("aborted", "AbortError"); });
  try {
    const result = await bootstrapEbayAccount(expectedRequest(), "operator-token");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, EBAY_ACCOUNT_BOOTSTRAP_ABORTED);
  } finally {
    aborted.restore();
  }
});

test("every bootstrap route failure code has a Korean operator message", () => {
  const routeCodes = [
    "EBAY_ACCOUNT_BOOTSTRAP_INPUT_INVALID",
    "EBAY_CREDENTIAL_UNAVAILABLE",
    "EBAY_ACCESS_TOKEN_MISSING",
    "EBAY_MARKETPLACE_MISMATCH",
    "EBAY_MARKETPLACE_ID_INVALID",
    "EBAY_BUSINESS_POLICY_TERMS_INVALID",
    "EBAY_BUSINESS_POLICY_GET_UNVERIFIED",
    "EBAY_BUSINESS_POLICY_SELECTION_REQUIRED",
    "EBAY_BUSINESS_POLICY_EXPECTED_MISSING",
    "EBAY_BUSINESS_POLICY_CREATE_FAILED",
    "EBAY_BUSINESS_POLICY_CREATE_UNVERIFIED",
    "EBAY_INVENTORY_LOCATION_INPUT_INVALID",
    "EBAY_INVENTORY_LOCATION_GET_UNVERIFIED",
    "EBAY_INVENTORY_LOCATION_DISABLED",
    "EBAY_INVENTORY_LOCATION_CREATE_FAILED",
    "EBAY_LISTING_HANDOFF_MALFORMED",
    "EBAY_LISTING_HANDOFF_UNAVAILABLE",
    "EBAY_LISTING_HANDOFF_SAVE_FAILED",
    "EBAY_LISTING_HANDOFF_PRODUCT_UNAVAILABLE",
    "EBAY_LISTING_HANDOFF_MISMATCH",
    EBAY_ACCOUNT_BOOTSTRAP_FAILED,
  ];
  for (const code of routeCodes) {
    const message = ebayAccountBootstrapFailureMessage(code);
    assert.match(message, /[가-힣]/u, `${code} needs a Korean message`);
    // Detail suffixes must resolve to the same base message.
    assert.equal(
      ebayAccountBootstrapFailureMessage(`${code}:DETAIL`).startsWith(message),
      true,
      `${code}:DETAIL should keep the base message`,
    );
    if (code !== EBAY_ACCOUNT_BOOTSTRAP_FAILED) {
      assert.notEqual(
        ebayAccountBootstrapFailureMessage(code),
        EBAY_ACCOUNT_BOOTSTRAP_FAILURE_MESSAGES[EBAY_ACCOUNT_BOOTSTRAP_FAILED],
        `${code} should have its own message`,
      );
    }
  }
});

test("the resolved ids are shown and saved through the existing handoff path", async () => {
  const fields = ebayAccountBootstrapResolvedFields(storedHandoff());
  assert.deepEqual(fields.map((field) => field.value), [
    "EBAY_US",
    "fulfillment-operator",
    "payment-operator",
    "return-operator",
    "warehouse-operator",
  ]);

  const workbench = await readFile(
    new URL("../app/product-publish-workbench.tsx", import.meta.url),
    "utf8",
  );
  assert.match(workbench, /bootstrapEbayAccount\(built\.request, accessToken\)/u);
  assert.match(workbench, /saveStoredListingHandoff\(\{\s*productId,\s*channel: "ebay",/u);
  assert.match(workbench, /ebayAccountBootstrapResolvedFields\(ebayBootstrapResolved\)/u);
  assert.match(workbench, /void saveEbayListingHandoff\(\)/u);
});
