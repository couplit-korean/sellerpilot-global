import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const canonical = await readFile(new URL(
  "../supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql", import.meta.url,
), "utf8");
const boundary = await readFile(new URL(
  "../supabase/migrations/20260909181000_cs_lazada_supplemental_provider_ingest.sql", import.meta.url,
), "utf8");
const rounds = await readFile(new URL(
  "../supabase/migrations/20260909185000_cs_lazada_supplemental_resync_rounds.sql", import.meta.url,
), "utf8");
const admin = "00000000-0000-4000-8000-000000009001";
const credential = "00000000-0000-4000-8000-000000009002";
const binding = "00000000-0000-4000-8000-000000009003";
const otherCredential = "00000000-0000-4000-8000-000000009004";
const otherBinding = "00000000-0000-4000-8000-000000009005";
const seller = "a".repeat(64);
const otherSeller = "b".repeat(64);

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
      status text not null,expires_at timestamptz,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,country text not null,target_fingerprint text not null,
      status text not null,expires_at timestamptz
    );
  `);
  await db.exec(canonical);
  await db.exec(boundary);
  await db.exec(rounds);
  await db.query("insert into auth.users values($1)", [admin]);
  await db.query("insert into sellerpilot_private.admin_users values($1)", [admin]);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,$3,'lazada','production','active',clock_timestamp()+interval '1 day',$4,'provider_certified_v1',clock_timestamp()),
    ($2,$3,'lazada','production','active',clock_timestamp()+interval '1 day',$5,'provider_certified_v1',clock_timestamp())`,
  [credential, otherCredential, admin, seller, otherSeller]);
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values
    ($1,$3,'lazada','inquiries.list','MY',$5,'active',clock_timestamp()+interval '1 day'),
    ($2,$4,'lazada','inquiries.list','MY',$6,'active',clock_timestamp()+interval '1 day')`,
  [binding, otherBinding, credential, otherCredential, "c".repeat(64), "d".repeat(64)]);
  await db.exec("set role service_role");
  for (const account of [
    { binding, credential, seller, target: "c".repeat(64), digest: "e".repeat(64) },
    { binding: otherBinding, credential: otherCredential, seller: otherSeller, target: "d".repeat(64), digest: "f".repeat(64) },
  ]) {
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [account.binding, JSON.stringify({
      contractVersion: "sellerpilot-lazada-supplemental-permission-readback/1",
      verificationSource: "lazada_app_permission_readback",
      providerRequestId: `permission-${account.credential}`,
      providerEvidenceDigest: account.digest,
      bindingTargetFingerprint: account.target,
      credentialId: account.credential,
      sellerAccountKey: account.seller,
      country: "MY",
      surface: "product_review",
      sourcePath: "/review/seller/list",
    })]);
  }
  return db;
}

function event(account: string, id: string, eventKey: string) {
  return {
    credentialId: account,
    country: "MY",
    surface: "product_review",
    sourcePath: "/review/seller/list",
    resourceKey: id,
    eventKey,
    status: "published",
    title: "상품 리뷰 · 평점 5",
    body: `round ${id}`,
    externalOrderId: "8001",
    externalItemId: "1001",
    rating: 5,
    occurredAt: "2026-09-09T18:00:00.000Z",
    observedAt: "2026-09-09T18:20:00.000Z",
    providerContext: { reviewId: id, itemId: "1001" },
  };
}

const page = {
  contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
  kind: "provider_page",
  pageNumber: 1,
  pageSize: 20,
  total: 1,
  entryCount: 1,
  hasMore: false,
  nextPage: null,
};

async function prepare(db: PGlite, account = credential) {
  return (await db.query(`select public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
    $1,'MY','/review/seller/list','1001',20) value`, [account])).rows[0]?.value;
}

async function acknowledge(db: PGlite, prepared: Record<string, unknown>, row: unknown, account = credential) {
  return (await db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
    $1,$2,$3,'MY','product_review','/review/seller/list','1001',1,20,$4::jsonb,$5::jsonb
  ) value`, [prepared.continuationId, prepared.revision, account, JSON.stringify([row]), JSON.stringify(page)]))
    .rows[0]?.value;
}

async function begin(db: PGlite, parent: Record<string, unknown>, startRequestId: string, account = credential) {
  return (await db.query(`select public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
    $1,$2,$3,$4,'MY','/review/seller/list','1001',20,$5) value`, [
    admin, parent.continuationId, parent.revision, account, startRequestId,
  ])).rows[0]?.value;
}

test("explicit admin request starts a new immutable round and a new review event persists", async () => {
  const db = await fixture();
  try {
    const first = await prepare(db);
    const firstReceipt = await acknowledge(db, first, event(credential, "REVIEW-1", "1".repeat(64)));
    assert.equal(firstReceipt.complete, true);
    await assert.rejects(prepare(db), /READ_ALREADY_COMPLETE/u);
    const startId = "00000000-0000-4000-8000-000000009011";
    const begun = await begin(db, firstReceipt, startId);
    assert.equal(begun.runNumber, 2);
    assert.equal(begun.replayed, false);
    const second = await prepare(db);
    assert.equal(second.continuationId, begun.continuationId);
    const secondReceipt = await acknowledge(db, second, event(credential, "REVIEW-2", "2".repeat(64)));
    assert.equal(secondReceipt.complete, true);
    await db.exec("reset role");
    const state = (await db.query(`select
      (select count(*)::integer from sellerpilot_private.lazada_supplemental_read_progress) rounds,
      (select count(*)::integer from sellerpilot_private.lazada_supplemental_cs_events) events`)).rows[0];
    assert.deepEqual(state, { rounds: 2, events: 2 });
  } finally { await db.close(); }
});

test("same resync request replays without a third round and a different request cannot reset it", async () => {
  const db = await fixture();
  try {
    const first = await prepare(db);
    const completed = await acknowledge(db, first, event(credential, "REVIEW-1", "1".repeat(64)));
    const startId = "00000000-0000-4000-8000-000000009012";
    const created = await begin(db, completed, startId);
    const activeReplay = await begin(db, completed, startId);
    assert.equal(activeReplay.continuationId, created.continuationId);
    assert.equal(activeReplay.replayed, true);
    await assert.rejects(db.query(`select public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
      $1,$2,$3,$4,'MY','/review/seller/list','1001',20,$5)`, [
      admin, completed.continuationId, Number(completed.revision) + 1, credential, startId,
    ]), /RESYNC_REQUEST_CONFLICT/u);
    const second = await prepare(db);
    await acknowledge(db, second, event(credential, "REVIEW-2", "2".repeat(64)));
    const completedReplay = await begin(db, completed, startId);
    assert.equal(completedReplay.complete, true);
    assert.equal(completedReplay.replayed, true);
    await assert.rejects(begin(db, completed, "00000000-0000-4000-8000-000000009013"),
      /RESYNC_ALREADY_STARTED/u);
    await db.exec("reset role");
    const count = (await db.query(
      "select count(*)::integer count from sellerpilot_private.lazada_supplemental_read_progress",
    )).rows[0]?.count;
    assert.equal(count, 2);
  } finally { await db.close(); }
});

test("superseded late ACK, revoked permission, in-progress reset and other account parent are rejected", async () => {
  const db = await fixture();
  try {
    const first = await prepare(db);
    const completed = await acknowledge(db, first, event(credential, "REVIEW-1", "1".repeat(64)));
    const exactBeforeResync = await acknowledge(db, first, event(credential, "REVIEW-1", "1".repeat(64)));
    assert.equal(exactBeforeResync.replayed, true);
    await begin(db, completed, "00000000-0000-4000-8000-000000009014");
    await assert.rejects(acknowledge(db, first, event(credential, "REVIEW-1", "1".repeat(64))),
      /SUPERSEDED_CONTINUATION/u);
    await assert.rejects(begin(db, completed, "00000000-0000-4000-8000-000000009015"),
      /RESYNC_ALREADY_STARTED/u);
    await assert.rejects(begin(db, completed, "00000000-0000-4000-8000-000000009016", otherCredential),
      /RESYNC_PARENT_MISMATCH/u);
    await db.exec("reset role");
    await db.query("update sellerpilot_private.lazada_supplemental_read_grants set status='revoked' where credential_id=$1",
      [credential]);
    await db.exec("set role service_role");
    await assert.rejects(begin(db, completed, "00000000-0000-4000-8000-000000009017"),
      /EXACT_PERMISSION_REQUIRED/u);
    await db.exec("reset role");
    const count = (await db.query(
      "select count(*)::integer count from sellerpilot_private.lazada_supplemental_read_progress",
    )).rows[0]?.count;
    assert.equal(count, 2);
  } finally { await db.close(); }
});

test("forward SQL remains service-only and contains no scheduler or provider mutation", () => {
  assert.match(rounds, /p_actor_id[\s\S]*sellerpilot_private\.admin_users/u);
  assert.match(rounds, /where complete=false/u);
  assert.match(rounds, /LAZADA_SUPPLEMENTAL_SUPERSEDED_CONTINUATION/u);
  assert.doesNotMatch(rounds, /channel_gateway_jobs|enqueue|cron|schedule/iu);
  assert.doesNotMatch(rounds, /reply\/add|return\/update|cancel\/create|message\/send/iu);
});
