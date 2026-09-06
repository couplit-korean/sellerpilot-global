import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildShipmentArguments } from "../lib/channels/shipment-draft";
import type { ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});
const { normalizeChannelOrders } = await import("../lib/channels/order-sync");
const timestamp = "2026-09-05T03:04:05.000Z";
const item = (id: unknown, orderId = "ORDER-1") => ({ order_item_id: id, order_id: orderId, shipping_type: "dropshipping", name: "Local fixture" });
function source(items: unknown, row: Record<string, unknown> = {}): ChannelOperationResult {
  return {
    ok: true, channel: "lazada", operation: "orders.list", safeMessage: "local fixture",
    steps: [
      { name: "orders", ok: true, status: 200, data: { data: { orders: [{ order_id: "ORDER-1", statuses: ["pending"], price: "20", currency: "MYR", ...row }] } } },
      { name: "order-items:ORDER-1", ok: true, status: 200, data: { data: items } },
    ],
  };
}
function draft(context: Record<string, unknown> | undefined, orderId = "ORDER-1") {
  return buildShipmentArguments({ channel: "lazada", externalOrderId: orderId, carrierCode: "FM49", trackingNumber: "", providerContext: context });
}
const invalidSources: [string, ChannelOperationResult][] = [
  ["missing response", source(undefined)],
  ["non-array response", source({ order_item_id: "ITEM-1" })],
  ["empty response", source([])],
  ["missing identity", source([item("ITEM-1"), {}])],
  ["invalid row type", source([item("ITEM-1"), null])],
  ["primitive row", source([item("ITEM-1"), "ITEM-2"])],
  ["duplicate identity", source([item("ITEM-1"), item(" ITEM-1 ")])],
  ["numeric duplicate", source([item(9101), item("9101")])],
  ["truncated count", source([item("ITEM-1")], { items_count: 2 })],
  ["wrong order", source([item("ITEM-1", "OTHER-ORDER")])],
  ["wrong order metadata", source([{ ...item("ITEM-1", "ORDER-2"), name: "otherproduct" }], { items_count: 5, item_name: "header product" })],
  ["different delivery modes", source([item("ITEM-1"), { ...item("ITEM-2"), shipping_type: "warehouse" }])],
  ["over adapter limit", source(Array.from({ length: 101 }, (_, i) => item(`ITEM-${i}`)))],
  ["over storage limit", source([item("X".repeat(33000))])],
];
for (const value of [null, undefined, "", " ", {}, [], false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  invalidSources.push([`invalid identity ${String(value)}`, source([item("ITEM-1"), item(value)])]);
}
const boundaryIds = Array.from({ length: 100 }, (_, index) => `ITEM-${index}`);
const boundarySize = Buffer.byteLength(JSON.stringify({ orderId: "ORDER-1", orderItemIds: boundaryIds, deliveryType: "dropship" }), "utf8");
boundaryIds[0] += "X".repeat(32760 - boundarySize);
invalidSources.push(["JSONB separator storage expansion", source(boundaryIds.map((id) => item(id)))]);
const sparseItems = new Array(2);
sparseItems[0] = item("ITEM-1");
invalidSources.push(["sparse response", source(sparseItems)]);
const failedDetail = source([item("ITEM-1")]);
failedDetail.steps[1].ok = false;
invalidSources.push(["failed detail", failedDetail]);
const duplicateDetail = source([item("ITEM-1")]);
duplicateDetail.steps.push({ ...duplicateDetail.steps[1] });
invalidSources.push(["ambiguous detail responses", duplicateDetail]);

for (const [name, result] of invalidSources) {
  test(`Lazada ${name} keeps the order visible but fails shipment closed`, () => {
    const [order] = normalizeChannelOrders("lazada", result, timestamp);
    assert.equal(order.externalOrderId, "ORDER-1");
    assert.equal(order.status, "paid");
    assert.deepEqual(order.providerContext?.orderItemIds, []);
    assert.throws(() => draft(order.providerContext), /SHIPMENT_PACKAGE_DETAILS_REQUIRED/);
    assert.ok(Buffer.byteLength(JSON.stringify(order.providerContext), "utf8") < 32768);
  });
}

test("Lazada valid single, multi-item and multi-order responses preserve exact identities", () => {
  for (const items of [[item("ITEM-1")], [item(9101), item("9007199254740993")], Array.from({ length: 100 }, (_, i) => item(`ITEM-${i}`))]) {
    const input = source(items, { items_count: items.length });
    const before = structuredClone(input);
    const [order] = normalizeChannelOrders("lazada", input, timestamp);
    assert.equal(order.quantity, items.length);
    assert.deepEqual(order.providerContext?.orderItemIds, items.map((row) => String(row.order_item_id)));
    assert.deepEqual(draft(order.providerContext).providerContext, order.providerContext);
    assert.deepEqual(input, before);
  }
  const multiple = source([item("ITEM-1")]);
  multiple.steps.push(
    { name: "orders:2", ok: true, status: 200, data: { data: { orders: [{ order_id: "ORDER-2", statuses: ["pending"], items_count: 2 }] } } },
    { name: "order-items:ORDER-2", ok: true, status: 200, data: { data: [item("ITEM-2", "ORDER-2"), item("ITEM-3", "ORDER-2")] } },
  );
  const orders = normalizeChannelOrders("lazada", multiple, timestamp);
  assert.deepEqual(orders.map((order) => [order.externalOrderId, order.quantity, order.providerContext?.orderItemIds]), [
    ["ORDER-1", 1, ["ITEM-1"]], ["ORDER-2", 2, ["ITEM-2", "ITEM-3"]],
  ]);
  for (const order of orders) assert.deepEqual(draft(order.providerContext, order.externalOrderId).providerContext, order.providerContext);
});

function conflictingOrdersSource(secondItemId: unknown = "SAME-ID", firstItemId: unknown = "SAME-ID") {
  const input = source([{ ...item(firstItemId), name: "untrusted detail one" }], { items_count: 1, item_name: "header one" });
  input.steps.push(
    { name: "orders:2", ok: true, status: 200, data: { data: { orders: [
      { order_id: "ORDER-2", statuses: ["pending"], items_count: 1, item_name: "header two" },
      { order_id: "ORDER-3", statuses: ["pending"], items_count: 1, item_name: "header three" },
    ] } } },
    { name: "order-items:ORDER-2", ok: true, status: 200, data: { data: [{ ...item(secondItemId, "ORDER-2"), name: "untrusted detail two" }] } },
    { name: "order-items:ORDER-3", ok: true, status: 200, data: { data: [{ ...item("UNIQUE-ID", "ORDER-3"), name: "valid third product" }] } },
  );
  return input;
}

test("invalid Lazada details cannot contaminate the header's product name or quantity", () => {
  for (const [, input] of invalidSources) {
    const originalHeader = ((input.steps[0].data.data as Record<string, unknown>).orders as Record<string, unknown>[])[0];
    const [order] = normalizeChannelOrders("lazada", input, timestamp);
    assert.equal(order.productName, originalHeader.item_name ?? "Lazada 주문 상품");
    assert.equal(order.quantity, originalHeader.items_count ?? 1);
  }
});

test("one item claimed by different Lazada orders blocks every owner across all pages without blocking unrelated orders", () => {
  const malformedOther = conflictingOrdersSource();
  (malformedOther.steps[3].data.data as unknown[]).push(null);
  for (const variant of [conflictingOrdersSource(), conflictingOrdersSource(" SAME-ID "), conflictingOrdersSource(9101, "9101"), malformedOther]) {
    for (const steps of [variant.steps, [...variant.steps].reverse()]) {
      const orders = normalizeChannelOrders("lazada", { ...variant, steps }, timestamp);
      assert.equal(orders.length, 3);
      for (const order of orders.filter((order) => order.externalOrderId !== "ORDER-3")) {
        assert.deepEqual(order.providerContext?.orderItemIds, []);
        assert.throws(() => draft(order.providerContext, order.externalOrderId), /SHIPMENT_PACKAGE_DETAILS_REQUIRED/);
        assert.equal(order.productName, order.externalOrderId === "ORDER-1" ? "header one" : "header two");
      }
      const third = orders.find((order) => order.externalOrderId === "ORDER-3")!;
      assert.equal(third.productName, "valid third product");
      assert.deepEqual(draft(third.providerContext, third.externalOrderId).providerContext, third.providerContext);
    }
  }
});

test("actual provider_context storage RPC replaces stale valid identities with fail-closed context before fulfillment readback", async () => {
  // Isolated in-memory database only. Execute the tracked storage/readback migration,
  // with a minimal upstream ingest fixture rather than a live DB or gateway enqueue.
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials(id uuid, created_by uuid, channel text, status text);
      create table sellerpilot_private.commerce_orders(
        id uuid primary key default gen_random_uuid(), owner_id uuid, channel_key text, external_order_id text,
        status text, product_name text, quantity integer, demo boolean default false, ordered_at timestamptz default now(),
        last_seen_at timestamptz, delivered_at timestamptz, updated_at timestamptz,
        unique(owner_id,channel_key,external_order_id)
      );
      create function public.sellerpilot_is_admin() returns boolean language sql as $$ select true $$;
      create function public.sellerpilot_service_ingest_orders(p_credential_id uuid,p_channel text,p_orders jsonb)
      returns integer language plpgsql as $$
      declare v jsonb; v_owner uuid;
      begin
        select created_by into v_owner from sellerpilot_private.channel_credentials where id=p_credential_id;
        for v in select value from jsonb_array_elements(p_orders) loop
          insert into sellerpilot_private.commerce_orders(owner_id,channel_key,external_order_id,status,product_name,quantity)
          values(v_owner,p_channel,v->>'externalOrderId',v->>'status',v->>'productName',(v->>'quantity')::integer)
          on conflict(owner_id,channel_key,external_order_id) do update
            set status=excluded.status, product_name=excluded.product_name, quantity=excluded.quantity;
        end loop;
        return jsonb_array_length(p_orders);
      end $$;
      insert into sellerpilot_private.channel_credentials values
        ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','lazada','active');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20260822050435_temu_orders_shipping_aftersales.sql", import.meta.url), "utf8"));
    const ingestRead = async (input: ChannelOperationResult) => {
      const normalized = normalizeChannelOrders("lazada", input, timestamp);
      await db.query("select public.sellerpilot_service_ingest_orders($1::uuid,'lazada',$2::jsonb)", ["00000000-0000-4000-8000-000000000001", JSON.stringify(normalized)]);
      const rows = await db.query<{ external_order_id: string; provider_context: Record<string, unknown> }>(
        "select * from public.sellerpilot_get_order_fulfillment_context_v2(array(select id from sellerpilot_private.commerce_orders))",
      );
      assert.equal(rows.rows.length, 1);
      assert.deepEqual(rows.rows[0].provider_context, normalized[0].providerContext);
      const metadata = await db.query<{ product_name: string; quantity: number }>("select product_name, quantity from sellerpilot_private.commerce_orders");
      assert.deepEqual(metadata.rows, [{ product_name: normalized[0].productName, quantity: normalized[0].quantity }]);
      if (((input.steps[0].data.data as Record<string, unknown>).orders as Record<string, unknown>[])[0].item_name === "header product") {
        assert.deepEqual(metadata.rows, [{ product_name: "header product", quantity: 5 }]);
      }
      return rows.rows[0];
    };
    for (const validItems of [[item("ITEM-1")], Array.from({ length: 100 }, (_, i) => item(`ITEM-${i}`))]) {
      const valid = await ingestRead(source(validItems));
      assert.deepEqual(draft(valid.provider_context).providerContext, valid.provider_context);
    }
    for (const [, invalid] of invalidSources) {
      const valid = await ingestRead(source([item("ITEM-1"), item("ITEM-2")]));
      assert.deepEqual(draft(valid.provider_context).providerContext, valid.provider_context);
      const blocked = await ingestRead(invalid);
      assert.deepEqual(blocked.provider_context.orderItemIds, []);
      assert.throws(() => draft(blocked.provider_context), /SHIPMENT_PACKAGE_DETAILS_REQUIRED/);
    }
    const multiple = source([item("ITEM-1")]);
    multiple.steps.push(
      { name: "orders:2", ok: true, status: 200, data: { data: { orders: [{ order_id: "ORDER-2", statuses: ["pending"] }] } } },
      { name: "order-items:ORDER-2", ok: true, status: 200, data: { data: [item("ITEM-2", "ORDER-2"), item("ITEM-3", "ORDER-2")] } },
    );
    const normalized = normalizeChannelOrders("lazada", multiple, timestamp);
    await db.query("select public.sellerpilot_service_ingest_orders($1::uuid,'lazada',$2::jsonb)", ["00000000-0000-4000-8000-000000000001", JSON.stringify(normalized)]);
    const stored = await db.query<{ external_order_id: string; provider_context: Record<string, unknown> }>(
      "select * from public.sellerpilot_get_order_fulfillment_context_v2(array(select id from sellerpilot_private.commerce_orders)) order by external_order_id",
    );
    assert.equal(stored.rows.length, 2);
    for (const [index, row] of stored.rows.entries()) {
      assert.deepEqual(row.provider_context, normalized[index].providerContext);
      assert.deepEqual(draft(row.provider_context, row.external_order_id).providerContext, row.provider_context);
    }
    const conflict = normalizeChannelOrders("lazada", conflictingOrdersSource(), timestamp);
    await db.query("select public.sellerpilot_service_ingest_orders($1::uuid,'lazada',$2::jsonb)", ["00000000-0000-4000-8000-000000000001", JSON.stringify(conflict)]);
    const conflictRows = await db.query<{ external_order_id: string; provider_context: Record<string, unknown>; product_name: string; quantity: number }>(
      `select f.external_order_id, f.provider_context, o.product_name, o.quantity
       from public.sellerpilot_get_order_fulfillment_context_v2(array(select id from sellerpilot_private.commerce_orders)) f
       join sellerpilot_private.commerce_orders o on o.id=f.id order by f.external_order_id`,
    );
    assert.equal(conflictRows.rows.length, 3);
    for (const row of conflictRows.rows) {
      if (row.external_order_id === "ORDER-3") {
        assert.deepEqual(row.provider_context.orderItemIds, ["UNIQUE-ID"]);
        assert.equal(row.product_name, "valid third product");
        assert.deepEqual(draft(row.provider_context, row.external_order_id).providerContext, row.provider_context);
      } else {
        assert.deepEqual(row.provider_context.orderItemIds, []);
        assert.equal(row.product_name, row.external_order_id === "ORDER-1" ? "header one" : "header two");
        assert.throws(() => draft(row.provider_context, row.external_order_id), /SHIPMENT_PACKAGE_DETAILS_REQUIRED/);
      }
      assert.equal(row.quantity, 1);
    }
  } finally {
    await db.close();
  }
});
