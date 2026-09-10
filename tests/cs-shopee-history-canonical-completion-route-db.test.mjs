import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    return nextResolve(specifier, context);
  },
});

const integratedRoot = process.env.SELLERPILOT_SHOPEE_INTEGRATED_ROOT?.trim();
const sourceRoot = integratedRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = async (name) => readFile(resolve(sourceRoot, "supabase/migrations", name), "utf8");
const gatewayModule = pathToFileURL(resolve(sourceRoot, "lib/channels/serverless-gateway.ts")).href;
const { executeServerlessCsProviderJob, runOneServerlessCsGatewayJob } = await import(gatewayModule);
const { ShopeeTransportAcceptanceStatus } = await import(
  pathToFileURL(resolve(sourceRoot, "app/cs/channels/shopee/transport-acceptance.tsx")).href
);

const sources = {
  atomic: await migration("20260826090400_atomic_gateway_completion_side_effects.sql"),
  serverless: await migration("20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql"),
  nonCsIntegrity: await migration("20260828210000_non_cs_release_integrity.sql"),
  ownership: await migration("20260908013000_hydrate_exact_coupang_local_verifier_claim.sql"),
  allowed: await migration("20260907200000_enable_shopee_comment_cs.sql"),
  qoo10: await migration("20260831056700_recover_exact_qoo10_s1_activation.sql"),
  temu: await migration("20260831133000_expand_verified_publication_to_temu.sql"),
  temuExact: await migration("20260901173960_allow_exact_temu_existing_content_update.sql"),
  lazadaExact: await migration("20260901173980_allow_exact_lazada_my_live_update.sql"),
  coupangRep: await migration("20260901173990_bind_coupang_exact_representative.sql"),
  qoo10Shipping: await migration("20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql"),
  qoo10ShippingFailed: await migration("20260905014100_allow_qoo10_shipping_s1_failed_verifier_complete.sql"),
  coupangLive: await migration("20260907191500_reconcile_exact_coupang_live_create_get_only.sql"),
  ledger: await migration("20260908142023_cs_shopee_history_ledger.sql"),
  start: await migration("20260908142028_cs_shopee_history_start.sql"),
  completion: await migration("20260908142029_cs_shopee_atomic_history_completion.sql"),
  invariants: await migration("20260908145331_cs_shopee_history_request_invariants.sql"),
  dateIntent: await migration("20260908151735_cs_shopee_history_date_intent_cutoff.sql"),
};

const completionSignature = "text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb";
const owner = "00000000-0000-4000-8000-000000013001";
const credential = "00000000-0000-4000-8000-000000013002";
const worker = "00000000-0000-4000-8000-000000013003";
const vaultId = "00000000-0000-4000-8000-000000013004";
const tokenHash = "synthetic-canonical-chain-worker-token";
const shops = [{ id: "1719148844", country: "SG" }, { id: "1758392145", country: "TW" }];
const accessToken = "synthetic-canonical-owner-access-token";
const publishableKey = "synthetic-canonical-publishable-key";
const serviceKey = "synthetic-canonical-service-key";
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function functionStatement(source, qualifiedName, occurrence = "last") {
  const pattern = new RegExp(`create(?: or replace)? function ${escapeRegExp(qualifiedName)}\\s*\\(`, "giu");
  const starts = [...source.matchAll(pattern)].map((match) => match.index);
  assert.ok(starts.length, `missing canonical function ${qualifiedName}`);
  const start = occurrence === "first" ? starts[0] : starts.at(-1);
  const tail = source.slice(start);
  const delimiterMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/iu);
  assert.ok(delimiterMatch?.index !== undefined, `missing body delimiter for ${qualifiedName}`);
  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = tail.indexOf(`${delimiter};`, bodyStart);
  assert.ok(bodyEnd >= 0, `missing body end for ${qualifiedName}`);
  return tail.slice(0, bodyEnd + delimiter.length + 1);
}

function taggedDoStatement(source, tag) {
  const startMarker = `do $${tag}$`;
  const endMarker = `$${tag}$;`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing canonical DO ${tag}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing canonical DO end ${tag}`);
  return source.slice(start, end + endMarker.length);
}

async function installCanonicalCompletionChain(db) {
  const run = async (label, sql) => {
    try { await db.exec(sql); } catch (error) { throw new Error(`${label}: ${error.message}`, { cause: error }); }
  };
  await run("atomic fingerprint", functionStatement(sources.atomic, "sellerpilot_private.gateway_completion_fingerprint"));
  await run("atomic context", functionStatement(sources.atomic, "public.sellerpilot_service_gateway_completion_context"));
  await run("atomic completion", functionStatement(sources.atomic, "public.sellerpilot_service_complete_gateway_transaction"));
  await run("initial serverless completion ownership", functionStatement(sources.serverless, "sellerpilot_private.worker_token_may_complete_gateway_job", "first"));
  await run("canonical serverless completion rewrite", taggedDoStatement(sources.serverless, "migration"));

  await run("current serverless operation matrix", functionStatement(sources.allowed, "sellerpilot_private.serverless_gateway_job_allowed"));
  await run("current serverless completion ownership", functionStatement(sources.nonCsIntegrity,
    "sellerpilot_private.worker_token_may_complete_gateway_job"));
  await run("current serverless lease ownership", functionStatement(sources.ownership, "sellerpilot_private.serverless_cs_job_is_owned"));
  await run("serverless touch", functionStatement(sources.serverless, "public.sellerpilot_touch_serverless_cs_job"));
  await run("serverless completion context", functionStatement(sources.serverless, "public.sellerpilot_service_serverless_cs_completion_context"));
  await run("serverless completion", functionStatement(sources.serverless, "public.sellerpilot_service_complete_serverless_cs_transaction"));

  const wrappers = [
    [sources.qoo10, "sellerpilot_056700_complete_gateway_before_qoo10_s1_activation"],
    [sources.temu, "sellerpilot_133000_complete_gateway_before_temu_publication"],
    [sources.temuExact, "sellerpilot_173960_complete_before_temu_exact"],
    [sources.lazadaExact, "sellerpilot_173980_complete_before_lazada_exact"],
  ];
  for (const [source, alias] of wrappers) {
    await run(`rename ${alias}`, `alter function public.sellerpilot_service_complete_gateway_transaction(${completionSignature}) rename to ${alias}`);
    await run(`install wrapper ${alias}`, functionStatement(source, "public.sellerpilot_service_complete_gateway_transaction"));
  }
  await run("copy Coupang representative predecessor", taggedDoStatement(sources.coupangRep, "copy_completion_predecessor"));
  await run("install Coupang representative wrapper", functionStatement(sources.coupangRep, "public.sellerpilot_service_complete_gateway_transaction"));
  await run("rename Qoo10 shipping predecessor", `alter function public.sellerpilot_service_complete_gateway_transaction(${completionSignature}) rename to sellerpilot_090500_complete_before_qoo10_shipping_s1`);
  await run("install Qoo10 shipping wrapper", functionStatement(sources.qoo10Shipping, "public.sellerpilot_service_complete_gateway_transaction"));
  await run("install Qoo10 failed verifier wrapper", functionStatement(sources.qoo10ShippingFailed, "public.sellerpilot_service_complete_gateway_transaction"));
  await run("rename Coupang live predecessor", `alter function public.sellerpilot_service_complete_gateway_transaction(${completionSignature}) rename to sellerpilot_complete_before_coupang_exact_live`);
  await run("install Coupang live wrapper", functionStatement(sources.coupangLive, "public.sellerpilot_service_complete_gateway_transaction"));
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema vault; create schema sellerpilot_private;
    create table auth.users(id uuid primary key,email text not null);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key references auth.users(id));
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer as
      $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,
      environment text not null,version integer not null,status text not null,vault_secret_id uuid
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null,last_seen_at timestamptz,last_version text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      attempt_id uuid,listing_id uuid,channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,error_message text,
      status text not null default 'queued',created_by uuid not null references auth.users(id),
      claim_token uuid,worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
      lease_expires_at timestamptz,created_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default clock_timestamp()
    );
    create unique index channel_gateway_jobs_continuation_once_idx on sellerpilot_private.channel_gateway_jobs((request_payload->>'continuationOf'))
      where nullif(request_payload->>'continuationOf','') is not null;
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),claim_token uuid not null,
      worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
      completion_fingerprint text not null,continuation_job_id uuid references sellerpilot_private.channel_gateway_jobs(id),
      created_at timestamptz not null default clock_timestamp(),unique(job_id,claim_token)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null references auth.users(id),channel_key text not null,
      external_ticket_id text not null,demo boolean not null default false,ticket_kind text not null,
      reply_context jsonb not null default '{}'::jsonb,provider_context jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),channel_key text not null,inbound_key text not null,
      remote_message_id text,provider_context jsonb not null default '{}'::jsonb
    );
    create table sellerpilot_private.isolated_ingest_log(
      id bigint generated always as identity primary key,credential_id uuid not null,channel text not null,payload jsonb not null
    );
    create table sellerpilot_private.isolated_sync_log(
      id bigint generated always as identity primary key,credential_id uuid not null,channel text not null,
      data_type text not null,status text not null,error_message text
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.channel_market_targets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),channel text not null,
      environment text not null,target_id text not null,market_code text not null,verified_at timestamptz not null default now(),
      unique(owner_id,channel,environment,market_code,target_id)
    );

    create table sellerpilot_private.exact_existing_update_permits(permit_id uuid,update_job_id uuid,channel text,consumed_at timestamptz);
    create table sellerpilot_private.product_listings(id uuid);
    create table sellerpilot_private.coupang_exact_representative_permits(permit_id uuid);
    create table sellerpilot_private.qoo10_exact_s1_verifier_runs(verifier_job_id uuid);
    create table sellerpilot_private.qoo10_shipping_s1_verifier_runs(verifier_job_id uuid);
    create table sellerpilot_private.qoo10_shipping_s1_activation_permits(activation_job_id uuid);
    create table sellerpilot_private.coupang_exact_live_verify_runs(verifier_job_id uuid);

    create function sellerpilot_private.worker_token_has_scope(text,text,boolean default true)
    returns boolean language sql stable set search_path='' as $$select false$$;
    create function sellerpilot_private.coupang_exact_live_local_running_owned(text,uuid,uuid)
    returns boolean language sql stable set search_path='' as $$select false$$;
    create function sellerpilot_private.record_exact_qoo10_s1_observation(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.record_exact_qoo10_s1_activation_outcome(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.record_temu_activation_outcome(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.record_temu_containment_outcome(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.record_temu_containment_discovery(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.schedule_temu_safe_test_containment_discovery(uuid) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.temu_publication_exact_long(text) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.enqueue_temu_safe_test_containment(uuid) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.temu_exact_update_response_valid(uuid,jsonb) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.temu_remote_resources_from_job(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function sellerpilot_private.lazada_exact_update_response_valid(uuid,jsonb) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.lazada_exact_update_remote_resources(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function sellerpilot_private.coupang_exact_rep_response_valid(uuid,jsonb) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.coupang_exact_rep_remote_resources_from_job(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    create function sellerpilot_private.record_qoo10_shipping_s1_observation(uuid) returns boolean language sql as $$select true$$;
    create function sellerpilot_private.record_qoo10_shipping_s1_activation_outcome(uuid) returns boolean language sql as $$select true$$;
    create function public.sellerpilot_service_resolve_exact_coupang_live_verifier(uuid) returns boolean language sql as $$select true$$;
    create function public.sellerpilot_touch_channel_gateway_job(text,uuid,uuid,text default null)
    returns text language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs job set
        lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
      from sellerpilot_private.ai_cli_worker_tokens token
      where job.id=$2 and job.claim_token=$3 and job.status='running' and job.lease_expires_at>clock_timestamp()
        and token.id=job.worker_token_id and token.token_hash=$1 and token.status='active' and token.expires_at>clock_timestamp();
      return case when found then 'running' else 'ownership_lost' end;
    end $$;
    create function public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb default null,text default null)
    returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs job set status=$4,response_payload=$5,error_message=$6,
        worker_token_id=null,claim_token=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp()
      from sellerpilot_private.ai_cli_worker_tokens token where job.id=$2 and job.claim_token=$3
        and job.status='running' and job.lease_expires_at>clock_timestamp() and token.id=job.worker_token_id
        and token.token_hash=$1 and token.status='active' and token.expires_at>clock_timestamp();
      return found;
    end $$;
    create function public.sellerpilot_service_prepare_gateway_credential_refresh(text,uuid,uuid,jsonb,timestamptz default null,boolean default false,boolean default false)
    returns jsonb language sql security definer set search_path='' as $$select null::jsonb$$;
    create function public.sellerpilot_record_credential_test(uuid,text,text) returns boolean language sql as $$select true$$;
    create function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) returns integer language sql as $$select 0$$;
    create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
    returns integer language plpgsql security definer set search_path='' as $$
    declare received integer; inquiry jsonb; ticket_id uuid; inquiry_owner uuid;
    begin
      if jsonb_typeof($3)<>'array' then raise exception 'isolated inquiry array required'; end if;
      insert into sellerpilot_private.isolated_ingest_log(credential_id,channel,payload) values($1,$2,$3);
      select created_by into strict inquiry_owner from sellerpilot_private.channel_credentials where id=$1;
      for inquiry in select value from jsonb_array_elements($3) loop
        ticket_id:=md5(inquiry_owner::text||':'||$2||':'||(inquiry->>'externalTicketId'))::uuid;
        insert into sellerpilot_private.support_tickets(
          id,owner_id,channel_key,external_ticket_id,demo,ticket_kind,reply_context,provider_context
        ) values(
          ticket_id,inquiry_owner,$2,inquiry->>'externalTicketId',false,
          coalesce(nullif(inquiry->>'ticketKind',''),'general'),
          coalesce(inquiry->'replyContext','{}'::jsonb),coalesce(inquiry->'providerContext','{}'::jsonb)
        ) on conflict(id) do update set
          reply_context=excluded.reply_context,provider_context=excluded.provider_context;
        insert into sellerpilot_private.support_inbound_messages(
          ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
        ) values(
          ticket_id,inquiry_owner,$2,inquiry->>'inboundKey',inquiry->>'remoteMessageId',
          coalesce(inquiry->'providerContext','{}'::jsonb)
        );
      end loop;
      select jsonb_array_length($3) into received; return received;
    end $$;
    create function public.sellerpilot_service_mark_channel_sync(uuid,text,text,text,text)
    returns boolean language plpgsql security definer set search_path='' as $$
    begin insert into sellerpilot_private.isolated_sync_log(credential_id,channel,data_type,status,error_message)
      values($1,$2,$3,$4,$5); return true; end $$;
    create function public.sellerpilot_service_record_lazada_im_bootstrap_result(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
    create function public.sellerpilot_enqueue_channel_gateway_job(uuid,uuid,text,text,jsonb)
    returns uuid language plpgsql security definer set search_path='' as $$
    declare next_id uuid:=gen_random_uuid();
    begin
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,attempt_id,channel,operation,environment,request_payload,status,created_by
      ) select next_id,$1,$2,$3,$4,current.environment,$5,'queued',current.created_by
          from sellerpilot_private.channel_credentials current where current.id=$1;
      return next_id;
    end $$;

    insert into auth.users values('${owner}','isolated-owner@example.invalid');
    insert into sellerpilot_private.admin_users values('${owner}');
    insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','shopee','production',9,'active','${vaultId}');
    insert into sellerpilot_private.ai_cli_worker_tokens values('${worker}','${tokenHash}','serverless_cs','active',clock_timestamp()+interval '1 day',null,null);
    insert into vault.decrypted_secrets values('${vaultId}',$secret$${JSON.stringify({ shopee_targets: shops.map(({ id }) => ({
      type: "shop", id, access_token: `synthetic-access-${id}`, refresh_token: `synthetic-refresh-${id}`,
      access_token_expires_at: "2099-01-01T00:00:00.000Z", refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
    })) })}$secret$);
    insert into sellerpilot_private.channel_market_targets(owner_id,credential_id,channel,environment,target_id,market_code)
      values('${owner}','${credential}','shopee','production','${shops[0].id}','${shops[0].country}'),
            ('${owner}','${credential}','shopee','production','${shops[1].id}','${shops[1].country}');
  `);
  await installCanonicalCompletionChain(db);
  await db.exec(sources.ledger);
  await db.exec(sources.start);
  await db.exec(sources.completion);
  await db.exec(sources.invariants);
  await db.exec(sources.dateIntent);
  return db;
}

function kstDate(milliseconds = Date.now()) {
  return new Date(milliseconds + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

async function start(db, requestKey) {
  const date = kstDate(Date.now() - 86_400_000);
  return (await db.query(`select public.sellerpilot_service_start_cs_shopee_history_v2($1,$2,$3::date,$3::date) result`,
    [owner, requestKey, date])).rows[0].result;
}

async function claim(db, runId, shopId, claimToken, kind = "product_review") {
  const selected = (await db.query(`select id,request_payload from sellerpilot_private.channel_gateway_jobs
    where status='queued' and request_payload#>>'{arguments,sellerpilotShopeeHistoryRunId}'=$1
      and request_payload#>>'{arguments,kind}'=$3
      and request_payload#>>'{arguments,shopId}'=$2 order by created_at,id limit 1`, [runId, shopId, kind])).rows[0];
  assert.ok(selected);
  await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',claim_token=$1,
    worker_token_id=$2,lease_expires_at=clock_timestamp()+interval '1 minute',started_at=clock_timestamp()
    where id=$3`, [claimToken, worker, selected.id]);
  return {
    id: selected.id, claim_token: claimToken, credential_id: credential, channel: "shopee",
    operation: "inquiries.list", environment: "production", request: selected.request_payload,
    credential: {
      partner_id: "2031489", partner_key: "synthetic-partner-key", shop_id: shopId,
      access_token: "synthetic-access-token", refresh_token: "synthetic-refresh-token",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
      authorization_expires_at: "2099-03-01T00:00:00.000Z",
      provider_account_identity_version: "v1", provider_account_subject: `shopee:shop:${shopId}`,
      shopee_targets: [{ type: "shop", id: shopId, access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token", access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2099-02-01T00:00:00.000Z" }],
    },
    attempt_count: 1,
  };
}

async function executeReviewAdapter(input, pages) {
  const previousFetch = globalThis.fetch;
  let pageIndex = 0;
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    assert.equal(init?.method, "GET");
    assert.equal(url.pathname, "/api/v2/product/get_comment");
    const page = pages[pageIndex++];
    assert.ok(page, `unexpected review adapter request ${url}`);
    assert.equal(url.searchParams.get("cursor") ?? "", page.cursor);
    assert.equal(url.searchParams.get("page_size"), "100");
    return Response.json({
      error: "",
      message: "",
      request_id: `synthetic-raw-envelope-${page.commentId}`,
      response: {
        item_comment_list: [{
          comment_id: page.commentId,
          item_id: 902,
          buyer_username: "synthetic-buyer",
          comment: `synthetic review ${page.commentId}`,
          create_time: 1_788_000_000 + pageIndex,
        }],
        more: page.more,
        next_cursor: page.nextCursor,
      },
    });
  };
  try {
    const result = await executeServerlessCsProviderJob(input);
    assert.equal(pageIndex, pages.length);
    assert.deepEqual(result.steps.map((providerStep) => providerStep.data.request_id),
      pages.map((page) => `synthetic-raw-envelope-${page.commentId}`));
    return result;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function executeReturnAdapter(input, returnSn) {
  const previousFetch = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    assert.equal(init?.method, "GET");
    observed.push(url.pathname);
    if (url.pathname === "/api/v2/returns/get_return_list") {
      assert.equal(url.searchParams.get("page_no"), "1");
      assert.equal(url.searchParams.get("page_size"), "100");
      return Response.json({ error: "", message: "", request_id: "synthetic-return-list-envelope",
        response: { return: [{ return_sn: returnSn }], more: false } });
    }
    assert.equal(url.pathname, "/api/v2/returns/get_return_detail");
    assert.equal(url.searchParams.get("return_sn"), returnSn);
    return Response.json({ error: "", message: "", request_id: "synthetic-return-detail-envelope",
      response: {
        return_sn: returnSn,
        order_sn: "SYNTHETIC-ORDER-1",
        reason: "ITEM_DAMAGED",
        text_reason: "synthetic damaged item",
        image: ["https://example.invalid/return-proof.jpg"],
        buyer_videos: [],
        status: "REQUESTED",
        create_time: 1_788_000_100,
        update_time: 1_788_000_101,
        user: { username: "synthetic-return-buyer" },
      } });
  };
  try {
    const result = await executeServerlessCsProviderJob(input);
    assert.deepEqual(observed, [
      "/api/v2/returns/get_return_list",
      "/api/v2/returns/get_return_detail",
    ]);
    assert.deepEqual(result.steps.map((providerStep) => providerStep.data.request_id), [
      "synthetic-return-list-envelope",
      "synthetic-return-detail-envelope",
    ]);
    return result;
  } finally {
    globalThis.fetch = previousFetch;
  }
}

function workerRpc(db, job) {
  let claimed = false;
  const jsonArgument = (value) => value == null ? null : JSON.stringify(value);
  return async (name, arguments_ = {}) => {
    try {
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        if (claimed) return { data: null, error: null };
        claimed = true; return { data: job, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
        return { data: { contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0 }, error: null };
      }
      if (name === "sellerpilot_service_reserve_provider_request_rate_budget_v1") {
        return { data: { contract: "sellerpilot-provider-request-rate-budget/1", status: "reserved",
          retryAfterMs: 0 }, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") {
        const result = (await db.query(`select public.sellerpilot_touch_serverless_cs_job($1,$2,$3,$4) result`,
          [arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token, arguments_.p_worker_version])).rows[0].result;
        return { data: result, error: null };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        const result = (await db.query(`select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result`,
          [arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token])).rows[0].result;
        return { data: result, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_shopee_history_v1") {
        const result = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_shopee_history_v1(
          $1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb
        ) result`, [arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token,
          arguments_.p_status, jsonArgument(arguments_.p_response_payload), arguments_.p_error_message,
          jsonArgument(arguments_.p_credential_refresh), jsonArgument(arguments_.p_normalized_orders),
          jsonArgument(arguments_.p_normalized_inquiries), jsonArgument(arguments_.p_diagnostic),
          arguments_.p_history_run_id, jsonArgument(arguments_.p_history_event)])).rows[0].result;
        return { data: result, error: null };
      }
      if (name === "sellerpilot_service_record_cs_history_page_v1") {
        return { data: { contract: "cs_history_coverage_v1", status: "completed", jobId: job.id }, error: null };
      }
      return { data: null, error: { code: `UNEXPECTED_RPC_${name}` } };
    } catch (error) {
      return { data: null, error: { code: String(error?.message ?? error).slice(0, 120) } };
    }
  };
}

async function runWorker(db, job, executeProvider) {
  return runOneServerlessCsGatewayJob({ rpc: workerRpc(db, job), executeProvider,
    heartbeatIntervalMs: 60_000, logError: () => {} }, tokenHash);
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function ownerApi(db) {
  let serial = Promise.resolve();
  const serialized = (callback) => {
    const next = serial.then(callback); serial = next.catch(() => undefined); return next;
  };
  const authenticated = (callback) => serialized(async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    try { return await callback(); } finally { await db.exec("reset role"); }
  });
  const server = http.createServer(async (request, response) => {
    const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/u, "");
    if (request.headers.apikey !== publishableKey || token !== accessToken) {
      json(response, 401, { code: "invalid_jwt", message: "invalid isolated token" }); return;
    }
    try {
      if (request.method === "GET" && request.url === "/auth/v1/user") {
        json(response, 200, { id: owner, email: "isolated-owner@example.invalid", aud: "authenticated",
          role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-08T00:00:00.000Z" }); return;
      }
      if (request.method === "POST" && request.url === "/rest/v1/rpc/sellerpilot_is_admin") {
        json(response, 200, await authenticated(async () => (await db.query("select public.sellerpilot_is_admin() result")).rows[0].result)); return;
      }
      if (request.method === "POST" && request.url === "/rest/v1/rpc/sellerpilot_read_cs_shopee_history_events_v1") {
        json(response, 200, await authenticated(async () => (await db.query(
          "select public.sellerpilot_read_cs_shopee_history_events_v1() result")).rows[0].result)); return;
      }
      json(response, 404, { message: "isolated route not found" });
    } catch (error) { json(response, 500, { message: String(error?.message ?? error) }); }
  });
  await new Promise((resolve_, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve_); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function restore(name, value) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

test("canonical common completion chain feeds owner GET with per-country partial, authorization and resume truth", async () => {
  const db = await fixture();
  const api = await ownerApi(db);
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishable: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: process.env.SUPABASE_SECRET_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = api.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_SECRET_KEY = serviceKey;
  try {
    const started = await start(db, uuid(13101));
    assert.deepEqual({ shops: started.shopCount, reviews: started.reviewScopeCount,
      returns: started.returnScopeCount, jobs: started.queuedJobCount },
    { shops: 2, reviews: 2, returns: 2, jobs: 4 });
    const runId = started.historyRunId;
    assert.equal((await db.query(`select count(*)::int n from unnest(array[
      to_regprocedure('public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_133000_complete_gateway_before_temu_publication(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_173960_complete_before_temu_exact(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_173980_complete_before_lazada_exact(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sp_173990_complete_pre(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_090500_complete_before_qoo10_shipping_s1(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_complete_before_coupang_exact_live(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),
      to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)')
    ]) function_id where function_id is not null`)).rows[0].n, 8);
    const sg = await claim(db, runId, shops[0].id, uuid(13201));
    assert.equal((await db.query(`select sellerpilot_private.worker_token_may_complete_gateway_job($1,$2,$3) ok`,
      [tokenHash, sg.id, sg.claim_token])).rows[0].ok, true);
    assert.match((await db.query(`select pg_get_functiondef(
      'public.sellerpilot_056700_complete_gateway_before_qoo10_s1_activation(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure
    ) definition`)).rows[0].definition, /worker_token_may_complete_gateway_job/u);
    assert.equal((await db.query(`select public.sellerpilot_touch_serverless_cs_job($1,$2,$3,'canonical-chain-test') result`,
      [tokenHash, sg.id, sg.claim_token])).rows[0].result, "running");
    const context = (await db.query(`select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result`,
      [tokenHash, sg.id, sg.claim_token])).rows[0].result;
    assert.equal(context.status, "running");
    assert.equal(context.channel, "shopee");
    const sgFirst = await runWorker(db, sg, input => executeReviewAdapter(input, [
      { cursor: "", commentId: 7301, more: true, nextCursor: "cursor-1" },
      { cursor: "cursor-1", commentId: 7302, more: true, nextCursor: "cursor-2" },
      { cursor: "cursor-2", commentId: 7303, more: true, nextCursor: "cursor-3" },
      { cursor: "cursor-3", commentId: 7304, more: true, nextCursor: "cursor-4" },
    ]));
    assert.equal(sgFirst.status, 200, await sgFirst.text());
    const sgFirstStored = (await db.query(`select status,error_message,response_payload from
      sellerpilot_private.channel_gateway_jobs where id=$1`, [sg.id])).rows[0];
    assert.equal(sgFirstStored.status, "succeeded", JSON.stringify(sgFirstStored));

    const tw = await claim(db, runId, shops[1].id, uuid(13202));
    const twDenied = await runWorker(db, tw, input => executeServerlessCsProviderJob(input, async () => ({
      ok: false, channel: "shopee", operation: "inquiries.list",
      steps: [{ name: "inquiries", ok: false, status: 403,
        data: { sellerpilotProviderContext: { shopId: shops[1].id } } }],
      safeMessage: "synthetic authorization denial",
    })));
    assert.equal(twDenied.status, 200, await twDenied.text());
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.isolated_ingest_log")).rows[0].n, 1);

    const { GET } = await import(pathToFileURL(resolve(sourceRoot,
      "app/api/admin/cs/channels/shopee/history-progress/route.ts")).href);
    const getProgress = async () => {
      const response = await GET(new Request("http://sellerpilot.invalid/api/admin/cs/channels/shopee/history-progress", {
        headers: { authorization: `Bearer ${accessToken}` },
      }));
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
    };
    const partial = await getProgress();
    assert.equal(partial.transport.contract, "sellerpilot-shopee-transport-acceptance/1");
    assert.deepEqual(partial.transport.supported.map((surface) => surface.key),
      ["product_review", "return_refund"]);
    assert.deepEqual(partial.transport.buyerChat.map((surface) => [surface.key, surface.operational,
      surface.providerPath]), [
      ["buyer_chat_push", false, null],
      ["buyer_chat_history", false, null],
      ["buyer_chat_reply", false, null],
    ]);
    const transportHtml = renderToStaticMarkup(createElement(ShopeeTransportAcceptanceStatus, {
      transport: partial.transport,
    }));
    assert.match(transportHtml, /상품 후기·댓글/u);
    assert.match(transportHtml, /\/api\/v2\/product\/get_comment/u);
    assert.match(transportHtml, /\/api\/v2\/returns\/get_return_list/u);
    assert.match(transportHtml, /Buyer Chat push 수신/u);
    assert.match(transportHtml, /endpoint를 추측하지 않습니다/u);
    assert.doesNotMatch(transportHtml, /Buyer Chat[^<]{0,80}운영 가능/u);
    const partialSg = partial.progress.shopKinds.find((item) => item.country === "SG" && item.kind === "product_review");
    const deniedTw = partial.progress.shopKinds.find((item) => item.country === "TW" && item.kind === "product_review");
    assert.equal(partialSg.status, "partial");
    assert.equal(partialSg.activeCheckpointDigests.length, 1);
    assert.equal(deniedTw.status, "authorization_required");
    assert.equal(deniedTw.authorizationRequiredScopeCount, 1);
    assert.equal(partial.progress.shopKinds.some((item) => item.kind === "buyer_chat"), false);

    const sgResume = await claim(db, runId, shops[0].id, uuid(13203));
    assert.equal(sgResume.request.arguments.sellerpilotShopeeHistorySequence, 2);
    assert.equal(sgResume.request.arguments.cursor, "cursor-4");
    const sgFinal = await runWorker(db, sgResume, input => executeReviewAdapter(input, [
      { cursor: "cursor-4", commentId: 7305, more: false, nextCursor: "" },
    ]));
    assert.equal(sgFinal.status, 200, await sgFinal.text());
    const resumed = await getProgress();
    const completeSg = resumed.progress.shopKinds.find((item) => item.country === "SG" && item.kind === "product_review");
    const stillDeniedTw = resumed.progress.shopKinds.find((item) => item.country === "TW" && item.kind === "product_review");
    assert.equal(completeSg.status, "complete");
    assert.equal(completeSg.completedScopeCount, 1);
    assert.equal(completeSg.activeCheckpointDigests.length, 0);
    assert.equal(stillDeniedTw.status, "authorization_required");
    assert.equal(resumed.progress.shopKinds.filter((item) => item.kind === "return_refund")
      .every((item) => item.status === "pending"), true);
    assert.equal(resumed.progress.shopKinds.some((item) => item.kind === "buyer_chat"), false);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.support_tickets where channel_key='shopee'")).rows[0].n, 5);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.support_inbound_messages where channel_key='shopee'")).rows[0].n, 5);
    const storedCompletion = (await db.query(`select response_payload#>>'{steps,0,data,sellerpilotMarker}' marker,
      response_payload::text like '%synthetic-raw-envelope-%' leaked_raw
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [sg.id])).rows[0];
    assert.equal(storedCompletion.marker, "normalized_inquiries_v1");
    assert.equal(storedCompletion.leaked_raw, false);

    const sgReturn = await claim(db, runId, shops[0].id, uuid(13204), "return_refund");
    const returnResult = await runWorker(db, sgReturn,
      input => executeReturnAdapter(input, "RETURN-7306"));
    assert.equal(returnResult.status, 200, await returnResult.text());
    const afterReturn = await getProgress();
    const completeReturn = afterReturn.progress.shopKinds.find((item) =>
      item.country === "SG" && item.kind === "return_refund");
    assert.equal(completeReturn.status, "complete");
    assert.equal(completeReturn.remoteUniqueCount, 1);
    assert.equal(completeReturn.normalizedUniqueCount, 1);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.gateway_completion_receipts")).rows[0].n, 4);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.cs_shopee_history_events")).rows[0].n, 4);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.support_tickets where channel_key='shopee'")).rows[0].n, 6);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.support_inbound_messages where channel_key='shopee'")).rows[0].n, 6);
    const returnTicket = (await db.query(`select external_ticket_id,ticket_kind,provider_context
      from sellerpilot_private.support_tickets where external_ticket_id like 'shopee:return:%'`)).rows[0];
    assert.equal(returnTicket.external_ticket_id, `shopee:return:${shops[0].id}:RETURN-7306`);
    assert.equal(returnTicket.ticket_kind, "after_sales");
    assert.equal(returnTicket.provider_context.replySupported, false);
  } finally {
    restore("NEXT_PUBLIC_SUPABASE_URL", previous.url);
    restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.publishable);
    restore("SUPABASE_SECRET_KEY", previous.secret);
    await new Promise((resolve_) => api.server.close(resolve_));
    await db.close();
  }
});
