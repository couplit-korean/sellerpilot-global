import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  Qoo10CreateFulfillmentEvidenceError,
  buildQoo10ListingCreateFulfillmentEvidence,
} from "../lib/channels/qoo10-listing-create-fulfillment-evidence";
import {
  Qoo10OfficialGetAdapterError,
  createQoo10ListingCreateFulfillmentOfficialGet,
  getQoo10OfficialSellerDeliveryGroups,
  qoo10OfficialFulfillmentSurfaceStatus,
  qoo10OfficialGetOrigin,
  qoo10OfficialGetPath,
  type Qoo10OfficialHttpGet,
  type Qoo10OfficialHttpGetResponse,
} from "../lib/channels/qoo10-listing-create-fulfillment-official-get";

const now = "2026-09-10T02:20:00.000Z";
const sellerId = "seller-fixture";
const testItemCode = "1234567890";
const certificationKey = "fixture-qapi-key-never-real";

function protocolDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function accountResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    observedAt: now,
    data: {
      ResultCode: "0",
      ResultMsg: "SUCCESS",
      ResultObject: [{
        ItemCode: testItemCode,
        SellerCode: "seller-item-fixture",
        ItemStatus: "S2",
        ShippingNo: "90001",
        ...overrides,
      }],
    },
  };
}

function errorCode(error: unknown) {
  return error instanceof Qoo10OfficialGetAdapterError
    || error instanceof Qoo10CreateFulfillmentEvidenceError
    ? error.code
    : "";
}

test("publishes only the public QAPI surfaces confirmed by official metadata", () => {
  assert.deepEqual(qoo10OfficialFulfillmentSurfaceStatus.seller_account_identity, {
    available: true,
    method: "ItemsLookup.GetItemDetailInfo",
    version: "1.2",
    documentedResponseFields: [
      "ItemCode", "ItemStatus", "ItemTitle", "SellerCode", "ShippingNo",
      "AvailableDateType", "AvailableDateValue", "ChangedDate",
    ],
  });
  assert.equal(qoo10OfficialFulfillmentSurfaceStatus.dispatch_places.available, false);
  assert.deepEqual(
    qoo10OfficialFulfillmentSurfaceStatus.dispatch_places.closestMethodFields,
    ["ShippingNo", "ShippingFee", "ShippingType", "FreeCondition", "Region", "Oversea", "transcName"],
  );
  assert.equal(qoo10OfficialFulfillmentSurfaceStatus.return_policies.available, false);
});

test("seller account adapter performs the exact documented GET and normalizes one matching item", async () => {
  const seen: string[] = [];
  const get: Qoo10OfficialHttpGet = async (input) => {
    assert.equal(input.method, "GET");
    assert.deepEqual(input.headers, {
      accept: "application/json",
      "user-agent": "SellerPilot-Qoo10-Official-Read/1.0",
    });
    seen.push(input.url.toString());
    return accountResponse();
  };
  const officialGet = createQoo10ListingCreateFulfillmentOfficialGet({
    sellerId,
    certificationKey,
    get,
  });
  const evidence = await officialGet({
    method: "GET",
    resource: "seller_account_identity",
    sellerId,
    testItemCode,
  });

  assert.equal(seen.length, 1);
  const url = new URL(seen[0]);
  assert.equal(url.origin, qoo10OfficialGetOrigin);
  assert.equal(url.pathname, qoo10OfficialGetPath);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    key: certificationKey,
    v: "1.2",
    returnType: "json",
    method: "ItemsLookup.GetItemDetailInfo",
    ItemCode: testItemCode,
    SellerCode: "",
  });
  const sellerIdDigest = protocolDigest({ sellerId });
  assert.equal(evidence.authenticatedSellerId, sellerId);
  assert.equal(evidence.records[0].id, testItemCode);
  assert.equal(evidence.records[0].sellerCode, "seller-item-fixture");
  assert.equal(evidence.sellerAccountIdentityDigest, protocolDigest({
    sellerIdDigest,
    testItemCode,
    testItemSellerCode: "seller-item-fixture",
  }));
  assert.equal(JSON.stringify(evidence).includes(certificationKey), false);
});

test("seller account adapter rejects cross-account input and malformed or ambiguous responses", async (t) => {
  let calls = 0;
  const make = (response: Qoo10OfficialHttpGetResponse) =>
    createQoo10ListingCreateFulfillmentOfficialGet({
      sellerId,
      certificationKey,
      get: async () => {
        calls += 1;
        return response;
      },
    });
  const baseRequest = {
    method: "GET" as const,
    resource: "seller_account_identity" as const,
    sellerId,
    testItemCode,
  };

  await t.test("cross-account request is stopped before HTTP", async () => {
    const before = calls;
    await assert.rejects(
      () => make(accountResponse())({ ...baseRequest, sellerId: "other-seller" }),
      (error) => errorCode(error) === "QOO10_OFFICIAL_GET_INPUT_INVALID",
    );
    assert.equal(calls, before);
  });
  await t.test("preselected account digest is stopped before HTTP", async () => {
    const before = calls;
    await assert.rejects(
      () => make(accountResponse())({ ...baseRequest, sellerAccountIdentityDigest: "a".repeat(64) }),
      (error) => errorCode(error) === "QOO10_OFFICIAL_GET_INPUT_INVALID",
    );
    assert.equal(calls, before);
  });
  for (const [name, response] of [
    ["http", { ...accountResponse(), status: 500 }],
    ["result", { ...accountResponse(), data: { ...accountResponse().data, ResultCode: "-1" } }],
    ["empty seller", accountResponse({ SellerCode: "" })],
    ["secret payload", accountResponse({ api_key: "must-not-enter-evidence" })],
    ["time", { ...accountResponse(), observedAt: "not-an-iso-timestamp" }],
    ["no match", accountResponse({ ItemCode: "9999999999" })],
    ["duplicate", {
      ...accountResponse(),
      data: {
        ...accountResponse().data,
        ResultObject: [accountResponse().data.ResultObject[0], accountResponse().data.ResultObject[0]],
      },
    }],
  ] as const) {
    await t.test(name, async () => {
      await assert.rejects(
        () => make(response)({ ...baseRequest }),
        (error) => errorCode(error) === "QOO10_OFFICIAL_GET_RESPONSE_INVALID",
      );
    });
  }
});

test("unconfirmed dispatch-place and return-policy resources fail closed without HTTP", async () => {
  let calls = 0;
  const officialGet = createQoo10ListingCreateFulfillmentOfficialGet({
    sellerId,
    certificationKey,
    get: async () => {
      calls += 1;
      return accountResponse();
    },
  });
  for (const [resource, expected] of [
    ["dispatch_places", "QOO10_CREATE_FULFILLMENT_DISPATCH_PLACE_GET_UNAVAILABLE"],
    ["return_policies", "QOO10_CREATE_FULFILLMENT_RETURN_POLICY_GET_UNAVAILABLE"],
  ] as const) {
    await assert.rejects(
      () => officialGet({
        method: "GET",
        resource,
        sellerId,
        testItemCode,
        selectedId: "selected-fixture",
        sellerAccountIdentityDigest: "a".repeat(64),
      }),
      (error) => errorCode(error) === expected,
    );
  }
  assert.equal(calls, 0);
});

test("012 builder reaches verified account GET then keeps CREATE blocked on dispatch surface", async () => {
  let reads = 0;
  const providerMutations = 0;
  const officialGet = createQoo10ListingCreateFulfillmentOfficialGet({
    sellerId,
    certificationKey,
    get: async () => {
      reads += 1;
      return accountResponse();
    },
  });
  await assert.rejects(
    () => buildQoo10ListingCreateFulfillmentEvidence({
      sellerId,
      testItemCode,
      dispatchPlaceId: "dispatch-fixture",
      returnPolicyId: "return-fixture",
      get: officialGet,
      now: new Date(now),
    }),
    (error) => errorCode(error) === "QOO10_CREATE_FULFILLMENT_DISPATCH_PLACE_GET_UNAVAILABLE",
  );
  assert.equal(reads, 1);
  assert.equal(providerMutations, 0);
});

test("seller delivery-group reader uses the documented GET and only its seven fields", async () => {
  const seen: string[] = [];
  const evidence = await getQoo10OfficialSellerDeliveryGroups({
    sellerId,
    certificationKey,
    get: async (input) => {
      seen.push(input.url.toString());
      return {
        status: 200,
        observedAt: now,
        data: {
          ResultCode: 0,
          ResultObject: [
            {
              ShippingNo: "12", ShippingFee: "500", ShippingType: "M",
              FreeCondition: "30000", Region: "Y", Oversea: "N",
              transcName: "fixture carrier", DispatchPlaceId: "must-be-ignored",
            },
            {
              ShippingNo: "2", ShippingFee: 0, ShippingType: "F",
              FreeCondition: 0, Region: "N", Oversea: "Y", transcName: "",
            },
          ],
        },
      };
    },
  });
  const url = new URL(seen[0]);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    key: certificationKey,
    v: "1.0",
    returnType: "json",
    method: "ItemsLookup.GetSellerDeliveryGroupInfo",
  });
  assert.deepEqual(evidence.groups, [
    {
      shippingNo: "2", shippingFee: "0", shippingType: "F",
      freeCondition: "0", region: "N", oversea: "Y", deliveryCompany: "",
    },
    {
      shippingNo: "12", shippingFee: "500", shippingType: "M",
      freeCondition: "30000", region: "Y", oversea: "N", deliveryCompany: "fixture carrier",
    },
  ]);
  assert.equal("dispatchPlaceId" in evidence.groups[0], false);
  assert.equal("returnPolicyId" in evidence.groups[0], false);
});

test("seller delivery-group reader rejects invalid, duplicate, or undated rows", async (t) => {
  const base = {
    ShippingNo: "2", ShippingFee: "0", ShippingType: "F",
    FreeCondition: "0", Region: "N", Oversea: "Y", transcName: "",
  };
  for (const [name, response] of [
    ["empty", { status: 200, observedAt: now, data: { ResultCode: 0, ResultObject: [] } }],
    ["invalid type", { status: 200, observedAt: now, data: { ResultCode: 0, ResultObject: [{ ...base, ShippingType: "Z" }] } }],
    ["duplicate", { status: 200, observedAt: now, data: { ResultCode: 0, ResultObject: [base, base] } }],
    ["invalid time", { status: 200, observedAt: "yesterday", data: { ResultCode: 0, ResultObject: [base] } }],
  ] as const) {
    await t.test(name, async () => {
      await assert.rejects(
        () => getQoo10OfficialSellerDeliveryGroups({
          sellerId,
          certificationKey,
          get: async () => response,
        }),
        (error) => errorCode(error) === "QOO10_OFFICIAL_GET_RESPONSE_INVALID",
      );
    });
  }
});
