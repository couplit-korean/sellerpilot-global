import assert from "node:assert/strict";
import test from "node:test";
import { parseTracxDeliveryPayload } from "../lib/logistics/tracx-webhook";

test("TracX accepts its empty delivery payload only as a non-persisted URL probe", () => {
  const parsed = parseTracxDeliveryPayload({
    PackingNo: "",
    TrackingNo: "",
    DeliveryCompanyCode: "",
    DeliveryCompanyName: "",
    StatusCode: "",
    StatusDesc: "",
    RefOrderNo: "",
    Date: "2026-08-22 15:29:15",
  });
  assert.equal(parsed?.kind, "probe");
});

test("TracX requires an identity and status for real delivery events", () => {
  assert.equal(parseTracxDeliveryPayload({ TrackingNo: "TRACK-1", StatusCode: "" }), null);
  assert.equal(parseTracxDeliveryPayload({ TrackingNo: "", StatusCode: "D4" }), null);
  const parsed = parseTracxDeliveryPayload({ TrackingNo: "TRACK-1", StatusCode: "D4" });
  assert.equal(parsed?.kind, "event");
  assert.equal(parsed?.event.TrackingNo, "TRACK-1");
});
