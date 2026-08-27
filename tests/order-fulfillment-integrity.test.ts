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
    inProgress: 0,
    reconciliationRequired: 1,
    failed: 1,
  });
});

test("fulfillment route preserves a stable resource-bound gateway write and defers 202 without false failure", async () => {
  const [route, page, orderSync, failureMigration, resourceMigration] = await Promise.all([
    readFile(new URL("../app/api/admin/orders/fulfill/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/order-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825071000_harden_order_shipment_ledger_integrity.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825104900_resource_bound_gateway_writes.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /idempotencyRoot = `shipment-\$\{shipment\.id\}-\$\{createHash\("sha256"\)/);
  assert.match(route, /orderId: input\.shipment\.id/);
  assert.match(route, /remoteResponse\.status === 202 \|\| remotePayload\.inProgress === true/);
  assert.match(route, /providerMutation\s*\?\s*\{[\s\S]*kind: "reconciliation_required"[\s\S]*:\s*\{[\s\S]*kind: "in_progress"/);
  const localPreparation = route.slice(
    route.indexOf("const shipmentDraft: ShipmentDraft"),
    route.indexOf("const idempotencyRoot"),
  );
  assert.match(localPreparation, /failedShipmentResult/);
  assert.doesNotMatch(localPreparation, /deferredShipmentResult/);
  assert.ok(route.indexOf("buildShipmentArguments(shipmentDraft)") < route.indexOf("if (order.status === \"paid\" && acknowledgeArguments)"));
  assert.ok(route.indexOf("operation: \"shipment.acknowledge\"", route.indexOf("if (order.status === \"paid\""))
    < route.indexOf("operation: \"shipment.confirm\"", route.indexOf("if (order.status === \"paid\"")));
  assert.ok(route.indexOf("operation: \"orders.get\"", route.indexOf("if (readbackArguments)"))
    < route.indexOf("operation: \"shipment.confirm\"", route.indexOf("if (readbackArguments)")));
  assert.match(route, /SHOPEE_SHIPPING_MODE_SELECTION_REQUIRED/);
  assert.match(route, /shippingParameter: preflightOutcome\.payload/);
  assert.match(route, /preflight-\$\{randomUUID\(\)\.slice\(0, 8\)\}/);
  assert.match(route, /const shipmentConcurrency = 3/);
  assert.match(route, /\.min\(1\)\.max\(3\)/);
  assert.match(route, /const shipmentOperationTimeoutMs = 70_000/);
  assert.match(route, /AbortSignal\.timeout\(shipmentOperationTimeoutMs\)/);
  assert.doesNotMatch(route, /AbortSignal\.timeout\(120_000\)/);
  assert.match(route, /Promise\.all\(parsed\.data\.shipments\.slice\(offset, offset \+ shipmentConcurrency\)\.map\(processShipmentSafely\)\)/);
  assert.match(page, /const fulfillmentRequestBatchSize = 3/);
  assert.match(page, /shipments\.slice\(offset, offset \+ fulfillmentRequestBatchSize\)/);
  assert.match(route, /출고 처리 중 예상하지 못한 응답/);
  assert.match(route, /new Set\(ids\)\.size !== ids\.length/);
  assert.doesNotMatch(route, /sellerpilot_record_order_shipment/);
  assert.match(route, /sellerpilot_service_record_order_shipment_failure/);
  assert.match(orderSync, /const externalOrderId = text\(row\.shipmentBoxId\)/);
  assert.doesNotMatch(orderSync, /text\(row\.orderId, row\.shipmentBoxId\)/);
  assert.match(orderSync, /const externalOrderId = text\(row\.productOrderId\)/);
  assert.doesNotMatch(orderSync, /text\(row\.orderId, row\.productOrderId\)/);
  assert.match(orderSync, /providerContext:\s*\{\s*shipmentBoxId: externalOrderId,/);
  assert.match(orderSync, /providerContext:\s*\{\s*productOrderId: externalOrderId,/);
  assert.match(orderSync, /if \(remote === "3"\) return "ready_to_ship";/);
  assert.match(orderSync, /if \(remote === "4"\) return "shipped";/);
  assert.match(orderSync, /if \(remote === "5"\) return "delivered";/);
  assert.match(orderSync, /PURCHASE_DECIDED\|DELIVERED/);
  assert.match(orderSync, /DISPATCHED\|DELIVERING/);
  assert.match(orderSync, /PRODUCT_PREPARE/);
  assert.match(failureMigration, /grant execute on function public\.sellerpilot_service_record_order_shipment_failure\(uuid, uuid, text, text\)[\s\S]*to service_role/);
  assert.match(failureMigration, /from public, anon, authenticated/);
  assert.match(resourceMigration, /sellerpilot_service_enqueue_resource_gateway_job/);
  assert.match(resourceMigration, /new\.operation = 'shipment\.confirm'/);
  assert.doesNotMatch(resourceMigration, /when v_provider_ok then 'shipped'/);
});

test("TracX delivery webhook bounds Supabase calls and classifies RPC auth separately from transient failures", async () => {
  const route = await readFile(new URL("../app/api/webhooks/tracx/delivery/route.ts", import.meta.url), "utf8");
  assert.match(route, /global: \{ fetch: createBoundedSupabaseFetch\(5_000\) \}/);
  assert.match(route, /workerRpcErrorStatus\(code \? \{ code \} : null\)/);
  assert.match(route, /try \{[\s\S]*sellerpilot_get_active_credential_secret[\s\S]*\} catch \(error\) \{/);
  assert.match(route, /try \{[\s\S]*sellerpilot_service_ingest_tracx_delivery[\s\S]*\} catch \(error\) \{/);
  assert.match(route, /console\.error\(`TracX delivery \$\{context\} RPC failed`, \{ code: code \?\? "unknown", status \}\)/);
  assert.doesNotMatch(route, /console\.error\([^\n]*(webhook_secret|secret_payload|receivedToken|expectedToken)/);
  assert.match(route, /verifyTracxWebhookSignature/);
  assert.match(route, /TRACX_ALLOW_LEGACY_QUERY_TOKEN === "true"/);
  assert.match(route, /reconciliationRequired: true/);
});
