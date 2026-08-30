import assert from "node:assert/strict";
import test from "node:test";
import { prepareListingUpdateArguments } from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";

test("Qoo10 UpdateGoods preserves the exact AdultYN carrier field before provider access", async () => {
  const remoteId = "1217336970";
  const prepared = prepareListingUpdateArguments("qoo10", {
    params: {
      SecondSubCat: "320000542",
      ItemTitle: "貼り付け式ケーブル整理クリップ6個セット",
      ProductionPlaceType: "2",
      ProductionPlace: "CN",
      RetailPrice: "1871",
      ShippingNo: "806971",
      AvailableDateType: "0",
      AvailableDateValue: "3",
      AdultYN: "N",
    },
  }, {
    status: "published",
    remoteId,
    publishedAt: "2026-08-30T00:00:00.000Z",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
  });

  assert.equal((prepared.params as Record<string, unknown>).AdultYN, "N");

  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return Response.json({
      ResultCode: -99,
      ResultMsg: "TEST_PROVIDER_STOP_AFTER_REQUEST_CAPTURE",
    });
  };

  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "test-key" },
      arguments: prepared,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]?.ItemCode, remoteId);
    assert.equal(bodies[0]?.AdultYN, "N");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
