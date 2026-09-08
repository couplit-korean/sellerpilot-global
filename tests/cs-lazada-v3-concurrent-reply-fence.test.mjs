import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const proposalSql = await readFile(new URL(
  '../docs/cs-parallel/proposals/lazada/lazada-010-concurrent-revision-reply-fence.sql',
  import.meta.url,
), 'utf8');
const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
const v3Sql = await readFile(integratedRoot
  ? new URL(`file://${integratedRoot}/supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql`)
  : new URL('../docs/cs-parallel/proposals/lazada/lazada-005-ingest-v3.sql', import.meta.url), 'utf8');
const source = (relative) => new URL(integratedRoot
  ? `file://${integratedRoot}/${relative}`
  : `../${relative}`, import.meta.url);
const [operationsSource, serverlessProviderSource, serverlessGatewaySource,
  localBeginRouteSource, localWorkerSource, deliveryLedgerSource] = await Promise.all([
  'lib/channels/operations.ts',
  'lib/channels/serverless-gateway-provider.ts',
  'lib/channels/serverless-gateway.ts',
  'app/api/channel-gateway/worker/begin-mutation/route.ts',
  'scripts/ai-cli-worker.mjs',
  'supabase/migrations/20260831033000_add_cs_message_delivery_ledger.sql',
].map((relative) => readFile(source(relative), 'utf8')));

const owner = '00000000-0000-4000-8000-000000001001';
const otherOwner = '00000000-0000-4000-8000-000000001002';
const credential = '00000000-0000-4000-8000-000000001003';
const localToken = '00000000-0000-4000-8000-000000001004';
const serverlessToken = '00000000-0000-4000-8000-000000001005';
const seller = 'a'.repeat(64);
const native = 'b'.repeat(64);
const localHash = 'c'.repeat(64);
const serverlessHash = 'd'.repeat(64);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,
      seller_account_key text,seller_account_key_source text,
      seller_account_verified_at timestamptz,status text not null default 'active',
      expires_at timestamptz
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null,
      channel_key text not null,source_credential_id uuid,seller_account_key text,
      external_ticket_id text not null,latest_inbound_key text,demo boolean not null default false,
      status text not null default 'waiting',reply_draft text,
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null,owner_id uuid not null,
      channel_key text not null,inbound_key text not null,remote_message_id text,
      provider_context jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default clock_timestamp(),body text not null default 'synthetic'
    );
    create table sellerpilot_private.lazada_im_message_revisions(
      id uuid primary key default gen_random_uuid(),owner_id uuid not null,credential_id uuid not null,
      seller_account_key text not null,external_ticket_id text not null,remote_message_id text not null,
      revision_kind text not null,native_content_fingerprint text not null,
      provider_context jsonb not null default '{}'::jsonb,
      first_observed_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(),credential_id uuid,channel text not null,
      operation text not null,status text not null,seller_account_key text,
      request_payload jsonb not null default '{}'::jsonb,
      provider_mutation_started_at timestamptz,error_message text,completed_at timestamptz,
      lease_expires_at timestamptz,worker_token_id uuid,claim_token uuid,
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key,kind text not null,ticket_id uuid
    );
  `);
  await db.exec(`
    create function sellerpilot_private.lazada_im_projection_state_v1(
      p_owner_id uuid,p_credential_id uuid,p_seller_account_key text,
      p_external_ticket_id text,p_remote_message_id text,
      p_native_content_fingerprint text,p_as_of timestamptz
    ) returns text language sql stable security definer set search_path='' as $$
      select case when exists(select 1 from sellerpilot_private.lazada_im_message_revisions r
        where r.owner_id=p_owner_id and r.credential_id=p_credential_id
          and r.seller_account_key=p_seller_account_key
          and r.external_ticket_id=p_external_ticket_id
          and r.remote_message_id=p_remote_message_id and r.revision_kind='recalled'
          and r.native_content_fingerprint=p_native_content_fingerprint
          and r.provider_context->>'eventKind'='recalled'
          and r.provider_context->>'recallTargetMessageId'=p_remote_message_id
          and r.first_observed_at<=p_as_of) then 'recalled'
        when exists(select 1 from sellerpilot_private.lazada_im_message_revisions r
        where r.owner_id=p_owner_id and r.credential_id=p_credential_id
          and r.seller_account_key=p_seller_account_key
          and r.external_ticket_id=p_external_ticket_id
          and r.remote_message_id=p_remote_message_id and r.revision_kind='conflict'
          and r.first_observed_at<=p_as_of) then 'conflict_review_required'
        else 'normal' end
    $$;
    create function sellerpilot_private.lazada_im_ticket_projection_state_v1(
      p_ticket_id uuid,p_as_of timestamptz
    ) returns text language sql stable security definer set search_path='' as $$
      select coalesce((select sellerpilot_private.lazada_im_projection_state_v1(
        m.owner_id,t.source_credential_id,t.seller_account_key,t.external_ticket_id,
        m.remote_message_id,m.provider_context->>'nativeContentFingerprint',p_as_of)
        from sellerpilot_private.support_tickets t
        join sellerpilot_private.support_inbound_messages m
          on m.ticket_id=t.id and m.inbound_key=t.latest_inbound_key
        where t.id=p_ticket_id limit 1),'normal')
    $$;
    create function sellerpilot_private.serverless_cs_job_is_owned(
      p_token_hash text,p_job_id uuid,p_claim_token uuid,p_live boolean default true
    ) returns boolean language sql stable set search_path='' as $$
      select exists(select 1 from sellerpilot_private.channel_gateway_jobs j
        join sellerpilot_private.ai_cli_worker_tokens t on t.id=j.worker_token_id
        where j.id=p_job_id and j.claim_token=p_claim_token and j.status='running'
          and (not p_live or j.lease_expires_at>clock_timestamp())
          and t.token_hash=p_token_hash and t.scope='serverless_cs'
          and t.status='active' and t.expires_at>clock_timestamp())
    $$;
    create function public.sellerpilot_service_ingest_lazada_inquiries_v3(
      p_credential_id uuid,p_rows jsonb
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare c record; r jsonb;
    begin
      select created_by,seller_account_key into c
        from sellerpilot_private.channel_credentials where id=p_credential_id for update;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'lazada-im-v3:'||c.created_by::text||':'||c.seller_account_key,0));
      for r in select value from jsonb_array_elements(p_rows) loop
        insert into sellerpilot_private.lazada_im_message_revisions(
          owner_id,credential_id,seller_account_key,external_ticket_id,remote_message_id,
          revision_kind,native_content_fingerprint,provider_context
        ) values(c.created_by,p_credential_id,c.seller_account_key,r->>'externalTicketId',
          r->>'remoteMessageId',r->>'revisionKind',r->>'nativeContentFingerprint',r->'providerContext');
      end loop;
      return jsonb_build_object('status','complete');
    end $$;
    create function public.sellerpilot_update_ticket(uuid,text,text,text)
      returns boolean language plpgsql security definer set search_path='' as $$
      begin update sellerpilot_private.support_tickets set status=$2,reply_draft=$3 where id=$1; return found; end $$;
    create function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
      returns uuid language plpgsql security definer set search_path='' as $$
      begin insert into sellerpilot_private.ai_cli_jobs values($1,'support_reply',$2); return $1; end $$;
    create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
      returns uuid language plpgsql security definer set search_path='' as $$
      declare j uuid:=gen_random_uuid(); t record;
      begin
        select * into t from sellerpilot_private.support_tickets where id=$1 for update;
        insert into sellerpilot_private.channel_gateway_jobs(
          id,credential_id,channel,operation,status,seller_account_key,request_payload
        ) values(j,t.source_credential_id,$2,'inquiries.reply','queued',t.seller_account_key,
          coalesce($4,'{}'::jsonb)||jsonb_build_object(
            'sellerpilotTicketId',t.id,'sellerpilotInboundKey',t.latest_inbound_key));
        return j;
      end $$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql security definer set search_path='' as $$
      begin update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
        where id=$2 and claim_token=$3 and status='running'; return found; end $$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql security definer set search_path='' as $$
      begin update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
        where id=$2 and claim_token=$3 and status='running'; return found; end $$;
    revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
      from public,anon,authenticated; grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb) to service_role;
    grant execute on function public.sellerpilot_update_ticket(uuid,text,text,text) to authenticated;
    grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text) to authenticated;
    grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) to service_role;
    grant execute on function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid) to service_role;
    grant execute on function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) to service_role;
  `);
  await db.exec(proposalSql);
  await db.query(`insert into auth.users values($1),($2)`, [owner, otherOwner]);
  await db.query(`insert into sellerpilot_private.admin_users values($1)`, [owner]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values($1,$2,'lazada',$3,'provider_certified_v1',clock_timestamp())`, [credential, owner, seller]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens values
    ($1,$2,'gateway','active',clock_timestamp()+interval '1 day'),
    ($3,$4,'serverless_cs','active',clock_timestamp()+interval '1 day')`,
  [localToken, localHash, serverlessToken, serverlessHash]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
  return db;
}

async function addTicket(db, suffix) {
  const ticket = (await db.query(`insert into sellerpilot_private.support_tickets(
    owner_id,channel_key,source_credential_id,seller_account_key,external_ticket_id,latest_inbound_key
  ) values($1,'lazada',$2,$3,$4,$5) returning id`,
  [owner, credential, seller, `lazada-im:${suffix}`, `inbound-${suffix}`])).rows[0].id;
  await db.query(`insert into sellerpilot_private.support_inbound_messages(
    ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
  ) values($1,$2,'lazada',$3,$4,jsonb_build_object('nativeContentFingerprint',$5::text))`,
  [ticket, owner, `inbound-${suffix}`, `remote-${suffix}`, native]);
  return ticket;
}

function revision(suffix, kind) {
  return [{
    externalTicketId: `lazada-im:${suffix}`,
    remoteMessageId: `remote-${suffix}`,
    revisionKind: kind,
    nativeContentFingerprint: native,
    providerContext: kind === 'recalled'
      ? { eventKind: 'recalled', recallTargetMessageId: `remote-${suffix}` }
      : { eventKind: 'message', projectionConflict: true },
  }];
}

async function ingest(db, rows) {
  await db.exec('set role service_role');
  try {
    return await db.query(`select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb)`,
      [credential, JSON.stringify(rows)]);
  } finally {
    await db.exec('reset role');
  }
}

async function enqueue(db, ticket) {
  await db.exec('set role service_role');
  try {
    return (await db.query(`select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      $1,'lazada','synthetic approved reply','{}'::jsonb) id`, [ticket])).rows[0].id;
  } finally {
    await db.exec('reset role');
  }
}

test('010 proposal uses the canonical V3 seller lock and removes the mutation-time cutoff', () => {
  const credentialLock = v3Sql.indexOf('for update;', v3Sql.indexOf('sellerpilot_service_ingest_lazada_inquiries_v3'));
  const sellerLock = v3Sql.indexOf("'lazada-im-v3:'", credentialLock);
  const batchLoop = v3Sql.indexOf('for v_row in select value from jsonb_array_elements', sellerLock);
  assert.ok(credentialLock > 0 && sellerLock > credentialLock && batchLoop > sellerLock);
  assert.match(v3Sql, /v_result:=public\.sellerpilot_service_ingest_lazada_inquiries_v3\(/);
  assert.match(proposalSql, /'infinity'::timestamptz/);
  assert.doesNotMatch(proposalSql, /lazada_im_lock_current_ticket_action_v1[\s\S]*?statement_timestamp\(\)/);
  assert.match(proposalSql, /after insert on sellerpilot_private\.lazada_im_message_revisions/);
  assert.match(proposalSql, /sellerpilot_service_begin_gateway_provider_mutation/);
  assert.match(proposalSql, /sellerpilot_service_begin_serverless_gateway_provider_mutation/);
});

test('both real worker call paths cross the provider boundary and reconciliation cannot be re-enqueued', () => {
  const writeSet = operationsSource.slice(
    operationsSource.indexOf('export const writeChannelOperations'),
    operationsSource.indexOf(']);', operationsSource.indexOf('export const writeChannelOperations')) + 3,
  );
  assert.match(writeSet, /"inquiries\.reply"/);
  assert.match(serverlessProviderSource,
    /writeChannelOperations\.has\(input\.job\.operation\)[\s\S]{0,500}await input\.hooks\.beginProviderMutation\(\)/);
  assert.match(serverlessGatewaySource,
    /BEGIN_PROVIDER_MUTATION_RPC = "sellerpilot_service_begin_serverless_gateway_provider_mutation"/);
  assert.match(localBeginRouteSource,
    /"sellerpilot_service_begin_gateway_provider_mutation"/);
  assert.match(localWorkerSource,
    /writeChannelOperations\.has\(job\.operation\)[\s\S]{0,250}await markExternalWriteStarted\(\)/);
  assert.match(deliveryLedgerSource,
    /channel_gateway_jobs_one_terminal_or_active_reply_generation_idx[\s\S]{0,700}reconciliation_required/);
});

test('recall inserted after statement start is rejected before enqueue in the same request', async () => {
  const db = await fixture();
  try {
    const ticket = await addTicket(db, 'cutoff');
    await db.exec(`create function pg_temp.observe_then_enqueue(p_credential uuid,p_rows jsonb,p_ticket uuid)
      returns uuid language plpgsql as $$
      begin
        perform pg_sleep(0.01);
        perform public.sellerpilot_service_ingest_lazada_inquiries_v3(p_credential,p_rows);
        return public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          p_ticket,'lazada','synthetic approved reply','{}'::jsonb);
      end $$`);
    await db.exec('set role service_role');
    await assert.rejects(
      db.query(`select pg_temp.observe_then_enqueue($1,$2::jsonb,$3)`,
        [credential, JSON.stringify(revision('cutoff', 'recalled')), ticket]),
      /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/,
    );
    await db.exec('reset role');
    const count = await db.query(`select count(*)::integer count from sellerpilot_private.channel_gateway_jobs`);
    assert.equal(count.rows[0].count, 0);
  } finally { await db.close(); }
});

test('current recall/conflict block drafts, resolution, and enqueue while normal remains usable', async () => {
  const db = await fixture();
  try {
    const recalled = await addTicket(db, 'recalled');
    const conflict = await addTicket(db, 'conflict');
    const normal = await addTicket(db, 'normal');
    await ingest(db, revision('recalled', 'recalled'));
    await ingest(db, revision('conflict', 'conflict'));
    for (const ticket of [recalled, conflict]) {
      await assert.rejects(db.query(`select public.sellerpilot_update_ticket($1,'resolved','draft',$2)`,
        [ticket, ticket === recalled ? 'inbound-recalled' : 'inbound-conflict']), /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
      await assert.rejects(db.query(`select public.sellerpilot_create_support_reply_job(
        gen_random_uuid(),$1,$2,'ko','polite')`,
        [ticket, ticket === recalled ? 'inbound-recalled' : 'inbound-conflict']), /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
      await assert.rejects(enqueue(db, ticket), /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    }
    const ai = (await db.query(`select public.sellerpilot_create_support_reply_job(
      gen_random_uuid(),$1,'inbound-normal','ko','polite') id`, [normal])).rows[0].id;
    assert.ok(ai);
    assert.ok(await enqueue(db, normal));
  } finally { await db.close(); }
});

test('post-enqueue revisions cancel queued/running work and both provider boundaries fail closed', async () => {
  const db = await fixture();
  try {
    const queuedTicket = await addTicket(db, 'queued');
    const queuedJob = await enqueue(db, queuedTicket);
    await ingest(db, revision('queued', 'recalled'));
    const queued = (await db.query(`select status,provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1`, [queuedJob])).rows[0];
    assert.equal(queued.status, 'failed');
    assert.equal(queued.provider_mutation_started_at, null);

    for (const [suffix, tokenId, tokenHash, beginRpc] of [
      ['local', localToken, localHash, 'sellerpilot_service_begin_gateway_provider_mutation'],
      ['serverless', serverlessToken, serverlessHash, 'sellerpilot_service_begin_serverless_gateway_provider_mutation'],
    ]) {
      const ticket = await addTicket(db, suffix);
      const job = await enqueue(db, ticket);
      const claim = crypto.randomUUID();
      await db.query(`update sellerpilot_private.channel_gateway_jobs set status='running',
        worker_token_id=$2,claim_token=$3,lease_expires_at=clock_timestamp()+interval '1 hour'
        where id=$1`, [job, tokenId, claim]);
      await db.exec(`alter table sellerpilot_private.lazada_im_message_revisions disable trigger fence_lazada_reply_jobs_on_revision_v1`);
      await ingest(db, revision(suffix, 'conflict'));
      await db.exec(`alter table sellerpilot_private.lazada_im_message_revisions enable trigger fence_lazada_reply_jobs_on_revision_v1`);
      await db.exec('set role service_role');
      const begun = await db.query(`select public.${beginRpc}($1,$2,$3) begun`, [tokenHash, job, claim]);
      await db.exec('reset role');
      assert.equal(begun.rows[0].begun, false);
      const state = (await db.query(`select status,provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1`, [job])).rows[0];
      assert.equal(state.status, 'failed');
      assert.equal(state.provider_mutation_started_at, null);
    }

    const uncertainTicket = await addTicket(db, 'uncertain');
    const uncertainJob = await enqueue(db, uncertainTicket);
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='running',provider_mutation_started_at=clock_timestamp() where id=$1`, [uncertainJob]);
    await ingest(db, revision('uncertain', 'recalled'));
    const uncertain = (await db.query(`select status from sellerpilot_private.channel_gateway_jobs where id=$1`, [uncertainJob])).rows[0];
    assert.equal(uncertain.status, 'reconciliation_required');
  } finally { await db.close(); }
});

test('private and unsafe functions remain unreachable to API roles', async () => {
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const acl = (await db.query(`select
        has_function_privilege($1,'sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)','EXECUTE') ticket_lock,
        has_function_privilege($1,'sellerpilot_private.lazada_im_lock_reply_job_action_v1(uuid)','EXECUTE') job_lock,
        has_function_privilege($1,'public.sellerpilot_09100000_enqueue_reply_unsafe(uuid,text,text,jsonb)','EXECUTE') unsafe_enqueue`,
      [role])).rows[0];
      assert.equal(acl.ticket_lock, false);
      assert.equal(acl.job_lock, false);
      assert.equal(acl.unsafe_enqueue, false);
    }
  } finally { await db.close(); }
});
