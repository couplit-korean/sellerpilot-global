import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260908046000_enable_temu_after_sales_detail_cs.sql", import.meta.url), "utf8");
const credential = "00000000-0000-4000-8000-000000008502";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function detailRow(overrides = {}) {
  return {
    externalTicketId: "aftersales:AFTER-1",
    customerName: "Temu buyer",
    subject: "return",
    message: "damaged",
    status: "waiting",
    priority: 1,
    receivedAt: "2026-09-08T01:00:00.000Z",
    remoteMessageId: `AFTER-1:${hash("revision")}`,
    inboundKey: `temu:${hash("inbound")}`,
    providerStatus: "waiting",
    providerContext: {
      afterSalesSn: "AFTER-1",
      orderSn: "ORDER-1",
      statusGroup: "1",
      availableOperations: [],
      providerRevision: hash("revision"),
      providerRevisionSource: "updateAt",
      replySupported: false,
      afterSalesCases: [{
        afterSalesSn: "AFTER-1-CHILD",
        orderSn: "ORDER-1",
        reasonCode: "7",
        reason: "damaged",
        buyerComment: "box damaged",
        status: "1",
        requestedQuantity: 1,
        requestedRefund: { currency: "KRW", amount: "3190" },
      }],
      refundSummary: { buyerTotalRefund: { currency: "KRW", amount: "3190" } },
      detailContract: "temu.aftersales.parentaftersales.detail.get",
    },
    replyContext: {},
    ticketKind: "after_sales",
    ...overrides,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text, status text,
      seller_account_key text, seller_account_key_source text
    );
    create table sellerpilot_private.captured_inquiries(payload jsonb);
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      returns integer language plpgsql security definer set search_path='' as $$
      begin
        -- SHOPEE_RETURN_CONTEXT_INVALID
        insert into sellerpilot_private.captured_inquiries(payload) values($3);
        return jsonb_array_length($3);
      end $$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to service_role;
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','temu','active','${"b".repeat(64)}','provider_certified_v1'
    );
  `);
  await db.exec(migration);
  return db;
}

test("Temu detail ingest accepts only exact read-only after-sales lineage", async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'temu',$2::jsonb) result",
      [credential, JSON.stringify([detailRow()])],
    )).rows[0].result, 1);
    const captured = (await db.query("select payload from sellerpilot_private.captured_inquiries")).rows[0].payload[0];
    assert.equal(captured.providerContext.replySupported, false);
    assert.deepEqual(captured.replyContext, {});
    assert.equal(captured.ticketKind, "after_sales");
  } finally { await db.close(); }
});

test("Temu detail ingest rejects replyable, mismatched and arbitrary provider fields", async () => {
  const db = await fixture();
  try {
    for (const row of [
      detailRow({ providerContext: { ...detailRow().providerContext, replySupported: true } }),
      detailRow({ externalTicketId: "aftersales:OTHER" }),
      detailRow({ replyContext: { afterSalesSn: "AFTER-1" } }),
      detailRow({ providerContext: { ...detailRow().providerContext, phone: "do-not-store" } }),
      detailRow({ providerContext: { ...detailRow().providerContext, afterSalesCases: [] } }),
    ]) {
      await assert.rejects(db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'temu',$2::jsonb)",
        [credential, JSON.stringify([row])],
      ), /TEMU_AFTER_SALES_CONTEXT_INVALID/);
    }
  } finally { await db.close(); }
});
