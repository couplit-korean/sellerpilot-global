import assert from "node:assert/strict";
import test from "node:test";
import { ebayShipmentBody, ebayShipmentReadback } from "../lib/channels/ebay-shipment";
const expected = {
  lineItems: [{ lineItemId: "LOCAL-LINE-1", quantity: 1 }],
  shippingCarrierCode: "USPS", trackingNumber: "LOCAL-NOT-A-REAL-TRACKING",
  shippedDate: "2026-09-06T03:04:05.000Z",
};
for (const shippedDate of ["2026-02-29T03:04:05Z", "2026-02-30T03:04:05Z", "2026-04-31T03:04:05Z", "2026-09-06T24:00:00Z"]) {
  test(`eBay impossible shipment date ${shippedDate} fails both draft and readback`, () => {
    const remote = { fulfillments: [{ fulfillmentId: "LOCAL-FULFILLMENT", ...expected, shippedDate }] };
    assert.equal(ebayShipmentReadback(remote, expected).verified, false);
    assert.throws(() => ebayShipmentBody({ ...expected, shippedDate }), /SHIPMENT_FIELD_INVALID:ebay.shippedDate/);
  });
}
test("eBay valid UTC precision and leap dates remain supported without requiring retry timestamp equality", () => {
  for (const shippedDate of ["2024-02-29T23:59:59Z", "2026-09-06T03:04:05.123456Z", expected.shippedDate]) {
    assert.equal(ebayShipmentBody({ ...expected, shippedDate }).shippedDate, shippedDate);
    assert.equal(ebayShipmentReadback({ fulfillments: [{ fulfillmentId: "LOCAL-FULFILLMENT", ...expected, shippedDate }] }, expected).verified, true);
  }
});
