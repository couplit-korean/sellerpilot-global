import assert from "node:assert/strict";
import test from "node:test";
import {
  Qoo10QsmCreateFulfillmentSourceError,
  buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm,
  createQoo10ListingCreateFulfillmentQsmGet,
  qoo10QsmCreateFulfillmentCaptureContract,
  qoo10QsmCreateFulfillmentCollector,
  qoo10QsmCreateFulfillmentOrigin,
  qoo10QsmCreateFulfillmentTrustBoundary,
  sealQoo10QsmCreateFulfillmentCapture,
  type Qoo10QsmCreateFulfillmentCapture,
  type Qoo10QsmCreateFulfillmentCaptureDraft,
} from "../lib/channels/qoo10-listing-create-fulfillment-qsm-source";

const now = "2026-09-10T03:00:00.000Z";
const sellerId = "seller-fixture";
const testItemCode = "1234567890";
const dispatchPlaceId = "dispatch-jp-1";
const returnPolicyId = "returns-jp-1";

function draft(
  overrides: Partial<Qoo10QsmCreateFulfillmentCaptureDraft> = {},
): Qoo10QsmCreateFulfillmentCaptureDraft {
  return {
    contract: qoo10QsmCreateFulfillmentCaptureContract,
    collector: qoo10QsmCreateFulfillmentCollector,
    trustBoundary: qoo10QsmCreateFulfillmentTrustBoundary,
    browser: {
      name: "Chrome",
      family: "chrome",
      type: "extension",
      profileName: "CHANGHEE",
    },
    sourceOrigin: qoo10QsmCreateFulfillmentOrigin,
    authenticatedSellerId: sellerId,
    testItemCode,
    testItemSellerCode: "seller-item-fixture",
    observedAt: now,
    dispatchPlaces: [{
      id: dispatchPlaceId,
      active: true,
      payload: {
        label: "Tokyo dispatch fixture",
        countryCode: "JP",
        postalCode: "1000001",
        addressLine1: "fixture address",
      },
    }],
    returnPolicies: [{
      id: returnPolicyId,
      active: true,
      payload: {
        label: "Japan returns fixture",
        returnWindowDays: 7,
        returnShippingPaidBy: "buyer",
      },
    }],
    ...overrides,
  };
}

function code(error: unknown) {
  return error instanceof Qoo10QsmCreateFulfillmentSourceError ? error.code : "";
}

test("one server-injected CHANGHEE capture satisfies all three Q012 reads", async () => {
  const capture = sealQoo10QsmCreateFulfillmentCapture(draft());
  const requests: unknown[] = [];
  const evidence = await buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm({
    sellerId,
    testItemCode,
    dispatchPlaceId,
    returnPolicyId,
    now: new Date(now),
    readCapture: async (request) => {
      requests.push(request);
      return capture;
    },
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    method: "BROWSER_READ",
    readOnly: true,
    browser: {
      name: "Chrome",
      family: "chrome",
      type: "extension",
      profileName: "CHANGHEE",
    },
    sourceOrigin: "https://qsm.qoo10.jp",
    sellerId,
    testItemCode,
    dispatchPlaceId,
    returnPolicyId,
  });
  assert.equal(evidence.testItemCode, testItemCode);
  assert.equal(evidence.dispatchPlaceId, dispatchPlaceId);
  assert.equal(evidence.returnPolicyId, returnPolicyId);
  assert.equal(evidence.sourceObservedAt.seller_account_identity, now);
  assert.equal(evidence.sourceObservedAt.dispatch_places, now);
  assert.equal(evidence.sourceObservedAt.return_policies, now);
  assert.match(evidence.sourceRevisions.dispatch_places, /^sha256:[a-f0-9]{64}:dispatch_places$/u);
});

test("QSM adapter requires the account read before fulfillment reads", async () => {
  let reads = 0;
  const get = createQoo10ListingCreateFulfillmentQsmGet({
    sellerId,
    testItemCode,
    dispatchPlaceId,
    returnPolicyId,
    now: new Date(now),
    readCapture: async () => {
      reads += 1;
      return sealQoo10QsmCreateFulfillmentCapture(draft());
    },
  });
  await assert.rejects(
    () => get({
      method: "GET",
      resource: "dispatch_places",
      sellerId,
      testItemCode,
      selectedId: dispatchPlaceId,
      sellerAccountIdentityDigest: "a".repeat(64),
    }),
    (error) => code(error) === "QOO10_QSM_CREATE_FULFILLMENT_REQUEST_ORDER_INVALID",
  );
  assert.equal(reads, 1);
});

test("capture sealer rejects secret-shaped fields before evidence exists", () => {
  assert.throws(() => sealQoo10QsmCreateFulfillmentCapture(draft({
    dispatchPlaces: [{ id: dispatchPlaceId, active: true, payload: {
      apiKey: "must-never-be-imported",
    } }],
  })), (error) => code(error) === "QOO10_QSM_CREATE_FULFILLMENT_SECRET_FORBIDDEN");
  for (const payload of [
    {
      label: "Tokyo dispatch fixture", countryCode: "JP", postalCode: "1000001",
      addressLine1: "fixture address", sessionId: "must-never-be-imported",
    },
    {
      label: "Tokyo dispatch fixture", countryCode: "JP", postalCode: "1000001",
      addressLine1: "fixture address", unexpected: true,
    },
  ]) {
    assert.throws(
      () => sealQoo10QsmCreateFulfillmentCapture(draft({
        dispatchPlaces: [{ id: dispatchPlaceId, active: true, payload }],
      })),
      (error) => code(error) === "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_INVALID",
    );
  }
});

test("dispatch and return record order is canonical by ID", () => {
  const dispatch = draft().dispatchPlaces[0]!;
  const returned = draft().returnPolicies[0]!;
  const first = sealQoo10QsmCreateFulfillmentCapture(draft({
    dispatchPlaces: [
      { ...dispatch, id: "dispatch-jp-2" },
      dispatch,
    ],
    returnPolicies: [
      { ...returned, id: "returns-jp-2" },
      returned,
    ],
  }));
  const second = sealQoo10QsmCreateFulfillmentCapture(draft({
    dispatchPlaces: [...first.dispatchPlaces].reverse(),
    returnPolicies: [...first.returnPolicies].reverse(),
  }));
  assert.equal(first.sourceRevision, second.sourceRevision);
  assert.equal(first.captureDigest, second.captureDigest);
  assert.deepEqual(first.dispatchPlaces.map(({ id }) => id), [dispatchPlaceId, "dispatch-jp-2"]);
  assert.deepEqual(first.returnPolicies.map(({ id }) => id), [returnPolicyId, "returns-jp-2"]);
});

test("route-side source validation rejects wrong account, profile, selected IDs, freshness, and tampering", async (t) => {
  async function expectCaptureError(
    capture: unknown,
    expectedCode: Qoo10QsmCreateFulfillmentSourceError["code"],
  ) {
    await assert.rejects(
      () => buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm({
        sellerId,
        testItemCode,
        dispatchPlaceId,
        returnPolicyId,
        now: new Date(now),
        readCapture: async () => capture,
      }),
      (error) => code(error) === expectedCode,
    );
  }

  await t.test("account", () => expectCaptureError(
    sealQoo10QsmCreateFulfillmentCapture(draft({ authenticatedSellerId: "other-seller" })),
    "QOO10_QSM_CREATE_FULFILLMENT_ACCOUNT_MISMATCH",
  ));
  await t.test("profile", async () => {
    const capture = sealQoo10QsmCreateFulfillmentCapture(draft()) as unknown as Record<string, unknown>;
    capture.browser = { name: "Chrome", family: "chrome", type: "extension", profileName: "JEONGHUN" };
    await expectCaptureError(capture, "QOO10_QSM_CREATE_FULFILLMENT_PROFILE_INVALID");
  });
  await t.test("selected dispatch", () => expectCaptureError(
    sealQoo10QsmCreateFulfillmentCapture(draft({
      dispatchPlaces: [{
        id: "different", active: true,
        payload: { label: "different", countryCode: "JP", postalCode: "1", addressLine1: "x" },
      }],
    })),
    "QOO10_QSM_CREATE_FULFILLMENT_SELECTION_INVALID",
  ));
  await t.test("inactive return", () => expectCaptureError(
    sealQoo10QsmCreateFulfillmentCapture(draft({
      returnPolicies: [{
        id: returnPolicyId, active: false,
        payload: { label: "inactive", returnWindowDays: 7, returnShippingPaidBy: "buyer" },
      }],
    })),
    "QOO10_QSM_CREATE_FULFILLMENT_SELECTION_INVALID",
  ));
  await t.test("stale", () => expectCaptureError(
    sealQoo10QsmCreateFulfillmentCapture(draft({ observedAt: "2026-09-10T02:54:59.999Z" })),
    "QOO10_QSM_CREATE_FULFILLMENT_FRESHNESS_INVALID",
  ));
  await t.test("payload tamper", async () => {
    const capture = structuredClone(
      sealQoo10QsmCreateFulfillmentCapture(draft()),
    ) as Qoo10QsmCreateFulfillmentCapture;
    capture.dispatchPlaces[0].payload.label = "tampered";
    await expectCaptureError(capture, "QOO10_QSM_CREATE_FULFILLMENT_TAMPERED");
  });
  await t.test("extra envelope field", async () => {
    const capture = sealQoo10QsmCreateFulfillmentCapture(draft()) as unknown as Record<string, unknown>;
    capture.untrusted = true;
    await expectCaptureError(capture, "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_INVALID");
  });
});

test("source failure remains pre-provider and no browser payload is accepted directly", async () => {
  let reads = 0;
  const providerMutations = 0;
  await assert.rejects(
    () => buildQoo10ListingCreateFulfillmentEvidenceFromServerQsm({
      sellerId,
      testItemCode,
      dispatchPlaceId,
      returnPolicyId,
      now: new Date(now),
      readCapture: async () => {
        reads += 1;
        throw new Error("QSM unavailable");
      },
    }),
    (error) => code(error) === "QOO10_QSM_CREATE_FULFILLMENT_SOURCE_FAILED",
  );
  assert.equal(reads, 1);
  assert.equal(providerMutations, 0);
});
