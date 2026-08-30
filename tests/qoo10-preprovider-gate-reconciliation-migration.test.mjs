import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const JOB_ID = "6795cc6c-57e9-4239-9241-e2942de6a1a1";
const ATTEMPT_ID = "95ce0ac4-ed20-4d2d-993b-0ef88e111604";
const LISTING_ID = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const SOURCE_JOB_ID = "0bc5ff1f-c884-4615-8a79-4688da46af6a";
const SOURCE_ATTEMPT_ID = "05e1959d-d7d8-4389-b7de-7335d28e4f91";
const PREVIOUS_UPDATE_JOB_ID = "2b56d31c-9d88-4df6-9be0-ab2aebc2c918";
const PREVIOUS_UPDATE_ATTEMPT_ID = "dc9a6e45-e333-4a15-b432-c14a03734f9c";
const LEGACY_JOB_ID = "2b6258c8-f1fd-4dc2-baed-b0019dd66112";
const OWNER_ID = "82b8859d-046d-4b23-bd04-dc4092fc735d";
const REMOTE_ID = "1217336970";
const SELLER_KEY = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const REQUEST_FINGERPRINT = "a98ca816896acd825f29fc90f4d94881a4655617175170f79dc23e2a666390f3";
const SOURCE_FINGERPRINT = "66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527";
const PRODUCTION_REQUEST_SHA = "634c0ead954b340d8eb3b16cef70715dd9036a0f61085275a3209670a063ef29";
const PRODUCTION_DESCRIPTION_SHA = "ae7be17cfa4a0b6d6233b52e3281e06b6566cdef14612bbc0f27293adb931eec";
const ORIGINAL_ERROR = "Gateway write lease expired; provider outcome requires reconciliation.";
const TERMINAL_ERROR = "Qoo10 provider write 시작 전 release-gate 거부를 QSM readback으로 확인하여 작업을 취소했습니다.";
const ATTEMPT_MESSAGE = "Qoo10 provider write 시작 전 거부 · QSM S1 비공개 상태 확인 · listing.update 재시도 가능";
const LISTING_ERROR = "Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요";
const DESCRIPTION = "a".repeat(13_413);
const IMAGE_DIGEST = "d30953d938a8c966709cd8739c4170462167bb88a2a92bddb0f71e7902035467";
const IMAGE_URLS = [
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/e6/e6972e812b95d38ccb08026cc16573660d532012951c54bcbd9aa57807c907c3.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/64/641856cd5eff810194e0b5c14309e099c0c716f3643b8f68377bfe6baca521b8.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/04/04f2523967867f7f0c218c635beb34571aec4f97b80cb24adae9d8e5edf994db.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/7f/7fe0ed3832f3bff882b576c6709e7a201a8b2c18b4905dd8b5bbdc3ce5bbcf5e.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/00/002c35dfc480660d5eab429ef9491357b06f7e317539365fadffeb8a186cc3e0.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/38/3800dcf97c2814ebe961bd8bd30d53dda7ff0d6b1a9f73a7fed929dea1fe92ac.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/fa/fae4e55b17604528d3f1b14a471b2a72c0856b1bb0e1dc7a324388a9066684a2.jpg",
  "https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/cc/cc9af9f4c99383fd159395b5a13289b4b268f548d8f5ccb391c6672af2914410.jpg",
];
const migrationUrl = new URL(
  "../supabase/migrations/20260831052500_reconcile_exact_qoo10_preprovider_gate_denial.sql",
  import.meta.url,
);

const compatibilitySql = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
create schema sellerpilot_private;
create schema extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea language sql immutable as $$
  select case when lower(algorithm) = 'sha256'
    then sha256(convert_to(value, 'UTF8'))
    else convert_to(md5(value || algorithm), 'UTF8') end
$$;

create table sellerpilot_private.channel_credentials (
  id uuid primary key,
  channel text not null,
  environment text not null,
  status text not null,
  expires_at timestamptz,
  fingerprint text not null,
  seller_account_key text,
  seller_account_key_source text,
  seller_account_verified_at timestamptz,
  created_at timestamptz not null
);
create table sellerpilot_private.channel_operation_attempts (
  id uuid primary key,
  owner_id uuid not null,
  credential_id uuid not null,
  channel text not null,
  operation text not null,
  status text not null,
  http_status integer,
  remote_id text,
  safe_message text,
  gateway_write_required boolean not null default false,
  pre_gateway_retryable boolean not null default false,
  request_fingerprint text not null,
  seller_account_key text,
  started_at timestamptz not null,
  completed_at timestamptz
);
create table sellerpilot_private.products (
  id uuid primary key,
  owner_id uuid not null,
  status text not null,
  demo boolean not null default false,
  updated_at timestamptz not null
);
create table sellerpilot_private.product_listings (
  id uuid primary key,
  owner_id uuid not null,
  product_id uuid not null references sellerpilot_private.products(id),
  channel_key text not null,
  market text not null,
  target_id text not null,
  currency text not null default 'KRW',
  marketplace_sku text,
  remote_id text,
  status text not null,
  operation_attempt_id uuid,
  failure_class text,
  requested_publication_intent text not null,
  remote_visibility text not null,
  provider_status text,
  seller_account_key text,
  published_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  price numeric not null default 0,
  updated_at timestamptz not null
);
create table sellerpilot_private.channel_gateway_jobs (
  id uuid primary key,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  attempt_id uuid,
  listing_id uuid,
  channel text not null,
  operation text not null,
  environment text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  request_fingerprint text not null,
  seller_account_key text,
  status text not null,
  error_message text,
  worker_token_id uuid,
  claim_token uuid,
  lease_expires_at timestamptz,
  credential_refresh_in_flight boolean not null default false,
  credential_refresh_fingerprint text,
  prepared_credential_id uuid,
  credential_refresh_prepared_at timestamptz,
  credential_refresh_recovery_vault_id uuid,
  credential_refresh_recovery_fingerprint text,
  credential_refresh_recovery_staged_at timestamptz,
  credential_refresh_started_at timestamptz,
  oauth_request_vault_id uuid,
  oauth_request_fingerprint text,
  oauth_source_credential_id uuid,
  oauth_exchange_completed boolean not null default false,
  oauth_provider_call_started_at timestamptz,
  attempt_count integer not null default 1,
  provider_mutation_started_at timestamptz,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null
);
create table sellerpilot_private.qoo10_listing_create_rollback_confirmations (
  source_job_id uuid primary key,
  source_attempt_id uuid not null,
  listing_id uuid not null,
  credential_id uuid not null,
  request_fingerprint text not null,
  credential_fingerprint text not null,
  seller_account_key text not null,
  remote_id text not null,
  bi_contents_no bigint not null,
  category_code text not null,
  retail_price_jpy bigint not null,
  sell_price_jpy bigint not null,
  quantity integer not null,
  shipping_no text not null,
  observed_provider_status text not null,
  previous_job_status text not null,
  new_job_status text not null,
  previous_attempt_status text not null,
  new_attempt_status text not null,
  previous_listing_status text not null,
  new_listing_status text not null,
  previous_failure_class text not null,
  new_failure_class text not null,
  previous_remote_visibility text not null,
  new_remote_visibility text not null,
  previous_provider_status text,
  new_provider_status text not null,
  requested_publication_intent text not null,
  confirmed_at timestamptz not null
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
create table sellerpilot_private.gateway_completion_receipts (
  job_id uuid primary key,
  claim_token uuid not null,
  worker_token_id uuid not null,
  completion_fingerprint text not null,
  continuation_job_id uuid,
  created_at timestamptz not null
);
create table sellerpilot_private.listing_mutation_release_gate (
  singleton boolean primary key,
  is_open boolean not null,
  opened_at timestamptz,
  opened_release_sha text,
  opened_channel text,
  updated_at timestamptz not null
);

create or replace function sellerpilot_private.qoo10_definition_occurrences(
  p_haystack text, p_needle text
)
returns integer language sql immutable set search_path = '' as $$
  select case when p_needle = '' then 0 else
    (length(p_haystack) - length(replace(p_haystack,p_needle,'')))
      / length(p_needle) end
$$;
create or replace function
  sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(
    p_old jsonb, p_new jsonb, p_job_id text
  )
returns boolean language sql stable security definer set search_path = '' as $$
  select false
$$;
create or replace function sellerpilot_private.guard_product_listing_seller_lineage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('sellerpilot.qoo10_exact_origin_rejection_job', true), '') is not null then
    if not sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(
      to_jsonb(old),
      to_jsonb(new),
      current_setting('sellerpilot.qoo10_exact_origin_rejection_job', true)
    ) then
      raise exception 'invalid exact Qoo10 origin-type rejection restore';
    end if;
    return new;
  end if;

  if nullif(current_setting('sellerpilot.qoo10_rollback_retry_job', true), '') is not null then
    return new;
  end if;
  return new;
end;
$$;
create trigger guard_product_listing_seller_lineage
before update on sellerpilot_private.product_listings
for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();
revoke all on function
  sellerpilot_private.qoo10_definition_occurrences(text,text)
  from public,anon,authenticated,service_role;
revoke all on function
  sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(jsonb,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function
  sellerpilot_private.guard_product_listing_seller_lineage()
  from public,anon,authenticated,service_role;
`;

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
        PromotionName: "販売者が確認した入力だけに基づく商品案内",
        Keyword: "buchakhyeong keibeul jeongri keulrip 6gae seteu,No Brand,購入前確認",
        AvailableDateType: "0",
        AvailableDateValue: "3",
        ItemDescription: DESCRIPTION,
      },
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ja-JP",
      publicationExpectedFingerprint: REQUEST_FINGERPRINT,
      publicationExpectedImageCount: 8,
      publicationIntent: "live",
      sellerpilotPublicationAssetBinding: {
        contract: "sellerpilot_publication_asset_binding_v1",
        approvedManifestDigest: "728b29c454ebc8b693912b2278fa0960863f506e16ca82056675c0ab46c24c62",
        approvedDetailPageVersion: 1,
        approvedDetailImages: IMAGE_URLS.map((publicUrl) => ({ publicUrl })),
      },
      sellerpilotQoo10RollbackUpdateRecovery: {
        status: "allowed",
        contract: "qoo10_create_rollback_confirmation_v1",
        sourceJobId: SOURCE_JOB_ID,
        listingId: LISTING_ID,
        remoteId: REMOTE_ID,
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

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

async function seedDatabase(options = {}) {
  const db = new PGlite();
  await db.exec(compatibilitySql);
  const request = requestFixture();
  options.mutateRequest?.(request);

  await db.query(
    `insert into sellerpilot_private.channel_credentials values (
       $1,'qoo10','production','active','2027-08-20T14:59:59Z',
       '910B8E8633C1',$2,'credential_incarnation_v1',
       '2026-08-25T11:40:32.606508Z','2026-08-20T08:35:56.238133Z'
     )`,
    [CREDENTIAL_ID, SELLER_KEY],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,status,http_status,
       remote_id,safe_message,gateway_write_required,pre_gateway_retryable,
       request_fingerprint,seller_account_key,started_at,completed_at
     ) values
       ($1,$2,$3,'qoo10','listing.create','failed',409,$4,
        'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.',
        true,false,$5,$6,'2026-08-30T14:45:00Z',
        '2026-08-30T14:51:26.505498Z'),
       ($7,$2,$3,'qoo10','listing.update','failed',200,$4,
        'prior exact rejection reconciled',true,false,$8,$6,
        '2026-08-30T14:59:48Z','2026-08-30T15:06:13Z'),
       ($9,$2,$3,'qoo10','listing.update','manual_required',409,null,$10,
        true,false,$11,$6,'2026-08-30T20:23:03.667881Z',
        '2026-08-30T20:41:03.259905Z')`,
    [
      SOURCE_ATTEMPT_ID, OWNER_ID, CREDENTIAL_ID, REMOTE_ID,
      SOURCE_FINGERPRINT, SELLER_KEY, PREVIOUS_UPDATE_ATTEMPT_ID,
      "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
      ATTEMPT_ID, ORIGINAL_ERROR, REQUEST_FINGERPRINT,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.products values (
       $1,$2,'draft',false,'2026-08-30T14:40:00Z'
     )`,
    [PRODUCT_ID, OWNER_ID],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,market,target_id,currency,
       marketplace_sku,remote_id,status,
       operation_attempt_id,failure_class,requested_publication_intent,
       remote_visibility,provider_status,seller_account_key,published_at,
       last_verified_at,last_error,price,updated_at
     ) values (
       $1,$2,$3,'qoo10','JP','','JPY',null,$4,'failed',$5,'external_action',
       'live','non_public','S1',$6,null,'2026-08-30T14:51:26.505498Z',
       $7,1871,'2026-08-30T20:41:03.259905Z'
     )`,
    [LISTING_ID, OWNER_ID, PRODUCT_ID, REMOTE_ID, ATTEMPT_ID, SELLER_KEY, ORIGINAL_ERROR],
  );

  const simpleJob = async ({ id, attemptId = null, operation, status, createdAt, fingerprint }) => {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,request_fingerprint,seller_account_key,status,
         created_at,updated_at
       ) values (
         $1,$2,$3,$4,'qoo10',$5,'production','{}',$6,$7,$8,$9,$9
       )`,
      [id, CREDENTIAL_ID, attemptId, LISTING_ID, operation, fingerprint, SELLER_KEY, status, createdAt],
    );
  };
  await simpleJob({
    id: LEGACY_JOB_ID, operation: "listing.create", status: "failed",
    createdAt: "2026-08-30T11:23:25.017463Z", fingerprint: "4".repeat(64),
  });
  await simpleJob({
    id: SOURCE_JOB_ID, attemptId: SOURCE_ATTEMPT_ID, operation: "listing.create",
    status: "failed", createdAt: "2026-08-30T12:56:53.380373Z",
    fingerprint: SOURCE_FINGERPRINT,
  });
  await simpleJob({
    id: PREVIOUS_UPDATE_JOB_ID, attemptId: PREVIOUS_UPDATE_ATTEMPT_ID,
    operation: "listing.update", status: "succeeded",
    createdAt: "2026-08-30T14:59:56.436937Z",
    fingerprint: "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff",
  });
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,request_fingerprint,seller_account_key,
       status,error_message,worker_token_id,claim_token,lease_expires_at,
       credential_refresh_in_flight,credential_refresh_fingerprint,
       prepared_credential_id,credential_refresh_prepared_at,
       credential_refresh_recovery_vault_id,
       credential_refresh_recovery_fingerprint,
       credential_refresh_recovery_staged_at,credential_refresh_started_at,
       oauth_request_vault_id,oauth_request_fingerprint,
       oauth_source_credential_id,oauth_exchange_completed,
       oauth_provider_call_started_at,attempt_count,
       provider_mutation_started_at,created_at,started_at,completed_at,updated_at
     ) values (
       $1,$2,$3,$4,'qoo10','listing.update','production',$5::jsonb,$6::jsonb,
       $7,$8,'reconciliation_required',$9,null,null,null,false,null,null,null,
       null,null,null,null,null,null,null,false,null,1,$10,
       '2026-08-30T20:23:21.41397Z','2026-08-30T20:25:05.865099Z',
       '2026-08-30T20:41:03.259905Z','2026-08-30T20:41:03.259905Z'
     )`,
    [
      JOB_ID, CREDENTIAL_ID, ATTEMPT_ID, LISTING_ID, JSON.stringify(request),
      options.responsePayload === undefined ? null : JSON.stringify(options.responsePayload),
      REQUEST_FINGERPRINT, SELLER_KEY, ORIGINAL_ERROR,
      options.providerMutationStartedAt ?? null,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_create_rollback_confirmations
     values (
       $1,$2,$3,$4,$5,'910B8E8633C1',$6,$7,8461402963,'320000542',
       1871,1871,1,'0','S1','reconciliation_required','failed',
       'manual_required','failed','failed','paused','external_action','retryable',
       'unknown','non_public',null,'S1','live','2026-08-30T14:51:26.505498Z'
     )`,
    [SOURCE_JOB_ID, SOURCE_ATTEMPT_ID, LISTING_ID, CREDENTIAL_ID, SOURCE_FINGERPRINT, SELLER_KEY, REMOTE_ID],
  );
  await db.query(
    `insert into sellerpilot_private.listing_mutation_release_gate values (
       true,$1,$2,$3,$4,clock_timestamp()
     )`,
    [
      options.gateOpen ?? false,
      options.gateOpen ? "2026-08-30T20:42:00Z" : null,
      options.gateOpen ? "a".repeat(40) : null,
      options.gateOpen ? "qoo10" : null,
    ],
  );
  if (options.listingStatus) {
    await db.query(
      "update sellerpilot_private.product_listings set status=$2 where id=$1",
      [LISTING_ID, options.listingStatus],
    );
  }
  if (options.laterJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,listing_id,channel,operation,environment,
         request_payload,request_fingerprint,seller_account_key,status,
         created_at,updated_at
       ) values (
         '45be7858-f670-4a62-80bf-13b49e45cae5',$1,$2,'qoo10',
         'listing.update','production','{}',$3,$4,'failed',
         '2026-08-30T20:42:00Z','2026-08-30T20:42:00Z'
       )`,
      [CREDENTIAL_ID, LISTING_ID, "9".repeat(64), SELLER_KEY],
    );
  }
  return db;
}

async function renderedMigration(db) {
  const source = await readFile(migrationUrl, "utf8");
  const requestSha = await scalar(
    db,
    `select encode(extensions.digest(request_payload::text,'sha256'),'hex') value
       from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [JOB_ID],
  );
  const descriptionSha = createHash("sha256").update(DESCRIPTION, "utf8").digest("hex");
  return source
    .replaceAll(PRODUCTION_REQUEST_SHA, requestSha)
    .replaceAll(PRODUCTION_DESCRIPTION_SHA, descriptionSha);
}

test("exact pre-provider denial is cancelled without mutating provider evidence", async () => {
  const db = await seedDatabase();
  try {
    const before = (await db.query(
      `select
         (select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1) request_payload,
         (select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1) response_payload,
         (select coalesce(jsonb_agg(to_jsonb(receipt)),'[]'::jsonb)
            from sellerpilot_private.gateway_completion_receipts receipt where job_id=$1) receipts,
         (select to_jsonb(product) from sellerpilot_private.products product where id=$2) product`,
      [JOB_ID, PRODUCT_ID],
    )).rows[0];
    const migration = await renderedMigration(db);
    await db.exec(migration);

    assert.deepEqual(
      (await db.query(
        `select job.status job_status,job.error_message,job.response_payload,
                job.provider_mutation_started_at,
                attempt.status attempt_status,attempt.http_status,
                attempt.remote_id,attempt.safe_message,
                listing.status listing_status,listing.failure_class,
                listing.operation_attempt_id::text operation_attempt_id,
                listing.remote_visibility,listing.provider_status,
                listing.last_verified_at::text last_verified_at,
                listing.last_error
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id=job.attempt_id
           join sellerpilot_private.product_listings listing
             on listing.id=job.listing_id
          where job.id=$1`,
        [JOB_ID],
      )).rows,
      [{
        job_status: "cancelled",
        error_message: TERMINAL_ERROR,
        response_payload: null,
        provider_mutation_started_at: null,
        attempt_status: "failed",
        http_status: 409,
        remote_id: null,
        safe_message: ATTEMPT_MESSAGE,
        listing_status: "paused",
        failure_class: "retryable",
        operation_attempt_id: SOURCE_ATTEMPT_ID,
        remote_visibility: "non_public",
        provider_status: "S1",
        last_verified_at: "2026-08-30 14:51:26.505498+00",
        last_error: LISTING_ERROR,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select item_title,seller_sku,provider_status,remote_visibility,
                retail_price_jpy,sell_price_jpy,quantity,category_code,
                origin_type,origin_code,shipping_no,bi_contents_no,
                ordered_image_urls,ordered_image_digest_sha256,
                provider_mutation_started,provider_call_replayed
           from sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations`,
      )).rows,
      [{
        item_title: "貼り付け式ケーブル整理クリップ6個セット",
        seller_sku: "QA-20260823-CC-001",
        provider_status: "S1",
        remote_visibility: "non_public",
        retail_price_jpy: 1871,
        sell_price_jpy: 1871,
        quantity: 1,
        category_code: "320000542",
        origin_type: "2",
        origin_code: "CN",
        shipping_no: "806971",
        bi_contents_no: 8461402963,
        ordered_image_urls: IMAGE_URLS,
        ordered_image_digest_sha256: IMAGE_DIGEST,
        provider_mutation_started: false,
        provider_call_replayed: false,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value from sellerpilot_private.operation_audit
          where action='qoo10_exact_preprovider_gate_denial_reconciled'`,
      ),
      1,
    );
    const after = (await db.query(
      `select
         (select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1) request_payload,
         (select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1) response_payload,
         (select coalesce(jsonb_agg(to_jsonb(receipt)),'[]'::jsonb)
            from sellerpilot_private.gateway_completion_receipts receipt where job_id=$1) receipts,
         (select to_jsonb(product) from sellerpilot_private.products product where id=$2) product`,
      [JOB_ID, PRODUCT_ID],
    )).rows[0];
    assert.deepEqual(after, before);

    assert.deepEqual(
      (await db.query(
        `select table_class.relrowsecurity rls_enabled,
                not has_table_privilege('anon',table_class.oid,'select')
                  and not has_table_privilege('authenticated',table_class.oid,'select')
                  and not has_table_privilege('service_role',table_class.oid,'select')
                  as private_table
           from pg_catalog.pg_class table_class
          where table_class.oid=
            'sellerpilot_private.qoo10_preprovider_gate_denial_reconciliations'::regclass`,
      )).rows,
      [{ rls_enabled: true, private_table: true }],
    );
    assert.deepEqual(
      (await db.query(
        `select procedure.prosecdef security_definer,
                procedure.proconfig @> array['search_path=']::text[]
                  or procedure.proconfig @> array['search_path=""']::text[]
                  as locked_search_path,
                not has_function_privilege('service_role',procedure.oid,'execute')
                  as service_role_revoked
           from pg_catalog.pg_proc procedure
          where procedure.oid=
            'sellerpilot_private.qoo10_exact_preprovider_gate_restore_allowed(jsonb,jsonb,text)'::regprocedure`,
      )).rows,
      [{ security_definer: true, locked_search_path: true, service_role_revoked: true }],
    );

    await db.exec(migration);
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value from sellerpilot_private.operation_audit
          where action='qoo10_exact_preprovider_gate_denial_reconciled'`,
      ),
      1,
      "migration replay must be idempotent",
    );
  } finally {
    await db.close();
  }
});

for (const [name, options, expected] of [
  ["an open release gate", { gateOpen: true }, /requires closed gate/],
  ["a non-NULL provider response", { responsePayload: { ok: false } }, /job evidence mismatch/],
  ["a provider mutation marker", { providerMutationStartedAt: "2026-08-30T20:30:00Z" }, /job evidence mismatch/],
  [
    "request semantic drift hidden behind a matching fixture digest",
    { mutateRequest: (request) => { request.arguments.params.ItemTitle = "DIFFERENT"; } },
    /request semantic mismatch/,
  ],
  [
    "approved image ordinality drift hidden behind a matching fixture digest",
    {
      mutateRequest: (request) => {
        request.arguments.sellerpilotPublicationAssetBinding.approvedDetailImages.reverse();
      },
    },
    /request semantic mismatch/,
  ],
  [
    "an approved image count below eight hidden behind a matching fixture digest",
    {
      mutateRequest: (request) => {
        request.arguments.sellerpilotPublicationAssetBinding.approvedDetailImages.pop();
      },
    },
    /request semantic mismatch/,
  ],
  ["a later listing write", { laterJob: true }, /listing mutation ledger mismatch/],
  ["listing state drift", { listingStatus: "queued" }, /unresolved state mismatch/],
]) {
  test(`exact pre-provider reconciliation fails closed for ${name}`, async () => {
    const db = await seedDatabase(options);
    try {
      await assert.rejects(
        db.exec(await renderedMigration(db)),
        (error) => {
          assert.match(error instanceof Error ? error.message : String(error), expected);
          assert.equal(error?.code, "55000");
          return true;
        },
      );
      await db.exec("rollback");
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer value from information_schema.tables
            where table_schema='sellerpilot_private'
              and table_name='qoo10_preprovider_gate_denial_reconciliations'`,
        ),
        0,
      );
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer value from sellerpilot_private.operation_audit
            where action='qoo10_exact_preprovider_gate_denial_reconciled'`,
        ),
        0,
      );
    } finally {
      await db.close();
    }
  });
}
