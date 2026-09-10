import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { LazadaSupplementalReadSummary } from "../app/cs/channels/lazada/supplemental-summary";
import { parseLazadaSupplementalReadResponse, type LazadaSupplementalReadResponse } from "../lib/cs/channels/lazada/supplemental-contract";
import { normalizeLazadaSupplementalRead } from "../lib/cs/channels/lazada/supplemental-read";
import { projectLazadaSupplementalReadRpc } from "../lib/cs/channels/lazada/supplemental-web";

const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
const integratedMigration = process.env.SELLERPILOT_LAZADA_SUPPLEMENTAL_MIGRATION?.trim()
  || "20260909165423_cs_lazada_supplemental_read_ledger.sql";
const migration = await readFile(integratedRoot
  ? resolve(integratedRoot, "supabase/migrations", integratedMigration)
  : new URL("../docs/cs-parallel/proposals/lazada/lazada-012-supplemental-read-ledger.sql", import.meta.url),
"utf8");
const owner = "00000000-0000-4000-8000-000000001221";
const admin = "00000000-0000-4000-8000-000000001222";
const credential = "00000000-0000-4000-8000-000000001223";
const otherCredential = "00000000-0000-4000-8000-000000001224";
const seller = "a".repeat(64);
const observedAt = "2026-09-09T11:45:00.000Z";
type IngestResult = { value: { seen: number; inserted: number; duplicates: number } };
type ReadResult = { value: Pick<LazadaSupplementalReadResponse, "events" | "nextCursor"> };

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
      status text not null,expires_at timestamptz,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      credential_id uuid not null,channel text not null,operation text not null,country text not null,
      status text not null,expires_at timestamptz
    );
  `);
  await db.exec(migration);
  await db.query("insert into auth.users values($1),($2)", [owner, admin]);
  await db.query("insert into sellerpilot_private.admin_users values($1),($2)", [owner, admin]);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,$2,'lazada','production','active',clock_timestamp()+interval '1 day',$3,'provider_certified_v1',clock_timestamp()),
    ($4,$2,'lazada','production','active',clock_timestamp()+interval '1 day',$5,'provider_certified_v1',clock_timestamp())`,
  [credential, owner, seller, otherCredential, "b".repeat(64)]);
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values
    ($1,'lazada','inquiries.list','MY','active',clock_timestamp()+interval '1 day'),
    ($2,'lazada','inquiries.list','SG','active',clock_timestamp()+interval '1 day')`,
  [credential, otherCredential]);
  return db;
}

function rows() {
  const review = normalizeLazadaSupplementalRead({
    credentialId: credential, country: "MY", sourcePath: "/review/seller/list", observedAt,
    payload: { total_count: 1, data: [{ review_id: "REV-77", item_id: "ITEM-7", rating: 4,
      review_content: "배송 상태가 좋았습니다.", review_time: "2026-09-09T09:00:00+08:00" }] },
  });
  const afterSales = normalizeLazadaSupplementalRead({
    credentialId: credential, country: "MY", sourcePath: "/order/reverse/return/history/list", observedAt,
    payload: { total: 1, data: { items: [{ reverse_order_id: "RO-77", trade_order_id: "ORDER-7",
      reverse_order_line_id: "RL-7", history_id: "H-7", reverse_status: "RETURN_INIT",
      reason: "단순 변심", status_update_time: 1788908400 }] } },
  });
  return { review, afterSales };
}

function legacyReviewEventKey(event: ReturnType<typeof rows>["review"][number]) {
  return createHash("sha256").update([
    "product_review",
    event.resourceKey,
    event.occurredAt,
    event.status,
    event.body ?? "",
    event.providerContext.sellerReplyId ?? "",
  ].join("\u001f")).digest("hex");
}

test("migration exports only read-ledger ingest and administrator read functions", () => {
  const functions = [...migration.matchAll(/create(?: or replace)? function public\.([a-z0-9_]+)/giu)]
    .map((match) => match[1]);
  assert.deepEqual(functions, [
    "sellerpilot_service_ingest_lazada_supplemental_cs_v1",
    "sellerpilot_read_lazada_supplemental_cs_v1",
  ]);
  assert.doesNotMatch(migration, /insert into sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(migration, /update sellerpilot_private\.(?:support_tickets|orders|listings)/iu);
  assert.doesNotMatch(migration, /delete from/iu);
});

test("adapter rows persist under exact credential/country and shared admin reads a mutation-free UI projection", async () => {
  const db = await fixture();
  try {
    const normalized = rows();
    await db.exec("set role service_role");
    const reviewReceipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify(normalized.review)])).rows[0]?.value;
    assert.deepEqual({ seen: reviewReceipt.seen, inserted: reviewReceipt.inserted, duplicates: reviewReceipt.duplicates },
      { seen: 1, inserted: 1, duplicates: 0 });
    const replay = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify(normalized.review)])).rows[0]?.value;
    assert.equal(replay.duplicates, 1);
    await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','reverse_order_after_sales','/order/reverse/return/history/list',$2::jsonb)`,
    [credential, JSON.stringify(normalized.afterSales)]);
    await assert.rejects(db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'SG','product_review','/review/seller/list',$2::jsonb)`,
    [credential, JSON.stringify(normalized.review)]), /COUNTRY_BINDING_REQUIRED|ROW_INVALID/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const rpc = (await db.query<ReadResult>(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,null,null,null,null,50) value`)).rows[0]?.value;
    await db.exec("reset role");
    const projection = projectLazadaSupplementalReadRpc(rpc);
    assert.equal(projection.events.length, 2);
    assert.equal(projection.liveProviderRead, false);
    assert.deepEqual(projection.capabilities.map((item) => [item.surface,item.state,item.replyEnabled,item.mutationsEnabled]), [
      ["product_review", "permission_pending", false, false],
      ["reverse_order_after_sales", "conditional", false, false],
    ]);
    const html = renderToStaticMarkup(createElement(LazadaSupplementalReadSummary, { state: projection }));
    assert.match(html, /배송 상태가 좋았습니다/);
    assert.match(html, /단순 변심/);
    assert.match(html, /Lazada 접근 권한/);
    assert.match(html, /비활성/);
    assert.doesNotMatch(html, /답글 보내기|환불 승인|반품 승인/);
    assert.deepEqual(parseLazadaSupplementalReadResponse(JSON.parse(JSON.stringify(projection))), projection);
  } finally { await db.close(); }
});

test("non-admin read and cross-account row substitution are rejected", async () => {
  const db = await fixture();
  try {
    const review = rows().review.map((row) => ({ ...row, credentialId: otherCredential }));
    await db.exec("set role service_role");
    await assert.rejects(db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb)`,
    [credential, JSON.stringify(review)]), /ROW_INVALID/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", ["00000000-0000-4000-8000-000000001229"]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query<ReadResult>("select public.sellerpilot_read_lazada_supplemental_cs_v1(null,null,null,null,null,50)"),
      /administrator access required/);
  } finally { await db.close(); }
});

test("official nested review and history responses survive SQL ingest, replay and admin projection", async () => {
  const db = await fixture();
  try {
    const review = normalizeLazadaSupplementalRead({ credentialId: credential, country: "MY", observedAt,
      sourcePath: "/review/seller/list", resourceId: "2222",
      payload: { code: "0", success: "true", data: { total: "1", data: [{ item_id: "2222", order_id: "1111",
        ratings: { product_rating: "5" }, reviews: [{ id: "3333", create_time: "1640970071000",
          review_type: "PRODUCT_REVIEW", review_content: "공식 구조 리뷰", seller_reply: "감사합니다".repeat(60) }] }] } } });
    const history = normalizeLazadaSupplementalRead({ credentialId: credential, country: "MY", observedAt,
      sourcePath: "/order/reverse/return/history/list", resourceId: "4444",
      payload: { code: "0", data: { page_info: { total: "1" }, list: [{ time: "1627562669235", operator: "Private Buyer", picture: [] }] } } });
    await db.exec("set role service_role");
    for (const events of [review, history]) {
      for (const duplicate of [false, true]) {
        const receipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
          $1,'MY',$2,$3,$4::jsonb) value`, [credential, events[0].surface, events[0].sourcePath, JSON.stringify(events)]))
          .rows[0]?.value;
        assert.equal(receipt.inserted, duplicate ? 0 : 1);
        assert.equal(receipt.duplicates, duplicate ? 1 : 0);
      }
    }
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const rpc = (await db.query<ReadResult>("select public.sellerpilot_read_lazada_supplemental_cs_v1(null,null,null,null,null,50) value")).rows[0]?.value;
    const projection = projectLazadaSupplementalReadRpc(rpc);
    assert.equal(projection.events.length, 2);
    assert.equal(projection.events.find((row) => row.surface === "product_review")?.providerContext.sellerReply, "감사합니다".repeat(60));
    assert.equal(projection.events.find((row) => row.surface === "product_review")?.externalOrderId, "1111");
    const html = renderToStaticMarkup(createElement(LazadaSupplementalReadSummary, { state: projection }));
    assert.match(html, /공식 구조 리뷰/);
    assert.match(html, /상태 미제공/);
    assert.doesNotMatch(html, /Private Buyer/);
    assert.equal(projection.liveProviderRead, false);
  } finally { await db.close(); }
});

test("multi-account composite pagination retains equal-time equal-event-key rows", async () => {
  const db = await fixture();
  try {
    const base = rows().review[0];
    const other = { ...base, credentialId: otherCredential, country: "SG" };
    await db.exec("set role service_role");
    await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb)`, [credential, JSON.stringify([base])]);
    await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'SG','product_review','/review/seller/list',$2::jsonb)`, [otherCredential, JSON.stringify([other])]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const first = (await db.query<ReadResult>(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,null,null,null,null,1) value`)).rows[0]?.value;
    assert.equal(first.events.length, 1);
    assert.ok(first.nextCursor);
    const cursor = first.nextCursor;
    const second = (await db.query<ReadResult>(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,$1,$2,$3,$4,1) value`, [
      cursor.occurredAt, cursor.eventKey, cursor.credentialId, cursor.country,
    ])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(second.events.length, 1);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(new Set([first.events[0].credentialId, second.events[0].credentialId]),
      new Set([credential, otherCredential]));
    assert.equal(first.events[0].eventKey, second.events[0].eventKey);
    assert.equal(first.events[0].occurredAt, second.events[0].occurredAt);
  } finally { await db.close(); }
});

test("rating revisions and sibling reverse-order lines survive SQL ingest while exact replays stay idempotent", async () => {
  const db = await fixture();
  try {
    const reviewPayload = {
      review_id: "REV-IDENTITY",
      item_id: "ITEM-IDENTITY",
      review_content: "same body",
      review_time: "2026-09-09T09:00:00+08:00",
    };
    const reviewFive = normalizeLazadaSupplementalRead({
      credentialId: credential,
      country: "MY",
      sourcePath: "/review/seller/list",
      observedAt,
      payload: { data: [{ ...reviewPayload, rating: 5 }] },
    })[0];
    const reviewOne = normalizeLazadaSupplementalRead({
      credentialId: credential,
      country: "MY",
      sourcePath: "/review/seller/list",
      observedAt,
      payload: { data: [{ ...reviewPayload, rating: 1 }] },
    })[0];
    assert.notEqual(reviewFive.eventKey, reviewOne.eventKey);
    const reversePayload = {
      reverse_order_id: "RO-IDENTITY",
      trade_order_id: "ORDER-IDENTITY",
      reverse_status: "RETURN_INIT",
      reason: "same reason",
      status_update_time: "2026-09-09T09:00:00+08:00",
    };
    const reverseLines = normalizeLazadaSupplementalRead({
      credentialId: credential,
      country: "MY",
      sourcePath: "/order/reverse/return/detail/list",
      observedAt,
      payload: { data: { items: [
        { ...reversePayload, reverse_order_line_id: "RL-1", trade_order_line_id: "ITEM-1" },
        { ...reversePayload, reverse_order_line_id: "RL-2", trade_order_line_id: "ITEM-2" },
      ] } },
    });
    assert.equal(new Set(reverseLines.map((event) => event.eventKey)).size, 2);

    await db.exec("set role service_role");
    const reviewReceipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify([reviewFive, reviewOne])])).rows[0]?.value;
    assert.deepEqual({ inserted: reviewReceipt.inserted, duplicates: reviewReceipt.duplicates },
      { inserted: 2, duplicates: 0 });
    const reviewReplay = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify([reviewFive, reviewOne])])).rows[0]?.value;
    assert.deepEqual({ inserted: reviewReplay.inserted, duplicates: reviewReplay.duplicates },
      { inserted: 0, duplicates: 2 });
    const reverseReceipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','reverse_order_after_sales','/order/reverse/return/detail/list',$2::jsonb) value`,
    [credential, JSON.stringify(reverseLines)])).rows[0]?.value;
    assert.deepEqual({ inserted: reverseReceipt.inserted, duplicates: reverseReceipt.duplicates },
      { inserted: 2, duplicates: 0 });
    const reverseReplay = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','reverse_order_after_sales','/order/reverse/return/detail/list',$2::jsonb) value`,
    [credential, JSON.stringify(reverseLines)])).rows[0]?.value;
    assert.deepEqual({ inserted: reverseReplay.inserted, duplicates: reverseReplay.duplicates },
      { inserted: 0, duplicates: 2 });

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    const rpc = (await db.query<ReadResult>(`select public.sellerpilot_read_lazada_supplemental_cs_v1(
      null,null,null,null,null,50) value`)).rows[0]?.value;
    await db.exec("reset role");
    assert.deepEqual(rpc.events.filter((event: { resourceKey: string }) => event.resourceKey === "REV-IDENTITY")
      .map((event) => event.rating).sort(), [1, 5]);
    assert.deepEqual(rpc.events.filter((event: { resourceKey: string }) => event.resourceKey === "RO-IDENTITY")
      .map((event: { providerContext: { reverseOrderLineId?: string } }) => event.providerContext.reverseOrderLineId)
      .sort(), ["RL-1", "RL-2"]);
  } finally { await db.close(); }
});

test("an exact observation already stored with the legacy event key is not duplicated", async () => {
  const db = await fixture();
  try {
    const current = rows().review[0];
    const legacy = { ...current, eventKey: legacyReviewEventKey(current) };
    assert.notEqual(legacy.eventKey, current.eventKey);
    await db.exec("set role service_role");
    const legacyReceipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify([legacy])])).rows[0]?.value;
    assert.equal(legacyReceipt.inserted, 1);
    const currentReceipt = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`,
    [credential, JSON.stringify([current])])).rows[0]?.value;
    assert.deepEqual({ inserted: currentReceipt.inserted, duplicates: currentReceipt.duplicates },
      { inserted: 0, duplicates: 1 });
    await db.exec("reset role");
    const stored = (await db.query(
      "select event_key from sellerpilot_private.lazada_supplemental_cs_events",
    )).rows;
    assert.deepEqual(stored, [{ event_key: legacy.eventKey }]);
  } finally { await db.close(); }
});

test("changed immutable observations reusing a stored event key reject and roll back the batch", async () => {
  const db = await fixture();
  try {
    const original = rows().review[0];
    const newEvent = { ...original, resourceKey: "REV-BEFORE-CONFLICT", eventKey: "9".repeat(64),
      providerContext: { reviewId: "REV-BEFORE-CONFLICT", itemId: original.externalItemId ?? "ITEM-7" } };
    await db.exec("set role service_role");
    await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb)`, [credential, JSON.stringify([original])]);
    const changedRows = [
      { ...original, body: "changed body" },
      { ...original, status: "hidden" },
      { ...original, externalItemId: "ITEM-CHANGED",
        providerContext: { ...original.providerContext, itemId: "ITEM-CHANGED" } },
      { ...original, rating: 1, title: "상품 리뷰 · 평점 1" },
      { ...original, providerContext: { ...original.providerContext, sellerReplyId: "REPLY-CHANGED" } },
    ];
    for (const changed of changedRows) {
      await assert.rejects(db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
        $1,'MY','product_review','/review/seller/list',$2::jsonb)`, [
        credential, JSON.stringify([newEvent, changed]),
      ]), /LAZADA_SUPPLEMENTAL_EVENT_KEY_CONFLICT/);
      await db.exec("reset role");
      const count = (await db.query<{ value: number }>(
        "select count(*)::integer value from sellerpilot_private.lazada_supplemental_cs_events",
      )).rows[0]?.value;
      assert.equal(count, 1);
      await db.exec("set role service_role");
    }
    const exactReplay = (await db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',$2::jsonb) value`, [
      credential, JSON.stringify([original]),
    ])).rows[0]?.value;
    assert.deepEqual({ inserted: exactReplay.inserted, duplicates: exactReplay.duplicates },
      { inserted: 0, duplicates: 1 });
  } finally { await db.close(); }
});

test("migration rerun and direct authenticated table reads fail closed", async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.exec(migration), /LAZADA_SUPPLEMENTAL_ALREADY_INSTALLED/);
    await db.exec("rollback");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select count(*) from sellerpilot_private.lazada_supplemental_cs_events"),
      /permission denied/);
  } finally { await db.close(); }
});

test("NULL and wrong-type read or ingest inputs are rejected without changing the ledger", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    await assert.rejects(db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
      $1,'MY','product_review','/review/seller/list',null::jsonb)`, [credential]),
    /LAZADA_SUPPLEMENTAL_INGEST_INVALID/);
    const invalidIngests: Array<[string | null, string | null, unknown]> = [
      ["product_review", "/review/seller/list", null],
      ["product_review", "/review/seller/list", {}],
      [null, "/review/seller/list", []],
      ["product_review", null, []],
    ];
    for (const [surface, sourcePath, payload] of invalidIngests) {
      await assert.rejects(db.query<IngestResult>(`select public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
        $1,'MY',$2::text,$3::text,$4::jsonb)`, [credential, surface, sourcePath, JSON.stringify(payload)]),
      /LAZADA_SUPPLEMENTAL_INGEST_INVALID/);
    }
    await db.exec("reset role");
    const before = (await db.query<{ value: number }>(
      "select count(*)::integer value from sellerpilot_private.lazada_supplemental_cs_events",
    )).rows[0]?.value;
    assert.equal(before, 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query(
      "select public.sellerpilot_read_lazada_supplemental_cs_v1(null,null,null,null,null,null)",
    ), /LAZADA_SUPPLEMENTAL_READ_INVALID/);
    await db.exec("reset role");
    const after = (await db.query<{ value: number }>(
      "select count(*)::integer value from sellerpilot_private.lazada_supplemental_cs_events",
    )).rows[0]?.value;
    assert.equal(after, 0);
  } finally { await db.close(); }
});
