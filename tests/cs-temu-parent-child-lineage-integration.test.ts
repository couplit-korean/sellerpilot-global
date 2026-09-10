import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";

const baseIngest = await readFile(new URL(
  "../supabase/migrations/20260908046000_enable_temu_after_sales_detail_cs.sql",
  import.meta.url,
), "utf8");
const lineageIngest = await readFile(new URL(
  "../supabase/migrations/20260909104730_cs_temu_child_order_lineage.sql",
  import.meta.url,
), "utf8");
const laterWrapper = await readFile(new URL(
  "../supabase/migrations/20260908047000_enable_coupang_after_sales_cs.sql",
  import.meta.url,
), "utf8");
const credentialId = "00000000-0000-4000-8000-00000000d001";
const payload = { app_key: "app", app_secret: "secret", access_token: "token" };

function providerResult(childOrderSn = "ORDER-1") {
  return {
    ok: true,
    channel: "temu" as const,
    operation: "inquiries.list" as const,
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotListSummary: {
          parentAfterSalesSn: "AFTER-1",
          parentOrderSn: "ORDER-1",
          afterSalesStatusGroup: 1,
          updateAt: 1_788_000_000,
        },
        result: {
          parentAfterSalesSn: "AFTER-1",
          parentOrderSn: "ORDER-1",
          parentAfterSalesStatus: 1,
          afterSalesType: 2,
          afterSalesList: [{
            afterSalesSn: "AFTER-1-CHILD",
            orderSn: childOrderSn,
            buyerComment: "damaged",
            afterSalesStatus: 1,
          }],
        },
      },
    }],
    safeMessage: "ok",
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
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      to service_role;
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}','temu','active','${"b".repeat(64)}','provider_certified_v1'
    );
  `);
  await db.exec(baseIngest);
  await db.exec(laterWrapper);
  await db.exec(lineageIngest);
  const acl = await db.query(`select
    has_function_privilege('service_role','public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)','EXECUTE') as inner_service,
    has_function_privilege('authenticated','public.sellerpilot_08047000_ingest_before_coupang_after_sales(uuid,text,jsonb)','EXECUTE') as inner_authenticated,
    has_function_privilege('service_role','public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)','EXECUTE') as outer_service`);
  assert.deepEqual(acl.rows[0], { inner_service: false, inner_authenticated: false, outer_service: true });
  return db;
}

async function executeDetail(childOrderSn: string | undefined) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    result: {
      parentAfterSalesSn: "AFTER-1",
      parentOrderSn: "ORDER-1",
      afterSalesList: [{
        afterSalesSn: "AFTER-1-CHILD",
        ...(childOrderSn === undefined ? {} : { orderSn: childOrderSn }),
      }],
    },
  });
  try {
    return await runWithProviderReadOnlyTransport(() => executeChannelOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
        detailQueue: [{ parentAfterSalesSn: "AFTER-1", parentOrderSn: "ORDER-1" }],
      },
      environment: "production",
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("adapter, normalizer and ingest all reject a child outside its parent order", async () => {
  await assert.rejects(executeDetail("ORDER-OTHER"), /TEMU_AFTER_SALES_DETAIL_MISMATCH/);
  await assert.rejects(executeDetail(undefined), /TEMU_AFTER_SALES_DETAIL_MISMATCH/);
  assert.throws(
    () => normalizeChannelInquiries("temu", providerResult("ORDER-OTHER"), "2026-09-09T10:30:00.000Z"),
    /INQUIRY_RECORD_INVALID:temu/,
  );

  const normalized = normalizeChannelInquiries(
    "temu",
    providerResult(),
    "2026-09-09T10:30:00.000Z",
  );
  assert.equal(normalized.length, 1);
  const crossOrder = structuredClone(normalized);
  crossOrder[0]!.providerContext.afterSalesCases = [{
    ...(crossOrder[0]!.providerContext.afterSalesCases as Array<Record<string, unknown>>)[0],
    orderSn: "ORDER-OTHER",
  }];
  const db = await fixture();
  try {
    await assert.rejects(db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'temu',$2::jsonb)",
      [credentialId, JSON.stringify(crossOrder)],
    ), /TEMU_AFTER_SALES_CONTEXT_INVALID/);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.captured_inquiries",
    )).rows[0].count, 0);

    for (let replay = 0; replay < 2; replay += 1) {
      assert.equal((await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'temu',$2::jsonb) result",
        [credentialId, JSON.stringify(normalized)],
      )).rows[0].result, 1);
    }
    const captured = (await db.query(
      "select payload from sellerpilot_private.captured_inquiries order by ctid",
    )).rows;
    assert.equal(captured.length, 2);
    assert.equal(
      createHash("sha256").update(JSON.stringify(captured[0]?.payload)).digest("hex"),
      createHash("sha256").update(JSON.stringify(captured[1]?.payload)).digest("hex"),
    );
  } finally {
    await db.close();
  }
});
