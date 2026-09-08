import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const localRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredRoot = process.env.SELLERPILOT_QOO10_INTEGRATED_ROOT?.trim();
const repoRoot = configuredRoot ? path.resolve(configuredRoot) : localRoot;
const requiredIntegratedFile = path.join(
  repoRoot,
  "supabase/migrations/20260908145336_cs_qoo10_reply_s3_common_paths.sql",
);
await access(requiredIntegratedFile);

const mockSupabaseModule = `data:text/javascript,${encodeURIComponent(`
export function createClient() {
  return {
    rpc(name, args = {}) {
      return globalThis.__sellerpilotQoo10ActualReceiptRpc(name, args);
    },
  };
}
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    if (specifier === "@supabase/supabase-js") {
      return { shortCircuit: true, url: mockSupabaseModule };
    }
    return nextResolve(specifier, context);
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qoo10-actual-receipt-fixture.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_qoo10_actual_receipt_fixture_only";

const [{ runOneServerlessCsGatewayJob }, { POST: completeWorkerPost }] = await Promise.all([
  import(pathToFileURL(path.join(repoRoot, "lib/channels/serverless-gateway.ts")).href),
  import(pathToFileURL(path.join(
    repoRoot,
    "app/api/channel-gateway/worker/complete/route.ts",
  )).href),
]);

const sql = Object.fromEntries(await Promise.all(Object.entries({
  atomic: "supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql",
  status: "supabase/migrations/20260908140419_cs_qoo10_reply_s3_status.sql",
  seal: "supabase/migrations/20260908140421_cs_qoo10_reply_s3_response_seal.sql",
  coupang: "supabase/migrations/20260908143355_cs_coupang_reply_readback.sql",
  common: "supabase/migrations/20260908145336_cs_qoo10_reply_s3_common_paths.sql",
  compat: "supabase/migrations/20260908153341_cs_qoo10_reply_s3_actual_completion.sql",
}).map(async ([key, relative]) => [
  key,
  await readFile(path.join(repoRoot, relative), "utf8"),
])));

const ids = {
  owner: "61000000-0000-4000-8000-000000000001",
  qooCredential: "61000000-0000-4000-8000-000000000002",
  qooTicket: "61000000-0000-4000-8000-000000000003",
  qooInbound: "61000000-0000-4000-8000-000000000004",
  qooReplyJob: "61000000-0000-4000-8000-000000000005",
  gatewayWorker: "61000000-0000-4000-8000-000000000006",
  serverlessWorker: "61000000-0000-4000-8000-000000000007",
  otherWorker: "61000000-0000-4000-8000-000000000008",
  qooReplyClaim: "61000000-0000-4000-8000-000000000009",
  qooReadClaim: "61000000-0000-4000-8000-000000000010",
  wrongClaim: "61000000-0000-4000-8000-000000000011",
  coupangCredential: "61000000-0000-4000-8000-000000000012",
  coupangTicket: "61000000-0000-4000-8000-000000000013",
  coupangReplyJob: "61000000-0000-4000-8000-000000000014",
  coupangReplyClaim: "61000000-0000-4000-8000-000000000015",
};
const qooSellerKey = "a".repeat(64);
const coupangSellerKey = "b".repeat(64);
const replyFingerprint = "c".repeat(64);
const qooInboundKey = "qoo10:inbound:actual-receipt-fixture";
const coupangInboundKey = `coupang:${"d".repeat(64)}`;
const serverlessTokenHash = "e".repeat(64);
const otherTokenHash = "f".repeat(64);
const gatewayBearer = `spw_${"g".repeat(43)}`;
const gatewayTokenHash = createHash("sha256").update(gatewayBearer).digest("hex");

function qooBindingDigest() {
  return createHash("sha256").update(JSON.stringify({
    inquiryType: "MSG",
    questionNo: "700",
    sequenceNo: "701",
  })).digest("hex");
}

function qooReplyRequest() {
  return {
    arguments: {
      params: {
        inq_type: "MSG",
        question_no: "700",
        seq_no: "701",
        contents: "synthetic approved reply fixture",
      },
    },
    sellerpilotInboundKey: qooInboundKey,
    sellerpilotReplyFingerprint: replyFingerprint,
    sellerpilotTicketId: ids.qooTicket,
  };
}

function qooReplyResponse() {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.reply",
    steps: [{
      name: "SetInquiryMessage",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        sellerpilotReplyAcceptance: {
          contract: "sellerpilot-reply-acceptance/1",
          level: "provider_accepted",
          channel: "qoo10",
          kind: "inquiry",
          bindingDigest: qooBindingDigest(),
        },
      },
    }],
    safeMessage: "synthetic provider ACK",
  };
}

function qooS3Result(sequenceNo = "701") {
  return {
    ok: true,
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{
      name: "GetInquiryMessage",
      ok: true,
      status: 200,
      data: {
        ResultCode: 0,
        ResultObject: [{
          INQ_TYPE: "MSG",
          QUESTION_NO: "700",
          SEQ_NO: sequenceNo,
          STATUS: "S3",
          CONTENTS: "must-not-persist",
          BUYER_EMAIL: "must-not-persist@example.invalid",
        }],
      },
    }],
    safeMessage: "synthetic S3 read",
  };
}

function coupangReplyRequest() {
  return {
    arguments: {
      kind: "call-center",
      inquiryId: "3101",
      parentAnswerId: "4103",
      reply: "synthetic Coupang reply fixture",
    },
    sellerpilotTicketId: ids.coupangTicket,
    sellerpilotInboundKey: coupangInboundKey,
    sellerpilotReplyFingerprint: replyFingerprint,
  };
}

function coupangReplyResponse() {
  return {
    ok: true,
    channel: "coupang",
    operation: "inquiries.reply",
    steps: [{
      name: "replyCallCenterInquiry",
      ok: true,
      status: 200,
      data: {
        sellerpilotReplyAcceptance: {
          contract: "sellerpilot-reply-acceptance/1",
          level: "provider_accepted",
          channel: "coupang",
          kind: "call-center",
          bindingDigest: "1".repeat(64),
        },
      },
    }],
  };
}

async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select '${ids.owner}'::uuid $$;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable as
      $$ select sha256(convert_to(value,'UTF8')) $$;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      created_by uuid not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.ai_cli_worker_tokens (
      id uuid primary key,
      token_hash text not null unique,
      scope text not null,
      status text not null,
      expires_at timestamptz not null,
      created_by uuid not null
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null,
      attempt_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb not null default '{}'::jsonb,
      response_payload jsonb,
      status text not null default 'queued',
      error_message text,
      created_by uuid not null,
      seller_account_key text,
      worker_token_id uuid,
      claim_token uuid,
      lease_expires_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp(),
      created_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.support_tickets (
      id uuid primary key,
      owner_id uuid not null,
      source_credential_id uuid,
      channel_key text not null,
      ticket_kind text not null default 'conversation',
      external_ticket_id text not null,
      latest_inbound_key text not null,
      seller_account_key text,
      demo boolean not null default false,
      last_delivery_job_id uuid,
      provider_status text,
      provider_status_updated_at timestamptz,
      status text not null default 'open',
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.support_inbound_messages (
      id uuid primary key,
      ticket_id uuid not null,
      owner_id uuid not null,
      channel_key text not null,
      inbound_key text not null,
      sender_role text not null,
      received_at timestamptz not null
    );
    create table sellerpilot_private.support_reply_deliveries (
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null,
      owner_id uuid not null,
      gateway_job_id uuid not null unique,
      channel_key text not null,
      status text not null,
      verification_status text not null default 'unverified',
      verification_contract text,
      reply_fingerprint text not null,
      safe_message text,
      reconciliation_reason text,
      provider_request_id text,
      provider_message_id text,
      provider_accepted_at timestamptz,
      remote_observed_at timestamptz,
      queued_at timestamptz not null,
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default clock_timestamp()
    );

    create function public.sellerpilot_is_admin() returns boolean
    language sql stable as $$ select true $$;
    create function sellerpilot_private.worker_token_has_scope(
      p_token_hash text,p_scope text,p_touch boolean
    ) returns boolean language sql stable set search_path='' as $$
      select exists(
        select 1 from sellerpilot_private.ai_cli_worker_tokens token
         where token.token_hash=p_token_hash
           and token.status='active'
           and token.expires_at>clock_timestamp()
           and (token.scope=p_scope or (p_scope='gateway' and token.scope='legacy_combined'))
      )
    $$;
    create function public.sellerpilot_service_prepare_gateway_credential_refresh(
      text,uuid,uuid,jsonb,timestamptz,boolean,boolean
    ) returns jsonb language sql as $$ select '{"status":"rejected"}'::jsonb $$;
    create function public.sellerpilot_record_credential_test(uuid,text,text)
    returns void language sql as $$ select $$;
    create function public.sellerpilot_service_ingest_orders(uuid,text,jsonb)
    returns integer language sql as $$ select 0 $$;
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
    returns integer language sql as $$ select 0 $$;
    create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)
    returns void language sql as $$ select $$;
    create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean)
    returns void language sql as $$ select $$;
    create function public.sellerpilot_complete_channel_gateway_job(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_status text,
      p_response_payload jsonb,p_error_message text
    ) returns boolean language plpgsql security definer set search_path='' as $$
    declare v_updated integer;
    begin
      update sellerpilot_private.channel_gateway_jobs job set
        status=p_status,response_payload=p_response_payload,error_message=p_error_message,
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where job.id=p_job_id and job.status='running'
         and job.claim_token=p_claim_token and job.lease_expires_at>clock_timestamp();
      get diagnostics v_updated=row_count;
      return v_updated=1;
    end $$;

    create function sellerpilot_private.track_reply_acceptance_verification()
    returns trigger language plpgsql security definer set search_path='' as $$
    begin
      if new.verification_status='remote_observed' then return new; end if;
      if new.status='succeeded' then
        new.verification_status:='provider_accepted';
        new.verification_contract:='sellerpilot-reply-acceptance/1';
        new.provider_accepted_at:=coalesce(new.provider_accepted_at,new.completed_at,clock_timestamp());
      elsif new.status='reconciliation_required' then
        new.verification_status:='reconciliation_required';
      elsif new.status in('failed','cancelled') then
        new.verification_status:='failed';
      else
        new.verification_status:='unverified';
      end if;
      return new;
    end $$;
    create trigger track_reply_acceptance_verification
    before insert or update of status on sellerpilot_private.support_reply_deliveries
    for each row execute function sellerpilot_private.track_reply_acceptance_verification();

    create function sellerpilot_private.sync_inquiry_reply_delivery_ledger()
    returns trigger language plpgsql security definer set search_path='' as $$
    declare
      v_ticket_id uuid;
      v_owner_id uuid;
      v_reply_fingerprint text;
      v_delivery_status text;
      v_reconciliation_reason text;
    begin
      if new.operation<>'inquiries.reply' then return new; end if;
      begin v_ticket_id:=nullif(new.request_payload->>'sellerpilotTicketId','')::uuid;
      exception when others then return new; end;
      v_reply_fingerprint:=nullif(new.request_payload->>'sellerpilotReplyFingerprint','');
      if v_ticket_id is null or v_reply_fingerprint!~'^[0-9a-f]{64}$' then return new; end if;
      select ticket.owner_id into v_owner_id
        from sellerpilot_private.support_tickets ticket
       where ticket.id=v_ticket_id and ticket.channel_key=new.channel and not ticket.demo;
      if v_owner_id is null then return new; end if;
      v_delivery_status:=case
        when new.status='succeeded' and new.response_payload@>'{"ok":true}'::jsonb then 'succeeded'
        when new.status='succeeded' and new.response_payload@>'{"ok":false}'::jsonb then 'failed'
        when new.status='succeeded' then 'reconciliation_required'
        else new.status end;
      v_reconciliation_reason:=case when v_delivery_status='reconciliation_required'
        then left(coalesce(nullif(trim(new.error_message),''),'Provider outcome requires reconciliation.'),500)
        else null end;
      insert into sellerpilot_private.support_reply_deliveries(
        ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,
        provider_request_id,provider_message_id,safe_message,reconciliation_reason,
        queued_at,started_at,completed_at,updated_at
      ) values(
        v_ticket_id,v_owner_id,new.id,new.channel,v_delivery_status,v_reply_fingerprint,
        nullif(new.response_payload#>>'{steps,0,requestId}',''),
        left(nullif(trim(new.response_payload->>'remoteId'),''),240),
        left(nullif(trim(new.response_payload->>'safeMessage'),''),1000),
        v_reconciliation_reason,new.created_at,new.started_at,new.completed_at,clock_timestamp()
      ) on conflict(gateway_job_id) do update set
        status=excluded.status,
        provider_request_id=coalesce(excluded.provider_request_id,sellerpilot_private.support_reply_deliveries.provider_request_id),
        provider_message_id=coalesce(excluded.provider_message_id,sellerpilot_private.support_reply_deliveries.provider_message_id),
        safe_message=coalesce(excluded.safe_message,sellerpilot_private.support_reply_deliveries.safe_message),
        reconciliation_reason=excluded.reconciliation_reason,
        started_at=coalesce(excluded.started_at,sellerpilot_private.support_reply_deliveries.started_at),
        completed_at=excluded.completed_at,updated_at=clock_timestamp();
      update sellerpilot_private.support_tickets set
        last_delivery_job_id=new.id,
        provider_status=case when v_delivery_status='succeeded' then 'answered' else provider_status end,
        provider_status_updated_at=case when v_delivery_status='succeeded' then clock_timestamp() else provider_status_updated_at end
       where id=v_ticket_id and latest_inbound_key=new.request_payload->>'sellerpilotInboundKey';
      return new;
    end $$;
    create trigger sync_inquiry_reply_delivery_ledger
    after insert or update of status,response_payload,error_message
    on sellerpilot_private.channel_gateway_jobs for each row
    execute function sellerpilot_private.sync_inquiry_reply_delivery_ledger();

    create function public.sellerpilot_get_cs_workspace_snapshot()
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object(
        'delivery',(select jsonb_build_object(
          'verificationContract', d.verification_contract,
          'status', d.status
        ) from sellerpilot_private.support_reply_deliveries d limit 1),
        'blockingDelivery',(select jsonb_build_object(
          'verificationContract', blocking.verification_contract,
          'status', blocking.status
        ) from sellerpilot_private.support_reply_deliveries blocking limit 1)
      )
    $$;

    insert into sellerpilot_private.channel_credentials values
      ('${ids.qooCredential}','qoo10','production','${ids.owner}','active',
       clock_timestamp()+interval '1 day','${qooSellerKey}',null,null),
      ('${ids.coupangCredential}','coupang','production','${ids.owner}','active',
       clock_timestamp()+interval '1 day','${coupangSellerKey}',
       'provider_certified_v1',clock_timestamp());
    insert into sellerpilot_private.ai_cli_worker_tokens values
      ('${ids.gatewayWorker}','${gatewayTokenHash}','gateway','active',
       clock_timestamp()+interval '1 day','${ids.owner}'),
      ('${ids.serverlessWorker}','${serverlessTokenHash}','serverless_cs','active',
       clock_timestamp()+interval '1 day','${ids.owner}'),
      ('${ids.otherWorker}','${otherTokenHash}','gateway','active',
       clock_timestamp()+interval '1 day','${ids.owner}');
  `);

  await db.exec(sql.atomic);
  await db.exec(`
    create function sellerpilot_private.worker_token_may_complete_gateway_job(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns boolean language sql stable set search_path='' as $$
      select exists(
        select 1 from sellerpilot_private.ai_cli_worker_tokens token
         where token.token_hash=p_token_hash
           and token.status='active'
           and token.expires_at>clock_timestamp()
           and (
             token.scope in('gateway','legacy_combined')
             or (token.scope='serverless_cs' and (
               exists(select 1 from sellerpilot_private.channel_gateway_jobs job
                 where job.id=p_job_id and job.worker_token_id=token.id
                   and job.claim_token=p_claim_token and job.channel='qoo10'
                   and job.operation in('inquiries.list','inquiries.reply'))
               or exists(select 1 from sellerpilot_private.gateway_completion_receipts receipt
                 join sellerpilot_private.channel_gateway_jobs job on job.id=receipt.job_id
                where receipt.job_id=p_job_id and receipt.worker_token_id=token.id
                  and receipt.claim_token=p_claim_token and job.channel='qoo10'
                  and job.operation in('inquiries.list','inquiries.reply'))
             ))
           )
      )
    $$;
    do $rewrite_atomic_token_gate$
    declare
      v_signature text;
      v_definition text;
      v_rewritten text;
      v_old_guard constant text := E'not sellerpilot_private.worker_token_has_scope(\n       p_token_hash,\n       ''gateway'',\n       true\n     )';
      v_new_guard constant text := E'not sellerpilot_private.worker_token_may_complete_gateway_job(\n       p_token_hash,\n       p_job_id,\n       p_claim_token\n     )';
    begin
      foreach v_signature in array array[
        'public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)',
        'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'
      ] loop
        select pg_catalog.pg_get_functiondef(v_signature::regprocedure) into v_definition;
        v_rewritten:=replace(v_definition,v_old_guard,v_new_guard);
        v_rewritten:=replace(v_rewritten,
          'worker_token.scope in (''gateway'', ''legacy_combined'')',
          'worker_token.scope in (''gateway'', ''legacy_combined'', ''serverless_cs'')');
        if v_rewritten=v_definition then
          raise exception 'ACTUAL_FIXTURE_ATOMIC_TOKEN_REWRITE_FAILED';
        end if;
        execute v_rewritten;
      end loop;
    end
    $rewrite_atomic_token_gate$;
    create function public.sellerpilot_service_serverless_cs_completion_context(
      p_token_hash text,p_job_id uuid,p_claim_token uuid
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      if not sellerpilot_private.worker_token_may_complete_gateway_job(
        p_token_hash,p_job_id,p_claim_token
      ) then return null; end if;
      return public.sellerpilot_service_gateway_completion_context(
        p_token_hash,p_job_id,p_claim_token
      );
    end $$;
  `);
  await db.exec(sql.status);
  await db.exec(sql.seal);
  await db.exec(sql.coupang);
  await db.exec(sql.common);
  await db.exec(sql.compat);
  return db;
}

async function insertQooReply(db) {
  await db.query(`insert into sellerpilot_private.support_tickets(
    id,owner_id,source_credential_id,channel_key,ticket_kind,external_ticket_id,
    latest_inbound_key,seller_account_key,demo,status
  ) values($1,$2,$3,'qoo10','conversation','MSG:700',$4,$5,false,'open')`, [
    ids.qooTicket, ids.owner, ids.qooCredential, qooInboundKey, qooSellerKey,
  ]);
  await db.query(`insert into sellerpilot_private.support_inbound_messages values(
    $1,$2,$3,'qoo10',$4,'customer','2026-09-07T15:30:00Z'
  )`, [ids.qooInbound, ids.qooTicket, ids.owner, qooInboundKey]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,
    created_by,seller_account_key,worker_token_id,claim_token,lease_expires_at,started_at
  ) values($1,$2,'qoo10','inquiries.reply','production',$3::jsonb,'running',
    $4,$5,$6,$7,clock_timestamp()+interval '10 minutes',clock_timestamp())`, [
    ids.qooReplyJob, ids.qooCredential, JSON.stringify(qooReplyRequest()),
    ids.owner, qooSellerKey, ids.gatewayWorker, ids.qooReplyClaim,
  ]);
}

async function insertCoupangReply(db) {
  await db.query(`insert into sellerpilot_private.support_tickets(
    id,owner_id,source_credential_id,channel_key,ticket_kind,external_ticket_id,
    latest_inbound_key,seller_account_key,demo,status
  ) values($1,$2,$3,'coupang','conversation','call-center:3101',$4,$5,false,'open')`, [
    ids.coupangTicket, ids.owner, ids.coupangCredential, coupangInboundKey, coupangSellerKey,
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,
    created_by,seller_account_key,worker_token_id,claim_token,lease_expires_at,started_at
  ) values($1,$2,'coupang','inquiries.reply','production',$3::jsonb,'running',
    $4,$5,$6,$7,clock_timestamp()+interval '10 minutes',clock_timestamp())`, [
    ids.coupangReplyJob, ids.coupangCredential, JSON.stringify(coupangReplyRequest()),
    ids.owner, coupangSellerKey, ids.gatewayWorker, ids.coupangReplyClaim,
  ]);
}

async function callCompletion(db, input) {
  const params = [
    input.tokenHash,
    input.jobId,
    input.claimToken,
    input.status,
    input.response ?? null,
    input.error ?? null,
    null,
    null,
    null,
    null,
  ];
  const result = await db.query(`select public.sellerpilot_service_complete_gateway_transaction(
    $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb
  ) value`, params.map((value, index) => index === 4 && value !== null ? JSON.stringify(value) : value));
  return result.rows[0].value;
}

async function completeQooReplyTwice(db) {
  await insertQooReply(db);
  const input = {
    tokenHash: gatewayTokenHash,
    jobId: ids.qooReplyJob,
    claimToken: ids.qooReplyClaim,
    status: "succeeded",
    response: qooReplyResponse(),
  };
  const first = await callCompletion(db, input);
  const replay = await callCompletion(db, input);
  assert.equal(first.status, "completed");
  assert.equal(replay.status, "completed");
  assert.equal(replay.replayed, true);
  const childRows = (await db.query(`select job.*
    from sellerpilot_private.qoo10_reply_s3_readback_enqueues enqueue
    join sellerpilot_private.channel_gateway_jobs job on job.id=enqueue.readback_job_id
    where enqueue.reply_job_id=$1`, [ids.qooReplyJob])).rows;
  assert.equal(childRows.length, 1);
  return childRows[0];
}

async function claimChild(db, childId, workerId, claimToken) {
  await db.query(`update sellerpilot_private.channel_gateway_jobs set
    status='running',worker_token_id=$2,claim_token=$3,
    lease_expires_at=clock_timestamp()+interval '10 minutes',
    started_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=$1`, [childId, workerId, claimToken]);
  return (await db.query(`select * from sellerpilot_private.channel_gateway_jobs where id=$1`, [childId])).rows[0];
}

async function dbRpc(db, name, args) {
  const calls = {
    sellerpilot_service_serverless_cs_completion_context: {
      sql: "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) value",
      values: [args.p_token_hash, args.p_job_id, args.p_claim_token],
    },
    sellerpilot_service_gateway_completion_context: {
      sql: "select public.sellerpilot_service_gateway_completion_context($1,$2,$3) value",
      values: [args.p_token_hash, args.p_job_id, args.p_claim_token],
    },
    sellerpilot_service_complete_serverless_cs_transaction: {
      sql: `select public.sellerpilot_service_complete_serverless_cs_transaction(
        $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb
      ) value`,
      values: [args.p_token_hash,args.p_job_id,args.p_claim_token,args.p_status,
        args.p_response_payload,args.p_error_message,args.p_credential_refresh,
        args.p_normalized_orders,args.p_normalized_inquiries,args.p_diagnostic],
    },
    sellerpilot_service_complete_gateway_transaction: {
      sql: `select public.sellerpilot_service_complete_gateway_transaction(
        $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb
      ) value`,
      values: [args.p_token_hash,args.p_job_id,args.p_claim_token,args.p_status,
        args.p_response_payload,args.p_error_message,args.p_credential_refresh,
        args.p_normalized_orders,args.p_normalized_inquiries,args.p_diagnostic],
    },
    sellerpilot_service_record_qoo10_reply_s3_readback_v1: {
      sql: `select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      ) value`,
      values: [args.p_token_hash,args.p_job_id,args.p_claim_token,args.p_delivery_id,
        args.p_state,args.p_reason,args.p_matching_rows,args.p_reply_content_observed,
        args.p_resend_allowed],
    },
  };
  const call = calls[name];
  if (!call) return { data: null, error: { code: `unexpected_rpc:${name}` } };
  try {
    const values = call.values.map((value, index) => {
      if (value === null || value === undefined) return null;
      if ([4, 6, 7, 8, 9].includes(index) && typeof value === "object") {
        return JSON.stringify(value);
      }
      return value;
    });
    return { data: (await db.query(call.sql, values)).rows[0].value, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        code: typeof error?.code === "string" ? error.code : "db_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function deliveryRead(db) {
  return (await db.query(`select public.sellerpilot_get_inquiry_reply_delivery($1,$2) value`, [
    ids.qooTicket, ids.qooReplyJob,
  ])).rows[0].value;
}

function serverlessRpc(db, child, options = {}) {
  let claimed = false;
  let completionCalls = 0;
  return {
    get completionCalls() { return completionCalls; },
    rpc: async (name, args = {}) => {
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        if (claimed) return { data: null, error: null };
        claimed = true;
        await claimChild(db, child.id, ids.serverlessWorker, ids.qooReadClaim);
        return {
          data: {
            id: child.id,
            claim_token: ids.qooReadClaim,
            credential_id: ids.qooCredential,
            channel: "qoo10",
            operation: "inquiries.list",
            environment: "production",
            request: child.request_payload,
            credential: { api_key: "synthetic-fixture-secret" },
            attempt_count: 1,
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
        return { data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "reserved",
          retryAfterSeconds: 0,
        }, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") {
        const row = (await db.query(`select status,claim_token from sellerpilot_private.channel_gateway_jobs
          where id=$1`, [child.id])).rows[0];
        return { data: row?.status === "running" && row?.claim_token === ids.qooReadClaim
          ? "running" : "ownership_lost", error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        completionCalls += 1;
        const actual = await dbRpc(db, name, args);
        if (options.loseFirstCompletionResponse && completionCalls === 1 && !actual.error) {
          return { data: null, error: { code: "response_lost_after_commit" } };
        }
        return actual;
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        return { data: { contract: "sellerpilot-cs-credential-binding/1", status: "recorded" }, error: null };
      }
      return dbRpc(db, name, args);
    },
  };
}

async function assertStatusZero(db) {
  const delivery = await deliveryRead(db);
  assert.equal(delivery.qoo10S3StatusObserved, false);
  assert.equal(delivery.qoo10S3LastCheckedAt, null);
  assert.equal(delivery.qoo10S3ReadbackState, null);
  assert.equal((await db.query(`select count(*)::integer count
    from sellerpilot_private.support_reply_deliveries
    where qoo10_s3_status_observed or qoo10_s3_last_checked_at is not null`)).rows[0].count, 0);
}

test("actual runOne survives a lost canonical completion response, replays one receipt, records 007, and reaches delivery GET", async () => {
  const db = await createFixture();
  try {
    const child = await completeQooReplyTwice(db);
    const runtime = serverlessRpc(db, child, { loseFirstCompletionResponse: true });
    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["qoo10"],
      rpc: runtime.rpc,
      executeProvider: async () => qooS3Result(),
      logError: () => {},
    }, serverlessTokenHash);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "succeeded");
    assert.equal(runtime.completionCalls, 2);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [child.id])).rows[0].count, 1);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [child.id])).rows[0].count, 1);
    const stored = (await db.query(`select response_payload from sellerpilot_private.channel_gateway_jobs
      where id=$1`, [child.id])).rows[0].response_payload;
    assert.equal(stored.steps[0].data.sellerpilotMarker, "sellerpilot-qoo10-s3-stored-evidence/1");
    assert.doesNotMatch(JSON.stringify(stored), /must-not-persist|BUYER_EMAIL|synthetic-fixture-secret/u);
    const delivery = await deliveryRead(db);
    assert.equal(delivery.qoo10S3StatusObserved, true);
    assert.equal(delivery.qoo10S3ReadbackState, "verified");
    assert.equal(delivery.qoo10ReplyContentObserved, false);
    assert.equal(delivery.qoo10AutomaticResendAllowed, false);
    assert.equal(delivery.verificationStatus, "provider_accepted");
  } finally {
    await db.close();
  }
});

test("actual external worker completion POST reaches canonical receipt, seal, 007, and delivery GET", async () => {
  const db = await createFixture();
  try {
    const child = await completeQooReplyTwice(db);
    await claimChild(db, child.id, ids.gatewayWorker, ids.qooReadClaim);
    globalThis.__sellerpilotQoo10ActualReceiptRpc = (name, args) => dbRpc(db, name, args);
    const response = await completeWorkerPost(new Request(
      "https://fixture.invalid/api/channel-gateway/worker/complete",
      {
        method: "POST",
        headers: { authorization: `Bearer ${gatewayBearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          jobId: child.id,
          claimToken: ids.qooReadClaim,
          status: "succeeded",
          result: qooS3Result(),
        }),
      },
    ));
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /안전하게 저장/u);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [child.id])).rows[0].count, 1);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_completion_seals where job_id=$1`, [child.id])).rows[0].count, 1);
    const delivery = await deliveryRead(db);
    assert.equal(delivery.qoo10S3ReadbackState, "verified");
    assert.equal(delivery.qoo10S3StatusObserved, true);
    assert.equal(delivery.qoo10ReplyContentObserved, false);
    assert.equal(delivery.qoo10AutomaticResendAllowed, false);
  } finally {
    delete globalThis.__sellerpilotQoo10ActualReceiptRpc;
    await db.close();
  }
});

test("actual runOne persists a failed transport receipt and status-only incomplete evidence without provider rows", async () => {
  const db = await createFixture();
  try {
    const child = await completeQooReplyTwice(db);
    const runtime = serverlessRpc(db, child);
    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["qoo10"],
      rpc: runtime.rpc,
      executeProvider: async () => { throw new Error("synthetic transport failure"); },
      logError: () => {},
    }, serverlessTokenHash);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "failed");
    const job = (await db.query(`select status,response_payload from sellerpilot_private.channel_gateway_jobs
      where id=$1`, [child.id])).rows[0];
    assert.equal(job.status, "failed");
    assert.equal(job.response_payload, null);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [child.id])).rows[0].count, 1);
    const delivery = await deliveryRead(db);
    assert.equal(delivery.qoo10S3StatusObserved, false);
    assert.equal(delivery.qoo10S3ReadbackState, "incomplete");
    assert.equal(delivery.qoo10S3ReadbackReason, "provider_transport_or_contract_failed");
    assert.equal(delivery.qoo10S3MatchingRows, 0);
    assert.equal(delivery.qoo10AutomaticResendAllowed, false);
  } finally {
    await db.close();
  }
});

test("marker, claim, and receipt-token mismatches leave Qoo10 status observations at zero", async (t) => {
  await t.test("marker mismatch", async () => {
    const db = await createFixture();
    try {
      const child = await completeQooReplyTwice(db);
      await db.query(`update sellerpilot_private.channel_gateway_jobs set
        request_payload=jsonb_set(request_payload,
          '{arguments,sellerpilotQoo10ReplyReadback,sequenceNo}','"999"'::jsonb)
        where id=$1`, [child.id]);
      await claimChild(db, child.id, ids.gatewayWorker, ids.qooReadClaim);
      globalThis.__sellerpilotQoo10ActualReceiptRpc = (name, args) => dbRpc(db, name, args);
      const response = await completeWorkerPost(new Request(
        "https://fixture.invalid/api/channel-gateway/worker/complete",
        {
          method: "POST",
          headers: { authorization: `Bearer ${gatewayBearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            jobId: child.id,
            claimToken: ids.qooReadClaim,
            status: "succeeded",
            result: qooS3Result("999"),
          }),
        },
      ));
      assert.equal(response.status, 503);
      assert.equal((await db.query(`select count(*)::integer count
        from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [child.id])).rows[0].count, 1);
      await assertStatusZero(db);
    } finally {
      delete globalThis.__sellerpilotQoo10ActualReceiptRpc;
      await db.close();
    }
  });

  await t.test("claim mismatch", async () => {
    const db = await createFixture();
    try {
      const child = await completeQooReplyTwice(db);
      await claimChild(db, child.id, ids.gatewayWorker, ids.qooReadClaim);
      globalThis.__sellerpilotQoo10ActualReceiptRpc = (name, args) => dbRpc(db, name, args);
      const response = await completeWorkerPost(new Request(
        "https://fixture.invalid/api/channel-gateway/worker/complete",
        {
          method: "POST",
          headers: { authorization: `Bearer ${gatewayBearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            jobId: child.id,
            claimToken: ids.wrongClaim,
            status: "succeeded",
            result: qooS3Result(),
          }),
        },
      ));
      assert.equal(response.status, 409);
      assert.equal((await db.query(`select count(*)::integer count
        from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [child.id])).rows[0].count, 0);
      await assertStatusZero(db);
    } finally {
      delete globalThis.__sellerpilotQoo10ActualReceiptRpc;
      await db.close();
    }
  });

  await t.test("receipt worker-token mismatch", async () => {
    const db = await createFixture();
    try {
      const child = await completeQooReplyTwice(db);
      await claimChild(db, child.id, ids.gatewayWorker, ids.qooReadClaim);
      const preparedModule = await import(pathToFileURL(path.join(
        repoRoot,
        "lib/channels/cs/qoo10/reply-readback-completion.ts",
      )).href);
      const prepared = preparedModule.qoo10ReplyS3CompletionEvidence({
        context: child.request_payload.arguments.sellerpilotQoo10ReplyReadback,
        result: qooS3Result(),
      });
      const completed = await dbRpc(db, "sellerpilot_service_complete_gateway_transaction", {
        p_token_hash: gatewayTokenHash,
        p_job_id: child.id,
        p_claim_token: ids.qooReadClaim,
        p_status: "succeeded",
        p_response_payload: prepared.storedResponse,
        p_error_message: null,
        p_credential_refresh: null,
        p_normalized_orders: null,
        p_normalized_inquiries: null,
        p_diagnostic: null,
      });
      assert.equal(completed.error, null);
      const mismatched = await dbRpc(db, "sellerpilot_service_record_qoo10_reply_s3_readback_v1", {
        p_token_hash: otherTokenHash,
        p_job_id: child.id,
        p_claim_token: ids.qooReadClaim,
        p_delivery_id: child.request_payload.arguments.sellerpilotQoo10ReplyReadback.deliveryId,
        p_state: prepared.verification.state,
        p_reason: prepared.verification.reason,
        p_matching_rows: prepared.verification.matchingRows,
        p_reply_content_observed: false,
        p_resend_allowed: false,
      });
      assert.notEqual(mismatched.error, null);
      await assertStatusZero(db);
    } finally {
      await db.close();
    }
  });
});

test("Coupang reply receipt keeps its own 001/003 child while Qoo10 enqueue and status impact stay zero", async () => {
  const db = await createFixture();
  try {
    await insertCoupangReply(db);
    const completion = {
      tokenHash: gatewayTokenHash,
      jobId: ids.coupangReplyJob,
      claimToken: ids.coupangReplyClaim,
      status: "succeeded",
      response: coupangReplyResponse(),
    };
    const first = await callCompletion(db, completion);
    const replay = await callCompletion(db, completion);
    assert.equal(first.status, "completed");
    assert.equal(replay.replayed, true);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.coupang_reply_readback_links
      where source_job_id=$1`, [ids.coupangReplyJob])).rows[0].count, 1);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_readback_enqueues`)).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_completion_seals`)).rows[0].count, 0);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.support_reply_deliveries
      where qoo10_s3_status_observed or qoo10_s3_last_checked_at is not null`)).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("010 completion entrypoints stay service-role-only and hide the renamed predecessor", async () => {
  const db = await createFixture();
  try {
    const privileges = (await db.query(`select
      has_function_privilege('service_role',
        'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
        'execute') service_gateway,
      has_function_privilege('service_role',
        'public.sellerpilot_service_complete_serverless_cs_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
        'execute') service_serverless,
      has_function_privilege('anon',
        'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
        'execute') anon_gateway,
      has_function_privilege('authenticated',
        'public.sellerpilot_service_complete_serverless_cs_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
        'execute') authenticated_serverless,
      has_function_privilege('service_role',
        'public.sellerpilot_145336_complete_before_qoo10_reply_s3(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)',
        'execute') service_predecessor`)).rows[0];
    assert.deepEqual(privileges, {
      service_gateway: true,
      service_serverless: true,
      anon_gateway: false,
      authenticated_serverless: false,
      service_predecessor: false,
    });
  } finally {
    await db.close();
  }
});
