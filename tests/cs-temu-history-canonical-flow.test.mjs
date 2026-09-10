import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const readMigration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const [atomic, serverless, generalized, ownership, contextBinding, sellerLineage,
  periodicBase, periodicCurrent, history] = await Promise.all([
  readMigration("20260826090400_atomic_gateway_completion_side_effects.sql"),
  readMigration("20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql"),
  readMigration("20260828210000_non_cs_release_integrity.sql"),
  readMigration("20260908013000_hydrate_exact_coupang_local_verifier_claim.sql"),
  readMigration("20260909134538_temu_cs_verified_account_binding_context.sql"),
  readMigration("20260825111800_bind_listing_seller_accounts.sql"),
  readMigration("20260820170000_periodic_channel_sync.sql"),
  readMigration("20260831145000_release_smartstore_from_static_egress.sql"),
  readMigration("20260909134539_temu_history_checkpoint_resume.sql"),
]);

const owner = "00000000-0000-4000-8000-00000000d701";
const administrator = "00000000-0000-4000-8000-00000000d702";
const credential = "00000000-0000-4000-8000-00000000d703";
const worker = "00000000-0000-4000-8000-00000000d704";
const requestKey = "00000000-0000-4000-8000-00000000d705";
const claim = "00000000-0000-4000-8000-00000000d706";
const tokenHash = "7".repeat(64);
const sellerKey = "8".repeat(64);

function functionStatement(source, name) {
  const markers = [`create or replace function ${name}`, `create function ${name}`];
  const start = markers.map(marker => source.indexOf(marker)).find(index => index >= 0);
  assert.notEqual(start, undefined, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

function blockStatement(source, tag) {
  const start = source.indexOf(`do $${tag}$`);
  const marker = `$${tag}$;`;
  const end = source.indexOf(marker, start + 3);
  assert.ok(start >= 0 && end >= 0, `missing block ${tag}`);
  return source.slice(start, end + marker.length);
}

async function value(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

test("actual canonical enqueue, completion context and completion feed replay-safe history checkpoint", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role;
      create schema auth;create schema sellerpilot_private;create schema extensions;
      create function extensions.digest(text,text)returns bytea language sql immutable
        as $$select sha256(convert_to($1,'UTF8'))$$;
      create table auth.users(id uuid primary key);
      create function auth.uid()returns uuid language sql stable as $$select '${administrator}'::uuid$$;
      create function public.sellerpilot_is_admin()returns boolean language sql stable as $$select true$$;
      create table sellerpilot_private.ai_cli_worker_tokens(
        id uuid primary key,label text,token_hash text unique,fingerprint text,status text,scope text,
        expires_at timestamptz,last_seen_at timestamptz,last_version text,created_by uuid,created_at timestamptz,
        revoked_at timestamptz,rotation_set_id uuid,activation_expires_at timestamptz,activated_at timestamptz
      );
      create table sellerpilot_private.channel_credentials(
        id uuid primary key,channel text,environment text,status text,expires_at timestamptz,
        fingerprint text,version integer,seller_account_key text,seller_account_key_source text,
        seller_account_verified_at timestamptz,created_by uuid,created_at timestamptz default now()
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key default gen_random_uuid(),credential_id uuid references sellerpilot_private.channel_credentials(id),
        attempt_id uuid,listing_id uuid,channel text,operation text,environment text,request_payload jsonb default'{}',
        response_payload jsonb,status text default'queued',error_message text,worker_token_id uuid,
        claim_token uuid,attempt_count integer default 0,lease_expires_at timestamptz,created_at timestamptz default now(),
        started_at timestamptz,completed_at timestamptz,updated_at timestamptz default now(),
        provider_mutation_started_at timestamptz,seller_account_key text,created_by uuid
      );
      create table sellerpilot_private.channel_sync_state(
        owner_id uuid,channel_key text,data_type text,status text,imported_count integer,
        last_started_at timestamptz,last_error text,updated_at timestamptz,
        primary key(owner_id,channel_key,data_type)
      );
      create table sellerpilot_private.serverless_static_egress_policy(channel text primary key,enabled boolean not null);
      create table sellerpilot_private.channel_operation_attempts(
        id uuid primary key,credential_id uuid,channel text,operation text,status text,seller_account_key text
      );
      create table sellerpilot_private.product_listings(
        id uuid primary key,product_id uuid,channel_key text,remote_id text,marketplace_sku text,
        market text,target_id text,operation_attempt_id uuid,seller_account_key text
      );
      create table sellerpilot_private.channel_market_targets(
        credential_id uuid,channel text,market_code text,target_id text
      );
      create table sellerpilot_private.ingested_inquiries(job_id uuid,credential_id uuid,channel text);
      create table sellerpilot_private.sync_marks(credential_id uuid,channel text,kind text,status text);
      create function sellerpilot_private.worker_token_has_scope(text,text,boolean default true)
        returns boolean language sql stable set search_path='' as $$
        select exists(select 1 from sellerpilot_private.ai_cli_worker_tokens
          where token_hash=$1 and scope=$2 and(not $3 or(status='active'and expires_at>clock_timestamp())))
      $$;
      create function sellerpilot_private.coupang_exact_live_local_running_owned(text,uuid,uuid)
        returns boolean language sql stable set search_path='' as $$select false$$;
      create function public.sellerpilot_service_prepare_gateway_credential_refresh(
        text,uuid,uuid,jsonb,timestamptz,boolean,boolean
      )returns jsonb language sql as $$select null::jsonb$$;
      create function public.sellerpilot_record_credential_test(uuid,text,text)
        returns void language sql as $$select$$;
      create function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
        returns void language sql as $$select$$;
      create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
        returns void language plpgsql as $$begin insert into sellerpilot_private.ingested_inquiries
          values(current_setting('fixture.job_id')::uuid,$1,$2);end$$;
      create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean)
        returns void language sql as $$select$$;
      create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)
        returns void language plpgsql as $$begin insert into sellerpilot_private.sync_marks values($1,$2,$3,$4);end$$;
      create function public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)
        returns boolean language plpgsql as $$begin
          update sellerpilot_private.channel_gateway_jobs job set status=$4,response_payload=$5,error_message=$6,
            worker_token_id=null,claim_token=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
          from sellerpilot_private.ai_cli_worker_tokens token where job.id=$2 and job.claim_token=$3
            and job.status='running'and token.id=job.worker_token_id and token.token_hash=$1
            and token.status='active'and token.expires_at>clock_timestamp();return found;end$$;
    `);
    await db.exec(atomic);
    await db.exec(functionStatement(generalized, "sellerpilot_private.serverless_gateway_job_allowed"));
    await db.exec(functionStatement(ownership, "sellerpilot_private.serverless_cs_job_is_owned"));
    await db.exec(functionStatement(generalized, "sellerpilot_private.worker_token_may_complete_gateway_job"));
    await db.exec(blockStatement(serverless, "migration"));
    await db.exec(functionStatement(serverless, "public.sellerpilot_service_serverless_cs_completion_context"));
    await db.exec(functionStatement(serverless, "public.sellerpilot_service_complete_serverless_cs_transaction"));
    await db.exec(contextBinding);
    await db.exec(functionStatement(sellerLineage, "sellerpilot_private.guard_gateway_job_seller_lineage"));
    await db.exec(`create trigger guard_gateway_job_seller_lineage before insert or update
      on sellerpilot_private.channel_gateway_jobs for each row
      execute function sellerpilot_private.guard_gateway_job_seller_lineage()`);
    await db.exec(functionStatement(periodicBase, "public.sellerpilot_service_enqueue_periodic_sync"));
    await db.exec(`alter function public.sellerpilot_service_enqueue_periodic_sync(text,text,jsonb,integer)
      rename to sellerpilot_310450_enqueue_periodic_sync_unsafe`);
    await db.exec(functionStatement(periodicCurrent, "public.sellerpilot_service_enqueue_periodic_sync"));
    await db.exec(history);
    await db.exec(`
      insert into auth.users values('${owner}'),('${administrator}');
      insert into sellerpilot_private.ai_cli_worker_tokens values(
        '${worker}','serverless','${tokenHash}','777777777777','active','serverless_cs',
        now()+interval'1 day',null,null,'${administrator}',now(),null,null,null,null);
      insert into sellerpilot_private.channel_credentials(
        id,channel,environment,status,expires_at,fingerprint,version,seller_account_key,
        seller_account_key_source,seller_account_verified_at,created_by,created_at
      )values('${credential}','temu','production','active',now()+interval'1 day','credential',1,
        '${sellerKey}','provider_certified_v1',now(),'${owner}',now());
      insert into sellerpilot_private.serverless_static_egress_policy values('temu',true);
    `);

    const started = await value(db,
      "select public.sellerpilot_start_or_resume_temu_history_v1($1,$2::jsonb) result",
      [credential, JSON.stringify({ action: "start", requestKey,
        fromDate: "2026-09-08", toDate: "2026-09-08" })]);
    assert.equal(started.status, "running");
    const job = (await db.query("select*from sellerpilot_private.channel_gateway_jobs")).rows[0];
    assert.equal(job.status, "queued");
    assert.equal(job.seller_account_key, sellerKey);
    assert.equal(await value(db,
      "select status from sellerpilot_private.channel_sync_state where channel_key='temu'and data_type='inquiries'"), "queued");

    await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=$1,
      claim_token=$2,attempt_count=1,started_at=now(),lease_expires_at=now()+interval'5 minutes' where id=$3`,
    [worker, claim, job.id]);
    await db.query("select set_config('fixture.job_id',$1,false)", [job.id]);
    const gatewayContext = await value(db,
      "select public.sellerpilot_service_gateway_completion_context($1,$2,$3) result",
      [tokenHash, job.id, claim]);
    assert.equal(gatewayContext.temuHistoryRunId, started.runId);
    const context = await value(db,
      "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result",
      [tokenHash, job.id, claim]);
    assert.equal(context.status, "running");
    assert.equal(context.credential_binding_context.sellerAccountKey, sellerKey);
    assert.equal(context.temuHistoryRunId, started.runId);
    assert.equal(job.request_payload.arguments.sellerpilotTemuHistoryRunId, started.runId);

    const response = JSON.stringify({ ok: true,channel: "temu",operation: "inquiries.list",steps: [],safeMessage: "ok" });
    const completed = await value(db, `select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,'[]'::jsonb,null) result`,
    [tokenHash, job.id, claim, response]);
    assert.equal(completed.status, "completed");
    const checkpoint = await value(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      [tokenHash, job.id, claim]);
    assert.equal(checkpoint.replayed, false);
    assert.equal(checkpoint.completedPageCount, 1);

    const completionReplay = await value(db, `select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,'[]'::jsonb,null) result`,
    [tokenHash, job.id, claim, response]);
    assert.equal(completionReplay.replayed, true);
    const checkpointReplay = await value(db,
      "select public.sellerpilot_service_record_temu_history_checkpoint_v1($1,$2,$3) result",
      [tokenHash, job.id, claim]);
    assert.equal(checkpointReplay.replayed, true);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.ingested_inquiries"), 1);
    assert.equal(await value(db,
      "select count(*)::integer from sellerpilot_private.temu_history_checkpoint_receipts"), 1);
  } finally {
    await db.close();
  }
});
