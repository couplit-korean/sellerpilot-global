import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";

const canonical = await readFile(new URL(
  "../supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql", import.meta.url,
), "utf8");
const boundary = await readFile(new URL(
  "../supabase/migrations/20260909181000_cs_lazada_supplemental_provider_ingest.sql", import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000008101";
const credential = "00000000-0000-4000-8000-000000008102";
const binding = "00000000-0000-4000-8000-000000008103";
const seller = "a".repeat(64);

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
  await db.query("insert into auth.users values($1)", [owner]);
  await db.query(`insert into sellerpilot_private.channel_credentials values(
    $1,$2,'lazada','production','active',clock_timestamp()+interval '1 day',$3,
    'provider_certified_v1',clock_timestamp())`, [credential, owner, seller]);
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values(
    $1,$2,'lazada','inquiries.list','MY',$3,'active',clock_timestamp()+interval '1 day')`,
  [binding, credential, seller]);
  return db;
}

const grantEvidence = {
  contractVersion: "sellerpilot-lazada-supplemental-permission-readback/1",
  verificationSource: "lazada_app_permission_readback",
  providerRequestId: "permission-readback-request-1",
  providerEvidenceDigest: "b".repeat(64),
  bindingTargetFingerprint: seller,
  credentialId: credential,
  sellerAccountKey: seller,
  country: "MY",
  surface: "product_review",
  sourcePath: "/review/seller/list",
};

function reviewRow(id: string) {
  return {
    credentialId: credential,
    country: "MY",
    surface: "product_review",
    sourcePath: "/review/seller/list",
    resourceKey: id,
    eventKey: id === "REVIEW-1" ? "c".repeat(64) : "d".repeat(64),
    status: "published",
    title: "상품 리뷰 · 평점 5",
    body: "provider page",
    externalOrderId: "ORDER-1",
    externalItemId: "1001",
    rating: 5,
    occurredAt: "2026-09-09T18:00:00.000Z",
    observedAt: "2026-09-09T18:20:00.000Z",
    providerContext: { reviewId: id, itemId: "1001" },
  };
}

function pagination(pageNumber: number, hasMore: boolean) {
  return {
    contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
    kind: "provider_page",
    pageNumber,
    pageSize: 1,
    total: 2,
    entryCount: 1,
    hasMore,
    nextPage: hasMore ? pageNumber + 1 : null,
  };
}

async function prepare(db: PGlite) {
  return (await db.query(`select public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
    $1,'MY','/review/seller/list','1001',1) value`, [credential])).rows[0]?.value;
}

async function acknowledge(db: PGlite, prepared: Record<string, unknown>, row: unknown, page: number, hasMore: boolean) {
  return (await db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
    $1,$2,$3,'MY','product_review','/review/seller/list','1001',$4,1,$5::jsonb,$6::jsonb
  ) value`, [
    prepared.continuationId, prepared.revision, credential, page,
    JSON.stringify([row]), JSON.stringify(pagination(page, hasMore)),
  ])).rows[0]?.value;
}

test("generic IM/list binding alone is insufficient and grant recording remains service-only", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    await assert.rejects(prepare(db), /LAZADA_SUPPLEMENTAL_EXACT_PERMISSION_REQUIRED/u);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify(grantEvidence)]), /permission denied|service role required/u);
    await db.exec("reset role; set role service_role");
    const grant = (await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb) value`, [binding, JSON.stringify(grantEvidence)])).rows[0]?.value;
    assert.equal(grant.surface, "product_review");
    assert.equal(grant.readOnly, true);
    const issued = await prepare(db);
    assert.equal(issued.pageNumber, 1);
    assert.equal(issued.sellerAccountKey, seller);
  } finally { await db.close(); }
});

test("actual Lazada binding generator target and provider-certified seller key remain separately bound", async () => {
  const db = await fixture();
  try {
    const subject = `lazada:v1:${"A".repeat(40)}`;
    const sellerKey = createHash("sha256")
      .update(["lazada", "production", subject].join("\u001f"), "utf8").digest("hex");
    const generated = csCredentialBindingEvidence({
      channel: "lazada",
      operation: "inquiries.list",
      credential: {
        app_key: "actual-app",
        app_secret: "actual-secret",
        access_token: "actual-token",
        country: "MY",
        provider_account_subject: subject,
      },
      request: { arguments: {} },
    });
    assert.ok(generated);
    const target = generated.targetFingerprints[0];
    assert.notEqual(target, sellerKey);
    await db.query("update sellerpilot_private.channel_credentials set seller_account_key=$1 where id=$2",
      [sellerKey, credential]);
    await db.query("update sellerpilot_private.cs_credential_capability_bindings set target_fingerprint=$1 where id=$2",
      [target, binding]);
    await db.exec("set role service_role");
    const grant = (await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb) value`, [binding, JSON.stringify({
      ...grantEvidence,
      sellerAccountKey: sellerKey,
      bindingTargetFingerprint: target,
    })])).rows[0]?.value;
    assert.equal(grant.status, "active");
    const issued = await prepare(db);
    assert.equal(issued.sellerAccountKey, sellerKey);
  } finally { await db.close(); }
});

test("writer failure does not advance, exact replay is idempotent, and next page is durable", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify(grantEvidence)]);
    const first = await prepare(db);
    const malformed = { ...pagination(1, true) } as Record<string, unknown>;
    delete malformed.nextPage;
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
      $1,0,$2,'MY','product_review','/review/seller/list','1001',1,1,$3::jsonb,$4::jsonb
    )`, [first.continuationId, credential, JSON.stringify([reviewRow("REVIEW-1")]), JSON.stringify(malformed)]),
    /LAZADA_SUPPLEMENTAL_PAGE_ACK_INVALID/u);
    await assert.rejects(acknowledge(db, first, { ...reviewRow("REVIEW-1"), eventKey: "bad" }, 1, true),
      /LAZADA_SUPPLEMENTAL_ROW_INVALID/u);
    await db.exec("reset role");
    const unchanged = (await db.query(`select revision,next_page,complete
      from sellerpilot_private.lazada_supplemental_read_progress where continuation_id=$1`,
    [first.continuationId])).rows[0];
    assert.deepEqual(unchanged, { revision: 0, next_page: 1, complete: false });

    await db.exec("set role service_role");
    const accepted = await acknowledge(db, first, reviewRow("REVIEW-1"), 1, true);
    assert.equal(accepted.complete, false);
    assert.equal(accepted.nextPage, 2);
    assert.equal(accepted.replayed, false);
    const replay = await acknowledge(db, first, reviewRow("REVIEW-1"), 1, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.revision, 1);
    await db.exec("reset role");
    const countAfterReplay = (await db.query(
      "select count(*)::integer count from sellerpilot_private.lazada_supplemental_cs_events",
    )).rows[0]?.count;
    assert.equal(countAfterReplay, 1);

    await db.exec("set role service_role");
    const second = await prepare(db);
    assert.equal(second.pageNumber, 2);
    assert.equal(second.revision, 1);
    const completed = await acknowledge(db, second, reviewRow("REVIEW-2"), 2, false);
    assert.equal(completed.complete, true);
    assert.equal(completed.nextPage, null);
    await db.exec("reset role");
    const progress = (await db.query(`select revision,next_page,complete,last_page_number
      from sellerpilot_private.lazada_supplemental_read_progress where continuation_id=$1`,
    [first.continuationId])).rows[0];
    assert.deepEqual(progress, { revision: 2, next_page: 2, complete: true, last_page_number: 2 });
    await db.exec("set role service_role");
    await assert.rejects(prepare(db), /LAZADA_SUPPLEMENTAL_READ_ALREADY_COMPLETE/u);
  } finally { await db.close(); }
});

test("single-page reverse detail can atomically ingest more rows than its unused page-size input", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const evidence = {
      ...grantEvidence,
      surface: "reverse_order_after_sales",
      sourcePath: "/order/reverse/return/detail/list",
      providerRequestId: "permission-readback-request-2",
      providerEvidenceDigest: "e".repeat(64),
    };
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify(evidence)]);
    const issued = (await db.query(`select public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
      $1,'MY','/order/reverse/return/detail/list','9001',20) value`, [credential])).rows[0]?.value;
    const rows = Array.from({ length: 21 }, (_, index) => ({
      credentialId: credential,
      country: "MY",
      surface: "reverse_order_after_sales",
      sourcePath: "/order/reverse/return/detail/list",
      resourceKey: "9001",
      eventKey: (index + 1).toString(16).padStart(64, "0"),
      status: "RETURN_INIT",
      title: "사후지원 · RETURN_INIT",
      body: null,
      externalOrderId: "8001",
      externalItemId: String(9100 + index),
      rating: null,
      occurredAt: "2026-09-09T18:00:00.000Z",
      observedAt: "2026-09-09T18:20:00.000Z",
      providerContext: { reverseOrderId: "9001", reverseOrderLineId: String(9100 + index) },
    }));
    const page = {
      contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
      kind: "single_page",
      pageNumber: 1,
      pageSize: 20,
      total: 21,
      entryCount: 21,
      hasMore: false,
      nextPage: null,
    };
    const receipt = (await db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
      $1,0,$2,'MY','reverse_order_after_sales','/order/reverse/return/detail/list','9001',1,20,
      $3::jsonb,$4::jsonb) value`, [issued.continuationId, credential, JSON.stringify(rows), JSON.stringify(page)]))
      .rows[0]?.value;
    assert.equal(receipt.complete, true);
    assert.equal(receipt.writerReceipt.inserted, 21);
  } finally { await db.close(); }
});

test("grant and continuation are exact account/country/path bindings", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    await assert.rejects(db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify({ ...grantEvidence, sellerAccountKey: "f".repeat(64) })]),
    /LAZADA_SUPPLEMENTAL_GRANT_BINDING_MISMATCH/u);
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify(grantEvidence)]);
    const first = await prepare(db);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
      $1,0,$2,'SG','product_review','/review/seller/list','1001',1,1,$3::jsonb,$4::jsonb
    )`, [first.continuationId, credential, JSON.stringify([reviewRow("REVIEW-1")]), JSON.stringify(pagination(1, true))]),
    /CONTINUATION_BINDING_MISMATCH/u);
    await db.exec("reset role");
    const progress = (await db.query(`select revision,next_page from sellerpilot_private.lazada_supplemental_read_progress
      where continuation_id=$1`, [first.continuationId])).rows[0];
    assert.deepEqual(progress, { revision: 0, next_page: 1 });
  } finally { await db.close(); }
});

test("boundary has no scheduler or provider mutation surface and calls only the canonical writer", () => {
  assert.match(boundary, /sellerpilot_service_ingest_lazada_supplemental_cs_v1\(/u);
  assert.doesNotMatch(boundary, /channel_gateway_jobs|enqueue|cron|schedule/iu);
  assert.doesNotMatch(boundary, /reply\/add|return\/update|cancel\/create|message\/send/iu);
  assert.match(boundary, /from public,anon,authenticated/u);
});
