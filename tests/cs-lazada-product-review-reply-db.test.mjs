import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260910061000_cs_lazada_product_review_reply.sql", import.meta.url,
), "utf8");
const uiMigration = await readFile(new URL(
  "../supabase/migrations/20260910064500_cs_lazada_product_review_reply_ui.sql", import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000009201";
const credential = "00000000-0000-4000-8000-000000009202";
const otherCredential = "00000000-0000-4000-8000-000000009203";
const binding = "00000000-0000-4000-8000-000000009204";
const otherBinding = "00000000-0000-4000-8000-000000009205";
const workerId = "00000000-0000-4000-8000-000000009206";
const workerHash = "e".repeat(64);
const seller = "a".repeat(64);
const otherSeller = "b".repeat(64);
const eventKey = "c".repeat(64);
const observedAt = "2026-09-09T22:00:00.000Z";
const generation = Date.parse(observedAt);

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select true$$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql as $$begin
        update sellerpilot_private.channel_gateway_jobs job set provider_mutation_started_at=clock_timestamp()
          where job.id=$2 and job.claim_token=$3 and job.status='running'
            and job.lease_expires_at>clock_timestamp() and exists(
              select 1 from sellerpilot_private.ai_cli_worker_tokens token
               where token.id=job.worker_token_id and token.token_hash=$1
                 and token.scope='gateway' and token.status='active' and token.expires_at>clock_timestamp());
        return found; end$$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql as $$begin
        update sellerpilot_private.channel_gateway_jobs job set provider_mutation_started_at=clock_timestamp()
          where job.id=$2 and job.claim_token=$3 and job.status='running'
            and job.lease_expires_at>clock_timestamp() and exists(
              select 1 from sellerpilot_private.ai_cli_worker_tokens token
               where token.id=job.worker_token_id and token.token_hash=$1
                 and token.scope='gateway' and token.status='active' and token.expires_at>clock_timestamp());
        return found; end$$;
    create function public.sellerpilot_09100000_begin_gateway_mutation_unsafe(text,uuid,uuid)
      returns boolean language plpgsql as $$begin
        update sellerpilot_private.channel_gateway_jobs job set provider_mutation_started_at=clock_timestamp()
          where job.id=$2 and job.claim_token=$3 and job.status='running'
            and job.lease_expires_at>clock_timestamp() and exists(
              select 1 from sellerpilot_private.ai_cli_worker_tokens token
               where token.id=job.worker_token_id and token.token_hash=$1
                 and token.scope='gateway' and token.status='active' and token.expires_at>clock_timestamp());
        return found; end$$;
    create function public.sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe(text,uuid,uuid)
      returns boolean language plpgsql as $$begin
        update sellerpilot_private.channel_gateway_jobs job set provider_mutation_started_at=clock_timestamp()
          where job.id=$2 and job.claim_token=$3 and job.status='running'
            and job.lease_expires_at>clock_timestamp() and exists(
              select 1 from sellerpilot_private.ai_cli_worker_tokens token
               where token.id=job.worker_token_id and token.token_hash=$1
                 and token.scope='gateway' and token.status='active' and token.expires_at>clock_timestamp());
        return found; end$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,status text not null,expires_at timestamptz,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,country text not null,status text not null,expires_at timestamptz
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,environment text not null,request_payload jsonb not null,
      response_payload jsonb,status text not null default 'queued',error_message text,created_by uuid not null,
      seller_account_key text,provider_mutation_started_at timestamptz,
      worker_token_id uuid,claim_token uuid,lease_expires_at timestamptz
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key,claim_token uuid not null,worker_token_id uuid not null,
      completion_fingerprint text not null,continuation_job_id uuid
    );
    create table sellerpilot_private.lazada_supplemental_cs_events(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null,credential_id uuid not null,
      seller_account_key text not null,country text not null,surface text not null,source_path text not null,
      resource_key text not null,event_key text not null,status text not null,title text not null,body text,
      external_order_id text,external_item_id text,rating integer,occurred_at timestamptz not null,
      observed_at timestamptz not null,provider_context jsonb not null
    );
  `);
  await db.exec(migration);
  await db.exec(uiMigration);
  await db.query("insert into auth.users values($1)", [owner]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'gateway','active',clock_timestamp()+interval '1 day')",
    [workerId, workerHash]);
  for (const [id, account] of [[credential, seller], [otherCredential, otherSeller]]) {
    await db.query(`insert into sellerpilot_private.channel_credentials values(
      $1,$2,'lazada','production','active',clock_timestamp()+interval '1 day',$3,
      'provider_certified_v1',clock_timestamp())`, [id, owner, account]);
  }
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values
    ($1,$2,'lazada','inquiries.reply','MY','active',clock_timestamp()+interval '1 day'),
    ($3,$4,'lazada','inquiries.reply','MY','active',clock_timestamp()+interval '1 day')`,
  [binding, credential, otherBinding, otherCredential]);
  await db.query(`insert into sellerpilot_private.lazada_supplemental_cs_events(
    owner_id,credential_id,seller_account_key,country,surface,source_path,resource_key,event_key,
    status,title,body,external_item_id,rating,occurred_at,observed_at,provider_context
  ) values($1,$2,$3,'MY','product_review','/review/seller/list','11111111111',$4,
    'published','상품 리뷰 · 평점 5','review','22222222222',5,$5,$6,$7::jsonb)`, [
    owner, credential, seller, eventKey, "2026-09-09T21:00:00.000Z", observedAt,
    JSON.stringify({ reviewId: "11111111111", itemId: "22222222222", reviewType: "PRODUCT_REVIEW" }),
  ]);
  return db;
}

test("admin UI capability is pending until the exact credential-country grant is active", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    const pending = (await db.query(`select public.sellerpilot_get_lazada_product_review_reply_capability_v1(
      $1,'MY') value`, [credential])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(pending.permissionState, "permission_pending");
    assert.equal(pending.automaticReplyEnabled, false);
    await grant(db);
    await db.exec("set role authenticated");
    const authorized = (await db.query(`select public.sellerpilot_get_lazada_product_review_reply_capability_v1(
      $1,'MY') value`, [credential])).rows[0]?.value;
    const wrongAccount = (await db.query(`select public.sellerpilot_get_lazada_product_review_reply_capability_v1(
      $1,'MY') value`, [otherCredential])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(authorized.permissionState, "authorized");
    assert.equal(wrongAccount.permissionState, "permission_pending");
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});

function evidence(credentialId, account, suffix) {
  return {
    contract: "sellerpilot-lazada-product-review-reply-permission/1",
    verificationSource: "lazada_app_permission_readback",
    credentialId, sellerAccountKey: account, country: "MY",
    replyPath: "/review/seller/reply/add", readbackPath: "/review/seller/list/v2",
    replyProviderRequestId: `reply-permission-${suffix}`,
    readbackProviderRequestId: `read-permission-${suffix}`,
    evidenceDigest: suffix.repeat(64),
  };
}

async function grant(db, bindingId = binding, input = evidence(credential, seller, "d")) {
  await db.exec("set role service_role");
  const value = (await db.query(`select public.sellerpilot_service_record_lazada_product_review_reply_grant_v1(
    $1,$2::jsonb) value`, [bindingId, JSON.stringify(input)])).rows[0]?.value;
  await db.exec("reset role");
  return value;
}

async function prepare(db, reply = "Thank you for your review.", credentialId = credential) {
  await db.exec("set role authenticated");
  try {
    return (await db.query(`select public.sellerpilot_prepare_lazada_product_review_reply_v1(
      $1,'MY','11111111111',$2,$3) value`, [credentialId, generation, reply])).rows[0]?.value;
  } finally { await db.exec("reset role"); }
}

test("missing exact reply/readback permission and cross-account review both fail closed", async () => {
  const db = await fixture();
  try {
    await assert.rejects(prepare(db), /PERMISSION_REQUIRED/u);
    await grant(db, otherBinding, evidence(otherCredential, otherSeller, "e"));
    await assert.rejects(prepare(db, "Thank you for your review.", otherCredential), /REVIEW_ACCOUNT_MISMATCH/u);
  } finally { await db.close(); }
});

test("prepare and enqueue replay exactly while a different body is blocked", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    assert.equal(prepared.status, "prepared");
    await db.exec("set role authenticated");
    const first = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1(
      $1,$2) value`, [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    const replay = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1(
      $1,$2) value`, [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(first.jobId, replay.jobId);
    assert.equal(replay.replayed, true);
    assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.channel_gateway_jobs")).rows[0]?.count, 1);
    await assert.rejects(prepare(db, "Different reply"), /REPLY_CONFLICT/u);
  } finally { await db.close(); }
});

test("ambiguous response cannot resend and readback-only recovery verifies the same lineage", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1(
      $1,$2) value`, [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',
      provider_mutation_started_at=clock_timestamp() where id=$1`, [queued.jobId]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required',
      error_message='synthetic response loss' where id=$1`, [queued.jobId]);
    assert.equal((await db.query(`select status from sellerpilot_private.lazada_product_review_reply_deliveries
      where id=$1`, [prepared.deliveryId])).rows[0]?.status, "readback_required");

    await db.exec("set role authenticated");
    const readback = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_readback_v1($1) value`,
      [prepared.deliveryId])).rows[0]?.value;
    await db.exec("reset role");
    const request = (await db.query("select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
      [readback.jobId])).rows[0]?.request_payload;
    assert.equal(request.arguments.kind, "product_review_readback");
    assert.equal(request.sellerpilotLazadaProductReviewReply.readbackOnly, true);
    assert.notEqual(readback.jobId, queued.jobId);

    const receipt = {
      ok: true,
      steps: [{ data: { sellerpilotLazadaProductReviewReadback: {
        contract: "sellerpilot-lazada-product-review-reply-readback/1",
        deliveryId: prepared.deliveryId,
        country: "MY",
        reviewId: "11111111111",
        generation,
        identityFingerprint: prepared.identityFingerprint,
        state: "verified", exactReplyObserved: true,
      } } }],
    };
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='succeeded',response_payload=$2::jsonb
      where id=$1`, [readback.jobId, JSON.stringify(receipt)]);
    const status = (await db.query(`select status,reply_observed_at is not null observed
      from sellerpilot_private.lazada_product_review_reply_deliveries where id=$1`, [prepared.deliveryId])).rows[0];
    assert.deepEqual(status, { status: "verified", observed: true });
    await db.exec("set role authenticated");
    const replay = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1(
      $1,$2) value`, [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(replay.status, "verified");
    assert.equal(replay.automaticResendAllowed, false);
    assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.channel_gateway_jobs")).rows[0]?.count, 2);
  } finally { await db.close(); }
});

test("canonical SQL keeps review replies outside IM and reverse-order mutations", () => {
  assert.match(migration, /'\/review\/seller\/reply\/add'/u);
  assert.match(migration, /'\/review\/seller\/list\/v2'/u);
  assert.doesNotMatch(migration, /\/im\/message\/send|\/order\/reverse\/return\/update|\/order\/reverse\/cancel\/create/u);
  assert.match(migration, /automaticResendAllowed',false/u);
});

test("revoked permission and changed review generation both block enqueue", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("update sellerpilot_private.lazada_product_review_reply_grants set status='revoked'");
    await db.exec("set role authenticated");
    await assert.rejects(db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2)`,
      [prepared.deliveryId, prepared.identityFingerprint]), /PERMISSION_REVOKED/u);
    await db.exec("reset role");

    await db.exec("update sellerpilot_private.lazada_product_review_reply_grants set status='active'");
    await db.exec("update sellerpilot_private.lazada_supplemental_cs_events set observed_at=observed_at+interval '1 second'");
    await db.exec("set role authenticated");
    await assert.rejects(db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2)`,
      [prepared.deliveryId, prepared.identityFingerprint]), /GENERATION_STALE/u);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});

test("only the exact delivery job with an exact receipt can verify", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2) value`,
      [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    const unrelated = (await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      credential_id,channel,operation,environment,request_payload,created_by,seller_account_key)
      select credential_id,channel,operation,environment,request_payload,created_by,seller_account_key
      from sellerpilot_private.channel_gateway_jobs where id=$1 returning id`, [queued.jobId])).rows[0]?.id;
    const wrongReceipt = { ok: true, steps: [{ data: { sellerpilotLazadaProductReviewReadback: {
      contract: "sellerpilot-lazada-product-review-reply-readback/1", deliveryId: prepared.deliveryId,
      country: "SG", reviewId: "99999999999", generation: 1,
      identityFingerprint: prepared.identityFingerprint, state: "verified", exactReplyObserved: true,
    } } }] };
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='succeeded',response_payload=$2::jsonb
      where id=$1`, [unrelated, JSON.stringify(wrongReceipt)]);
    assert.notEqual((await db.query(`select status from sellerpilot_private.lazada_product_review_reply_deliveries
      where id=$1`, [prepared.deliveryId])).rows[0]?.status, "verified");
  } finally { await db.close(); }
});

test("claim transition and both provider mutation entrypoints revalidate the canonical delivery", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2) value`,
      [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");

    const claimToken = "00000000-0000-4000-8000-000000009299";
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
      claim_token=$3,lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1`,
    [queued.jobId, workerId, claimToken]);
    await db.exec("update sellerpilot_private.lazada_product_review_reply_grants set status='revoked'");
    await db.exec("set role service_role");
    await assert.rejects(db.query(`select public.sellerpilot_service_begin_gateway_provider_mutation(
      $2,$1,$3)`, [queued.jobId, workerHash, claimToken]), /PERMISSION_REVOKED/u);
    await assert.rejects(db.query(`select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      $2,$1,$3)`, [queued.jobId, workerHash, claimToken]), /PERMISSION_REVOKED/u);
    await db.exec("reset role");
    assert.equal((await db.query(`select provider_mutation_started_at is null untouched
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [queued.jobId])).rows[0]?.untouched, true);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});

test("claim transition rejects a generation changed after enqueue", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2) value`,
      [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    await db.exec("update sellerpilot_private.lazada_supplemental_cs_events set observed_at=observed_at+interval '1 second'");
    await assert.rejects(db.query("update sellerpilot_private.channel_gateway_jobs set status='running' where id=$1",
      [queued.jobId]), /GENERATION_STALE/u);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [queued.jobId])).rows[0]?.status, "queued");
  } finally { await db.close(); }
});

for (const beginRpc of [
  "sellerpilot_service_begin_gateway_provider_mutation",
  "sellerpilot_service_begin_serverless_gateway_provider_mutation",
]) test(`${beginRpc} executes only the exact claimed review job`, async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2) value`,
      [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    const claimToken = "00000000-0000-4000-8000-000000009298";
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$2,
      claim_token=$3,lease_expires_at=clock_timestamp()+interval '1 hour' where id=$1`,
    [queued.jobId, workerId, claimToken]);
    await db.exec("set role service_role");
    const begun = (await db.query(`select public.${beginRpc}($1,$2,$3) value`,
      [workerHash, queued.jobId, claimToken])).rows[0]?.value;
    await db.exec("reset role");
    assert.equal(begun, true);
    assert.equal((await db.query(`select provider_mutation_started_at is not null started
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [queued.jobId])).rows[0]?.started, true);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});

test("ambiguous prior delivery remains readback-observable after a newer review generation", async () => {
  const db = await fixture();
  try {
    await grant(db);
    const prepared = await prepare(db);
    await db.exec("set role authenticated");
    const queued = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_reply_v1($1,$2) value`,
      [prepared.deliveryId, prepared.identityFingerprint])).rows[0]?.value;
    await db.exec("reset role");
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',
      provider_mutation_started_at=clock_timestamp() where id=$1`, [queued.jobId]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required'
      where id=$1`, [queued.jobId]);
    await db.exec("update sellerpilot_private.lazada_supplemental_cs_events set observed_at=observed_at+interval '1 second'");
    await db.exec("set role authenticated");
    const readback = (await db.query(`select public.sellerpilot_enqueue_lazada_product_review_readback_v1($1) value`,
      [prepared.deliveryId])).rows[0]?.value;
    assert.equal(readback.readbackOnly, true);
    assert.equal(readback.providerMutationPerformed, false);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});
