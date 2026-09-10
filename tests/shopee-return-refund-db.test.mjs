import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../supabase/migrations/20260908045000_enable_shopee_return_refund_cs.sql", import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000008401";
const credential = "00000000-0000-4000-8000-000000008402";
const hash = (value) => createHash("sha256").update(value).digest("hex");

function returnRow(overrides = {}) {
  const shopId = "1719148844";
  const returnSn = "RETURN1";
  return {
    externalTicketId: `shopee:return:${shopId}:${returnSn}`,
    customerName: "buyer",
    subject: "return",
    message: "damaged",
    status: "waiting",
    priority: 2,
    receivedAt: "2026-09-08T01:00:00.000Z",
    remoteMessageId: `${shopId}:${returnSn}:${hash("revision")}`,
    inboundKey: `shopee:${hash("inbound")}`,
    providerStatus: "waiting",
    providerContext: { kind: "return_refund", shopId, returnSn, replySupported: false },
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
      id uuid primary key, created_by uuid, channel text, status text,
      seller_account_key text, seller_account_key_source text
    );
    create table sellerpilot_private.captured_inquiries(payload jsonb);
    create function public.sellerpilot_07200000_ingest_before_shopee(uuid,text,jsonb)
      returns integer language plpgsql security definer set search_path='' as $$
      begin
        insert into sellerpilot_private.captured_inquiries(payload) values($3);
        return jsonb_array_length($3);
      end $$;
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      returns integer language plpgsql security definer set search_path='' as $$
      begin
        -- SHOPEE_COMMENT_CONTEXT_INVALID
        return 19;
      end $$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to service_role;
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','shopee','active','${"a".repeat(64)}','provider_certified_v1'
    );
  `);
  await db.exec(migration);
  return db;
}

test("Shopee return/refund ingest stays read-only and preserves after-sales identity", async () => {
  const db = await fixture();
  try {
    const row = returnRow();
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'shopee',$2::jsonb) result",
      [credential, JSON.stringify([row])],
    )).rows[0].result, 1);
    const captured = (await db.query("select payload from sellerpilot_private.captured_inquiries")).rows[0].payload[0];
    assert.equal(captured.ticketKind, "after_sales");
    assert.deepEqual(captured.replyContext, {});
    assert.equal(captured.providerContext.replySupported, false);
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'shopee','[]'::jsonb) result",
      [credential],
    )).rows[0].result, 19);
  } finally { await db.close(); }
});

test("Shopee return/refund ingest rejects mixed, replyable and cross-shop identities", async () => {
  const db = await fixture();
  try {
    for (const row of [
      returnRow({ providerContext: { kind: "return_refund", shopId: "1719148844", returnSn: "RETURN1", replySupported: true } }),
      returnRow({ externalTicketId: "shopee:return:999:RETURN1" }),
      returnRow({ ticketKind: "conversation" }),
      returnRow({ replyContext: { returnSn: "RETURN1" } }),
    ]) {
      await assert.rejects(db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'shopee',$2::jsonb)",
        [credential, JSON.stringify([row])],
      ), /SHOPEE_RETURN_CONTEXT_INVALID/);
    }
    await assert.rejects(db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'shopee',$2::jsonb)",
      [credential, JSON.stringify([returnRow(), { providerContext: { kind: "product_review" } }])],
    ), /SHOPEE_RETURN_CONTEXT_INVALID/);
  } finally { await db.close(); }
});
