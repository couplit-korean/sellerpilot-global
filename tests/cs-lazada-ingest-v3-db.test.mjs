import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const proposal = await readFile(new URL(
  '../supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql',
  import.meta.url,
), 'utf8');
const owner = '00000000-0000-4000-8000-000000000501';
const credential = '00000000-0000-4000-8000-000000000502';
const otherCredential = '00000000-0000-4000-8000-000000000503';
const account = 'a'.repeat(64);
const otherAccount = 'b'.repeat(64);
const app = 'c'.repeat(64);
const token = 'd'.repeat(64);
const target = 'e'.repeat(64);

function fingerprint(nativeText, nativeMedia = null) {
  return createHash('sha256').update(JSON.stringify({ nativeText, nativeMedia })).digest('hex');
}

function buyer(remoteMessageId, message, receivedAt, nativeMedia = null) {
  return {
    externalTicketId: 'lazada-im:session-1',
    customerName: 'Synthetic buyer',
    subject: 'Synthetic inquiry',
    message,
    status: 'waiting',
    priority: 3,
    receivedAt,
    remoteMessageId,
    providerContext: {
      nativeContentFingerprint: fingerprint(message, nativeMedia),
      ...(nativeMedia ? { eventKind: 'image', nativeText: message, nativeMedia } : {}),
    },
  };
}

function seller(remoteMessageId, message, receivedAt) {
  return {
    ...buyer(remoteMessageId, message, receivedAt),
    customerName: 'Synthetic seller',
    status: 'resolved',
    senderRole: 'seller',
  };
}

function system(remoteMessageId, message, receivedAt) {
  return {
    ...buyer(remoteMessageId, message, receivedAt),
    customerName: 'Lazada 시스템',
    status: 'resolved',
    senderRole: 'system',
    providerContext: {
      nativeContentFingerprint: fingerprint(message),
      eventKind: 'system',
      roleBasis: 'official_session_tag',
    },
  };
}

function recalled(row) {
  return {
    ...row,
    message: `Lazada 발신자 회수 · ${row.message}`,
    status: 'waiting',
    providerContext: {
      ...row.providerContext,
      eventKind: 'recalled',
      recallTargetMessageId: row.remoteMessageId,
    },
  };
}

async function fixture({ binding = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema extensions;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.channels(key text primary key);
    insert into sellerpilot_private.channels values('lazada');
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid not null references auth.users(id),
      channel text not null,
      status text not null,
      expires_at timestamptz,
      seller_account_key text,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key default gen_random_uuid(),
      credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,
      operation text not null,
      country text not null,
      app_fingerprint text not null,
      token_fingerprint text not null,
      target_fingerprint text not null,
      status text not null,
      expires_at timestamptz
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null references auth.users(id),
      external_ticket_id text not null,
      channel_key text not null references sellerpilot_private.channels(key),
      customer_name text not null,
      subject text not null,
      message text not null,
      status text not null default 'waiting',
      priority integer not null default 3,
      received_at timestamptz not null,
      resolved_at timestamptz,
      demo boolean not null default false,
      updated_at timestamptz not null default now(),
      source_credential_id uuid references sellerpilot_private.channel_credentials(id),
      seller_account_key text,
      provider_status text not null default 'unknown',
      provider_status_updated_at timestamptz,
      latest_inbound_key text,
      provider_context jsonb not null default '{}'::jsonb,
      channel_account_id uuid references sellerpilot_private.channel_credentials(id),
      ticket_kind text not null default 'conversation',
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),
      ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id),
      channel_key text not null references sellerpilot_private.channels(key),
      inbound_key text not null,
      remote_message_id text,
      sender_role text not null,
      body text not null,
      provider_context jsonb not null default '{}'::jsonb,
      received_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.lazada_unordered_messages(
      owner_id uuid not null,
      seller_account_key text not null,
      external_ticket_id text not null,
      remote_message_id text not null,
      body text not null,
      sender_role text not null,
      native_content_fingerprint text not null,
      unique(owner_id,seller_account_key,external_ticket_id,remote_message_id,native_content_fingerprint)
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      claim_token uuid not null,
      response_payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
      claim_token uuid not null,
      worker_token_hash text not null
    );
    create function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$select case
      when $1='fixture-token' and job.claim_token=$3 and job.status='running'
        then jsonb_build_object('channel',job.channel,'operation',job.operation,
          'status','running','credential_id',job.credential_id)
      when exists(
        select 1 from sellerpilot_private.gateway_completion_receipts receipt
         where receipt.job_id=job.id and receipt.claim_token=$3
           and receipt.worker_token_hash=$1
      ) then jsonb_build_object('channel',job.channel,'operation',job.operation,
        'status','completed_replay','credential_id',job.credential_id)
      end
      from sellerpilot_private.channel_gateway_jobs job where job.id=$2$$;
    create function public.sellerpilot_service_ingest_lazada_gateway_v2(text,uuid,uuid,jsonb)
    returns jsonb language sql security definer set search_path=''
    as $$select jsonb_build_object('contract','lazada_ingest_v2','status','complete')$$;
  `);
  await db.exec(`
    create function public.sellerpilot_service_ingest_lazada_inquiries_v2(p_credential_id uuid,p_inquiries jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare
      v_owner uuid; v_account text; v_row jsonb; v_ticket uuid; v_role text;
      v_key text; v_received timestamptz; v_normal integer:=0; v_quarantine integer:=0;
      v_pending integer:=0; v_conflict integer:=0;
    begin
      select created_by,seller_account_key into v_owner,v_account
        from sellerpilot_private.channel_credentials
       where id=p_credential_id and channel='lazada' and status in('active','grace');
      if v_owner is null then raise exception 'active channel credential required'; end if;
      for v_row in select value from jsonb_array_elements(p_inquiries) loop
        v_role:=coalesce(v_row->>'senderRole','customer');
        v_key:='lazada:'||encode(extensions.digest(concat_ws(chr(31),'v2','lazada',
          v_row->>'externalTicketId',v_row->>'remoteMessageId'),'sha256'),'hex');
        if v_row->>'orderingStatus' in ('unverified','conflict') then
          insert into sellerpilot_private.lazada_unordered_messages values(
            v_owner,v_account,v_row->>'externalTicketId',v_row->>'remoteMessageId',
            v_row->>'message',v_role,v_row#>>'{providerContext,nativeContentFingerprint}'
          ) on conflict do nothing;
          v_quarantine:=v_quarantine+1;
          if v_row->>'orderingStatus'='conflict' then v_conflict:=v_conflict+1; end if;
          continue;
        end if;
        begin v_received:=(v_row->>'receivedAt')::timestamptz;
        exception when others then v_pending:=v_pending+1; continue; end;
        if v_role='customer' then
          insert into sellerpilot_private.support_tickets(
            owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
            priority,received_at,demo,source_credential_id,seller_account_key,provider_status,
            latest_inbound_key,channel_account_id
          ) values(
            v_owner,v_row->>'externalTicketId','lazada','Synthetic buyer','Synthetic inquiry',
            v_row->>'message','waiting',3,v_received,false,p_credential_id,v_account,'waiting',
            v_key,p_credential_id
          ) on conflict(owner_id,channel_key,external_ticket_id) do nothing;
          select id into v_ticket from sellerpilot_private.support_tickets
           where owner_id=v_owner and channel_key='lazada'
             and external_ticket_id=v_row->>'externalTicketId'
             and source_credential_id=p_credential_id and seller_account_key=v_account;
          if v_ticket is null then raise exception 'fixture ticket lineage mismatch'; end if;
          insert into sellerpilot_private.support_inbound_messages(
            ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
            provider_context,received_at
          ) values(v_ticket,v_owner,'lazada',v_key,v_row->>'remoteMessageId','customer',
            v_row->>'message',v_row->'providerContext',v_received)
          on conflict(owner_id,channel_key,inbound_key) do nothing;
          update sellerpilot_private.support_tickets ticket set
            latest_inbound_key=v_key,message=v_row->>'message',received_at=v_received,
            status='waiting',provider_status='waiting',resolved_at=null
           where ticket.id=v_ticket and (
             ticket.latest_inbound_key is null or v_received >= (
               select received_at from sellerpilot_private.support_inbound_messages
                where ticket_id=ticket.id and inbound_key=ticket.latest_inbound_key
             )
           );
          v_normal:=v_normal+1;
        elsif v_role='seller' then
          select id into v_ticket from sellerpilot_private.support_tickets
           where owner_id=v_owner and channel_key='lazada'
             and external_ticket_id=v_row->>'externalTicketId'
             and source_credential_id=p_credential_id and seller_account_key=v_account;
          if v_ticket is null then v_pending:=v_pending+1; continue; end if;
          insert into sellerpilot_private.support_inbound_messages(
            ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
            provider_context,received_at
          ) values(v_ticket,v_owner,'lazada',v_key,v_row->>'remoteMessageId','seller',
            v_row->>'message',v_row->'providerContext',v_received)
          on conflict(owner_id,channel_key,inbound_key) do nothing;
          update sellerpilot_private.support_tickets ticket set provider_status='answered'
           where ticket.id=v_ticket and v_received >= (
             select received_at from sellerpilot_private.support_inbound_messages
              where ticket_id=ticket.id and inbound_key=ticket.latest_inbound_key
           );
          v_normal:=v_normal+1;
        else
          v_pending:=v_pending+1;
        end if;
      end loop;
      return jsonb_build_object('contract','lazada_ingest_v2',
        'status',case when v_pending+v_conflict>0 then'partial'else'complete'end,
        'normalCount',v_normal,'quarantinedCount',v_quarantine,'pendingCount',v_pending,
        'conflictCount',v_conflict,'expiredUnstoredCount',0);
    end$$;
    revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)
      from public,anon,authenticated;
    grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)
      to service_role;
  `);
  await db.query('insert into auth.users values($1)', [owner]);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,$3,'lazada','active',now()+interval '30 days',$4,'provider_certified_v1',now()),
    ($2,$3,'lazada','active',now()+interval '30 days',$5,'provider_certified_v1',now())`,
  [credential, otherCredential, owner, account, otherAccount]);
  if (binding) await bind(db, credential, app, token);
  await db.exec(proposal);
  return db;
}

async function bind(db, credentialId, appFingerprint = app, tokenFingerprint = token) {
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id,channel,operation,country,app_fingerprint,token_fingerprint,
    target_fingerprint,status,expires_at
  ) values($1,'lazada','inquiries.list','MY',$2,$3,$4,'active',now()+interval '1 day')`,
  [credentialId, appFingerprint, tokenFingerprint, target]);
}

async function ingest(db, rows, credentialId = credential) {
  return (await db.query(
    'select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb) result',
    [credentialId, JSON.stringify(rows)],
  )).rows[0].result;
}

async function batchFingerprint(db, rows) {
  return (await db.query(`select encode(extensions.digest(
    coalesce(jsonb_agg(element order by element::text),'[]'::jsonb)::text,'sha256'
  ),'hex') fingerprint from jsonb_array_elements($1::jsonb) element`,
  [JSON.stringify(rows)])).rows[0].fingerprint;
}

async function persistedState(db, jobId) {
  const counts = (await db.query(`select
    (select count(*)::int from sellerpilot_private.support_tickets) tickets,
    (select count(*)::int from sellerpilot_private.support_inbound_messages) messages,
    (select count(*)::int from sellerpilot_private.lazada_im_message_revisions) revisions,
    (select response_payload from sellerpilot_private.channel_gateway_jobs where id=$1) response_payload`,
  [jobId])).rows[0];
  return counts;
}

async function ticketState(db) {
  return (await db.query(`select status,provider_status,latest_inbound_key,message,
    provider_context from sellerpilot_private.support_tickets
    where external_ticket_id='lazada-im:session-1'`)).rows[0];
}

test('credential-specific readiness fails closed for missing or ambiguous IM app lineage and keeps RPCs service-only', async () => {
  const db = await fixture({ binding: false });
  try {
    assert.equal((await db.query('select public.sellerpilot_service_lazada_im_ingest_ready_v3($1) ready', [credential])).rows[0].ready, false);
    await assert.rejects(ingest(db, [buyer('buyer-1', 'new customer', '2026-09-08T01:00:00Z')]), /LAZADA_IM_INGEST_V3_BINDING_REQUIRED/);
    await bind(db, credential);
    assert.equal((await db.query('select public.sellerpilot_service_lazada_im_ingest_ready_v3($1) ready', [credential])).rows[0].ready, true);
    await bind(db, credential, 'f'.repeat(64), token);
    assert.equal((await db.query('select public.sellerpilot_service_lazada_im_ingest_ready_v3($1) ready', [credential])).rows[0].ready, false);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const access = (await db.query(`select
        has_function_privilege($1,'public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)','EXECUTE') ingest,
        has_table_privilege($1,'sellerpilot_private.lazada_im_message_revisions','SELECT') direct`, [role])).rows[0];
      assert.equal(access.ingest, role === 'service_role');
      assert.equal(access.direct, false);
    }
  } finally { await db.close(); }
});

test('official system timeline is durable without changing the current customer generation', async () => {
  const db = await fixture();
  try {
    const customer = buyer('buyer-new', 'new customer', '2026-09-08T10:00:00Z');
    assert.equal((await ingest(db, [customer])).status, 'complete');
    const before = await ticketState(db);
    const result = await ingest(db, [system('official-1', 'official notice', '2026-09-08T10:01:00Z')]);
    assert.equal(result.status, 'complete');
    assert.equal(result.systemCount, 1);
    const after = await ticketState(db);
    assert.equal(after.latest_inbound_key, before.latest_inbound_key);
    assert.equal(after.status, before.status);
    assert.equal(after.provider_status, before.provider_status);
    assert.equal(after.message, before.message);
    const timeline = await db.query(`select sender_role,body from sellerpilot_private.support_inbound_messages
      order by received_at`);
    assert.deepEqual(timeline.rows.map((row) => row.sender_role), ['customer', 'system']);
  } finally { await db.close(); }
});

test('an older seller echo cannot resolve a newer customer generation', async () => {
  const db = await fixture();
  try {
    await ingest(db, [buyer('buyer-new', 'new customer', '2026-09-08T10:00:00Z')]);
    const before = await ticketState(db);
    const result = await ingest(db, [seller('seller-old', 'previous reply', '2026-09-08T09:00:00Z')]);
    assert.equal(result.status, 'complete');
    assert.equal(result.sellerCount, 1);
    const after = await ticketState(db);
    assert.equal(after.latest_inbound_key, before.latest_inbound_key);
    assert.equal(after.status, 'waiting');
    assert.equal(after.provider_status, 'waiting');
  } finally { await db.close(); }
});

test('normal then recall preserves two revision kinds and updates only the matching projection', async () => {
  const db = await fixture();
  try {
    const original = buyer('same-id', 'original', '2026-09-08T10:00:00Z');
    await ingest(db, [original]);
    const before = await ticketState(db);
    const result = await ingest(db, [recalled(original)]);
    assert.equal(result.status, 'complete');
    assert.equal(result.recallCount, 1);
    const revisions = await db.query(`select revision_kind,native_content_fingerprint
      from sellerpilot_private.lazada_im_message_revisions
      where remote_message_id='same-id' order by id`);
    assert.deepEqual(revisions.rows.map((row) => row.revision_kind), ['message', 'recalled']);
    assert.equal(new Set(revisions.rows.map((row) => row.native_content_fingerprint)).size, 1);
    const message = (await db.query(`select body,provider_context from sellerpilot_private.support_inbound_messages
      where remote_message_id='same-id'`)).rows[0];
    assert.equal(message.body, 'original');
    assert.equal(message.provider_context.eventKind, 'recalled');
    const after = await ticketState(db);
    assert.equal(after.latest_inbound_key, before.latest_inbound_key);
    assert.equal(after.status, 'waiting');
    assert.equal(after.provider_context.currentMessageRecalled, true);
  } finally { await db.close(); }
});

test('same native ID with a changed body or attachment is quarantined instead of treated as recall', async () => {
  const db = await fixture();
  try {
    const first = buyer('media-id', 'caption', '2026-09-08T10:00:00Z', { imageUrl: 'https://fixture.invalid/one.png' });
    first.providerContext.extraText = 'must not enter revision evidence';
    first.providerContext.attachmentUrl = 'https://fixture.invalid/unknown.png';
    first.providerContext.nested = {
      body: 'must not enter revision evidence',
      url: 'https://fixture.invalid/nested.png',
    };
    await ingest(db, [first]);
    const changed = recalled(buyer('media-id', 'changed caption', '2026-09-08T10:00:00Z', { imageUrl: 'https://fixture.invalid/two.png' }));
    const result = await ingest(db, [changed]);
    assert.equal(result.status, 'partial');
    assert.ok(result.conflictCount >= 1);
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.lazada_im_message_revisions
      where remote_message_id='media-id' and revision_kind='conflict'`)).rows[0].n, 1);
    const revisionContexts = (await db.query(`select provider_context
      from sellerpilot_private.lazada_im_message_revisions where remote_message_id='media-id'`)).rows;
    assert.ok(revisionContexts.length >= 2);
    const allowedRevisionKeys = new Set([
      'eventKind', 'messageStatus', 'messageType', 'templateId', 'templateKind',
      'roleBasis', 'recallTargetMessageId', 'historyOnly', 'projectionConflict',
    ]);
    assert.ok(revisionContexts.every((row) => Object.keys(row.provider_context)
      .every((key) => allowedRevisionKeys.has(key))));
    const revisionEvidence = JSON.stringify(revisionContexts);
    assert.doesNotMatch(revisionEvidence, /must not enter revision evidence/);
    assert.doesNotMatch(revisionEvidence, /fixture\.invalid/);
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.lazada_unordered_messages
      where remote_message_id='media-id'`)).rows[0].n, 1);
    const projected = (await db.query(`select body,provider_context from sellerpilot_private.support_inbound_messages
      where remote_message_id='media-id'`)).rows[0];
    assert.equal(projected.body, 'caption');
    assert.equal(projected.provider_context.nativeMedia.imageUrl, 'https://fixture.invalid/one.png');
    assert.notEqual(projected.provider_context.eventKind, 'recalled');
  } finally { await db.close(); }
});

test('revision metadata rejects invalid scalar types and lengths before any projection write', async () => {
  const db = await fixture();
  try {
    const invalidType = buyer('invalid-type', 'synthetic type', '2026-09-08T10:00:00Z');
    invalidType.providerContext.eventKind = { nested: 'system' };
    const invalidLength = buyer('invalid-length', 'synthetic length', '2026-09-08T10:01:00Z');
    invalidLength.providerContext.roleBasis = 'x'.repeat(81);
    const result = await ingest(db, [invalidType, invalidLength]);
    assert.equal(result.status, 'partial');
    assert.equal(result.pendingCount, 2);
    const counts = await db.query(`select
      (select count(*)::int from sellerpilot_private.support_tickets) tickets,
      (select count(*)::int from sellerpilot_private.support_inbound_messages) messages,
      (select count(*)::int from sellerpilot_private.lazada_im_message_revisions) revisions`);
    assert.deepEqual(counts.rows[0], { tickets: 0, messages: 0, revisions: 0 });
  } finally { await db.close(); }
});

test('a different certified seller credential cannot attach revisions to an existing ticket', async () => {
  const db = await fixture();
  try {
    await ingest(db, [buyer('buyer-1', 'original owner', '2026-09-08T10:00:00Z')]);
    await bind(db, otherCredential);
    await assert.rejects(
      ingest(db, [buyer('foreign-1', 'foreign seller event', '2026-09-08T10:01:00Z')], otherCredential),
      /LAZADA_IM_TICKET_LINEAGE_MISMATCH/,
    );
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.support_inbound_messages`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.lazada_im_message_revisions
      where seller_account_key=$1`, [otherAccount])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('gateway V3 rejects mismatched or expired pending batches before ingest and makes completed replay payload-agnostic', async () => {
  const db = await fixture();
  try {
    const job = '00000000-0000-4000-8000-000000000504';
    const claim = '00000000-0000-4000-8000-000000000505';
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,status,claim_token
    ) values($1,$2,'lazada','inquiries.list','running',$3)`, [job, credential, claim]);
    const originalBatch = [buyer('pending-original', 'original pending batch', '2026-09-08T09:00:00Z')];
    const originalFingerprint = await batchFingerprint(db, originalBatch);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set response_payload=jsonb_build_object(
      'lazadaIngestionPending',jsonb_build_object('fingerprint',$2::text,'firstObservedAt',now(),'expiresAt',now()+interval '1 day')
    ) where id=$1`, [job, originalFingerprint]);
    const beforeMismatch = await persistedState(db, job);
    const mismatch = (await db.query(`select public.sellerpilot_service_ingest_lazada_gateway_v3(
      'fixture-token',$1,$2,$3::jsonb
    ) result`, [job, claim, JSON.stringify([buyer('pending-other', 'other batch', '2026-09-08T09:01:00Z')])])).rows[0].result;
    assert.equal(mismatch.status, 'partial');
    assert.equal(mismatch.originalBatchRequired, true);
    assert.equal(mismatch.ingestSkipped, true);
    assert.deepEqual(await persistedState(db, job), beforeMismatch);

    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set response_payload=jsonb_set(response_payload,'{lazadaIngestionPending,expiresAt}',to_jsonb((now()-interval '1 second')::text))
      where id=$1`, [job]);
    const beforeExpired = await persistedState(db, job);
    const expired = (await db.query(`select public.sellerpilot_service_ingest_lazada_gateway_v3(
      'fixture-token',$1,$2,$3::jsonb
    ) result`, [job, claim, JSON.stringify(originalBatch)])).rows[0].result;
    assert.equal(expired.status, 'partial');
    assert.equal(expired.pendingReceiptExpired, true);
    assert.equal(expired.ingestSkipped, true);
    assert.deepEqual(await persistedState(db, job), beforeExpired);

    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set response_payload='{}'::jsonb where id=$1`, [job]);
    const complete = (await db.query(`select public.sellerpilot_service_ingest_lazada_gateway_v3(
      'fixture-token',$1,$2,$3::jsonb
    ) result`, [job, claim, JSON.stringify([buyer('gateway-1', 'gateway customer', '2026-09-08T10:00:00Z')])])).rows[0].result;
    assert.equal(complete.contract, 'lazada_ingest_v3');
    assert.equal(complete.status, 'complete');
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set status='completed',response_payload=jsonb_build_object('providerReceipt','synthetic')
      where id=$1`, [job]);
    await db.query(`insert into sellerpilot_private.gateway_completion_receipts(
      job_id,claim_token,worker_token_hash
    ) values($1,$2,'fixture-token')`, [job, claim]);
    const beforeReplay = await persistedState(db, job);
    const replay = (await db.query(`select public.sellerpilot_service_ingest_lazada_gateway_v3(
      'fixture-token',$1,$2,$3::jsonb
    ) result`, [job, claim, JSON.stringify([buyer('replay-different', 'ignored replay payload', '2026-09-08T11:00:00Z')])])).rows[0].result;
    assert.equal(replay.status, 'complete');
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.replayPayloadIgnored, true);
    assert.equal(replay.replayBasis, 'gateway_completion_receipt');
    assert.deepEqual(await persistedState(db, job), beforeReplay);
    await assert.rejects(db.query(`select public.sellerpilot_service_ingest_lazada_gateway_v3(
      'wrong-token',$1,$2,'[]'::jsonb
    )`, [job, claim]), /LAZADA_INGEST_CLAIM_REQUIRED/);
  } finally { await db.close(); }
});
