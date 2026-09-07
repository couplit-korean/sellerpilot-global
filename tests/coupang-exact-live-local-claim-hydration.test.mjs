import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const claimMigration = await readFile(new URL(
  "../supabase/migrations/20260908011500_allow_exact_coupang_live_verifier_local_claim.sql",
  import.meta.url,
), "utf8");
const hydrationMigration = await readFile(new URL(
  "../supabase/migrations/20260908013000_hydrate_exact_coupang_local_verifier_claim.sql",
  import.meta.url,
), "utf8");
const generalMigration = await readFile(new URL(
  "../supabase/migrations/20260907110000_general_local_channel_executor.sql",
  import.meta.url,
), "utf8");
const marketMigration = await readFile(new URL(
  "../supabase/migrations/20260908004500_fix_exact_coupang_live_verifier_empty_market.sql",
  import.meta.url,
), "utf8");

function statement(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

const originalLocalClaim = statement(
  generalMigration,
  "create function public.sellerpilot_claim_local_channel_executor_job(",
  "\n\nrevoke all on function public.sellerpilot_claim_local_channel_executor_job(",
);
const exactMatcher = statement(
  marketMigration,
  "create or replace function sellerpilot_private.coupang_exact_live_verifier_job_matches(",
  "\nrevoke all on function sellerpilot_private.coupang_exact_live_verifier_job_matches(",
);

const id = Object.freeze({
  credentialOwner: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  listingOwner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  approver: "61000000-0000-4000-8000-000000000001",
  tokenCreator: "61000000-0000-4000-8000-000000000002",
  token: "61000000-0000-4000-8000-000000000003",
  sourceRoute: "61000000-0000-4000-8000-000000000004",
  serverlessToken: "61000000-0000-4000-8000-000000000006",
  serverlessJob: "61000000-0000-4000-8000-000000000007",
  serverlessClaim: "61000000-0000-4000-8000-000000000008",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  verifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  claim: "61000000-0000-4000-8000-000000000005",
});
const release = "9".repeat(40);
const previousReadRelease = "8".repeat(40);
const egress = "a".repeat(64);
const tokenHash = "b".repeat(64);
const sellerKey = "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const fingerprint = "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";
const version = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;

function verifierPayload() {
  return {
    periodicKey: `coupang-exact-live:${id.source}`,
    arguments: {
      publicationReviewSourceJobId: id.source,
      sellerpilotReadOnly: true,
      sellerpilotCoupangExactLiveReconciliation: "coupang_exact_live_get_only_v1",
      remoteId: "16375780938",
      market: "",
      targetId: "",
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: fingerprint,
      publicationExpectedImageCount: 8,
    },
  };
}

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(String.raw`
    create role anon;create role authenticated;create role service_role;
    create schema extensions;create extension pgcrypto with schema extensions;
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text,scope text,status text,
      expires_at timestamptz,last_seen_at timestamptz,last_version text,
      created_by uuid
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,status text,
      expires_at timestamptz,last_check_status text,seller_account_key text,
      seller_account_key_source text,created_by uuid
    );
    create table sellerpilot_private.serverless_static_egress_policy(
      channel text primary key,enabled boolean
    );
    create table sellerpilot_private.local_channel_executor_routes(
      id uuid primary key,owner_id uuid,channel text,operation text,
      credential_id uuid,seller_account_key text,worker_token_id uuid,
      release_sha text,egress_ip_sha256 text,approved_by uuid,
      approved_at timestamptz,expires_at timestamptz,enabled boolean
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,owner_id uuid
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,owner_id uuid
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,listing_id uuid,
      channel text,operation text,environment text,request_payload jsonb,
      response_payload jsonb,status text,seller_account_key text,
      request_fingerprint text,created_by uuid,created_at timestamptz,
      updated_at timestamptz,started_at timestamptz,completed_at timestamptz,
      error_message text,provider_mutation_started_at timestamptz,
      write_resource_kind text,write_resource_key text,
      credential_refresh_in_flight boolean default false,
      credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,
      oauth_exchange_completed boolean default false,worker_token_id uuid,
      claim_token uuid,lease_expires_at timestamptz,attempt_count integer default 0
    );
    create table sellerpilot_private.coupang_exact_live_verify_runs(
      verifier_job_id uuid primary key,source_job_id uuid unique,
      source_attempt_id uuid,listing_id uuid,remote_id text,
      source_job_sha256 text,source_attempt_sha256 text,
      source_listing_sha256 text,queued_at timestamptz
    );
    create table sellerpilot_private.coupang_exact_live_verify_receipts(
      verifier_job_id uuid primary key
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as
      'select coalesce(current_setting(''request.jwt.claim.role'',true),'''')=''service_role''';
    create function sellerpilot_private.active_serverless_runtime_release_sha()
    returns text language sql stable as
      'select coalesce(current_setting(''test.active_release'',true),''${release}'')';
    create function sellerpilot_private.coupang_exact_live_source_current()
    returns boolean language sql stable as
      'select coalesce(current_setting(''test.source_current'',true),''true'')=''true''';
    create function sellerpilot_private.serverless_gateway_job_allowed(
      p_channel text,p_operation text
    )returns boolean language sql immutable as $$
      select p_operation in(
        'orders.list','inquiries.list','listing.publication.verify'
      )
    $$;
    create function sellerpilot_private.serverless_cs_job_is_owned(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,
      p_require_live_lease boolean default true
    )returns boolean language sql stable set search_path='' as $$
      select exists(
        select 1 from sellerpilot_private.ai_cli_worker_tokens token
        join sellerpilot_private.channel_gateway_jobs job
          on job.worker_token_id=token.id
        where token.token_hash=p_token_hash
          and token.scope = 'serverless_cs'
          and token.status='active' and token.expires_at>clock_timestamp()
          and job.id=p_job_id and job.claim_token=p_claim_token
          and sellerpilot_private.serverless_gateway_job_allowed(
            job.channel,job.operation
          )
          and (not p_require_live_lease or (
            job.status='running' and job.lease_expires_at>clock_timestamp()
          ))
      )
    $$;
    create function sellerpilot_private.local_channel_executor_route_is_current(
      uuid,text,text,uuid,uuid,text,text,text
    )returns boolean language sql stable as 'select true';
    create function sellerpilot_private.local_channel_executor_job_allowed(
      p_job_id uuid,p_credential_id uuid,p_worker_token_id uuid,
      p_worker_version text,p_release_sha text,p_egress_ip_sha256 text
    )returns boolean language plpgsql stable security definer set search_path='' as $$
    begin
      -- SMARTSTORE_LOCAL_UPDATE_REMOTE_IDENTITY
      -- LISTING_CREATE_UNBOUND_SELLER_LINEAGE
      perform sellerpilot_private.local_channel_executor_route_is_current(
        null,null,null,null,null,null,null,null
      );
      return false;
    end$$;
  `);
  await db.exec(exactMatcher);
  await db.exec(String.raw`
    create function public.sellerpilot_11820_claim_gateway_unsafe(
      p_token_hash text,p_worker_version text default null
    )returns jsonb language plpgsql security definer set search_path='' as $$
    declare
      v_token_id uuid;
      v_job_id uuid;
      v_claim_token uuid:='${id.claim}'::uuid;
      v_result jsonb;
    begin
      select token.id into v_token_id
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.token_hash=p_token_hash
         and token.scope='gateway'
         and token.status='active'
         and token.expires_at>clock_timestamp();
      select j.id into v_job_id
        from sellerpilot_private.channel_gateway_jobs j
        join sellerpilot_private.channel_credentials c
          on c.id=j.credential_id and c.status='active'
       where j.status = 'queued'
         and (
           (
             coalesce(current_setting(
               'sellerpilot.local_channel_executor_lane',true
             ),'')='enabled'
             and sellerpilot_private.local_channel_executor_job_allowed(
               j.id,c.id,v_token_id,p_worker_version,
               current_setting(
                 'sellerpilot.local_channel_executor_release_sha',true
               ),
               current_setting(
                 'sellerpilot.local_channel_executor_egress_sha256',true
               )
             )
           )
           or coalesce(current_setting(
             'sellerpilot.local_channel_executor_lane',true
           ),'') is distinct from 'enabled'
         )
         and not exists(
           select 1 from sellerpilot_private.channel_gateway_jobs running
            where running.channel=j.channel and running.status='running'
         )
       order by j.created_at,j.id
       for update of j,c skip locked limit 1;
      if v_job_id is null then return null;end if;
      update sellerpilot_private.channel_gateway_jobs
         set status='running',worker_token_id=v_token_id,
             claim_token=v_claim_token,
             lease_expires_at=clock_timestamp()+interval '2 minutes',
             attempt_count=attempt_count+1,
             started_at=coalesce(started_at,clock_timestamp()),
             updated_at=clock_timestamp()
       where id=v_job_id;
      select jsonb_build_object(
        'id',job.id,'claim_token',job.claim_token,
        'credential_id',job.credential_id,'channel',job.channel,
        'operation',job.operation,'environment',job.environment,
        'request',job.request_payload,'credential','{}'::jsonb,
        'attempt_count',job.attempt_count
      ) into v_result
        from sellerpilot_private.channel_gateway_jobs job
       where job.id=v_job_id;
      return v_result;
    end$$;
    create function public.sellerpilot_claim_channel_gateway_job(
      p_token_hash text,p_worker_version text default null
    )returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.ai_cli_worker_tokens
         set last_seen_at=clock_timestamp(),last_version=p_worker_version
       where token_hash=p_token_hash;
      return public.sellerpilot_11820_claim_gateway_unsafe(
        p_token_hash,p_worker_version
      );
    end$$;
    create function public.sellerpilot_service_listing_publication_verification_source(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    )returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      if not sellerpilot_private.serverless_cs_job_is_owned(
        p_token_hash,p_job_id,p_claim_token,true
      ) or sellerpilot_private.coupang_exact_live_source_current() is not true then
        raise exception 'publication verification source ownership required'
          using errcode='42501';
      end if;
      if coalesce(current_setting('test.hydration_valid',true),'true')<>'true' then
        raise exception 'exact Coupang verifier source unavailable'
          using errcode='55000';
      end if;
      return jsonb_build_object(
        'contract','listing_publication_verification_source_v1',
        'verificationJobId',p_job_id,
        'sourceJobId','${id.source}',
        'sourceOperation','listing.create',
        'sourceArguments','{}'::jsonb,
        'sourceResponsePayload',jsonb_build_object(
          'remoteState',jsonb_build_object(
            'resources',jsonb_build_object('sellerProductId','16375780938'),
            'evidence',jsonb_build_object(
              'providerAssignedDescendantIdentityBinding',jsonb_build_object(
                'contract','coupang_provider_assigned_vendor_items_v1',
                'sourceJobId','${id.source}',
                'sellerProductId','16375780938'
              )
            )
          )
        ),
        'sourceFingerprint','${fingerprint}',
        'expectedRemoteId','16375780938','expectedLocale','ko-KR',
        'expectedImageCount',8,'market','','targetId',''
      );
    end$$;
  `);
  await db.exec(originalLocalClaim);
  return db;
}

async function seed(db) {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("select set_config('test.active_release',$1,false)", [release]);
  await db.query(`insert into sellerpilot_private.admin_users values
    ($1),($2),($3),($4)`, [
    id.credentialOwner, id.listingOwner, id.approver, id.tokenCreator,
  ]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens values(
    $1,$2,'gateway','active',clock_timestamp()+interval '1 day',
    clock_timestamp(),$3,$4)`, [id.token, tokenHash, version, id.tokenCreator]);
  await db.query(`insert into sellerpilot_private.channel_credentials values(
    $1,'coupang','production','active',clock_timestamp()+interval '1 day',
    'passed',$2,'credential_incarnation_v1',$3)`, [
    id.credential, sellerKey, id.credentialOwner,
  ]);
  await db.exec(
    "insert into sellerpilot_private.serverless_static_egress_policy values('coupang',false)",
  );
  await db.query(`insert into sellerpilot_private.local_channel_executor_routes values(
    $1,$2,'coupang','categories.validate',$3,$4,$5,$6,$7,$8,
    clock_timestamp(),clock_timestamp()+interval '1 hour',true)`, [
    id.sourceRoute, id.listingOwner, id.credential, sellerKey, id.token,
    previousReadRelease, egress, id.approver,
  ]);
  await db.query(
    "insert into sellerpilot_private.channel_operation_attempts values($1,$2)",
    [id.attempt, id.listingOwner],
  );
  await db.query(
    "insert into sellerpilot_private.product_listings values($1,$2)",
    [id.listing, id.listingOwner],
  );
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,
    request_fingerprint,created_by,created_at,updated_at,
    provider_mutation_started_at
  )values($1,$2,$3,$4,'coupang','listing.create','production','{}','{}',
    'reconciliation_required',$5,$6,$7,clock_timestamp()-interval '1 day',
    clock_timestamp(),clock_timestamp())`, [
    id.source, id.credential, id.attempt, id.listing, sellerKey, fingerprint,
    id.credentialOwner,
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,
    request_fingerprint,created_by,created_at,updated_at
  )values($1,$2,null,$3,'coupang','listing.publication.verify','production',
    $4,'{}','queued',$5,$6,$7,clock_timestamp(),clock_timestamp())`, [
    id.verifier, id.credential, id.listing, verifierPayload(), sellerKey,
    fingerprint, id.credentialOwner,
  ]);
  await db.query(`insert into sellerpilot_private.coupang_exact_live_verify_runs
    select $1,$2,$3,$4,'16375780938',
      encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex'),
      encode(extensions.digest(to_jsonb(attempt)::text,'sha256'),'hex'),
      encode(extensions.digest(to_jsonb(listing)::text,'sha256'),'hex'),
      clock_timestamp()
    from sellerpilot_private.channel_gateway_jobs source
    cross join sellerpilot_private.channel_operation_attempts attempt
    cross join sellerpilot_private.product_listings listing
    where source.id=$2 and attempt.id=$3 and listing.id=$4`, [
    id.verifier, id.source, id.attempt, id.listing,
  ]);
}

async function activate(db) {
  await db.exec(claimMigration);
  return (await db.query(
    `select public.sellerpilot_service_activate_exact_coupang_live_local_claim(
      $1,$2,$3
    ) result`,
    [id.token, release, egress],
  )).rows[0].result;
}

async function claim(db) {
  return (await db.query(
    `select public.sellerpilot_claim_local_channel_executor_job(
      $1,$2,$3,$4
    ) result`,
    [tokenHash, version, release, egress],
  )).rows[0].result;
}

test("forward patch hydrates only the exact GET verifier and leaves every mutation gate closed", () => {
  assert.match(hydrationMigration,
    /sellerpilot_service_listing_publication_verification_source/u);
  assert.match(hydrationMigration,
    /sellerpilotPublicationSource/u);
  assert.match(hydrationMigration,
    /coupang_exact_live_local_claim_routes/u);
  assert.match(hydrationMigration,
    /source_read_route_id/u);
  assert.match(hydrationMigration,
    /categories\.attributes', 'categories\.validate/u);
  assert.match(hydrationMigration,
    /coupang_exact_live_generic_claim_exclusion_v1/u);
  assert.doesNotMatch(hydrationMigration,
    /serverless_gateway_job_allowed\([\s\S]{0,100}listing\.publication\.verify[\s\S]{0,40}is true/u);
  assert.match(hydrationMigration,
    /provider_mutation_started_at is null/u);
  assert.match(hydrationMigration,
    /write_resource_kind is null/u);
  assert.match(hydrationMigration,
    /write_resource_key is null/u);
  assert.doesNotMatch(hydrationMigration, /da3cfdeb/u);
  assert.doesNotMatch(hydrationMigration,
    /listing_mutation_release_gate|set_listing_channel_mutation_release_gate/u);
  assert.doesNotMatch(hydrationMigration,
    /method[^\n]*(?:POST|PUT|PATCH|DELETE)/iu);
});

test("PGlite atomically claims and returns the exact source contract without mutating stored evidence", async () => {
  const db = await database();
  try {
    await seed(db);
    const sourceBefore = (await db.query(
      "select to_jsonb(row) value from sellerpilot_private.channel_gateway_jobs row where id=$1",
      [id.source],
    )).rows[0].value;
    const attemptBefore = (await db.query(
      "select to_jsonb(row) value from sellerpilot_private.channel_operation_attempts row where id=$1",
      [id.attempt],
    )).rows[0].value;
    const listingBefore = (await db.query(
      "select to_jsonb(row) value from sellerpilot_private.product_listings row where id=$1",
      [id.listing],
    )).rows[0].value;
    const activation = await activate(db);
    assert.equal(activation.releaseSha, release);
    assert.equal(activation.providerMutationPerformed, false);
    await db.exec(hydrationMigration);

    const generic = (await db.query(
      "select public.sellerpilot_claim_channel_gateway_job($1,$2) result",
      [tokenHash, version],
    )).rows[0].result;
    assert.equal(generic, null, "the no-mode fallback cannot preempt the exact row");

    await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens values(
      $1,$2,'serverless_cs','active',clock_timestamp()+interval '1 day',
      clock_timestamp(),'serverless-fixture',$3)`, [
      id.serverlessToken, "c".repeat(64), id.tokenCreator,
    ]);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,
      response_payload,status,seller_account_key,request_fingerprint,created_by,
      created_at,updated_at,worker_token_id,claim_token,lease_expires_at
    )values($1,$2,'coupang','orders.list','production','{}','{}','running',
      $3,$4,$5,clock_timestamp(),clock_timestamp(),$6,$7,
      clock_timestamp()+interval '2 minutes')`, [
      id.serverlessJob, id.credential, sellerKey, fingerprint,
      id.credentialOwner, id.serverlessToken, id.serverlessClaim,
    ]);
    assert.equal((await db.query(
      `select sellerpilot_private.serverless_cs_job_is_owned(
        $1,$2,$3,true
      ) owned`,
      ["c".repeat(64), id.serverlessJob, id.serverlessClaim],
    )).rows[0].owned, true, "the existing serverless ownership path remains open");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1",
      [id.serverlessJob],
    );

    const claimed = await claim(db);
    assert.equal(claimed.id, id.verifier);
    assert.equal(claimed.operation, "listing.publication.verify");
    assert.equal(
      claimed.request.arguments.sellerpilotPublicationSource.verificationJobId,
      id.verifier,
    );
    assert.equal(
      claimed.request.arguments.sellerpilotPublicationSource.sourceJobId,
      id.source,
    );
    assert.equal(
      claimed.request.arguments.sellerpilotPublicationSource.expectedRemoteId,
      "16375780938",
    );
    assert.deepEqual(
      claimed.request.arguments.sellerpilotPublicationSource
        .sourceResponsePayload.remoteState.evidence
        .providerAssignedDescendantIdentityBinding,
      {
        contract: "coupang_provider_assigned_vendor_items_v1",
        sourceJobId: id.source,
        sellerProductId: "16375780938",
      },
    );

    const stored = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [id.verifier],
    )).rows[0];
    assert.equal(stored.status, "running");
    assert.equal(stored.attempt_id, null);
    assert.equal(stored.provider_mutation_started_at, null);
    assert.equal(stored.write_resource_kind, null);
    assert.equal(stored.write_resource_key, null);
    assert.equal(stored.request_payload.arguments.sellerpilotPublicationSource, undefined);
    assert.deepEqual((await db.query(
      "select to_jsonb(row) value from sellerpilot_private.channel_gateway_jobs row where id=$1",
      [id.source],
    )).rows[0].value, sourceBefore);
    assert.deepEqual((await db.query(
      "select to_jsonb(row) value from sellerpilot_private.channel_operation_attempts row where id=$1",
      [id.attempt],
    )).rows[0].value, attemptBefore);
    assert.deepEqual((await db.query(
      "select to_jsonb(row) value from sellerpilot_private.product_listings row where id=$1",
      [id.listing],
    )).rows[0].value, listingBefore);

    await assert.rejects(db.query(
      `select public.sellerpilot_service_listing_publication_verification_source(
        $1,$2,$3
      )`,
      [tokenHash, id.verifier, id.claim],
    ), /ownership required/u);
  } finally {
    await db.close();
  }
});

test("PGlite rolls the claim back to queued when exact source hydration fails", async () => {
  const db = await database();
  try {
    await seed(db);
    await activate(db);
    await db.exec(hydrationMigration);
    await db.exec("select set_config('test.hydration_valid','false',false)");
    await assert.rejects(claim(db), /source unavailable/u);
    const verifier = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [id.verifier],
    )).rows[0];
    assert.equal(verifier.status, "queued");
    assert.equal(verifier.worker_token_id, null);
    assert.equal(verifier.claim_token, null);
    assert.equal(verifier.lease_expires_at, null);
    assert.equal(verifier.attempt_count, 0);
    assert.equal(verifier.provider_mutation_started_at, null);
    assert.equal(verifier.write_resource_kind, null);
    assert.equal(verifier.write_resource_key, null);
  } finally {
    await db.close();
  }
});

test("PGlite rolls the claim back when the frozen source hash drifts", async () => {
  const db = await database();
  try {
    await seed(db);
    await activate(db);
    await db.exec(hydrationMigration);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set response_payload=$1 where id=$2",
      [{ drifted: true }, id.source],
    );
    await assert.rejects(claim(db), /CLAIM_RESULT_INVALID/u);
    const verifier = (await db.query(
      "select status,worker_token_id,claim_token,lease_expires_at,attempt_count from sellerpilot_private.channel_gateway_jobs where id=$1",
      [id.verifier],
    )).rows[0];
    assert.deepEqual(verifier, {
      status: "queued",
      worker_token_id: null,
      claim_token: null,
      lease_expires_at: null,
      attempt_count: 0,
    });
  } finally {
    await db.close();
  }
});
