import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901085000_reconcile_qoo10_partial_manual_activation.sql",
  import.meta.url,
);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function partialObservation() {
  return {
    contract: "qoo10_seller_center_partial_readback_v1",
    profileName: "CHANGHEE",
    remoteId: "1217336970",
    sellerSku: "QA-20260823-CC-001",
    title: "貼り付け式ケーブル整理クリップ6個セット",
    promotionName: "購入前確認",
    providerStatus: "S1",
    sellerStopped: true,
    purchaseAvailable: false,
    currency: "JPY",
    priceJpy: 1871,
    quantity: 1,
    shippingNo: "806971",
    representativeImageCount: 1,
    additionalImageCount: 0,
    detailImageCount: 8,
    detailLocale: "ja-JP",
    detailJapanese: true,
    observedAt: "2026-09-01T02:40:00Z",
  };
}

function finalObservation() {
  return {
    contract: "qoo10_seller_center_manual_activation_readback_v1",
    profileName: "CHANGHEE",
    remoteId: "1217336970",
    sellerSku: "QA-20260823-CC-001",
    title: "貼り付け式ケーブル整理クリップ6個セット",
    promotionName: "購入前確認",
    providerStatus: "S2",
    sellerStatus: "selling",
    purchaseAvailable: true,
    currency: "JPY",
    priceJpy: 1871,
    quantity: 1,
    shippingNo: "806971",
    representativeImageCount: 1,
    additionalImageCount: 0,
    detailImageCount: 8,
    detailLocale: "ja-JP",
    detailJapanese: true,
    sellerCenterObserved: true,
    publicPageObserved: true,
    publicUrl: "https://www.qoo10.jp/g/1217336970",
    manualActivationCount: 1,
    manualActivationConfirmedAt: "2026-09-01T02:50:00Z",
    observedAt: "2026-09-01T02:51:00Z",
  };
}

async function validatorDatabase() {
  const db = new PGlite();
  await db.exec("create schema sellerpilot_private");
  const migration = await readFile(migrationUrl, "utf8");
  for (const signature of [
    "create function sellerpilot_private.qoo10_exact_partial_manual_observation_valid(",
    "create function sellerpilot_private.qoo10_exact_manual_activation_observation_valid(",
  ]) await db.exec(extractFunction(migration, signature));
  return db;
}

async function valid(db, functionName, observation) {
  return (await db.query(
    `select sellerpilot_private.${functionName}($1::jsonb) value`,
    [JSON.stringify(observation)],
  )).rows[0].value;
}

test("partial seller-center evidence accepts only the exact S1/non-public item", async () => {
  const db = await validatorDatabase();
  try {
    const exact = partialObservation();
    assert.equal(await valid(
      db,
      "qoo10_exact_partial_manual_observation_valid",
      exact,
    ), true);
    for (const [name, mutate] of [
      ["wrong profile", (value) => { value.profileName = "JEONGHUN"; }],
      ["wrong item", (value) => { value.remoteId = "1217336971"; }],
      ["wrong title", (value) => { value.title += " "; }],
      ["wrong price", (value) => { value.priceJpy = 1872; }],
      ["wrong stock", (value) => { value.quantity = 2; }],
      ["not stopped", (value) => { value.sellerStopped = false; }],
      ["purchase open", (value) => { value.purchaseAvailable = true; }],
      ["missing image", (value) => { value.detailImageCount = 7; }],
      ["extra field", (value) => { value.untrusted = true; }],
    ]) {
      const changed = structuredClone(exact);
      mutate(changed);
      assert.equal(await valid(
        db,
        "qoo10_exact_partial_manual_observation_valid",
        changed,
      ), false, name);
    }
  } finally {
    await db.close();
  }
});

test("manual completion requires exact S2, one action, and both seller/public readbacks", async () => {
  const db = await validatorDatabase();
  try {
    const exact = finalObservation();
    assert.equal(await valid(
      db,
      "qoo10_exact_manual_activation_observation_valid",
      exact,
    ), true);
    for (const [name, mutate] of [
      ["S1", (value) => { value.providerStatus = "S1"; }],
      ["two actions", (value) => { value.manualActivationCount = 2; }],
      ["no seller readback", (value) => { value.sellerCenterObserved = false; }],
      ["no public readback", (value) => { value.publicPageObserved = false; }],
      ["not purchasable", (value) => { value.purchaseAvailable = false; }],
      ["wrong public URL", (value) => { value.publicUrl += "?other=1"; }],
      ["wrong shipping", (value) => { value.shippingNo = "0"; }],
    ]) {
      const changed = structuredClone(exact);
      mutate(changed);
      assert.equal(await valid(
        db,
        "qoo10_exact_manual_activation_observation_valid",
        changed,
      ), false, name);
    }
  } finally {
    await db.close();
  }
});

test("the three inert later activation jobs are exact and any fourth or provider boundary fails closed", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid not null,
        created_at timestamptz not null,
        operation text not null,
        status text not null,
        attempt_count integer not null,
        provider_mutation_started_at timestamptz,
        completed_at timestamptz
      );
      insert into sellerpilot_private.channel_gateway_jobs values
        ('fac9c5c4-940d-4600-88f3-8f97a069dfbf',
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','2026-08-30T22:00:00Z',
         'listing.update','reconciliation_required',1,'2026-08-30T22:01:00Z',
         '2026-08-30T22:02:00Z'),
        ('81000000-0000-4000-8000-000000000001',
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','2026-08-30T23:00:00Z',
         'listing.activate','failed',0,null,'2026-08-30T23:01:00Z'),
        ('81000000-0000-4000-8000-000000000002',
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','2026-08-30T23:02:00Z',
         'listing.activate','failed',0,null,'2026-08-30T23:03:00Z'),
        ('81000000-0000-4000-8000-000000000003',
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','2026-08-30T23:04:00Z',
         'listing.activate','failed',1,null,'2026-08-30T23:05:00Z');
    `);
    const migration = await readFile(migrationUrl, "utf8");
    for (const signature of [
      "create function sellerpilot_private.qoo10_exact_partial_manual_later_jobs(",
      "create function sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid(",
    ]) await db.exec(extractFunction(migration, signature));
    const sourceId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
    const snapshot = (await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs($1) value",
      [sourceId],
    )).rows[0].value;
    assert.equal(snapshot.length, 3);
    assert.equal((await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid($1,$2::jsonb) value",
      [sourceId, JSON.stringify(snapshot)],
    )).rows[0].value, true);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at='2026-08-30T23:04:30Z'
       where id='81000000-0000-4000-8000-000000000003'
    `);
    const changed = (await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs($1) value",
      [sourceId],
    )).rows[0].value;
    assert.equal((await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid($1,$2::jsonb) value",
      [sourceId, JSON.stringify(changed)],
    )).rows[0].value, false);

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=null
       where id='81000000-0000-4000-8000-000000000003';
      insert into sellerpilot_private.channel_gateway_jobs values
        ('81000000-0000-4000-8000-000000000004',
         '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','2026-08-30T23:06:00Z',
         'listing.activate','failed',0,null,'2026-08-30T23:07:00Z');
    `);
    const fourth = (await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs($1) value",
      [sourceId],
    )).rows[0].value;
    assert.equal((await db.query(
      "select sellerpilot_private.qoo10_exact_partial_manual_later_jobs_valid($1,$2::jsonb) value",
      [sourceId, JSON.stringify(fourth)],
    )).rows[0].value, false);
  } finally {
    await db.close();
  }
});

test("listing projection accepts only the append-only partial then final evidence sequence", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.qoo10_exact_partial_manual_reconciliations (
        source_job_id uuid primary key,
        partial_observed_at timestamptz not null
      );
      create table sellerpilot_private.qoo10_exact_manual_activation_outcomes (
        source_job_id uuid primary key,
        manual_activation_confirmed_at timestamptz not null,
        final_observed_at timestamptz not null,
        final_observation_sha256 text not null
      );
      insert into sellerpilot_private.qoo10_exact_partial_manual_reconciliations
      values ('fac9c5c4-940d-4600-88f3-8f97a069dfbf','2026-09-01T02:40:00Z');
    `);
    const migration = await readFile(migrationUrl, "utf8");
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.qoo10_partial_manual_listing_update_allowed(",
    ));
    const oldListing = {
      id: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
      owner_id: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
      product_id: "ddccde35-9c58-4856-b673-d7aa27ce4220",
      channel_key: "qoo10",
      market: "JP",
      target_id: "",
      remote_id: "1217336970",
      requested_publication_intent: "live",
      operation_attempt_id: "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
      seller_account_key: "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46",
      status: "failed",
      failure_class: "external_action",
      remote_visibility: "unknown",
      provider_status: null,
      remote_resources: {},
      published_at: null,
      last_verified_at: null,
      last_error: "uncertain",
      updated_at: "2026-09-01T02:30:00+00:00",
    };
    const partial = {
      ...oldListing,
      remote_visibility: "non_public",
      provider_status: "S1",
      last_verified_at: "2026-09-01T02:40:00+00:00",
      last_error: "Qoo10 부분 반영 확인 · 판매자센터 수동 판매재개 및 최종 공개 검증 필요",
      updated_at: "2026-09-01T02:41:00+00:00",
    };
    const allowed = async (before, after, marker) => (await db.query(
      "select sellerpilot_private.qoo10_partial_manual_listing_update_allowed($1::jsonb,$2::jsonb,$3) value",
      [JSON.stringify(before), JSON.stringify(after), marker],
    )).rows[0].value;
    assert.equal(await allowed(
      oldListing,
      partial,
      "partial:fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    ), true);
    assert.equal(await allowed(
      { ...oldListing, remote_id: null },
      partial,
      "partial:fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    ), false);
    assert.equal(await allowed(
      partial,
      { ...partial, status: "published" },
      "final:fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    ), false, "final evidence must exist first");

    await db.query(`
      insert into sellerpilot_private.qoo10_exact_manual_activation_outcomes
      values (
        'fac9c5c4-940d-4600-88f3-8f97a069dfbf',
        '2026-09-01T02:50:00Z','2026-09-01T02:51:00Z','${"a".repeat(64)}'
      )
    `);
    const final = {
      ...partial,
      status: "published",
      remote_visibility: "live",
      provider_status: "S2",
      remote_resources: {
        resources: { itemCode: "1217336970" },
        verification: {
          contract: "qoo10_seller_center_manual_activation_readback_v1",
          verifiedAt: "2026-09-01T02:51:00+00:00",
          evidenceSha256: "a".repeat(64),
          locale: "ja-JP",
          imageCount: 8,
          purchaseAvailable: true,
          manualActivationCount: 1,
        },
      },
      published_at: "2026-09-01T02:50:00+00:00",
      last_verified_at: "2026-09-01T02:51:00+00:00",
      last_error: null,
      failure_class: null,
      updated_at: "2026-09-01T02:52:00+00:00",
    };
    assert.equal(await allowed(
      partial,
      final,
      "final:fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    ), true);
    assert.equal(await allowed(
      partial,
      { ...final, provider_status: "S1" },
      "final:fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    ), false);
  } finally {
    await db.close();
  }
});

test("partial and final reconciliation are append-only, ordered, and never enqueue or call a provider", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const exact of [
    "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "1217336970",
    "QA-20260823-CC-001",
    "c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d",
    "b2c09c6388fa048f789a8a272bf21cd3d68cf8a8caa4fc02a4e1ca1be6a6b768",
  ]) assert.match(sql, new RegExp(exact, "u"));

  const reconcile = extractFunction(
    sql,
    "create function public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(",
  );
  const finalize = extractFunction(
    sql,
    "create function public.sellerpilot_service_finalize_exact_qoo10_manual_activation(",
  );
  const atomic = extractFunction(
    sql,
    "create function public.sellerpilot_service_reconcile_exact_qoo10_post_activation(",
  );
  assert.ok(
    reconcile.indexOf("insert into sellerpilot_private.qoo10_exact_partial_manual_reconciliations")
      < reconcile.indexOf("update sellerpilot_private.channel_gateway_jobs source"),
  );
  assert.ok(
    finalize.indexOf("insert into sellerpilot_private.qoo10_exact_manual_activation_outcomes")
      < finalize.indexOf("update sellerpilot_private.product_listings listing"),
  );
  assert.match(reconcile, /jsonb_array_length\(v_source\.response_payload->'steps'\)<>3/u);
  assert.match(reconcile, /qoo10_exact_no_effect_snapshot[\s\S]*is not null/u);
  assert.match(reconcile, /qoo10_exact_partial_manual_later_jobs_valid/u);
  assert.match(finalize, /v_later_jobs is distinct from v_partial\.later_jobs/u);
  assert.match(finalize, /manualActivationCount/u);
  assert.match(sql, /before update or delete[\s\S]*qoo10_exact_partial_manual_reconciliations/u);
  assert.match(sql, /before update or delete[\s\S]*qoo10_exact_manual_activation_outcomes/u);
  assert.doesNotMatch(reconcile, /insert into sellerpilot_private\.channel_gateway_jobs/u);
  assert.doesNotMatch(finalize, /insert into sellerpilot_private\.channel_gateway_jobs/u);
  assert.ok(
    atomic.indexOf("sellerpilot_service_reconcile_exact_qoo10_partial_manual")
      < atomic.indexOf("sellerpilot_service_finalize_exact_qoo10_manual_activation"),
  );
  assert.match(atomic, /v_manual_activation_confirmed_at<v_partial_observed_at/u);
  assert.match(atomic, /externalWriteCount',0/u);
  assert.doesNotMatch(atomic, /insert into sellerpilot_private\.channel_gateway_jobs/u);
  const grantBlock = sql.slice(
    sql.indexOf("grant execute on function"),
    sql.indexOf("do $qoo10_partial_manual_postimage$"),
  );
  assert.match(grantBlock, /sellerpilot_service_reconcile_exact_qoo10_post_activation/u);
  assert.doesNotMatch(grantBlock, /sellerpilot_service_reconcile_exact_qoo10_partial_manual/u);
  assert.doesNotMatch(grantBlock, /sellerpilot_service_finalize_exact_qoo10_manual_activation/u);
  assert.doesNotMatch(sql, /ItemsBasic\.UpdateGoods|ItemsOrder\.SetNewGoods|fetch\(/u);
});

test("post-activation reconciliation records both phases atomically and rolls back either phase on failure", async () => {
  const db = await validatorDatabase();
  try {
    const migration = await readFile(migrationUrl, "utf8");
    await db.exec(`
      create table public.reconciliation_phases (
        sequence_id bigint generated always as identity primary key,
        phase text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        status text not null
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key,
        status text not null
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        status text not null,
        failure_class text,
        remote_visibility text not null,
        provider_status text,
        remote_id text not null
      );
      create table sellerpilot_private.qoo10_exact_partial_manual_reconciliations (
        source_job_id uuid primary key,
        source_attempt_id uuid not null,
        listing_id uuid not null,
        partial_observation jsonb not null,
        provider_call_replayed boolean not null
      );
      create table sellerpilot_private.qoo10_exact_manual_activation_outcomes (
        source_job_id uuid primary key,
        final_observation jsonb not null,
        provider_call_replayed boolean not null
      );
      insert into sellerpilot_private.channel_gateway_jobs values
        ('fac9c5c4-940d-4600-88f3-8f97a069dfbf','reconciliation_required');
      insert into sellerpilot_private.channel_operation_attempts values
        ('4402cc76-295b-4e17-8c07-d5d0e9967ce9','manual_required');
      insert into sellerpilot_private.product_listings values
        ('4e5b97be-3fe5-4537-9e26-d36fb36ec1fc','failed',
         'external_action','unknown',null,'1217336970');
      create function sellerpilot_private.qoo10_exact_s1_release_is_current(text)
      returns boolean language sql stable as $$ select true $$;
      create function public.sellerpilot_service_reconcile_exact_qoo10_partial_manual(
        p_source_job_id uuid,p_release_sha text,p_observation jsonb
      ) returns jsonb language plpgsql as $$
      begin
        insert into public.reconciliation_phases(phase) values ('partial');
        insert into sellerpilot_private.qoo10_exact_partial_manual_reconciliations
          values (
            p_source_job_id,'4402cc76-295b-4e17-8c07-d5d0e9967ce9',
            '4e5b97be-3fe5-4537-9e26-d36fb36ec1fc',p_observation,false
          );
        return jsonb_build_object('phase','partial');
      end;
      $$;
      create function public.sellerpilot_service_finalize_exact_qoo10_manual_activation(
        p_source_job_id uuid,p_release_sha text,p_observation jsonb
      ) returns jsonb language plpgsql as $$
      begin
        insert into public.reconciliation_phases(phase) values ('final');
        insert into sellerpilot_private.qoo10_exact_manual_activation_outcomes
          values (p_source_job_id,p_observation,false);
        update sellerpilot_private.channel_gateway_jobs set status='failed';
        update sellerpilot_private.channel_operation_attempts set status='failed';
        update sellerpilot_private.product_listings
           set status='published',failure_class=null,remote_visibility='live',
               provider_status='S2';
        return jsonb_build_object('phase','final');
      end;
      $$;
    `);
    await db.exec(extractFunction(
      migration,
      "create function public.sellerpilot_service_reconcile_exact_qoo10_post_activation(",
    ));

    const args = [
      "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
      "a".repeat(40),
      JSON.stringify(partialObservation()),
      JSON.stringify(finalObservation()),
    ];
    const result = (await db.query(
      `select public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
        $1,$2,$3::jsonb,$4::jsonb
      ) value`,
      args,
    )).rows[0].value;
    assert.equal(result.contract, "qoo10_post_activation_atomic_reconciliation_v1");
    assert.equal(result.providerCallReplayed, false);
    assert.equal(result.externalWriteCount, 0);
    assert.equal(result.reused, false);
    assert.deepEqual(
      (await db.query("select phase from public.reconciliation_phases order by sequence_id")).rows,
      [{ phase: "partial" }, { phase: "final" }],
    );

    const replay = (await db.query(
      `select public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
        $1,$2,$3::jsonb,$4::jsonb
      ) value`,
      args,
    )).rows[0].value;
    assert.equal(replay.reused, true);
    assert.equal(replay.externalWriteCount, 0);
    assert.equal((await db.query("select count(*)::int count from public.reconciliation_phases")).rows[0].count, 2);

    const conflictingFinal = finalObservation();
    conflictingFinal.observedAt = "2026-09-01T02:52:00Z";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
          $1,$2,$3::jsonb,$4::jsonb
        )`,
        [args[0], args[1], args[2], JSON.stringify(conflictingFinal)],
      ),
      /replay conflict/u,
    );
    assert.equal((await db.query("select count(*)::int count from public.reconciliation_phases")).rows[0].count, 2);

    await db.exec(`
      truncate public.reconciliation_phases restart identity;
      truncate sellerpilot_private.qoo10_exact_manual_activation_outcomes;
      truncate sellerpilot_private.qoo10_exact_partial_manual_reconciliations;
      update sellerpilot_private.channel_gateway_jobs
         set status='reconciliation_required';
      update sellerpilot_private.channel_operation_attempts
         set status='manual_required';
      update sellerpilot_private.product_listings
         set status='failed',failure_class='external_action',
             remote_visibility='unknown',provider_status=null;
    `);
    const invalidFinal = finalObservation();
    invalidFinal.manualActivationConfirmedAt = "2026-09-01T02:39:59Z";
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
          $1,$2,$3::jsonb,$4::jsonb
        )`,
        [args[0], args[1], args[2], JSON.stringify(invalidFinal)],
      ),
      /evidence order invalid/u,
    );
    assert.equal((await db.query("select count(*)::int count from public.reconciliation_phases")).rows[0].count, 0);

    await db.exec(`
      create or replace function public.sellerpilot_service_finalize_exact_qoo10_manual_activation(
        p_source_job_id uuid,p_release_sha text,p_observation jsonb
      ) returns jsonb language plpgsql as $$
      begin
        insert into public.reconciliation_phases(phase) values ('final');
        raise exception 'synthetic final failure';
      end;
      $$;
    `);
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_reconcile_exact_qoo10_post_activation(
          $1,$2,$3::jsonb,$4::jsonb
        )`,
        args,
      ),
      /synthetic final failure/u,
    );
    assert.equal((await db.query("select count(*)::int count from public.reconciliation_phases")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
