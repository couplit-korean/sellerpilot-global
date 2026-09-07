import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908011500_allow_exact_coupang_live_verifier_local_claim.sql",
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

const originalClaim = statement(
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
  actor: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  approver: "60000000-0000-4000-8000-000000000001",
  tokenCreator: "60000000-0000-4000-8000-000000000002",
  token: "60000000-0000-4000-8000-000000000003",
  credential: "32de2968-d4b7-4fda-a84b-16a7ce0257cc",
  attempt: "d771421b-f408-4f75-addd-03879393fab8",
  listing: "fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4",
  source: "25adf712-1e9a-432b-8b0d-09cf35a826c5",
  verifier: "86d2cb63-d382-4cc9-8153-654cf7ccec80",
  normalJob: "60000000-0000-4000-8000-000000000004",
});
const release = "9".repeat(40);
const oldRelease = "8".repeat(40);
const egress = "a".repeat(64);
const tokenHash = "b".repeat(64);
const account = "e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd";
const fingerprint = "f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d";
const version = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;

function verifierPayload(market = "") {
  return {
    periodicKey: `coupang-exact-live:${id.source}`,
    arguments: {
      publicationReviewSourceJobId: id.source,
      sellerpilotReadOnly: true,
      sellerpilotCoupangExactLiveReconciliation: "coupang_exact_live_get_only_v1",
      remoteId: "16375780938",
      market,
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
  const db = new PGlite();
  await db.exec(String.raw`
    create role anon;create role authenticated;create role service_role;
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
      id uuid primary key,owner_id uuid,
      channel text,operation text,credential_id uuid,seller_account_key text,
      worker_token_id uuid,release_sha text,egress_ip_sha256 text,
      approved_by uuid,approved_at timestamptz,expires_at timestamptz,
      enabled boolean
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
      updated_at timestamptz,provider_mutation_started_at timestamptz,
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
       null,null,null,null,null,null,null,null);
      return p_job_id='${id.normalJob}'::uuid;
    end$$;
  `);
  await db.exec(exactMatcher);
  await db.exec(String.raw`
    create function public.sellerpilot_11820_claim_gateway_unsafe(
      p_token_hash text,p_worker_version text default null
    )returns jsonb language plpgsql security definer set search_path='' as $$
    declare token_id uuid;job_id uuid;claim_id uuid:=
      '70000000-0000-4000-8000-000000000001'::uuid;result jsonb;
    begin
      select id into token_id from sellerpilot_private.ai_cli_worker_tokens
      where token_hash=p_token_hash and scope='gateway' and status='active'
       and expires_at>clock_timestamp();
      select candidate.id into job_id
      from sellerpilot_private.channel_gateway_jobs candidate
      join sellerpilot_private.channel_credentials credential
       on credential.id=candidate.credential_id and credential.status='active'
      where candidate.status='queued'
       and coalesce(current_setting('sellerpilot.local_channel_executor_lane',true),'')='enabled'
       and sellerpilot_private.local_channel_executor_job_allowed(
        candidate.id,credential.id,token_id,p_worker_version,
        current_setting('sellerpilot.local_channel_executor_release_sha',true),
        current_setting('sellerpilot.local_channel_executor_egress_sha256',true)
       )
       and not exists(select 1 from sellerpilot_private.channel_gateway_jobs running
        where running.channel=candidate.channel and running.status='running')
      order by candidate.created_at,candidate.id for update of candidate,credential
      skip locked limit 1;
      if job_id is null then return null;end if;
      update sellerpilot_private.channel_gateway_jobs set status='running',
       worker_token_id=token_id,claim_token=claim_id,
       lease_expires_at=clock_timestamp()+interval '2 minutes',
       attempt_count=attempt_count+1 where id=job_id;
      select jsonb_build_object('id',id,'channel',channel,'operation',operation,
       'claim_token',claim_token) into result
      from sellerpilot_private.channel_gateway_jobs where id=job_id;
      return result;
    end$$;
    create function public.sellerpilot_claim_channel_gateway_job(
      p_token_hash text,p_worker_version text default null
    )returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.ai_cli_worker_tokens
       set last_seen_at=clock_timestamp(),last_version=p_worker_version
       where token_hash=p_token_hash;
      return public.sellerpilot_11820_claim_gateway_unsafe(
       p_token_hash,p_worker_version);
    end$$;
  `);
  await db.exec(originalClaim);
  const claimHash = (await db.query(`select md5(pg_get_functiondef(
    'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
  )) hash`)).rows[0].hash;
  assert.equal(claimHash, "dfee387ced728c18835a3f0d506a4ffc");
  return db;
}

async function seed(db) {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query("select set_config('test.active_release',$1,false)", [release]);
  await db.query(`insert into sellerpilot_private.admin_users values
    ($1),($2),($3),($4)`, [id.actor, id.owner, id.approver, id.tokenCreator]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens values(
    $1,$2,'gateway','active',clock_timestamp()+interval '1 day',
    clock_timestamp(),$3,$4)`, [id.token, tokenHash, version, id.tokenCreator]);
  await db.query(`insert into sellerpilot_private.channel_credentials values(
    $1,'coupang','production','active',clock_timestamp()+interval '1 day',
    'passed',$2,'credential_incarnation_v1',$3)`,
  [id.credential, account, id.actor]);
  await db.query(
    "insert into sellerpilot_private.serverless_static_egress_policy values('coupang',false)",
  );
  await db.query(`insert into sellerpilot_private.local_channel_executor_routes(
    id,owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,
    release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled
  )values('60000000-0000-4000-8000-000000000006',$1,'coupang',
    'categories.validate',$2,$3,$4,$5,$6,$7,
    clock_timestamp(),clock_timestamp()+interval '1 hour',true)`,
  [id.owner, id.credential, account, id.token, oldRelease, egress, id.approver]);
  await db.query(
    "insert into sellerpilot_private.channel_operation_attempts values($1,$2)",
    [id.attempt, id.owner],
  );
  await db.query(
    "insert into sellerpilot_private.product_listings values($1,$2)",
    [id.listing, id.owner],
  );
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,
    request_fingerprint,created_by,created_at,updated_at,
    provider_mutation_started_at
  )values($1,$2,$3,$4,'coupang','listing.create','production','{}','{}',
   'reconciliation_required',$5,$6,$7,clock_timestamp()-interval '1 day',
   clock_timestamp(),clock_timestamp())`,
  [id.source, id.credential, id.attempt, id.listing, account, fingerprint, id.actor]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,listing_id,channel,operation,environment,
    request_payload,response_payload,status,seller_account_key,
    request_fingerprint,created_by,created_at,updated_at
  )values($1,$2,null,$3,'coupang','listing.publication.verify','production',
   $4,'{}','queued',$5,$6,$7,clock_timestamp(),clock_timestamp())`,
  [id.verifier, id.credential, id.listing, verifierPayload(), account,
    fingerprint, id.actor]);
  await db.query(`insert into sellerpilot_private.coupang_exact_live_verify_runs
    values($1,$2,$3,$4,'16375780938',$5,$5,$5,clock_timestamp())`,
  [id.verifier, id.source, id.attempt, id.listing, "c".repeat(64)]);
}

async function activate(db, routeRelease = release, routeEgress = egress) {
  return db.query(`select public.sellerpilot_service_activate_exact_coupang_live_local_claim(
    $1,$2,$3
  ) result`, [id.token, routeRelease, routeEgress]);
}

async function claim(db, claimRelease = release, claimEgress = egress) {
  const claimVersion = `sellerpilot-cli-worker/1.61+${claimRelease}.${claimEgress.slice(0, 11)}`;
  return (await db.query(`select public.sellerpilot_claim_local_channel_executor_job(
    $1,$2,$3,$4
  ) result`, [tokenHash, claimVersion, claimRelease, claimEgress])).rows[0].result;
}

test("migration is a parameter-bound GET-only claim patch with no queued-job mutation", () => {
  assert.match(migration, /86d2cb63-d382-4cc9-8153-654cf7ccec80/);
  assert.match(migration, /dfee387ced728c18835a3f0d506a4ffc/);
  assert.match(migration, /coupang_exact_live_verifier_job_matches/);
  assert.match(migration, /coupang_exact_live_source_current/);
  assert.match(migration, /active_serverless_runtime_release_sha/);
  assert.match(migration, /local_channel_executor_routes/);
  assert.doesNotMatch(migration, /da3cfdeb6ed4fa65e848cc59bb6ea3f4a350e61f/);
  assert.doesNotMatch(migration,
    /update sellerpilot_private\.channel_gateway_jobs/);
  assert.doesNotMatch(migration,
    /listing\.(?:create|update|activate|stop)'[^)]*then true/);
  assert.doesNotMatch(migration,
    /mutation_release_gate|set_listing_channel_mutation_release_gate/);
});

test("PGlite activates the deployed release and claims only the queued exact verifier", async () => {
  const db = await database();
  try {
    await seed(db);
    const jobBefore = (await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.verifier],
    )).rows[0].value;
    const sourceBefore = (await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.source],
    )).rows[0].value;
    const runBefore = (await db.query(
      "select to_jsonb(run) value from sellerpilot_private.coupang_exact_live_verify_runs run",
    )).rows[0].value;
    const oldAllowedSource = (await db.query(`select prosrc from pg_proc where oid=
      'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure`
    )).rows[0].prosrc;
    await db.exec("select set_config('test.active_release','',false)");
    await db.exec(migration);
    assert.deepEqual((await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.verifier],
    )).rows[0].value, jobBefore);
    assert.equal(await claim(db), null, "claim stays closed before route activation");
    await assert.rejects(activate(db), /ACTIVATION_DENIED/);
    await db.query("select set_config('test.active_release',$1,false)", [release]);
    const activation = (await activate(db)).rows[0].result;
    assert.equal(activation.activated, true);
    assert.equal(activation.releaseSha, release);
    assert.equal(activation.providerMutationPerformed, false);
    const exactRoute = (await db.query(
      "select * from sellerpilot_private.coupang_exact_live_local_claim_routes",
    )).rows[0];
    assert.equal(exactRoute.owner_id, id.owner);
    assert.equal(exactRoute.channel, "coupang");
    assert.equal(exactRoute.operation, "listing.publication.verify");
    assert.equal(exactRoute.release_sha, release);
    assert.equal(exactRoute.egress_ip_sha256, egress);
    const replacementRelease = "7".repeat(40);
    await db.query("select set_config('test.active_release',$1,false)",
      [replacementRelease]);
    await activate(db, replacementRelease);
    assert.deepEqual((await db.query(`select count(*)::int count,
      min(release_sha) release from
      sellerpilot_private.coupang_exact_live_local_claim_routes`)).rows[0], {
      count: 1,
      release: replacementRelease,
    });
    await db.query("select set_config('test.active_release',$1,false)", [release]);
    await activate(db);
    const claimed = await claim(db);
    assert.equal(claimed.id, id.verifier);
    assert.equal(claimed.channel, "coupang");
    assert.equal(claimed.operation, "listing.publication.verify");
    const jobAfter = (await db.query(
      "select * from sellerpilot_private.channel_gateway_jobs where id=$1",
      [id.verifier],
    )).rows[0];
    assert.equal(jobAfter.status, "running");
    assert.equal(jobAfter.attempt_id, null);
    assert.equal(jobAfter.provider_mutation_started_at, null);
    assert.equal(jobAfter.write_resource_kind, null);
    assert.equal(jobAfter.write_resource_key, null);
    assert.deepEqual((await db.query(
      "select to_jsonb(job) value from sellerpilot_private.channel_gateway_jobs job where id=$1",
      [id.source],
    )).rows[0].value, sourceBefore);
    assert.deepEqual((await db.query(
      "select to_jsonb(run) value from sellerpilot_private.coupang_exact_live_verify_runs run",
    )).rows[0].value, runBefore);
    const predecessorSource = (await db.query(`select prosrc from pg_proc where oid=
      'sellerpilot_private.local_channel_executor_job_allowed_before_coupang_get(uuid,uuid,uuid,text,text,text)'::regprocedure`
    )).rows[0].prosrc;
    assert.equal(predecessorSource, oldAllowedSource);
  } finally {
    await db.close();
  }
});

test("PGlite rejects release, egress, token, route, owner, source, matcher and write-fence drift", async () => {
  for (const drift of [
    "release", "egress", "token", "route", "owner", "source", "matcher", "write",
  ]) {
    const db = await database();
    try {
      await seed(db);
      await db.exec(migration);
      if (drift === "release") {
        await assert.rejects(activate(db, "f".repeat(40)), /ACTIVATION_DENIED/);
      } else if (drift === "egress") {
        await assert.rejects(activate(db, release, "f".repeat(64)), /ACTIVATION_DENIED/);
      } else if (drift === "token") {
        await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked' where id=$1", [id.token]);
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      } else if (drift === "route") {
        await db.query("update sellerpilot_private.local_channel_executor_routes set operation='listing.create'");
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      } else if (drift === "owner") {
        await db.query("update sellerpilot_private.local_channel_executor_routes set owner_id=$1", [id.actor]);
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      } else if (drift === "source") {
        await db.exec("select set_config('test.source_current','false',false)");
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      } else if (drift === "matcher") {
        await db.query(`update sellerpilot_private.channel_gateway_jobs
          set request_payload=$1 where id=$2`, [verifierPayload("KR"), id.verifier]);
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      } else {
        await db.query(`update sellerpilot_private.channel_gateway_jobs
          set write_resource_kind='sellerProduct' where id=$1`, [id.verifier]);
        await assert.rejects(activate(db), /ACTIVATION_DENIED/);
      }
      assert.equal((await db.query(
        "select count(*)::int count from sellerpilot_private.coupang_exact_live_local_claim_routes",
      )).rows[0].count, 0, drift);
      assert.equal((await db.query(
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
        [id.verifier],
      )).rows[0].status, "queued", drift);
    } finally {
      await db.close();
    }
  }
});

test("PGlite preserves the predecessor path for a normal SmartStore job", async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec(migration);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='succeeded' where id=$1", [id.verifier]);
    await db.query(`insert into sellerpilot_private.channel_credentials values(
      '60000000-0000-4000-8000-000000000005','smartstore','production','active',
      clock_timestamp()+interval '1 day','passed',$1,'credential_incarnation_v1',$2)`,
    [account, id.actor]);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,
      seller_account_key,request_fingerprint,created_by,created_at,updated_at
    )values($1,'60000000-0000-4000-8000-000000000005','smartstore',
      'listing.update','production','{}','queued',$2,$3,$4,
      clock_timestamp(),clock_timestamp())`,
    [id.normalJob, account, fingerprint, id.actor]);
    const claimed = await claim(db);
    assert.equal(claimed.id, id.normalJob);
    assert.equal(claimed.operation, "listing.update");
  } finally {
    await db.close();
  }
});

test("PGlite rolls back cleanly when the exact queued preflight drifts", async () => {
  const db = await database();
  try {
    await seed(db);
    await db.query("update sellerpilot_private.channel_gateway_jobs set claim_token=$1 where id=$2",
      ["70000000-0000-4000-8000-000000000002", id.verifier]);
    await assert.rejects(db.exec(migration), /SOURCE_DRIFT/);
    await db.exec("rollback");
    assert.equal((await db.query(
      "select to_regclass('sellerpilot_private.coupang_exact_live_local_claim_routes') value",
    )).rows[0].value, null);
    assert.ok((await db.query(`select to_regprocedure(
      'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'
    ) value`)).rows[0].value);
    assert.equal((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1",
      [id.verifier],
    )).rows[0].status, "queued");
  } finally {
    await db.close();
  }
});
