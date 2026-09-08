import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { runWithProviderReadOnlyTransport } from "../lib/channels/protocols";
import {
  executeTemuInquiry,
  temuInquiryRetryContinuation,
  type TemuInquiryExecution,
} from "../lib/channels/temu-inquiries";

const ingestMigration = await readFile(new URL(
  "../supabase/migrations/20260908046000_enable_temu_after_sales_detail_cs.sql",
  import.meta.url,
), "utf8");
const credentialId = "00000000-0000-4000-8000-00000000b001";
const credentialPayload = { app_key: "fixture-app", app_secret: "fixture-secret", access_token: "fixture-token" };

function operationResult(execution: TemuInquiryExecution) {
  return {
    ok: true,
    channel: "temu" as const,
    operation: "inquiries.list" as const,
    steps: execution.steps,
    safeMessage: "fixture detail batch complete",
  };
}

async function ingestFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text,
      status text,
      seller_account_key text,
      seller_account_key_source text
    );
    create table sellerpilot_private.captured_inquiries(payload jsonb);
    create function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
      returns integer language plpgsql security definer set search_path='' as $$
      begin
        -- SHOPEE_RETURN_CONTEXT_INVALID
        insert into sellerpilot_private.captured_inquiries(payload) values($3);
        return jsonb_array_length($3);
      end $$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
      from public, anon, authenticated, service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid, text, jsonb)
      to service_role;
    insert into sellerpilot_private.channel_credentials values(
      '${credentialId}', 'temu', 'active', '${"c".repeat(64)}', 'provider_certified_v1'
    );
  `);
  await db.exec(ingestMigration);
  return db;
}

test("Temu retry replay re-reads and persists successful prefix details before advancing", async () => {
  const originalFetch = globalThis.fetch;
  let listCalls = 0;
  let failThirdOnce = true;
  const detailCalls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.type === "bg.aftersales.parentaftersales.list.get") {
      listCalls += 1;
      return Response.json({
        success: true,
        result: {
          data: Array.from({ length: 11 }, (_, index) => ({
            parentAfterSalesSn: `AFTER-${index + 1}`,
            parentOrderSn: `ORDER-${index + 1}`,
            afterSalesStatusGroup: 1,
            updateAt: 1_788_000_000 + index,
          })),
          total: 11,
          pageNumber: 1,
        },
      });
    }
    const afterSalesSn = String(body.parentAfterSalesSn);
    detailCalls.push(afterSalesSn);
    if (afterSalesSn === "AFTER-3" && failThirdOnce) {
      failThirdOnce = false;
      return Response.json({ success: false, error_msg: "fixture transient" }, { status: 503 });
    }
    const index = Number(afterSalesSn.split("-")[1]);
    return Response.json({
      success: true,
      result: {
        parentAfterSalesSn: afterSalesSn,
        parentOrderSn: body.parentOrderSn,
        parentAfterSalesStatus: 1,
        afterSalesType: 2,
        lastUpdateAtMillis: 1_788_000_000_000 + index * 1_000,
        afterSalesList: [{
          afterSalesSn: `${afterSalesSn}-CHILD`,
          orderSn: body.parentOrderSn,
          buyerComment: `fixture-message-${index}`,
          afterSalesStatus: 1,
        }],
      },
    });
  };

  let db: PGlite | null = null;
  try {
    const first = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload: credentialPayload,
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_100,
      },
    }));
    const retry = temuInquiryRetryContinuation(first);
    assert.equal(first.steps.at(-1)?.ok, false);
    assert.equal(retry?.deferredCount, 9);
    assert.equal(retry?.replayCount, 2);

    const replayedBatch = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload: credentialPayload,
      arguments: retry!.arguments,
    }));
    assert.equal(replayedBatch.steps.length, 10);
    assert.equal(replayedBatch.steps.every((step) => step.ok), true);
    assert.equal((replayedBatch.continuationArguments?.detailQueue as unknown[]).length, 1);
    assert.equal(replayedBatch.continuationArguments?.sellerpilotTemuDetailRetryCount, undefined);

    const finalBatch = await runWithProviderReadOnlyTransport(() => executeTemuInquiry({
      operation: "inquiries.list",
      payload: credentialPayload,
      arguments: replayedBatch.continuationArguments!,
    }));
    assert.equal(finalBatch.steps.length, 1);
    assert.equal(finalBatch.steps[0]?.ok, true);
    assert.equal(finalBatch.continuationArguments, undefined);
    assert.equal(listCalls, 1);
    assert.deepEqual(detailCalls, [
      "AFTER-1", "AFTER-2", "AFTER-3",
      "AFTER-1", "AFTER-2", "AFTER-3", "AFTER-4", "AFTER-5",
      "AFTER-6", "AFTER-7", "AFTER-8", "AFTER-9", "AFTER-10",
      "AFTER-11",
    ]);

    const normalizedBatches = [replayedBatch, finalBatch].map((execution) =>
      normalizeChannelInquiries("temu", operationResult(execution), "2026-09-08T12:00:00.000Z"));
    const normalized = normalizedBatches.flat();
    assert.equal(normalized.length, 11);
    assert.equal(new Set(normalized.map((row) => row.externalTicketId)).size, 11);
    assert.ok(normalized.some((row) => row.externalTicketId === "aftersales:AFTER-1"));
    assert.ok(normalized.some((row) => row.externalTicketId === "aftersales:AFTER-2"));

    db = await ingestFixture();
    for (const batch of normalizedBatches) {
      assert.equal((await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1, 'temu', $2::jsonb) result",
        [credentialId, JSON.stringify(batch)],
      )).rows[0].result, batch.length);
    }
    const captured = (await db.query(
      "select payload from sellerpilot_private.captured_inquiries order by ctid",
    )).rows.flatMap((row) => row.payload as Array<Record<string, unknown>>);
    assert.equal(captured.length, 11);
    assert.equal(new Set(captured.map((row) => row.externalTicketId)).size, 11);
    assert.equal(captured.filter((row) => row.externalTicketId === "aftersales:AFTER-1").length, 1);
    assert.equal(captured.filter((row) => row.externalTicketId === "aftersales:AFTER-2").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await db?.close();
  }
});
