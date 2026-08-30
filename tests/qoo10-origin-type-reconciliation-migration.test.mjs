import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const UPDATE_JOB_ID = "2b56d31c-9d88-4df6-9be0-ab2aebc2c918";
const UPDATE_ATTEMPT_ID = "dc9a6e45-e333-4a15-b432-c14a03734f9c";
const LISTING_ID = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const SOURCE_JOB_ID = "0bc5ff1f-c884-4615-8a79-4688da46af6a";
const SOURCE_ATTEMPT_ID = "05e1959d-d7d8-4389-b7de-7335d28e4f91";
const LEGACY_CREATE_JOB_ID = "2b6258c8-f1fd-4dc2-baed-b0019dd66112";
const OWNER_ID = "82b8859d-046d-4b23-bd04-dc4092fc735d";
const REMOTE_ID = "1217336970";
const SELLER_KEY = "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const UPDATE_FINGERPRINT = "a506bd889bb2e88b9eedde0815a606016cd069277cfc026e55a18ed061512cff";
const SOURCE_FINGERPRINT = "66759b5ea49910ae5b97d5f8311fce73f4f36f9ed37148692407e037563f1527";
const PRODUCTION_REQUEST_SHA = "49e5e2d5b528597324489de0fdea689170b8e19e12dba577a9935c7a9205a010";
const PRODUCTION_RESPONSE_SHA = "6410ec1b128921744770c90a1a2766737d3be67191814937550fd3d22432253f";
const FIXED_LISTING_ERROR =
  "Qoo10 원격 상품 비공개(S1) 롤백 확인 완료 · listing.update 재시도 필요";
const FIXED_ATTEMPT_MESSAGE =
  "Qoo10 UpdateGoods 명시 거부 · provider acceptance 증거 없음 · S1 핵심 관측 유지 · 전체 mutable 비교 미확정";
const migrationUrl = new URL(
  "../supabase/migrations/20260831010000_resolve_exact_qoo10_origin_type_rejection.sql",
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
  product_id uuid not null,
  channel_key text not null,
  market text not null,
  target_id text not null,
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
  credential_id uuid not null,
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
alter table sellerpilot_private.qoo10_listing_create_rollback_confirmations
  enable row level security;
revoke all on table
  sellerpilot_private.qoo10_listing_create_rollback_confirmations
  from public, anon, authenticated, service_role;
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
  updated_at timestamptz not null
);

create or replace function sellerpilot_private.guard_product_listing_seller_lineage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('sellerpilot.qoo10_rollback_retry_job', true), '') is not null then
    return new;
  end if;
  return new;
end;
$$;
create trigger guard_product_listing_seller_lineage
before update on sellerpilot_private.product_listings
for each row execute function sellerpilot_private.guard_product_listing_seller_lineage();

create or replace function
  sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(
    p_old jsonb, p_new jsonb, p_update_job_id text
  )
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform jsonb_build_object('shippingNo', confirmation.shipping_no)
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.channel_gateway_jobs update_job
      on update_job.id = p_update_job_id::uuid
   where false;
  return false;
end;
$$;

create or replace function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    p_listing_id uuid, p_credential_id uuid, p_product_id uuid,
    p_market text, p_target_id text
  )
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_listing uuid;
  v_shipping text;
  v_bi bigint;
begin
  select listing.id,
         confirmation.shipping_no,
         confirmation.bi_contents_no
    into v_listing, v_shipping, v_bi
    from sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
    join sellerpilot_private.product_listings listing
      on listing.id = confirmation.listing_id
   where confirmation.listing_id = p_listing_id
     and confirmation.credential_id = p_credential_id
     and listing.product_id = p_product_id
     and listing.market = p_market
     and listing.target_id = p_target_id;
  return jsonb_build_object('status', 'allowed', 'shippingNo', v_shipping);
end;
$$;

create or replace function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid, p_credential_id uuid, p_attempt_id uuid,
  p_channel text, p_operation text, p_request_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_expected_state jsonb :=
    p_request_payload#>'{arguments,sellerpilotQoo10RollbackUpdateRecovery,expectedState}';
  v_count integer;
begin
  select count(*) into v_count
        from sellerpilot_private.qoo10_listing_create_rollback_confirmations
          confirmation
        join sellerpilot_private.product_listings listing
          on listing.id = confirmation.listing_id
       where confirmation.listing_id = p_listing_id
         and confirmation.credential_id = p_credential_id
         and confirmation.shipping_no = v_expected_state->>'shippingNo';
  return jsonb_build_object('allowed', v_count = 1);
end;
$$;

create or replace function public.sellerpilot_complete_channel_gateway_job(
  p_token_hash text, p_job_id uuid, p_claim_token uuid, p_status text,
  p_response_payload jsonb, p_error_message text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform jsonb_build_object('shippingNo', confirmation.shipping_no)
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_operation_attempts update_attempt
      on update_attempt.id = job.attempt_id
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
    join sellerpilot_private.products product
      on product.id = listing.product_id
    join sellerpilot_private.qoo10_listing_create_rollback_confirmations
      confirmation
      on confirmation.listing_id = listing.id
     and confirmation.credential_id = job.credential_id
   where job.id = p_job_id;
  return true;
end;
$$;

revoke all on function
  sellerpilot_private.guard_product_listing_seller_lineage()
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(
    jsonb,jsonb,text
  ) from public, anon, authenticated, service_role;
revoke all on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid,uuid,uuid,text,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_get_qoo10_rollback_update_identity(
    uuid,uuid,uuid,text,text
  ) to service_role;
revoke all on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid,uuid,uuid,text,text,jsonb
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_enqueue_listing_gateway_job(
    uuid,uuid,uuid,text,text,jsonb
  ) to service_role;
revoke all on function
  public.sellerpilot_complete_channel_gateway_job(
    text,uuid,uuid,text,jsonb,text
  ) from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_complete_channel_gateway_job(
    text,uuid,uuid,text,jsonb,text
  ) to service_role;
`;

function requestFixture() {
  return {
    arguments: {
      params: {
        ItemCode: REMOTE_ID,
        SecondSubCat: "320000542",
        ProductionPlace: "CN",
        ShippingNo: "0",
      },
      publicationIntent: "live",
      publicationExpectedFingerprint: UPDATE_FINGERPRINT,
      sellerpilotQoo10RollbackUpdateRecovery: {
        status: "allowed",
        contract: "qoo10_create_rollback_confirmation_v1",
        listingId: LISTING_ID,
        remoteId: REMOTE_ID,
        providerStatus: "S1",
        sourceJobId: SOURCE_JOB_ID,
        expectedState: {
          categoryCode: "320000542",
          retailPriceJpy: 1871,
          sellPriceJpy: 1871,
          quantity: 1,
          shippingNo: "0",
          biContentsNo: 8461402963,
        },
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
        data: {
          ResultCode: -99,
          ResultMsg: "ProductionPlaceTypeは必須です。",
        },
      },
      {
        name: "qoo10-rollback-update-rejection-s1-readback",
        ok: false,
        status: 200,
        data: {
          ResultCode: 0,
          ResultObject: [{
            ItemNo: REMOTE_ID,
            ItemStatus: "S1",
            ProductionPlaceType: "2",
            ProductionPlace: "CN",
            ItemPrice: "1871.0000",
            RetailPrice: "1871.0000",
            ItemQty: "1",
            ShippingNo: "806971",
          }],
          actualImageCount: 8,
          providerStatus: "S1",
          sellerpilotExpectedProviderStatus: "S1",
          sellerpilotExactDetailImageCount: 8,
          sellerpilotVerification: "QOO10_ROLLBACK_UPDATE_REJECTION_S1_UNVERIFIED",
          sellerpilotMutableVerification: "LISTING_MUTABLE_FIELDS_MISMATCH",
          sellerpilotMismatchPaths: ["Keyword"],
          sellerpilotReconciliationRequired: true,
          sellerpilotPublicationChecks: {
            titleVerified: true,
            localeVerified: true,
            statusVerified: true,
            categoryVerified: true,
            identityVerified: true,
            quantityVerified: true,
            imageCountVerified: true,
            sellerCodeVerified: true,
            fingerprintVerified: true,
            detailImageUrlsVerified: true,
            detailImageDigestVerified: true,
            confirmedBiCdnImageVerified: true,
            recoveryExpectationVerified: true,
            representativeImageVerified: true,
            sellerAccountIdentityVerified: true,
            shippingVerified: false,
            sellPriceVerified: false,
            retailPriceVerified: false,
            priceQuantityVerified: false,
          },
        },
      },
    ],
  };
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

async function seedDatabase(options = {}) {
  const db = new PGlite();
  await db.exec(compatibilitySql);
  const request = requestFixture();
  const response = responseFixture();
  options.mutateRequest?.(request);
  options.mutateResponse?.(response);

  await db.query(
    `insert into sellerpilot_private.channel_credentials values
      ($1,'qoo10','production','active',clock_timestamp()+interval '1 year',
       '910B8E8633C1',$2,'credential_incarnation_v1',
       '2026-08-25T11:40:32.606508Z','2026-08-20T08:35:56.238133Z')`,
    [CREDENTIAL_ID, SELLER_KEY],
  );
  await db.query(
    `update sellerpilot_private.channel_credentials
        set expires_at='2027-08-20T14:59:59Z'
      where id=$1`,
    [CREDENTIAL_ID],
  );
  await db.query(
    `insert into sellerpilot_private.channel_operation_attempts (
       id,owner_id,credential_id,channel,operation,status,http_status,remote_id,
       safe_message,gateway_write_required,pre_gateway_retryable,
       request_fingerprint,seller_account_key,started_at,completed_at
     ) values
       ($1,$2,$3,'qoo10','listing.create','failed',409,$4,
        'Qoo10 신규 등록 롤백(S1)이 확인되어 기존 원격 상품으로 수정 재시도가 가능합니다.',
        true,false,$5,$6,
        '2026-08-30T14:45:00Z',$7),
       ($8,$2,$3,'qoo10','listing.update',$9,409,$4,
        'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。',
        true,false,$10,$6,'2026-08-30T14:59:48.089764Z',
        '2026-08-30T15:06:13.213314Z')`,
    [
      SOURCE_ATTEMPT_ID, OWNER_ID, CREDENTIAL_ID, REMOTE_ID,
      SOURCE_FINGERPRINT, SELLER_KEY, "2026-08-30T14:51:26.505498Z",
      UPDATE_ATTEMPT_ID, options.partialTerminal ? "failed" : "manual_required",
      UPDATE_FINGERPRINT,
    ],
  );
  await db.query(
    `insert into sellerpilot_private.products
       (id,owner_id,status,demo,updated_at)
     values ($1,$2,'draft',false,'2026-08-30T14:40:00Z')`,
    [PRODUCT_ID, OWNER_ID],
  );
  await db.query(
    `insert into sellerpilot_private.product_listings (
       id,owner_id,product_id,channel_key,market,target_id,remote_id,status,
       operation_attempt_id,failure_class,requested_publication_intent,
       remote_visibility,provider_status,seller_account_key,published_at,
       last_verified_at,last_error,price,updated_at
     ) values (
       $1,$2,$3,'qoo10','JP','qoo10-jp',$4,$5,$6,$7,'live',$8,null,$9,null,
       null,'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。',
       1871,'2026-08-30T15:06:14.060943Z'
     )`,
    [
      LISTING_ID, OWNER_ID, PRODUCT_ID, REMOTE_ID,
      options.partialTerminal ? "paused" : "failed",
      options.partialTerminal ? SOURCE_ATTEMPT_ID : UPDATE_ATTEMPT_ID,
      options.partialTerminal ? "retryable" : "external_action",
      options.partialTerminal ? "non_public" : "unknown",
      SELLER_KEY,
    ],
  );
  if (options.partialTerminal) {
    await db.query(
      `update sellerpilot_private.product_listings
          set provider_status='S1',last_verified_at=$2,last_error=$3
        where id=$1`,
      [LISTING_ID, "2026-08-30T14:51:26.505498Z", FIXED_LISTING_ERROR],
    );
  }
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,listing_id,channel,operation,environment,request_payload,
       request_fingerprint,status,created_at,updated_at
     ) values (
       $1,$2,$3,'qoo10','listing.create','production','{}',$4,'failed',
       '2026-08-30T11:23:25.017463Z','2026-08-30T11:23:25.017463Z'
     )`,
    [LEGACY_CREATE_JOB_ID, CREDENTIAL_ID, LISTING_ID, "4".repeat(64)],
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,request_fingerprint,seller_account_key,
       status,error_message,provider_mutation_started_at,created_at,started_at,
       completed_at,updated_at
     ) values
       ($1,$2,$3,$4,'qoo10','listing.create','production','{}','{}',$5,$6,
        'failed','QOO10_LISTING_CREATE_ROLLBACK_CONFIRMED: provider status S1; continue only with listing.update.',
        null,'2026-08-30T12:56:53.380373Z','2026-08-30T14:46:00Z',$7,$7),
       ($8,$2,$9,$4,'qoo10','listing.update','production',$10::jsonb,$11::jsonb,$12,$6,
        $13,'Qoo10 Japan listing.update 작업이 원격 오류로 종료됐습니다. · UpdateGoods: ProductionPlaceTypeは必須です。',
        '2026-08-30T15:06:06.574809Z','2026-08-30T14:59:56.436937Z',
        '2026-08-30T15:06:05.22258Z','2026-08-30T15:06:13.213314Z',
        '2026-08-30T15:06:13.213314Z')`,
    [
      SOURCE_JOB_ID, CREDENTIAL_ID, SOURCE_ATTEMPT_ID, LISTING_ID,
      SOURCE_FINGERPRINT, SELLER_KEY, "2026-08-30T14:51:26.505498Z",
      UPDATE_JOB_ID, UPDATE_ATTEMPT_ID, JSON.stringify(request),
      JSON.stringify(response), UPDATE_FINGERPRINT,
      options.partialTerminal ? "succeeded" : "reconciliation_required",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.qoo10_listing_create_rollback_confirmations
     values (
       $1,$2,$3,$4,$5,'910B8E8633C1',$6,$7,8461402963,'320000542',
       1871,1871,1,'0','S1','reconciliation_required','failed',
       'manual_required','failed','failed','paused','external_action','retryable',
       'unknown','non_public',null,'S1','live',$8
     )`,
    [
      SOURCE_JOB_ID, SOURCE_ATTEMPT_ID, LISTING_ID, CREDENTIAL_ID,
      SOURCE_FINGERPRINT, SELLER_KEY, REMOTE_ID,
      "2026-08-30T14:51:26.505498Z",
    ],
  );
  await db.query(
    `insert into sellerpilot_private.gateway_completion_receipts values (
       $1,'a6a1fc7a-4b4b-460e-aba6-65599ed122e0',
       '97b5f43a-b526-4b2c-8cd3-4b30b51c2d6d',
       $2,null,'2026-08-30T15:06:14.16154Z'
     )`,
    [
      UPDATE_JOB_ID,
      options.badReceipt
        ? "0".repeat(64)
        : "f8a24ebcb159bbd27a1a08b7a38bd187e4ead47bc8f5e4f5f4d4f31d7aff1a89",
    ],
  );
  await db.exec(
    `insert into sellerpilot_private.listing_mutation_release_gate
     values (true,false,null,null,clock_timestamp())`,
  );
  await db.query(
    `insert into sellerpilot_private.channel_gateway_jobs (
       id,credential_id,attempt_id,listing_id,channel,operation,environment,
       request_payload,response_payload,request_fingerprint,seller_account_key,
       status,error_message,created_at,updated_at,completed_at
     ) values (
       'bd402ec8-bf01-45b4-bf26-8c4b3e404e2d',$1,null,null,'shopee',
       'listing.create','production','{}','{}',$2,$3,'succeeded',null,
       '2026-08-23T07:47:07Z','2026-08-23T07:47:50Z','2026-08-23T07:47:50Z'
     )`,
    [CREDENTIAL_ID, "3".repeat(64), "unrelated-terminal-history"],
  );
  if (options.laterJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,response_payload,request_fingerprint,seller_account_key,
         status,error_message,created_at,updated_at
       ) values (
         'b1bc827f-df32-4bdf-a40c-884f93e5851a',$1,null,$2,'qoo10',
         'listing.update','production','{}',null,$3,$4,'failed',null,
         '2026-08-30T15:10:00Z','2026-08-30T15:10:00Z'
       )`,
      [CREDENTIAL_ID, LISTING_ID, "1".repeat(64), SELLER_KEY],
    );
  }
  if (options.globalActiveJob) {
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,response_payload,request_fingerprint,seller_account_key,
         status,error_message,created_at,updated_at
       ) values (
         'dc9c6705-722f-4e57-a158-0105ef7e213c',$1,null,null,'qoo10',
         'listing.stop','production','{}',null,$2,$3,'queued',null,
         '2026-08-30T14:00:00Z','2026-08-30T14:00:00Z'
       )`,
      [CREDENTIAL_ID, "2".repeat(64), SELLER_KEY],
    );
  }
  if (options.nullAttemptHttpStatus) {
    await db.query(
      `update sellerpilot_private.channel_operation_attempts
          set http_status=null where id=$1`,
      [UPDATE_ATTEMPT_ID],
    );
  }
  if (options.nullJobStartedAt) {
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set started_at=null where id=$1`,
      [UPDATE_JOB_ID],
    );
  }
  if (options.nullProviderMutationStartedAt) {
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set provider_mutation_started_at=null where id=$1`,
      [UPDATE_JOB_ID],
    );
  }
  if (options.nullJobCompletedAt) {
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set completed_at=null where id=$1`,
      [UPDATE_JOB_ID],
    );
  }
  if (options.nullListingFailureClass) {
    await db.query(
      `update sellerpilot_private.product_listings
          set failure_class=null where id=$1`,
      [LISTING_ID],
    );
  }
  if (options.listingProviderStatusDrift) {
    await db.query(
      `update sellerpilot_private.product_listings
          set provider_status='S1' where id=$1`,
      [LISTING_ID],
    );
  }
  if (options.listingVerifiedAtDrift) {
    await db.query(
      `update sellerpilot_private.product_listings
          set last_verified_at='2026-08-30T15:00:00Z' where id=$1`,
      [LISTING_ID],
    );
  }
  return db;
}

async function renderedMigration(db) {
  const source = await readFile(migrationUrl, "utf8");
  const hashes = (await db.query(
    `select
       encode(extensions.digest(request_payload::text,'sha256'),'hex') request_sha,
       encode(extensions.digest(response_payload::text,'sha256'),'hex') response_sha
     from sellerpilot_private.channel_gateway_jobs where id=$1`,
    [UPDATE_JOB_ID],
  )).rows[0];
  return source
    .replaceAll(PRODUCTION_REQUEST_SHA, hashes.request_sha)
    .replaceAll(PRODUCTION_RESPONSE_SHA, hashes.response_sha);
}

test("exact Qoo10 ProductionPlaceType rejection restores only retryable update state and preserves evidence", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    const before = (await db.query(
      `select
         (select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1) request_payload,
         (select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1) response_payload,
         (select to_jsonb(receipt) from sellerpilot_private.gateway_completion_receipts receipt where job_id=$1) receipt,
         (select to_jsonb(product) from sellerpilot_private.products product where id=$2) product`,
      [UPDATE_JOB_ID, PRODUCT_ID],
    )).rows[0];

    await db.exec(migration);

    assert.deepEqual(
      (await db.query(
        `select job.status job_status,job.error_message,
                attempt.status attempt_status,attempt.http_status,
                attempt.remote_id,attempt.safe_message,
                listing.status listing_status,listing.failure_class,
                listing.remote_visibility,listing.provider_status,
                listing.operation_attempt_id::text operation_attempt_id,
                listing.last_verified_at::text last_verified_at,listing.last_error
           from sellerpilot_private.channel_gateway_jobs job
           join sellerpilot_private.channel_operation_attempts attempt
             on attempt.id=job.attempt_id
           join sellerpilot_private.product_listings listing
             on listing.id=job.listing_id
          where job.id=$1`,
        [UPDATE_JOB_ID],
      )).rows,
      [{
        job_status: "succeeded",
        error_message: null,
        attempt_status: "failed",
        http_status: 200,
        remote_id: REMOTE_ID,
        safe_message: FIXED_ATTEMPT_MESSAGE,
        listing_status: "paused",
        failure_class: "retryable",
        remote_visibility: "non_public",
        provider_status: "S1",
        operation_attempt_id: SOURCE_ATTEMPT_ID,
        last_verified_at: "2026-08-30 14:51:26.505498+00",
        last_error: FIXED_LISTING_ERROR,
      }],
    );
    const after = (await db.query(
      `select
         (select request_payload from sellerpilot_private.channel_gateway_jobs where id=$1) request_payload,
         (select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1) response_payload,
         (select to_jsonb(receipt) from sellerpilot_private.gateway_completion_receipts receipt where job_id=$1) receipt,
         (select to_jsonb(product) from sellerpilot_private.products product where id=$2) product`,
      [UPDATE_JOB_ID, PRODUCT_ID],
    )).rows[0];
    assert.deepEqual(after, before, "raw payloads, receipt, and product must be byte-logically unchanged");
    assert.deepEqual(
      (await db.query(
        `select source_shipping_no,observed_shipping_no,provider_status,
                provider_mutation_accepted
           from sellerpilot_private.qoo10_listing_update_rejection_observations`,
      )).rows,
      [{
        source_shipping_no: "0",
        observed_shipping_no: "806971",
        provider_status: "S1",
        provider_mutation_accepted: false,
      }],
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value from sellerpilot_private.operation_audit
          where action='qoo10_exact_origin_rejection_reconciliation_resolved'`,
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select table_class.relrowsecurity as rls_enabled,
                table_class.relforcerowsecurity as rls_forced,
                not has_table_privilege('anon',table_class.oid,'select')
                  and not has_table_privilege('authenticated',table_class.oid,'select')
                  and not has_table_privilege('service_role',table_class.oid,'select')
                  as private_table,
                owner_role.rolname as owner_name,
                owner_role.rolbypassrls as owner_bypasses_rls,
                (select count(*)::integer from pg_catalog.pg_policy policy
                  where policy.polrelid=table_class.oid) as policy_count,
                (select count(*)::integer
                   from aclexplode(coalesce(
                     table_class.relacl,
                     acldefault('r',table_class.relowner)
                   )) acl
                  where acl.grantee<>table_class.relowner) as nonowner_grants,
                (select count(distinct acl.privilege_type)::integer
                   from aclexplode(coalesce(
                     table_class.relacl,
                     acldefault('r',table_class.relowner)
                   )) acl
                  where acl.grantee=table_class.relowner) as owner_privileges
           from pg_catalog.pg_class table_class
           join pg_catalog.pg_roles owner_role
             on owner_role.oid=table_class.relowner
          where table_class.oid=
            'sellerpilot_private.qoo10_listing_update_rejection_observations'::regclass`,
      )).rows,
      [{
        rls_enabled: true,
        rls_forced: false,
        private_table: true,
        owner_name: "postgres",
        owner_bypasses_rls: true,
        policy_count: 0,
        nonowner_grants: 0,
        owner_privileges: 8,
      }],
    );
    assert.deepEqual(
      (await db.query(
        `select procedure.prosecdef as security_definer,
                procedure.proconfig @> array['search_path=']::text[]
                  or procedure.proconfig @> array['search_path=""']::text[]
                  as locked_search_path,
                not has_function_privilege(
                  'service_role',procedure.oid,'execute'
                ) as service_role_revoked
           from pg_catalog.pg_proc procedure
          where procedure.oid=
            'sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(jsonb,jsonb,text)'::regprocedure`,
      )).rows,
      [{
        security_definer: true,
        locked_search_path: true,
        service_role_revoked: true,
      }],
    );
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_get_qoo10_rollback_update_identity(
          $1,$2,$3,'JP','qoo10-jp'
        ) value`,
        [LISTING_ID, CREDENTIAL_ID, PRODUCT_ID],
      ),
      { status: "allowed", shippingNo: "806971" },
      "the next update must use the separately observed provider delivery group",
    );
    const nextPayload = requestFixture();
    nextPayload.arguments.sellerpilotQoo10RollbackUpdateRecovery.expectedState.shippingNo = "806971";
    assert.deepEqual(
      await scalar(
        db,
        `select public.sellerpilot_service_enqueue_listing_gateway_job(
          $1,$2,$3,'qoo10','listing.update',$4::jsonb
        ) value`,
        [LISTING_ID, CREDENTIAL_ID, UPDATE_ATTEMPT_ID, JSON.stringify(nextPayload)],
      ),
      { allowed: true },
    );

    const replayAttemptId = "62c477a6-f8ed-4c4a-80a6-3f97418a00b4";
    const replayJobId = "98711a18-cfd1-45a1-bff7-843ddc19e9c8";
    await db.query(
      `insert into sellerpilot_private.channel_operation_attempts (
         id,owner_id,credential_id,channel,operation,status,http_status,
         remote_id,safe_message,gateway_write_required,pre_gateway_retryable,
         request_fingerprint,seller_account_key,started_at,completed_at
       ) values (
         $1,$2,$3,'qoo10','listing.update','running',null,$4,null,true,false,
         $5,$6,'2026-08-30T15:20:00Z',null
       )`,
      [
        replayAttemptId,
        OWNER_ID,
        CREDENTIAL_ID,
        REMOTE_ID,
        "9".repeat(64),
        SELLER_KEY,
      ],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id,credential_id,attempt_id,listing_id,channel,operation,environment,
         request_payload,response_payload,request_fingerprint,
         seller_account_key,status,error_message,created_at,updated_at
       ) values (
         $1,$2,$3,$4,'qoo10','listing.update','production','{}',null,$5,$6,
         'queued',null,'2026-08-30T15:20:01Z','2026-08-30T15:20:01Z'
       )`,
      [
        replayJobId,
        CREDENTIAL_ID,
        replayAttemptId,
        LISTING_ID,
        "9".repeat(64),
        SELLER_KEY,
      ],
    );
    await db.query(
      `update sellerpilot_private.product_listings
          set operation_attempt_id=$2,status='queued',failure_class=null,
              last_error=null,updated_at='2026-08-30T15:20:01Z'
        where id=$1`,
      [LISTING_ID, replayAttemptId],
    );
    await db.exec(
      `update sellerpilot_private.listing_mutation_release_gate
          set is_open=true,opened_at='2026-08-30T15:20:02Z'
        where singleton`,
    );

    await db.exec(migration);
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value from sellerpilot_private.operation_audit
          where action='qoo10_exact_origin_rejection_reconciliation_resolved'`,
      ),
      1,
      "reapplying the migration must be idempotent",
    );
    assert.equal(
      await scalar(
        db,
        `select count(*)::integer value
           from sellerpilot_private.qoo10_listing_update_rejection_observations`,
      ),
      1,
    );
    assert.deepEqual(
      (await db.query(
        `select status,operation_attempt_id::text operation_attempt_id
           from sellerpilot_private.product_listings where id=$1`,
        [LISTING_ID],
      )).rows,
      [{ status: "queued", operation_attempt_id: replayAttemptId }],
      "terminal replay must not rewind a legitimate later update",
    );
  } finally {
    await db.close();
  }
});

for (const [name, options, expected] of [
  [
    "a different provider rejection message",
    { mutateResponse: (response) => { response.steps[0].data.ResultMsg = "DIFFERENT"; } },
    /explicit rejection response mismatch/,
  ],
  [
    "an accepted provider mutation marker",
    { mutateResponse: (response) => { response.steps[0].data.sellerpilotMutation = "accepted"; } },
    /explicit rejection response mismatch/,
  ],
  [
    "a first-step reconciliation marker",
    { mutateResponse: (response) => { response.steps[0].data.sellerpilotReconciliationRequired = false; } },
    /explicit rejection response mismatch/,
  ],
  [
    "a changed S1 delivery group",
    { mutateResponse: (response) => { response.steps[1].data.ResultObject[0].ShippingNo = "0"; } },
    /unchanged S1 item readback mismatch/,
  ],
  ["a later listing job", { laterJob: true }, /production listing mutation ledger mismatch/],
  [
    "an unrelated active listing mutation",
    { globalActiveJob: true },
    /active listing mutation set mismatch/,
  ],
  ["a different completion receipt", { badReceipt: true }, /completion receipt mismatch/],
  ["a partial terminal state", { partialTerminal: true }, /partial exact Qoo10 reconciliation state/],
  ["a NULL attempt HTTP status", { nullAttemptHttpStatus: true }, /unresolved state mismatch/],
  ["a NULL job started_at", { nullJobStartedAt: true }, /update job evidence mismatch/],
  [
    "a NULL provider mutation started_at",
    { nullProviderMutationStartedAt: true },
    /update job evidence mismatch/,
  ],
  ["a NULL job completed_at", { nullJobCompletedAt: true }, /update job evidence mismatch/],
  ["a NULL listing failure class", { nullListingFailureClass: true }, /unresolved state mismatch/],
  [
    "a non-NULL initial listing provider status",
    { listingProviderStatusDrift: true },
    /unresolved state mismatch/,
  ],
  [
    "a non-NULL initial listing verification time",
    { listingVerifiedAtDrift: true },
    /unresolved state mismatch/,
  ],
]) {
  test(`exact reconciliation fails closed for ${name}`, async () => {
    const db = await seedDatabase(options);
    try {
      await assert.rejects(db.exec(await renderedMigration(db)), expected);
      await db.exec("rollback");
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer value
             from information_schema.tables
            where table_schema='sellerpilot_private'
              and table_name='qoo10_listing_update_rejection_observations'`,
        ),
        0,
        "the failed transaction must not leave a partial observation table",
      );
      assert.equal(
        await scalar(
          db,
          `select count(*)::integer value from sellerpilot_private.operation_audit
            where action='qoo10_exact_origin_rejection_reconciliation_resolved'`,
        ),
        0,
      );
    } finally {
      await db.close();
    }
  });
}

test("replay rejects a weakened observation check body with the same name", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    await db.exec(migration);
    await db.exec(
      `alter table
         sellerpilot_private.qoo10_listing_update_rejection_observations
       drop constraint qoo10_update_rejection_observations_rejection_code_check;
       alter table
         sellerpilot_private.qoo10_listing_update_rejection_observations
       add constraint qoo10_update_rejection_observations_rejection_code_check
       check (provider_rejection_code <> '');`,
    );
    await assert.rejects(
      db.exec(migration),
      /observation check-body post-image mismatch/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("replay rejects a partial observed-shipping function patch", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    await db.exec(migration);
    const definition = await scalar(
      db,
      `select pg_get_functiondef(
        'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
      ) value`,
    );
    const anchor =
      "     and shipping_observation.remote_id = confirmation.remote_id\n";
    const tampered = definition.replace(anchor, "");
    assert.notEqual(tampered, definition, "the fixture must remove one lineage predicate");
    await db.exec(tampered);
    await assert.rejects(
      db.exec(migration),
      /rollback identity partial post-image/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("replay rejects unrelated function-body drift through the full post-image SHA fence", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    await db.exec(migration);
    const definition = await scalar(
      db,
      `select pg_get_functiondef(
        'public.sellerpilot_service_get_qoo10_rollback_update_identity(uuid,uuid,uuid,text,text)'::regprocedure
      ) value`,
    );
    const original =
      "return jsonb_build_object('status', 'allowed', 'shippingNo', v_shipping);";
    const tampered = definition.replace(
      original,
      "return jsonb_build_object('status', 'allowed-v2', 'shippingNo', v_shipping);",
    );
    assert.notEqual(
      tampered,
      definition,
      "the fixture must alter only an unrelated function-body literal",
    );
    await db.exec(tampered);
    await assert.rejects(
      db.exec(migration),
      /rollback identity full post-image drifted/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("replay rejects a disabled product-listing lineage trigger", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    await db.exec(migration);
    await db.exec(
      `alter table sellerpilot_private.product_listings
         disable trigger guard_product_listing_seller_lineage`,
    );
    await assert.rejects(
      db.exec(migration),
      /product listing lineage trigger post-image mismatch/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("replay rejects a partial exact-reconciliation guard branch", async () => {
  const db = await seedDatabase();
  try {
    const migration = await renderedMigration(db);
    await db.exec(migration);
    const definition = await scalar(
      db,
      `select pg_get_functiondef(
        'sellerpilot_private.guard_product_listing_seller_lineage()'::regprocedure
      ) value`,
    );
    const tampered = definition.replace(
      "sellerpilot_private.qoo10_exact_origin_rejection_restore_allowed(",
      "sellerpilot_private.qoo10_rollback_update_retry_restore_allowed(",
    );
    assert.notEqual(tampered, definition, "the fixture must alter the guard helper");
    await db.exec(tampered);
    await assert.rejects(
      db.exec(migration),
      /origin rejection guard partial post-image/,
    );
    await db.exec("rollback");
  } finally {
    await db.close();
  }
});

test("migration source pins production evidence and contains no provider/network call", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const value of [
    UPDATE_JOB_ID,
    UPDATE_ATTEMPT_ID,
    LISTING_ID,
    PRODUCT_ID,
    CREDENTIAL_ID,
    SOURCE_JOB_ID,
    SOURCE_ATTEMPT_ID,
    PRODUCTION_REQUEST_SHA,
    PRODUCTION_RESPONSE_SHA,
    "ProductionPlaceTypeは必須です。",
    "a6a1fc7a-4b4b-460e-aba6-65599ed122e0",
    "f8a24ebcb159bbd27a1a08b7a38bd187e4ead47bc8f5e4f5f4d4f31d7aff1a89",
    LEGACY_CREATE_JOB_ID,
    "2027-08-20 14:59:59+00",
    "2026-08-25 11:40:32.606508+00",
  ]) assert.equal(source.includes(value), true, `missing exact evidence: ${value}`);
  assert.doesNotMatch(source, /net\.http|http_post|http_get|fetch\s*\(/i);
  assert.doesNotMatch(source, /schema_migrations/i);
  assert.match(source, /provider_call_replayed', false/);
  assert.match(source, /source_shipping_no[^\n]*'0'/);
  assert.match(source, /observed_shipping_no[^\n]*'806971'/);
});
