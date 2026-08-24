import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  remoteShipmentSuccessResult,
  shipmentLedgerWriteSucceeded,
  shipmentResultSummary,
  type ShipmentFulfillmentResult,
} from "../lib/order-shipment-integrity";

const orderId = "6e25193b-c71d-4a5f-89d1-f27707bdfef3";

test("remote shipment success is only complete when the order ledger RPC returns true without an error", () => {
  assert.equal(shipmentLedgerWriteSucceeded(true, null), true);
  assert.equal(shipmentLedgerWriteSucceeded(false, null), false);
  assert.equal(shipmentLedgerWriteSucceeded(null, null), false);
  assert.equal(shipmentLedgerWriteSucceeded(true, { message: "ledger unavailable" }), false);

  const complete = remoteShipmentSuccessResult({
    id: orderId,
    channel: "lazada",
    ledgerData: true,
    ledgerError: null,
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.status, "succeeded");
  assert.equal(complete.remoteSucceeded, true);
  assert.equal(complete.ledgerRecorded, true);
  assert.equal(complete.reconciliationRequired, false);

  const partial = remoteShipmentSuccessResult({
    id: orderId,
    channel: "lazada",
    ledgerData: null,
    ledgerError: { message: "ledger unavailable" },
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.status, "reconciliation_required");
  assert.equal(partial.remoteSucceeded, true);
  assert.equal(partial.ledgerRecorded, false);
  assert.equal(partial.reconciliationRequired, true);
  assert.match(partial.message, /다시 보내지 말고 원장 조정/);
});

test("reconciliation-required shipments are never counted as full success or remote failure", () => {
  const succeeded = remoteShipmentSuccessResult({ id: orderId, channel: "qoo10", ledgerData: true, ledgerError: null });
  const partial = remoteShipmentSuccessResult({ id: `${orderId.slice(0, -1)}4`, channel: "lazada", ledgerData: false, ledgerError: null });
  const failed: ShipmentFulfillmentResult = {
    id: `${orderId.slice(0, -1)}5`,
    channel: "temu",
    ok: false,
    status: "failed",
    remoteSucceeded: false,
    ledgerRecorded: true,
    reconciliationRequired: false,
    message: "remote failure",
  };

  assert.deepEqual(shipmentResultSummary([succeeded, partial, failed]), {
    succeeded: 1,
    reconciliationRequired: 1,
    failed: 1,
  });
});

test("fulfillment route preserves the stable remote idempotency key and uses the failure-only service RPC", async () => {
  const [route, migration] = await Promise.all([
    readFile(new URL("../app/api/admin/orders/fulfill/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825071000_harden_order_shipment_ledger_integrity.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /idempotencyKey = `shipment-\$\{shipment\.id\}-\$\{createHash\("sha256"\)/);
  assert.match(route, /const ledgerWrite = await admin\.userClient\.rpc\("sellerpilot_record_order_shipment"/);
  assert.match(route, /ledgerData = ledgerWrite\.data;[\s\S]*ledgerError = ledgerWrite\.error/);
  assert.match(route, /sellerpilot_service_record_order_shipment_failure/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_record_order_shipment_failure\(uuid, uuid, text, text\)[\s\S]*to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /tracking_number\s*=/);
  assert.doesNotMatch(migration, /status\s*=\s*'shipped'/);
});
