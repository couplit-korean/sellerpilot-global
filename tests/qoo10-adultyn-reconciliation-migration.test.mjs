import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const JOB_ID = "c25d3154-4110-4a25-9659-8e56aacf1b8d";
const ATTEMPT_ID = "c19956d8-67d3-465b-90cd-a41b9123ad4e";
const LISTING_ID = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const SOURCE_JOB_ID = "0bc5ff1f-c884-4615-8a79-4688da46af6a";
const SOURCE_ATTEMPT_ID = "05e1959d-d7d8-4389-b7de-7335d28e4f91";
const BASELINE_JOB_ID = "2b56d31c-9d88-4df6-9be0-ab2aebc2c918";
const BASELINE_ATTEMPT_ID = "dc9a6e45-e333-4a15-b432-c14a03734f9c";
const OWNER_ID = "82b8859d-046d-4b23-bd04-dc4092fc735d";
const REMOTE_ID = "1217336970";
const SELLER_KEY = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const FINGERPRINT = "388a0ed6bed7d1537ee0b4792429b1c796daabe12303681348b5634d1d37b3f9";
const SOURCE_FINGERPRINT = "66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527";
const REQUEST_SHA = "c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e";
const RESPONSE_SHA = "ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad";
const ERROR = "Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: AdultYNは必須です。";
const migrationUrl = new URL(
  "../supabase/migrations/20260831055000_reconcile_exact_qoo10_adultyn_rejection.sql",
  import.meta.url,
);
const predecessorMigrationUrl = new URL(
  "../supabase/migrations/20260831052500_reconcile_exact_qoo10_preprovider_gate_denial.sql",
  import.meta.url,
);
const predecessorTestUrl = new URL(
  "./qoo10-preprovider-gate-reconciliation-migration.test.mjs",
  import.meta.url,
);

function requestFixture() {
  return {
    arguments: {
      params: {
        ItemCode: REMOTE_ID,
        ItemTitle: "貼り付け式ケーブル整理クリップ6個セット",
        SecondSubCat: "320000542",
        RetailPrice: "1871",
        ShippingNo: "806971",
        ProductionPlaceType: "2",
        ProductionPlace: "CN",
      },
      publicationIntent: "live",
      publicationExpectedLocale: "ja-JP",
      publicationExpectedImageCount: 8,
      publicationExpectedFingerprint: FINGERPRINT,
      sellerpilotQoo10RollbackUpdateRecovery: {
        sourceJobId: SOURCE_JOB_ID,
        listingId: LISTING_ID,
        remoteId: REMOTE_ID,
      },
    },
  };
}

function responseFixture() {
  return {
    ok: false,
    channel: "qoo10",
    operation: "listing.update",
    remoteId: REMOTE_ID,
    steps: [
      {
        name: "UpdateGoods",
        ok: false,
        status: 200,
        data: { ResultCode: -99, ResultMsg: "AdultYNは必須です。" },
      },
      {
        name: "qoo10-rollback-update-rejection-s1-readback",
        ok: false,
        status: 200,
        data: {
          ResultCode: 0,
          ResultMsg: "QOO10_PUBLICATION_STATE_UNVERIFIED",
          ResultObject: [{
            ItemNo: REMOTE_ID,
            ItemStatus: "S1",
            ItemTitle: "貼り付け式ケーブル整理クリップ6個セット",
            AdultYN: "N",
            ProductionPlaceType: "2",
            ProductionPlace: "CN",
            RetailPrice: "1871.0000",
            ItemQty: "1",
            ShippingNo: "806971",
            ChangedDate: "2026-08-30 21:57:11",
          }],
          sellerpilotVerification: "QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED",
          providerStatus: "S1",
          actualImageCount: 8,
          sellerpilotMismatchPaths: ["ItemDescription.text", "Keyword"],
        },
      },
    ],
  };
}

async function compatibilitySql() {
  const source = await readFile(predecessorTestUrl, "utf8");
  const match = source.match(/const compatibilitySql = String\.raw`([\s\S]*?)`;\n\nfunction requestFixture/);
  assert.ok(match?.[1], "predecessor compatibility schema must remain extractable");
  return match[1];
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

async function seedDatabase(options = {}) {
  const db = new PGlite();
  await db.exec(await compatibilitySql());
  await db.exec(await readFile(predecessorMigrationUrl, "utf8"));
  await db.exec(`
    create or replace function
      sellerpilot_private.listing_mutation_release_gate_is_effective(p_channel text)
    returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce((select is_open from sellerpilot_private.listing_mutation_release_gate
        where singleton), false)
    $$;
    revoke all on function
      sellerpilot_private.listing_mutation_release_gate_is_effective(text)
      from public,anon,authenticated,service_role;

    create table sellerpilot_private.qoo10_listing_update_rejection_observations (
      update_job_id uuid primary key,
      update_attempt_id uuid not null unique,
      source_job_id uuid not null,
      source_attempt_id uuid not null,
      listing_id uuid not null,
      credential_id uuid not null,
      remote_id text not null,
      response_sha256 text not null,
      provider_rejection_code text not null,
      provider_rejection_reason text not null,
      provider_status text not null,
      observed_origin_type text not null,
      observed_origin text not null,
      observed_retail_price_jpy bigint not null,
      observed_sell_price_jpy bigint not null,
      observed_quantity integer not null,
      source_shipping_no text not null,
      observed_shipping_no text not null,
      observed_detail_image_count integer not null,
      provider_mutation_accepted boolean not null,
      observed_at timestamptz not null
    );
  `);

  const request = requestFixture();
  const response = responseFixture();
  options.mutateRequest?.(request);
  options.mutateResponse?.(response);

  await db.query(
    `insert into sellerpilot_private.channel_credentials values (
       $1,'qoo10','production','active','2027-08-20T14:59:59Z',
       '910B8E8633C1',$2,'credential_incarnation_v1',
       '2026-08-25T11:40:32.606508Z','2026-08-20T08:35:56.238133Z')`,
    [CREDENTIAL_ID, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,status,http_status,remote_id,
       safe_message,gateway_write_required,pre_gateway_retryable,
       request_fingerprint,seller_account_key,started_at,completed_at
     ) values
       ($1,$2,$3,'qoo10','listing.create','failed',409,$4,'source',true,false,$5,$6,
        '2026-08-30T14:45:00Z','2026-08-30T14:51:26.505498Z'),
       ($7,$2,$3,'qoo10','listing.update','failed',200,$4,'baseline',true,false,$8,$6,
        '2026-08-30T14:59:48Z','2026-08-30T15:06:13Z'),
       ($9,$2,$3,'qoo10','listing.update','manual_required',409,$4,$10,true,false,$11,$6,
        '2026-08-30T21:29:00Z','2026-08-30T21:32:29.567929Z')`,
    [
      SOURCE_ATTEMPT_ID, OWNER_ID, CREDENTIAL_ID, REMOTE_ID, SOURCE_FINGERPRINT,
      SELLER_KEY, BASELINE_ATTEMPT_ID, "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
      ATTEMPT_ID, ERROR, FINGERPRINT,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.products values
      ($1,$2,'draft',false,'2026-08-30T21:00:00Z')`,
    [PRODUCT_ID, OWNER_ID],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,market,target_id,currency,remote_id,status,
       operation_attempt_id,failure_class,requested_publication_intent,
       remote_visibility,provider_status,seller_account_key,published_at,
       last_verified_at,last_error,price,updated_at
     ) values ($1,$2,$3,'qoo10','JP','','JPY',$4,'failed',$5,'external_action',
       'live','unknown',null,$6,null,null,$7,1871,'2026-08-30T21:32:30Z')`,
    [LISTING_ID, OWNER_ID, PRODUCT_ID, REMOTE_ID, ATTEMPT_ID, SELLER_KEY, ERROR],
  );

  const insertJob = async ({ id, attemptId, operation, status, createdAt, fingerprint }) => {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,request_fingerprint,seller_account_key,status,created_at,updated_at
       ) values ($1,$2,$3,$4,'qoo10',$5,'production','{}',$6,$7,$8,$9,$9)`,
      [id, CREDENTIAL_ID, attemptId, LISTING_ID, operation, fingerprint, SELLER_KEY, status, createdAt],
    );
  };
  await insertJob({
    id: SOURCE_JOB_ID, attemptId: SOURCE_ATTEMPT_ID, operation: "listing.create",
    status: "failed", createdAt: "2026-08-30T12:56:53.380373Z", fingerprint: SOURCE_FINGERPRINT,
  });
  await insertJob({
    id: BASELINE_JOB_ID, attemptId: BASELINE_ATTEMPT_ID, operation: "listing.update",
    status: "succeeded", createdAt: "2026-08-30T14:59:56.436937Z",
    fingerprint: "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
  });
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_update_rejection_observations
     values ($1,$2,$3,$4,$5,$6,$7,$8,'-99','ProductionPlaceType_required',
       'S1','2','CN',1871,1871,1,'0','806971',8,$9,
       '2026-08-30T15:06:13.213314Z')`,
    [
      BASELINE_JOB_ID, BASELINE_ATTEMPT_ID, SOURCE_JOB_ID, SOURCE_ATTEMPT_ID,
      LISTING_ID, CREDENTIAL_ID, REMOTE_ID,
      options.baselineResponseSha ?? "6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f",
      options.baselineMutationAccepted ?? false,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,request_fingerprint,seller_account_key,status,
       error_message,attempt_count,provider_mutation_started_at,created_at,started_at,
       completed_at,updated_at
     ) values ($1,$2,$3,$4,'qoo10','listing.update','production',$5::jsonb,$6::jsonb,
       $7,$8,'reconciliation_required',$9,1,'2026-08-30T21:32:22.585567Z',
       '2026-08-30T21:29:28.87921Z','2026-08-30T21:32:19.498509Z',
       '2026-08-30T21:32:29.567929Z','2026-08-30T21:32:29.567929Z')`,
    [
      JOB_ID, CREDENTIAL_ID, ATTEMPT_ID, LISTING_ID, JSON.stringify(request),
      JSON.stringify(response), FINGERPRINT, SELLER_KEY, ERROR,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_create_rollback_confirmations values (
       $1,$2,$3,$4,$5,'910B8E8633C1',$6,$7,8461402963,'320000542',
       1871,1871,1,'0','S1','reconciliation_required','failed','manual_required',
       'failed','failed','paused','external_action','retryable','unknown','non_public',
       null,'S1','live','2026-08-30T14:51:26.505498Z')`,
    [SOURCE_JOB_ID, SOURCE_ATTEMPT_ID, LISTING_ID, CREDENTIAL_ID, SOURCE_FINGERPRINT, SELLER_KEY, REMOTE_ID],
  );
  await db.query(
    `insert into sellerpilot_private.listing_mutation_release_gate values
      (true,$1,$2,$3,$4,clock_timestamp())`,
    [
      options.gateOpen ?? false,
      options.gateOpen ? "2026-08-30T21:40:00Z" : null,
      options.gateOpen ? "a".repeat(40) : null,
      options.gateOpen ? "qoo10" : null,
    ],
  );
  if (options.laterJob) {
    await insertJob({
      id: "45be7858-f670-4a62-80bf-13b49e45cae5", attemptId: null,
      operation: "listing.update", status: "failed",
      createdAt: "2026-08-30T21:40:00Z", fingerprint: "9".repeat(64),
    });
  }
  return db;
}

async function renderedMigration(db) {
  const source = await readFile(migrationUrl, "utf8");
  const requestSha = await scalar(
    db,
    "select encode(extensions.digest(request_payload::text,'sha256'),'hex') value from sellerpilot_private.channel_gateway_jobs where id=$1",
    [JOB_ID],
  );
  const responseSha = await scalar(
    db,
    "select encode(extensions.digest(response_payload::text,'sha256'),'hex') value from sellerpilot_private.channel_gateway_jobs where id=$1",
    [JOB_ID],
  );
  return source.replaceAll(REQUEST_SHA, requestSha).replaceAll(RESPONSE_SHA, responseSha);
}

test("exact AdultYN rejection is reconciled without replaying or rewriting provider evidence", async () => {
  const db = await seedDatabase();
  try {
    const before = (await db.query(
      `select request_payload,response_payload,provider_mutation_started_at
         from sellerpilot_private.channel_gateway_jobs where id=$1`,
      [JOB_ID],
    )).rows[0];
    const migration = await renderedMigration(db);
    await db.exec(migration);

    const state = (await db.query(
      `select job.status job_status,job.error_message,job.request_payload,
              job.response_payload,job.provider_mutation_started_at,
              attempt.status attempt_status,attempt.http_status,attempt.remote_id,
              listing.status listing_status,listing.failure_class,
              listing.remote_visibility,listing.provider_status,
              listing.operation_attempt_id::text operation_attempt_id
         from sellerpilot_private.channel_gateway_jobs job
         join sellerpilot_private.channel_operation_attempts attempt on attempt.id=job.attempt_id
         join sellerpilot_private.product_listings listing on listing.id=job.listing_id
        where job.id=$1`,
      [JOB_ID],
    )).rows[0];
    assert.equal(state.job_status, "succeeded");
    assert.equal(state.error_message, null);
    assert.equal(state.attempt_status, "failed");
    assert.equal(state.http_status, 200);
    assert.equal(state.remote_id, REMOTE_ID);
    assert.equal(state.listing_status, "paused");
    assert.equal(state.failure_class, "retryable");
    assert.equal(state.remote_visibility, "non_public");
    assert.equal(state.provider_status, "S1");
    assert.equal(state.operation_attempt_id, SOURCE_ATTEMPT_ID);
    assert.deepEqual(state.request_payload, before.request_payload);
    assert.deepEqual(state.response_payload, before.response_payload);
    assert.equal(String(state.provider_mutation_started_at), String(before.provider_mutation_started_at));
    assert.equal(await scalar(db, `select count(*)::integer value from sellerpilot_private.qoo10_adultyn_rejection_reconciliations where job_id=$1 and not provider_mutation_accepted and not provider_call_replayed`, [JOB_ID]), 1);
    assert.equal(await scalar(db, `select count(*)::integer value from sellerpilot_private.operation_audit where action='qoo10_exact_adultyn_rejection_reconciled' and entity_id=$1`, [JOB_ID]), 1);

    await db.exec(migration);
    assert.equal(await scalar(db, `select count(*)::integer value from sellerpilot_private.qoo10_adultyn_rejection_reconciliations where job_id=$1`, [JOB_ID]), 1);
  } finally {
    await db.close();
  }
});

for (const [name, options, expected] of [
  ["an open release gate", { gateOpen: true }, /requires closed gate/],
  ["AdultYN unexpectedly present in the immutable request", { mutateRequest: (request) => { request.arguments.params.AdultYN = "N"; } }, /AdultYN-missing request mismatch/],
  ["a provider rejection message drift", { mutateResponse: (response) => { response.steps[0].data.ResultMsg = "OTHER"; } }, /rejection response mismatch/],
  ["a prior observation response digest drift", { baselineResponseSha: "0".repeat(64) }, /baseline observation or mutation ledger mismatch/],
  ["a prior observation marked provider-accepted", { baselineMutationAccepted: true }, /baseline observation or mutation ledger mismatch/],
  ["a later listing mutation", { laterJob: true }, /mutation ledger mismatch/],
]) {
  test(`exact AdultYN reconciliation fails closed for ${name}`, async () => {
    const db = await seedDatabase(options);
    try {
      await assert.rejects(db.exec(await renderedMigration(db)), (error) => {
        assert.match(error instanceof Error ? error.message : String(error), expected);
        assert.equal(error?.code, "55000");
        return true;
      });
    } finally {
      await db.close();
    }
  });
}
