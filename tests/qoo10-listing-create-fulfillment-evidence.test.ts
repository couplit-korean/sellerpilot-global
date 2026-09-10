import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildQoo10ListingCreateFulfillmentEvidence,
  Qoo10CreateFulfillmentEvidenceError,
  qoo10ListingCreateFulfillmentEvidence,
  qoo10ListingCreateFulfillmentEvidenceFromOfficialGets,
  type Qoo10CreateFulfillmentResource,
  type Qoo10OfficialGetEvidence,
} from "../lib/channels/qoo10-listing-create-fulfillment-evidence";

const SELLER_ID = "seller-create-qa";
const TEST_ITEM_CODE = "1098765432";
const TEST_ITEM_SELLER_CODE = "ACCOUNT-BOUND-QA";
const SELLER_ID_DIGEST = createHash("sha256")
  .update(JSON.stringify({ sellerId: SELLER_ID }), "utf8").digest("hex");
const ACCOUNT_DIGEST = createHash("sha256").update(JSON.stringify({
  sellerIdDigest: SELLER_ID_DIGEST,
  testItemCode: TEST_ITEM_CODE,
  testItemSellerCode: TEST_ITEM_SELLER_CODE,
}), "utf8").digest("hex");
const DISPATCH_ID = "dispatch-jp-1";
const RETURN_ID = "return-jp-1";
const NOW = new Date("2026-09-10T03:00:00.000Z");

function response(
  resource: Qoo10CreateFulfillmentResource,
  records: Qoo10OfficialGetEvidence["records"],
  overrides: Partial<Qoo10OfficialGetEvidence> = {},
): Qoo10OfficialGetEvidence {
  return {
    contract: "sellerpilot_qoo10_official_get_evidence_v1",
    method: "GET",
    resource,
    sourceOrigin: resource === "seller_account_identity"
      ? "https://api.qoo10.jp" : "https://qsm.qoo10.jp",
    authenticated: true,
    authenticatedSellerId: SELLER_ID,
    sellerAccountIdentityDigest: ACCOUNT_DIGEST,
    observedAt: "2026-09-10T02:59:50.000Z",
    revision: `${resource}-revision-19`,
    status: 200,
    resultCode: 0,
    records,
    ...overrides,
  };
}

function responses() {
  return {
    seller_account_identity: response("seller_account_identity", [{
      id: TEST_ITEM_CODE,
      active: true,
      sellerCode: TEST_ITEM_SELLER_CODE,
      payload: {
        ItemNo: TEST_ITEM_CODE,
        SellerCode: TEST_ITEM_SELLER_CODE,
        ItemStatus: "S2",
      },
    }]),
    dispatch_places: response("dispatch_places", [{
      id: DISPATCH_ID,
      active: true,
      payload: {
        address: {
          countryCode: "JP",
          postalCode: "100-0001",
          prefecture: "Tokyo",
          city: "Chiyoda",
          line1: "1-1",
          line2: "Warehouse A",
        },
        contact: { name: "QA Fulfillment", phone: "03-0000-0000" },
        shippingNos: ["0", "700001"],
      },
    }]),
    return_policies: response("return_policies", [{
      id: RETURN_ID,
      active: true,
      payload: {
        address: {
          countryCode: "JP",
          postalCode: "100-0002",
          prefecture: "Tokyo",
          city: "Chiyoda",
          line1: "2-2",
          line2: "Returns",
        },
        fees: { currency: "JPY", return: 500, exchange: 1_000 },
        windowDays: 7,
        conditions: ["unused", "original_package"],
      },
    }]),
  };
}

function buildFromResponses(value = responses(), now = NOW) {
  return qoo10ListingCreateFulfillmentEvidenceFromOfficialGets({
    sellerId: SELLER_ID,
    testItemCode: TEST_ITEM_CODE,
    dispatchPlaceId: DISPATCH_ID,
    returnPolicyId: RETURN_ID,
    responses: value,
    now,
  });
}

test("builds one fresh same-seller fulfillment revision using only three injected official GETs", async () => {
  const source = responses();
  const requests: Array<{ method: string; resource: string; selectedId?: string }> = [];
  const providerMutationCount = 0;
  const evidence = await buildQoo10ListingCreateFulfillmentEvidence({
    sellerId: SELLER_ID,
    testItemCode: TEST_ITEM_CODE,
    dispatchPlaceId: DISPATCH_ID,
    returnPolicyId: RETURN_ID,
    now: NOW,
    get: async (request) => {
      requests.push(request);
      assert.equal(request.method, "GET");
      assert.equal(request.sellerId, SELLER_ID);
      assert.equal(
        request.sellerAccountIdentityDigest,
        request.resource === "seller_account_identity" ? undefined : ACCOUNT_DIGEST,
      );
      assert.equal(request.testItemCode, TEST_ITEM_CODE);
      return source[request.resource];
    },
  });
  assert.deepEqual(requests.map(({ method, resource, selectedId }) => ({
    method,
    resource,
    selectedId,
  })), [
    { method: "GET", resource: "seller_account_identity", selectedId: undefined },
    { method: "GET", resource: "dispatch_places", selectedId: DISPATCH_ID },
    { method: "GET", resource: "return_policies", selectedId: RETURN_ID },
  ]);
  assert.equal(providerMutationCount, 0);
  assert.equal(evidence.sellerAccountIdentityDigest, ACCOUNT_DIGEST);
  assert.equal(evidence.dispatchPlaceId, DISPATCH_ID);
  assert.equal(evidence.returnPolicyId, RETURN_ID);
  assert.match(evidence.dispatchPlaceDigest, /^[a-f0-9]{64}$/u);
  assert.match(evidence.returnPolicyDigest, /^[a-f0-9]{64}$/u);
  assert.match(evidence.evidenceRevision, /^[a-f0-9]{64}$/u);
  assert.ok(qoo10ListingCreateFulfillmentEvidence(evidence, NOW));
});

test("canonical digests cover every selected dispatch-place and return-policy value", () => {
  const original = buildFromResponses();
  const reordered = responses();
  const dispatchPayload = reordered.dispatch_places.records[0].payload as Record<string, unknown>;
  reordered.dispatch_places.records[0].payload = {
    shippingNos: dispatchPayload.shippingNos,
    contact: dispatchPayload.contact,
    address: dispatchPayload.address,
  };
  const reorderedEvidence = buildFromResponses(reordered);
  assert.equal(reorderedEvidence.dispatchPlaceDigest, original.dispatchPlaceDigest);

  const changedDispatch = responses();
  const address = (changedDispatch.dispatch_places.records[0].payload as {
    address: Record<string, unknown>;
  }).address;
  address.line2 = "Warehouse B";
  assert.notEqual(
    buildFromResponses(changedDispatch).dispatchPlaceDigest,
    original.dispatchPlaceDigest,
  );

  const changedReturn = responses();
  const fees = (changedReturn.return_policies.records[0].payload as {
    fees: Record<string, unknown>;
  }).fees;
  fees.return = 600;
  assert.notEqual(
    buildFromResponses(changedReturn).returnPolicyDigest,
    original.returnPolicyDigest,
  );
});

for (const [name, mutate, code] of [
  ["unauthenticated", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.authenticated = false;
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"],
  ["different seller", (value: ReturnType<typeof responses>) => {
    value.return_policies.authenticatedSellerId = "other-seller";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"],
  ["different account digest", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.sellerAccountIdentityDigest = "b".repeat(64);
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"],
  ["non-GET transport", (value: ReturnType<typeof responses>) => {
    value.return_policies.method = "POST" as "GET";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"],
  ["non-official origin", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.sourceOrigin = "https://qoo10.example";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_UNAUTHENTICATED"],
  ["missing dispatch place", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.records[0].id = "other-dispatch";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["inactive return policy", (value: ReturnType<typeof responses>) => {
    value.return_policies.records[0].active = false;
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["missing account seller code", (value: ReturnType<typeof responses>) => {
    delete value.seller_account_identity.records[0].sellerCode;
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["empty dispatch payload", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.records[0].payload = {};
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["unsealed record field", (value: ReturnType<typeof responses>) => {
    (value.return_policies.records[0] as Record<string, unknown>).unsealedFee = 700;
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["duplicate selected return policy", (value: ReturnType<typeof responses>) => {
    value.return_policies.records.push(structuredClone(value.return_policies.records[0]));
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_AMBIGUOUS"],
  ["missing revision", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.revision = "";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_INCOMPLETE"],
  ["stale response", (value: ReturnType<typeof responses>) => {
    value.dispatch_places.observedAt = "2026-09-10T02:54:00.000Z";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE"],
  ["future response", (value: ReturnType<typeof responses>) => {
    value.return_policies.observedAt = "2026-09-10T03:00:06.000Z";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE"],
  ["split snapshot", (value: ReturnType<typeof responses>) => {
    value.return_policies.observedAt = "2026-09-10T02:59:10.000Z";
  }, "QOO10_CREATE_FULFILLMENT_RESPONSE_STALE"],
] as const) {
  test(`fails closed on ${name} official evidence`, () => {
    const value = responses();
    mutate(value);
    assert.throws(
      () => buildFromResponses(value),
      (error) => error instanceof Qoo10CreateFulfillmentEvidenceError
        && error.code === code,
    );
  });
}

test("fails closed when the injected official GET dependency throws", async () => {
  await assert.rejects(
    buildQoo10ListingCreateFulfillmentEvidence({
      sellerId: SELLER_ID,
      testItemCode: TEST_ITEM_CODE,
      dispatchPlaceId: DISPATCH_ID,
      returnPolicyId: RETURN_ID,
      now: NOW,
      get: async () => {
        throw new Error("network unavailable");
      },
    }),
    (error) => error instanceof Qoo10CreateFulfillmentEvidenceError
      && error.code === "QOO10_CREATE_FULFILLMENT_OFFICIAL_GET_FAILED",
  );
});

test("rejects expired or tampered sealed evidence at the approval consumer", () => {
  const evidence = buildFromResponses();
  assert.equal(
    qoo10ListingCreateFulfillmentEvidence(
      evidence,
      new Date("2026-09-10T03:04:50.000Z"),
    )?.evidenceDigest,
    evidence.evidenceDigest,
  );
  assert.equal(
    qoo10ListingCreateFulfillmentEvidence(
      evidence,
      new Date("2026-09-10T03:04:51.000Z"),
    ),
    null,
  );
  const tampered = structuredClone(evidence);
  tampered.returnPolicyId = "return-jp-2";
  assert.equal(qoo10ListingCreateFulfillmentEvidence(tampered, NOW), null);
});
