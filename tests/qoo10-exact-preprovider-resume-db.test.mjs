import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { PGlite } = await import(
  process.env.PGLITE_MODULE ?? "@electric-sql/pglite"
);

const JOB_ID = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const ATTEMPT_ID = "4402cc76-295b-4e17-8c07-d5d0e9967ce9";
const LISTING_ID = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const MUTATION_ID = "5fb751b6-0372-4ad3-b238-6670d58b42f9";
const SOURCE_JOB_ID = "0bc5ff1f-c884-4615-8a79-4688da46af6a";
const SOURCE_ATTEMPT_ID = "05e1959d-d7d8-4389-b7de-7335d28e4f91";
const ADULT_JOB_ID = "c25d3154-4110-4a25-9659-8e56aacf1b8d";
const ADULT_ATTEMPT_ID = "c19956d8-67d3-465b-90cd-a41b9123ad4e";
const BASELINE_JOB_ID = "2b56d31c-9d88-4df6-9be0-ab2aebc2c918";
const BASELINE_ATTEMPT_ID = "dc9a6e45-e333-4a15-b432-c14a03734f9c";
const OWNER_ID = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const CREATED_BY = "21eb1892-0894-4f9f-b414-4c9464182dd6";
const WORKER_ID = "9d5788ca-64dc-4901-a60b-c47c536ba816";
const CLAIM_TOKEN = "134b41fc-e4e5-4c51-9b8c-598cd27acfe8";
const WRONG_CLAIM_TOKEN = "43bf6939-80c1-4efb-8597-8de5666f1b62";
const OTHER_JOB_ID = "bab31dfd-bdc7-427d-b45d-ed778c6f7ae3";
const RELEASE_SHA = "52c0a26c93a3c377b042b65554234fb559bdab3f";
const SELLER_KEY = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const FINGERPRINT = "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799";
const PRODUCTION_PAYLOAD_SHA = "c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d";
const PRODUCTION_ADULT_REQUEST_SHA = "c74ae7bafc7e884b04fd30012f30a834495df4b0cf1e97969dd860f6e878da5e";
const PRODUCTION_ADULT_RESPONSE_SHA = "ca8034a29438e0e59ace5085fce129c859ea9c0c26a0ba03d22e3dc068fe57ad";
const ADULT_FINGERPRINT = "388a0ed6bed7d1537ee0b4792429b1c796daabe12303681348b5634d1d37b3f9";
const TOKEN_HASH = "a".repeat(64);

const migrationUrl = process.env.QOO10_EXACT_RESUME_MIGRATION
  ? pathToFileURL(process.env.QOO10_EXACT_RESUME_MIGRATION)
  : new URL(
      "../supabase/migrations/20260831056500_resume_exact_qoo10_preprovider_job.sql",
      import.meta.url,
    );

const payloadContractMigrationUrl = process.env.QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION
  ? pathToFileURL(process.env.QOO10_EXACT_RESUME_PAYLOAD_CONTRACT_MIGRATION)
  : new URL(
      "../supabase/migrations/20260831056600_correct_exact_qoo10_resume_payload_contract.sql",
      import.meta.url,
    );

const compatibilitySql = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
create schema auth;
create schema sellerpilot_private;
create schema extensions;

create table auth.users (id uuid primary key);
create or replace function extensions.digest(value text, algorithm text)
returns bytea language sql immutable as $$
  select case when lower(algorithm) = 'sha256'
    then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8') end
$$;

create table sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key,
  token_hash text not null unique,
  status text not null,
  expires_at timestamptz not null
);
create table sellerpilot_private.channel_credentials (
  id uuid primary key,
  channel text not null,
  environment text not null,
  status text not null,
  expires_at timestamptz,
  fingerprint text not null,
  created_by uuid not null,
  seller_account_key text not null,
  seller_account_key_source text not null,
  seller_account_verified_at timestamptz
);
create table sellerpilot_private.channel_operation_attempts (
  id uuid primary key,
  owner_id uuid not null,
  credential_id uuid not null,
  channel text not null,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null,
  http_status integer,
  remote_id text,
  safe_message text,
  started_at timestamptz not null,
  completed_at timestamptz,
  gateway_write_required boolean not null,
  pre_gateway_retryable boolean not null,
  seller_account_key text not null
);
create table sellerpilot_private.products (
  id uuid primary key,
  owner_id uuid not null,
  status text not null,
  demo boolean not null
);
create table sellerpilot_private.product_listings (
  id uuid primary key,
  owner_id uuid not null,
  product_id uuid not null,
  channel_key text not null,
  market text not null,
  target_id text not null,
  operation_attempt_id uuid,
  status text not null,
  failure_class text,
  last_error text,
  requested_publication_intent text not null,
  remote_visibility text not null,
  provider_status text,
  remote_id text,
  seller_account_key text not null,
  published_at timestamptz,
  last_verified_at timestamptz,
  updated_at timestamptz not null
);
create table sellerpilot_private.channel_gateway_jobs (
  id uuid primary key,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  attempt_id uuid references sellerpilot_private.channel_operation_attempts(id),
  listing_id uuid references sellerpilot_private.product_listings(id),
  channel text not null,
  operation text not null,
  environment text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  request_fingerprint text not null,
  seller_account_key text not null,
  status text not null,
  error_message text,
  worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
  claim_token uuid,
  attempt_count integer not null default 0,
  lease_expires_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null,
  provider_mutation_started_at timestamptz,
  credential_refresh_started_at timestamptz
);
create table sellerpilot_private.qoo10_adultyn_rejection_reconciliations (
  job_id uuid not null,
  attempt_id uuid not null,
  listing_id uuid not null,
  product_id uuid not null,
  credential_id uuid not null,
  source_job_id uuid not null,
  source_attempt_id uuid not null,
  baseline_update_job_id uuid not null,
  baseline_response_sha256 text not null,
  remote_id text not null,
  request_fingerprint text not null,
  request_sha256 text not null,
  response_sha256 text not null,
  provider_rejection_code text not null,
  provider_rejection_message text not null,
  provider_observed_at timestamptz not null,
  provider_status text not null,
  remote_visibility text not null,
  item_title text not null,
  adult_yn text not null,
  origin_type text not null,
  origin_code text not null,
  retail_price_jpy bigint not null,
  quantity integer not null,
  shipping_no text not null,
  detail_image_count integer not null,
  mismatch_paths text[] not null,
  provider_changed_date text not null,
  provider_mutation_accepted boolean not null,
  provider_call_replayed boolean not null,
  reconciled_at timestamptz not null
);
create table sellerpilot_private.qoo10_listing_create_rollback_confirmations (
  source_job_id uuid not null,
  source_attempt_id uuid not null,
  listing_id uuid not null,
  credential_id uuid not null,
  remote_id text not null,
  seller_account_key text not null,
  credential_fingerprint text not null,
  category_code text not null,
  retail_price_jpy bigint not null,
  sell_price_jpy bigint not null,
  quantity integer not null,
  shipping_no text not null,
  bi_contents_no bigint not null,
  new_provider_status text not null,
  confirmed_at timestamptz not null
);
create table sellerpilot_private.qoo10_listing_update_rejection_observations (
  update_job_id uuid not null,
  update_attempt_id uuid not null,
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
create table sellerpilot_private.gateway_completion_receipts (
  job_id uuid primary key
);
create table sellerpilot_private.operation_audit (
  id bigint generated always as identity primary key,
  owner_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  safe_detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create table sellerpilot_private.listing_mutation_release_gate (
  singleton boolean primary key,
  is_open boolean not null,
  opened_at timestamptz,
  opened_release_sha text,
  opened_channel text,
  updated_at timestamptz not null
);

create or replace function sellerpilot_private.qoo10_exact_adultyn_rejection_audit_detail()
returns jsonb language sql immutable security definer set search_path = '' as $$
  select '{"contract":"exact-adult-evidence-test"}'::jsonb
$$;

create or replace function sellerpilot_private.attested_listing_publication_release_sha(
  p_channel text
)
returns text language sql stable security definer set search_path = '' as $$
  select '${RELEASE_SHA}'::text
$$;
create or replace function sellerpilot_private.active_serverless_runtime_release_sha()
returns text language sql stable security definer set search_path = '' as $$
  select '${RELEASE_SHA}'::text
$$;
create or replace function sellerpilot_private.listing_publication_review_violation_count(
  p_channel text
)
returns integer language sql stable security definer set search_path = '' as $$
  select 0
$$;
create or replace function sellerpilot_private.listing_mutation_release_gate_is_effective(
  p_channel text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select gate.is_open
      from sellerpilot_private.listing_mutation_release_gate gate
     where gate.singleton
  ), false)
$$;

create or replace function public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_changed integer;
  v_already_started boolean := false;
begin
  select job.provider_mutation_started_at is not null
    into v_already_started
    from sellerpilot_private.channel_gateway_jobs job
   where job.id = p_job_id;
  update sellerpilot_private.channel_gateway_jobs job
     set provider_mutation_started_at = coalesce(
           job.provider_mutation_started_at, clock_timestamp()
         ),
         updated_at = clock_timestamp()
    from sellerpilot_private.ai_cli_worker_tokens worker
   where worker.token_hash = p_token_hash
     and worker.id = job.worker_token_id
     and worker.status = 'active'
     and worker.expires_at > statement_timestamp()
     and job.id = p_job_id
     and job.status = 'running'
     and job.claim_token = p_claim_token;
  get diagnostics v_changed = row_count;
  if v_changed = 1 and not v_already_started then
    insert into sellerpilot_private.operation_audit (
      action, entity_type, entity_id, safe_detail
    ) values ('test_provider_boundary', 'channel_gateway_job', p_job_id::text, '{}'::jsonb);
  end if;
  return v_changed = 1;
end;
$$;
create or replace function public.sellerpilot_300950_begin_serverless_gateway_mutation_before_release_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean language sql security definer set search_path = '' as $$
  select public.sellerpilot_300950_begin_gateway_mutation_before_release_gate(
    p_token_hash, p_job_id, p_claim_token
  )
$$;
`;

const channelDelegateSql = String.raw`
create or replace function public.sellerpilot_310500_begin_gateway_provider_mutation_before_channel_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean language sql security definer set search_path = '' as $$
  select public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe(
    p_token_hash, p_job_id, p_claim_token
  )
$$;
create or replace function public.sellerpilot_310500_begin_serverless_gateway_mutation_before_channel_gate(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns boolean language sql security definer set search_path = '' as $$
  select public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe(
    p_token_hash, p_job_id, p_claim_token
  )
$$;
`;

function requestFixture() {
  return {
    arguments: {
      params: {
        ItemCode: "1217336970",
        SecondSubCat: "320000542",
        ProductionPlaceType: "2",
        ProductionPlace: "CN",
        RetailPrice: "1871",
        ShippingNo: "806971",
        AdultYN: "N",
      },
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ja-JP",
      publicationExpectedImageCount: 8,
      publicationExpectedFingerprint: FINGERPRINT,
      sellerpilotQoo10RollbackUpdateRecovery: {
        status: "allowed",
        contract: "qoo10_create_rollback_confirmation_v1",
        sourceJobId: SOURCE_JOB_ID,
        listingId: LISTING_ID,
        remoteId: "1217336970",
        providerStatus: "S1",
        expectedState: {
          categoryCode: "320000542",
          retailPriceJpy: 1871,
          sellPriceJpy: 1871,
          quantity: 1,
          shippingNo: "806971",
          biContentsNo: 8461402963,
        },
      },
    },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFunction(source, qualifiedName, delimiter = "\\$\\$") {
  const pattern = new RegExp(
    `create(?: or replace)? function\\s+${escapeRegExp(qualifiedName)}\\s*\\([\\s\\S]*?\\n\\s*${delimiter};?`,
    "i",
  );
  const match = source.match(pattern);
  assert.ok(match?.[0], `${qualifiedName} must remain extractable`);
  return match[0];
}

function extractPermitTable(source) {
  const match = source.match(
    /create table sellerpilot_private\.qoo10_exact_preprovider_resume_permits \([\s\S]*?\n\);/,
  );
  assert.ok(match?.[0], "exact resume permit table must remain extractable");
  return match[0];
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

async function installResumeCore(db) {
  const source = await readFile(migrationUrl, "utf8");
  const payloadContractSource = await readFile(payloadContractMigrationUrl, "utf8");
  const payloadMeta = (await db.query(
    `select octet_length(request_payload::text)::integer payload_bytes,
            encode(extensions.digest(request_payload::text,'sha256'),'hex') payload_sha
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [JOB_ID],
  )).rows[0];
  const adultPayloadMeta = (await db.query(
    `select encode(extensions.digest(request_payload::text,'sha256'),'hex') request_sha,
            encode(extensions.digest(response_payload::text,'sha256'),'hex') response_sha
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [ADULT_JOB_ID],
  )).rows[0];
  const rendered = source
    .replaceAll(PRODUCTION_PAYLOAD_SHA, payloadMeta.payload_sha)
    .replaceAll(PRODUCTION_ADULT_REQUEST_SHA, adultPayloadMeta.request_sha)
    .replaceAll(PRODUCTION_ADULT_RESPONSE_SHA, adultPayloadMeta.response_sha)
    .replaceAll("23555", String(payloadMeta.payload_bytes));

  await db.exec(extractPermitTable(rendered));
  for (const name of [
    "sellerpilot_private.qoo10_exact_preprovider_resume_release_is_current",
    "sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current",
    "public.sellerpilot_service_arm_exact_qoo10_preprovider_resume",
    "sellerpilot_private.bind_exact_qoo10_preprovider_resume_claim",
    "sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed",
    "sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider",
    "sellerpilot_private.block_closed_listing_mutation_claim",
  ]) {
    await db.exec(extractFunction(rendered, name));
  }
  assert.equal(
    await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
        $1::uuid,$2
      ) value`,
      [JOB_ID, RELEASE_SHA],
    ),
    false,
    "the applied 56500 lineage must reject the actual prepared payload that omits ItemPrice and ItemQty",
  );
  const correctedPayloadContract = payloadContractSource
    .replaceAll(PRODUCTION_PAYLOAD_SHA, payloadMeta.payload_sha)
    .replaceAll(PRODUCTION_ADULT_REQUEST_SHA, adultPayloadMeta.request_sha)
    .replaceAll(PRODUCTION_ADULT_RESPONSE_SHA, adultPayloadMeta.response_sha)
    .replaceAll("23555", String(payloadMeta.payload_bytes));
  await db.exec(extractFunction(
    correctedPayloadContract,
    "sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current",
  ));
  assert.equal(
    await scalar(
      db,
      `select sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
        $1::uuid,$2
      ) value`,
      [JOB_ID, RELEASE_SHA],
    ),
    true,
    "the 56600 forward fix must accept omitted prepared price/quantity keys while retaining recovery expectedState evidence",
  );
  await db.exec(extractFunction(
    rendered,
    "public.sellerpilot_31033000_begin_gateway_provider_mutation_unsafe",
  ));
  await db.exec(`${extractFunction(
    rendered,
    "public.sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe",
    "\\$function\\$",
  )};`);
  await db.exec(channelDelegateSql);
  await db.exec(extractFunction(
    rendered,
    "public.sellerpilot_service_begin_gateway_provider_mutation",
  ));
  for (const name of [
    "public.sellerpilot_service_begin_serverless_gateway_provider_mutation",
  ]) {
    await db.exec(`${extractFunction(rendered, name, "\\$function\\$")};`);
  }
  await db.exec(`
    create trigger block_closed_listing_mutation_claim
    before update on sellerpilot_private.channel_gateway_jobs
    for each row execute function sellerpilot_private.block_closed_listing_mutation_claim();
  `);
}

async function seedDatabase() {
  const db = new PGlite();
  await db.exec(compatibilitySql);
  await db.query(`insert into auth.users values ($1),($2)`, [OWNER_ID, CREATED_BY]);
  await db.query(
    `insert into sellerpilot_private.ai_cli_worker_tokens values
      ($1,$2,'active','2027-08-31T00:00:00Z')`,
    [WORKER_ID, TOKEN_HASH],
  );
  await db.query(
    `insert into sellerpilot_private.channel_credentials values
      ($1,'qoo10','production','active','2027-08-31T00:00:00Z','910B8E8633C1',$2,$3,
       'credential_incarnation_v1','2026-08-25T00:00:00Z')`,
    [CREDENTIAL_ID, CREATED_BY, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,idempotency_key,
       request_fingerprint,status,http_status,remote_id,safe_message,started_at,
       completed_at,gateway_write_required,pre_gateway_retryable,seller_account_key
     ) values
      ($1,$2,$3,'qoo10','listing.update',$4,$5,'running',null,null,null,
       '2026-08-30T22:38:33.731944Z',null,true,false,$6),
      ($7,$2,$3,'qoo10','listing.update','adult-attempt',$8,'failed',200,
       '1217336970','AdultYN rejected','2026-08-30T21:32:19.498509Z',
       '2026-08-30T21:32:29.567929Z',true,false,$6),
      ($9,$2,$3,'qoo10','listing.update','baseline-attempt',$10,'failed',200,
       '1217336970','baseline','2026-08-30T14:59:48Z',
       '2026-08-30T15:06:13.213314Z',true,false,$6)`,
    [
      ATTEMPT_ID,
      OWNER_ID,
      CREDENTIAL_ID,
      `product-edit:${PRODUCT_ID}:${LISTING_ID}:${MUTATION_ID}`,
      FINGERPRINT,
      SELLER_KEY,
      ADULT_ATTEMPT_ID,
      ADULT_FINGERPRINT,
      BASELINE_ATTEMPT_ID,
      "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.products values ($1,$2,'draft',false)`,
    [PRODUCT_ID, OWNER_ID],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings values
      ($1,$2,$3,'qoo10','JP','',$4,'queued',null,null,'live','non_public','S1',
       '1217336970',$5,null,'2026-08-30T21:32:29.567929Z',
       '2026-08-30T22:38:42.23343Z')`,
    [LISTING_ID, OWNER_ID, PRODUCT_ID, ATTEMPT_ID, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,request_fingerprint,seller_account_key,status,error_message,
       worker_token_id,claim_token,attempt_count,lease_expires_at,created_by,
       created_at,started_at,completed_at,updated_at,provider_mutation_started_at,
       credential_refresh_started_at
     ) values ($1,$2,$3,$4,'qoo10','listing.update','production',$5::jsonb,$6,$7,
       'queued',null,null,null,0,null,$8,'2026-08-30T22:38:42.23343Z',null,null,
       '2026-08-30T22:38:42.23343Z',null,null)`,
    [
      JOB_ID,
      CREDENTIAL_ID,
      ATTEMPT_ID,
      LISTING_ID,
      JSON.stringify(requestFixture()),
      FINGERPRINT,
      SELLER_KEY,
      CREATED_BY,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,request_fingerprint,seller_account_key,status,
       error_message,attempt_count,created_by,created_at,started_at,completed_at,
       updated_at,provider_mutation_started_at
     ) values
      ($1,$2,$3,$4,'qoo10','listing.update','production',$5::jsonb,$6::jsonb,$7,$8,
       'succeeded',null,1,$9,'2026-08-30T21:29:28.87921Z',
       '2026-08-30T21:32:19.498509Z','2026-08-30T21:32:29.567929Z',
       '2026-08-30T21:35:00Z','2026-08-30T21:32:22.585567Z'),
      ($10,$2,$11,$4,'qoo10','listing.update','production','{}'::jsonb,'{}'::jsonb,$12,$8,
       'succeeded',null,1,$9,'2026-08-30T14:59:56.436937Z',
       '2026-08-30T15:00:00Z','2026-08-30T15:06:13.213314Z',
       '2026-08-30T15:06:13.213314Z','2026-08-30T15:00:01Z')`,
    [
      ADULT_JOB_ID,
      CREDENTIAL_ID,
      ADULT_ATTEMPT_ID,
      LISTING_ID,
      JSON.stringify({ adult: "request", AdultYN: "missing" }),
      JSON.stringify({ adult: "response", ResultCode: -99 }),
      ADULT_FINGERPRINT,
      SELLER_KEY,
      CREATED_BY,
      BASELINE_JOB_ID,
      BASELINE_ATTEMPT_ID,
      "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
    ],
  );
  const adultPayloadMeta = (await db.query(
    `select encode(extensions.digest(request_payload::text,'sha256'),'hex') request_sha,
            encode(extensions.digest(response_payload::text,'sha256'),'hex') response_sha
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [ADULT_JOB_ID],
  )).rows[0];
  await db.query(
    `insert into sellerpilot_private.qoo10_adultyn_rejection_reconciliations values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,'1217336970',$10,$11,$12,'-99',
       'AdultYNは必須です。','2026-08-30T21:32:29.567929Z','S1','non_public',
       '貼り付け式ケーブル整理クリップ6個セット','N','2','CN',1871,1,
       '806971',8,array['ItemDescription.text','Keyword']::text[],
       '2026-08-30 21:57:11',false,false,'2026-08-30T21:35:00Z')`,
    [
      ADULT_JOB_ID,
      ADULT_ATTEMPT_ID,
      LISTING_ID,
      PRODUCT_ID,
      CREDENTIAL_ID,
      SOURCE_JOB_ID,
      SOURCE_ATTEMPT_ID,
      BASELINE_JOB_ID,
      "6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f",
      ADULT_FINGERPRINT,
      adultPayloadMeta.request_sha,
      adultPayloadMeta.response_sha,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_create_rollback_confirmations values
      ($1,$2,$3,$4,'1217336970',$5,'910B8E8633C1','320000542',1871,1871,1,
       '0',8461402963,'S1','2026-08-30T14:51:26.505498Z')`,
    [SOURCE_JOB_ID, SOURCE_ATTEMPT_ID, LISTING_ID, CREDENTIAL_ID, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_update_rejection_observations values
      ($1,$2,$3,$4,$5,$6,'1217336970',$7,'-99',
       'ProductionPlaceType_required','S1','2','CN',1871,1871,1,'0','806971',8,
       false,'2026-08-30T15:06:13.213314Z')`,
    [
      BASELINE_JOB_ID,
      BASELINE_ATTEMPT_ID,
      SOURCE_JOB_ID,
      SOURCE_ATTEMPT_ID,
      LISTING_ID,
      CREDENTIAL_ID,
      "6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.operation_audit (
       owner_id,action,entity_type,entity_id,safe_detail
     ) values ($1,'qoo10_exact_adultyn_rejection_reconciled',
       'channel_gateway_job',$2,'{"contract":"exact-adult-evidence-test"}'::jsonb)`,
    [OWNER_ID, ADULT_JOB_ID],
  );
  await db.exec(`
    insert into sellerpilot_private.listing_mutation_release_gate values
      (true,false,null,null,null,clock_timestamp());
  `);
  await installResumeCore(db);
  return db;
}

async function arm(db) {
  return scalar(
    db,
    `select public.sellerpilot_service_arm_exact_qoo10_preprovider_resume(
      $1::uuid,$2
    ) value`,
    [JOB_ID, RELEASE_SHA],
  );
}

async function claim(db, jobId = JOB_ID, claimToken = CLAIM_TOKEN) {
  await db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set status='running',worker_token_id=$2,claim_token=$3,attempt_count=1,
            lease_expires_at=clock_timestamp()+interval '15 minutes',
            started_at=clock_timestamp(),error_message=null,updated_at=clock_timestamp()
      where id=$1`,
    [jobId, WORKER_ID, claimToken],
  );
}

async function beginProvider(db, functionName, claimToken) {
  return scalar(
    db,
    `select public.${functionName}($1,$2::uuid,$3::uuid) value`,
    [TOKEN_HASH, JOB_ID, claimToken],
  );
}

test("56600 accepts the exact sparse prepared payload and retains recovery price/quantity evidence", async () => {
  const db = await seedDatabase();
  try {
    const contract = (await db.query(
      `select
         not ((request_payload#>'{arguments,params}') ? 'ItemPrice') item_price_omitted,
         not ((request_payload#>'{arguments,params}') ? 'ItemQty') item_qty_omitted,
         request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}' expected_sell_price,
         request_payload#>>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}' expected_quantity,
         sellerpilot_private.qoo10_exact_preprovider_resume_lineage_is_current(
           id,$2
         ) lineage_current
       from sellerpilot_private.channel_gateway_jobs
       where id=$1`,
      [JOB_ID, RELEASE_SHA],
    )).rows[0];
    assert.deepEqual(contract, {
      item_price_omitted: true,
      item_qty_omitted: true,
      expected_sell_price: "1871",
      expected_quantity: "1",
      lineage_current: true,
    });
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value
           from sellerpilot_private.qoo10_exact_preprovider_resume_permits`,
      ),
      0,
      "installing the forward fix must not arm the one-shot permit",
    );
  } finally {
    await db.close();
  }
});

test("closed gate binds only the exact queued job and rejects another listing claim", async () => {
  const db = await seedDatabase();
  try {
    const armed = await arm(db);
    assert.equal(armed.contract, "qoo10_exact_preprovider_resume_v1");
    assert.equal(armed.reused, false);
    await claim(db);
    const permit = (await db.query(
      `select bound_claim_token::text, bound_worker_token_id::text, consumed_at
         from sellerpilot_private.qoo10_exact_preprovider_resume_permits
        where job_id=$1`,
      [JOB_ID],
    )).rows[0];
    assert.equal(permit.bound_claim_token, CLAIM_TOKEN);
    assert.equal(permit.bound_worker_token_id, WORKER_ID);
    assert.equal(permit.consumed_at, null);

    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,request_fingerprint,seller_account_key,status,attempt_count,
         created_by,created_at,updated_at
       ) values ($1,$2,$3,$4,'qoo10','listing.update','production','{}',$5,$6,
         'queued',0,$7,clock_timestamp(),clock_timestamp())`,
      [OTHER_JOB_ID, CREDENTIAL_ID, ATTEMPT_ID, LISTING_ID, "f".repeat(64), SELLER_KEY, CREATED_BY],
    );
    await assert.rejects(claim(db, OTHER_JOB_ID, WRONG_CLAIM_TOKEN), (error) => {
      assert.equal(error?.code, "55000");
      assert.match(error instanceof Error ? error.message : String(error), /LISTING_MUTATION_RELEASE_GATE_CLOSED/);
      return true;
    });
    assert.equal(
      await scalar(db, `select is_open value from sellerpilot_private.listing_mutation_release_gate where singleton`),
      false,
    );
  } finally {
    await db.close();
  }
});

for (const functionName of [
  "sellerpilot_service_begin_gateway_provider_mutation",
  "sellerpilot_service_begin_serverless_gateway_provider_mutation",
]) {
  test(`${functionName} consumes once and coalesces only the same bound claim`, async () => {
    const db = await seedDatabase();
    try {
      await arm(db);
      await claim(db);
      assert.equal(await beginProvider(db, functionName, WRONG_CLAIM_TOKEN), false);
      assert.equal(
        await scalar(db, `select provider_mutation_started_at is null value from sellerpilot_private.channel_gateway_jobs where id=$1`, [JOB_ID]),
        true,
      );
      assert.equal(await beginProvider(db, functionName, CLAIM_TOKEN), true);
      const state = (await db.query(
        `select job.provider_mutation_started_at is not null provider_started,
                permit.consumed_at is not null consumed
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.qoo10_exact_preprovider_resume_permits permit
             on permit.job_id=job.id
          where job.id=$1`,
        [JOB_ID],
      )).rows[0];
      assert.equal(state.provider_started, true);
      assert.equal(state.consumed, true);
      assert.equal(
        await beginProvider(db, functionName, CLAIM_TOKEN),
        true,
        "a committed begin with a lost HTTP response must coalesce for the same claim",
      );
      assert.equal(
        await beginProvider(db, functionName, WRONG_CLAIM_TOKEN),
        false,
        "a consumed permit must not authorize a different claim",
      );
      assert.equal(
        await scalar(db, `select count(*)::integer value from sellerpilot_private.operation_audit where action='test_provider_boundary' and entity_id=$1`, [JOB_ID]),
        1,
      );
      assert.equal(
        await scalar(db, `select count(*)::integer value from sellerpilot_private.operation_audit where action='qoo10_exact_preprovider_resume_consumed' and entity_id=$1`, [JOB_ID]),
        1,
      );
    } finally {
      await db.close();
    }
  });
}

for (const [name, mutate] of [
  ["attempt idempotency drift", async (db) => db.query(
    `update sellerpilot_private.channel_operation_attempts set idempotency_key='wrong' where id=$1`,
    [ATTEMPT_ID],
  )],
  ["unexpected prepared ItemPrice presence", async (db) => db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(request_payload,'{arguments,params,ItemPrice}','"1871"'::jsonb)
      where id=$1`,
    [JOB_ID],
  )],
  ["unexpected prepared ItemQty presence", async (db) => db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(request_payload,'{arguments,params,ItemQty}','"1"'::jsonb)
      where id=$1`,
    [JOB_ID],
  )],
  ["recovery expected sell price drift", async (db) => db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(
          request_payload,
          '{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy}',
          '1872'::jsonb
        )
      where id=$1`,
    [JOB_ID],
  )],
  ["recovery expected quantity drift", async (db) => db.query(
    `update sellerpilot_private.channel_gateway_jobs
        set request_payload=jsonb_set(
          request_payload,
          '{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity}',
          '2'::jsonb
        )
      where id=$1`,
    [JOB_ID],
  )],
]) {
  test(`arm fails closed for ${name}`, async () => {
    const db = await seedDatabase();
    try {
      await mutate(db);
      await assert.rejects(arm(db), (error) => {
        assert.equal(error?.code, "55000");
        assert.match(error instanceof Error ? error.message : String(error), /preconditions are not met/);
        return true;
      });
      assert.equal(
        await scalar(db, `select count(*)::integer value from sellerpilot_private.qoo10_exact_preprovider_resume_permits`),
        0,
      );
    } finally {
      await db.close();
    }
  });
}
