import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const requireFromHere = createRequire(import.meta.url);
const [adminSource, rawRouteSource, quarantineRouteSource, rawContractSource,
  quarantineContractSource, rawUiSource, quarantineUiSource, rawSql,
  quarantineSql, v3Sql, sharedPolicy] = await Promise.all([
  readFile(new URL('../lib/admin-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/admin/cs/lazada-raw-inbox/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/admin/cs/lazada-quarantine/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/cs/lazada-raw-inbox.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/cs/lazada-quarantine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/cs/lazada-raw-inbox.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/cs/lazada-quarantine.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260907210000_persist_lazada_im_raw_inbox.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260907060844_read_lazada_quarantine.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql', import.meta.url), 'utf8'),
  readFile(new URL('./fixtures/shared-cs-live-policy-20260907.sql', import.meta.url), 'utf8'),
]);

const owner = '00000000-0000-4000-8000-000000000701';
const otherOwner = '00000000-0000-4000-8000-000000000702';
const admin = '00000000-0000-4000-8000-000000000703';
const credential = '00000000-0000-4000-8000-000000000704';
const otherCredential = '00000000-0000-4000-8000-000000000705';
const wrongCredential = '00000000-0000-4000-8000-000000000706';
const account = 'a'.repeat(64);
const otherAccount = 'b'.repeat(64);
const app = 'c'.repeat(64);
const token = 'd'.repeat(64);
const target = 'e'.repeat(64);

function evaluateTypeScript(source, requireModule, globals = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const sandbox = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: requireModule,
    Request,
    Response,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  vm.runInContext(compiled, sandbox);
  return moduleRecord.exports;
}

const rawContract = evaluateTypeScript(rawContractSource, (name) => {
  if (name === 'zod') return requireFromHere('zod');
  throw new Error(`unexpected raw contract module ${name}`);
});
const quarantineContract = evaluateTypeScript(quarantineContractSource, (name) => {
  if (name === 'zod') return requireFromHere('zod');
  throw new Error(`unexpected quarantine contract module ${name}`);
});

function nativeFingerprint(nativeText, nativeMedia = null) {
  return createHash('sha256').update(JSON.stringify({ nativeText, nativeMedia })).digest('hex');
}

function inquiry(remoteMessageId, message, receivedAt, overrides = {}) {
  return {
    externalTicketId: 'lazada-im:web-session',
    customerName: 'Synthetic buyer',
    subject: 'Synthetic inquiry',
    message,
    status: 'waiting',
    priority: 3,
    receivedAt,
    remoteMessageId,
    providerContext: { nativeContentFingerprint: nativeFingerprint(message) },
    ...overrides,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema extensions;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create function extensions.digest(bytea,text) returns bytea language sql immutable
      as $$select sha256($1)$$;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
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
      body_digest text not null,
      sender_role text not null,
      body text not null,
      observed_at timestamptz not null default now(),
      expires_at timestamptz not null default (now()+interval '7 days'),
      unique(owner_id,seller_account_key,external_ticket_id,remote_message_id,body_digest,sender_role)
    );
    alter table sellerpilot_private.lazada_unordered_messages enable row level security;
    revoke all on sellerpilot_private.lazada_unordered_messages from public,anon,authenticated,service_role;
    create table sellerpilot_private.lazada_unordered_dedup(
      owner_id uuid not null,
      identity_digest text not null,
      conflicted boolean not null default false,
      primary key(owner_id,identity_digest)
    );
    create table sellerpilot_private.support_ticket_deletions(
      owner_id uuid not null,
      channel_key text not null,
      external_ticket_fingerprint text not null
    );
    create function sellerpilot_private.support_deletion_fingerprint(uuid,text,text)
    returns text language sql immutable set search_path=''
    as $$select encode(sha256(convert_to(jsonb_build_array($1,$2,$3)::text,'UTF8')),'hex')$$;
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      claim_token uuid,
      response_payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$select null::jsonb$$;
    create function public.sellerpilot_service_ingest_lazada_gateway_v2(text,uuid,uuid,jsonb)
    returns jsonb language sql security definer set search_path=''
    as $$select jsonb_build_object('contract','lazada_ingest_v2','status','complete')$$;
  `);
  await db.exec(sharedPolicy.slice(0, sharedPolicy.indexOf('CREATE OR REPLACE FUNCTION public.sellerpilot_get_operations_snapshot')));
  await db.exec(`
    create function public.sellerpilot_service_ingest_lazada_inquiries_v2(
      p_credential_id uuid,p_inquiries jsonb
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare
      v_owner uuid; v_account text; v_row jsonb; v_ticket uuid; v_key text;
      v_role text; v_received timestamptz; v_normal integer:=0;
      v_quarantine integer:=0; v_conflict integer:=0;
    begin
      select created_by,seller_account_key into v_owner,v_account
        from sellerpilot_private.channel_credentials
       where id=p_credential_id and channel='lazada' and status in('active','grace');
      if v_owner is null then raise exception 'active channel credential required'; end if;
      for v_row in select value from jsonb_array_elements(p_inquiries) loop
        v_role:=coalesce(v_row->>'senderRole','customer');
        if v_row->>'orderingStatus'='conflict' then
          insert into sellerpilot_private.lazada_unordered_messages(
            owner_id,seller_account_key,external_ticket_id,remote_message_id,
            body_digest,sender_role,body
          ) values(
            v_owner,v_account,v_row->>'externalTicketId',v_row->>'remoteMessageId',
            encode(extensions.digest(v_row->>'message','sha256'),'hex'),v_role,v_row->>'message'
          ) on conflict do nothing;
          insert into sellerpilot_private.lazada_unordered_dedup(owner_id,identity_digest,conflicted)
          values(v_owner,encode(extensions.digest(jsonb_build_array(
            v_owner,v_account,v_row->>'externalTicketId',v_row->>'remoteMessageId'
          )::text,'sha256'),'hex'),true) on conflict(owner_id,identity_digest)
          do update set conflicted=true;
          v_quarantine:=v_quarantine+1;v_conflict:=v_conflict+1;continue;
        end if;
        v_received:=(v_row->>'receivedAt')::timestamptz;
        v_key:='lazada:'||encode(extensions.digest(concat_ws(chr(31),'v2','lazada',
          v_row->>'externalTicketId',v_row->>'remoteMessageId'),'sha256'),'hex');
        if v_role='customer' then
          insert into sellerpilot_private.support_tickets(
            owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
            priority,received_at,demo,source_credential_id,seller_account_key,
            provider_status,latest_inbound_key,channel_account_id
          ) values(v_owner,v_row->>'externalTicketId','lazada','Synthetic buyer','Synthetic inquiry',
            v_row->>'message','waiting',3,v_received,false,p_credential_id,v_account,
            'waiting',v_key,p_credential_id)
          on conflict(owner_id,channel_key,external_ticket_id) do nothing;
          select id into v_ticket from sellerpilot_private.support_tickets
           where owner_id=v_owner and channel_key='lazada'
             and external_ticket_id=v_row->>'externalTicketId'
             and source_credential_id=p_credential_id and seller_account_key=v_account;
          if v_ticket is null then raise exception 'fixture ticket lineage mismatch'; end if;
          insert into sellerpilot_private.support_inbound_messages(
            ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,
            body,provider_context,received_at
          ) values(v_ticket,v_owner,'lazada',v_key,v_row->>'remoteMessageId','customer',
            v_row->>'message',v_row->'providerContext',v_received)
          on conflict(owner_id,channel_key,inbound_key) do nothing;
          update sellerpilot_private.support_tickets set latest_inbound_key=v_key,
            message=v_row->>'message',received_at=v_received,status='waiting',provider_status='waiting'
          where id=v_ticket;
          v_normal:=v_normal+1;
        end if;
      end loop;
      return jsonb_build_object('contract','lazada_ingest_v2',
        'status',case when v_conflict>0 then'partial'else'complete'end,
        'normalCount',v_normal,'quarantinedCount',v_quarantine,'pendingCount',0,
        'conflictCount',v_conflict,'expiredUnstoredCount',0);
    end$$;
    revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)
      from public,anon,authenticated;
    grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)
      to service_role;
  `);
  await db.query('insert into auth.users values($1),($2),($3)', [owner, otherOwner, admin]);
  await db.query('insert into sellerpilot_private.admin_users values($1)', [admin]);
  await db.query(`insert into sellerpilot_private.channel_credentials values
    ($1,$4,'lazada','active',now()+interval '30 days',$6,'provider_certified_v1',now()),
    ($2,$5,'lazada','active',now()+interval '30 days',$7,'provider_certified_v1',now()),
    ($3,$4,'lazada','active',now()+interval '30 days',$7,'provider_certified_v1',now())`,
  [credential, otherCredential, wrongCredential, owner, otherOwner, account, otherAccount]);
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id,channel,operation,country,app_fingerprint,token_fingerprint,
    target_fingerprint,status,expires_at
  ) values
    ($1,'lazada','inquiries.list','MY',$4,$5,$6,'active',now()+interval '1 day'),
    ($2,'lazada','inquiries.list','MY',$4,$5,$6,'active',now()+interval '1 day'),
    ($3,'lazada','inquiries.list','MY',$4,$5,$6,'active',now()+interval '1 day')`,
  [credential, otherCredential, wrongCredential, app, token, target]);
  await db.exec(rawSql);
  await db.exec(quarantineSql);
  await db.exec(v3Sql);
  return db;
}

async function asAuthenticated(db, userId, sql, parameters = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('set role authenticated');
  try {
    return await db.query(sql, parameters);
  } finally {
    await db.exec('reset role');
  }
}

function createSupabaseFactory(db, rpcCalls) {
  return (_url, key, options = {}) => {
    const authorization = options.global?.headers?.Authorization ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const userId = bearer === 'valid-admin' ? admin : bearer === 'valid-other' ? otherOwner : null;
    if (key === 'fixture-secret') return { rpc: async () => { throw new Error('GET must not use service client'); } };
    return {
      auth: {
        getUser: async () => bearer === 'expired'
          ? { data: { user: null }, error: { status: 401, code: 'session_expired' } }
          : userId
            ? { data: { user: { id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-08T00:00:00Z' } }, error: null }
            : { data: { user: null }, error: { status: 401, code: 'bad_jwt' } },
      },
      rpc: async (name, args = {}) => {
        rpcCalls.push({ bearer, name, args });
        try {
          if (!userId) return { data: null, error: { status: 401, code: 'bad_jwt' }, status: 401 };
          if (name === 'sellerpilot_is_admin') {
            const result = await asAuthenticated(db, userId, 'select public.sellerpilot_is_admin() value');
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          if (name === 'sellerpilot_read_lazada_im_raw_inbox_v1') {
            const result = await asAuthenticated(db, userId,
              'select public.sellerpilot_read_lazada_im_raw_inbox_v1($1,$2,$3) value',
              [args.p_before_time, args.p_before_id, args.p_as_of]);
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          if (name === 'sellerpilot_read_lazada_quarantine') {
            const result = await asAuthenticated(db, userId,
              'select public.sellerpilot_read_lazada_quarantine($1,$2,$3) value',
              [args.p_before_time, args.p_before_key, args.p_as_of]);
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          throw new Error(`unexpected rpc ${name}`);
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'database failure' }, status: 400 };
        }
      },
    };
  };
}

function loadRoutes(db, rpcCalls) {
  const createClient = createSupabaseFactory(db, rpcCalls);
  const adminApi = evaluateTypeScript(adminSource, (name) => {
    if (name === '@supabase/supabase-js') return { createClient };
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/supabase/config')) return { supabaseUrl: 'https://fixture.supabase.test', supabasePublishableKey: 'fixture-publishable' };
    throw new Error(`unexpected admin module ${name}`);
  }, { process: { env: { SUPABASE_SECRET_KEY: 'fixture-secret' } } });
  const loadRoute = (source, contract, suffix) => evaluateTypeScript(source, (name) => {
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/admin-api')) return adminApi;
    if (name.endsWith(suffix)) return contract;
    throw new Error(`unexpected route module ${name}`);
  });
  return {
    rawGet: loadRoute(rawRouteSource, rawContract, '/cs/lazada-raw-inbox'),
    quarantineGet: loadRoute(quarantineRouteSource, quarantineContract, '/cs/lazada-quarantine'),
  };
}

async function storeRaw(db, kind) {
  const raw = JSON.stringify({ fixtureEventKind: kind, remoteMessageId: `${kind}-raw` });
  const result = (await db.query(
    "select public.sellerpilot_service_store_lazada_im_raw_event_v1($1,$2,'webhook') value",
    [credential, raw],
  )).rows[0].value;
  return { id: result.id, raw };
}

test('actual admin helper and exported GETs expose V3 system, recall, and conflict evidence through authenticated user RPCs', async () => {
  const db = await fixture();
  try {
    const [systemRaw, recallRaw, conflictRaw] = await Promise.all([
      storeRaw(db, 'system'), storeRaw(db, 'recall'), storeRaw(db, 'conflict'),
    ]);
    const original = inquiry('recalled-1', 'original customer', '2026-09-08T10:00:00Z');
    const conflictOriginal = inquiry('conflict-1', 'first body', '2026-09-08T10:01:00Z');
    await db.query('select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb)',
      [credential, JSON.stringify([original, conflictOriginal])]);
    const system = inquiry('system-1', 'official system notice', '2026-09-08T10:02:00Z', {
      senderRole: 'system', status: 'resolved',
      providerContext: { nativeContentFingerprint: nativeFingerprint('official system notice'), eventKind: 'system', roleBasis: 'official_session_tag' },
    });
    const recall = inquiry('recalled-1', 'Lazada 발신자 회수 · original customer', '2026-09-08T10:03:00Z', {
      providerContext: { nativeContentFingerprint: nativeFingerprint('original customer'), eventKind: 'recalled', recallTargetMessageId: 'recalled-1' },
    });
    const conflict = inquiry('conflict-1', 'changed body', '2026-09-08T10:04:00Z', {
      orderingStatus: 'conflict',
      providerContext: { nativeContentFingerprint: nativeFingerprint('changed body'), eventKind: 'recalled', recallTargetMessageId: 'conflict-1' },
    });
    const v3Result = (await db.query(
      'select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb) value',
      [credential, JSON.stringify([system, recall, conflict])],
    )).rows[0].value;
    assert.equal(v3Result.status, 'partial');
    assert.equal(v3Result.systemCount, 1);
    assert.equal(v3Result.recallCount, 1);
    assert.ok(v3Result.conflictCount >= 1);
    for (const raw of [systemRaw, recallRaw]) {
      await db.query("select public.sellerpilot_service_mark_lazada_im_raw_event_v1($1,$2,'normalized')", [credential, raw.id]);
    }

    const rpcCalls = [];
    const routes = loadRoutes(db, rpcCalls);
    const headers = { authorization: 'Bearer valid-admin' };
    const rawResponse = await routes.rawGet.GET(new Request('https://fixture.test/api/admin/cs/lazada-raw-inbox', { headers }));
    assert.equal(rawResponse.status, 200);
    assert.match(rawResponse.headers.get('cache-control') ?? '', /private, no-store/);
    const rawPage = await rawResponse.json();
    const rawKinds = new Map(rawPage.events.map((event) => [JSON.parse(event.rawBody).fixtureEventKind, event.processingStatus]));
    assert.equal(rawKinds.get('system'), 'normalized');
    assert.equal(rawKinds.get('recall'), 'normalized');
    assert.equal(rawKinds.get('conflict'), 'pending');
    assert.match(rawUiSource, /<pre>\{event\.rawBody\}<\/pre>/);
    assert.match(rawUiSource, /normalized: "CS 원장 반영"/);

    const quarantineResponse = await routes.quarantineGet.GET(new Request('https://fixture.test/api/admin/cs/lazada-quarantine', { headers }));
    assert.equal(quarantineResponse.status, 200);
    const quarantinePage = await quarantineResponse.json();
    assert.equal(quarantinePage.messages.length, 1);
    assert.equal(quarantinePage.messages[0].messageId, 'conflict-1');
    assert.equal(quarantinePage.messages[0].reason, 'conflict');
    assert.equal(quarantinePage.messages[0].body, 'changed body');
    assert.match(quarantineUiSource, /message\.reason === "conflict"/);
    assert.match(quarantineUiSource, /메시지 ID 충돌 · 확인 필요/);

    const projections = await db.query(`select remote_message_id,sender_role,provider_context
      from sellerpilot_private.support_inbound_messages
      where remote_message_id in('system-1','recalled-1') order by remote_message_id`);
    assert.equal(projections.rows.find((row) => row.remote_message_id === 'system-1').sender_role, 'system');
    assert.equal(projections.rows.find((row) => row.remote_message_id === 'recalled-1').provider_context.eventKind, 'recalled');
    assert.ok(rpcCalls.some((call) => call.name === 'sellerpilot_is_admin'));
    assert.ok(rpcCalls.some((call) => call.name === 'sellerpilot_read_lazada_im_raw_inbox_v1'));
    assert.ok(rpcCalls.some((call) => call.name === 'sellerpilot_read_lazada_quarantine'));
    assert.equal(conflictRaw.raw.includes('conflict'), true);
  } finally { await db.close(); }
});

test('actual helper and database contracts reject anonymous, expired, non-admin, cross-owner credential, and direct-table access', async () => {
  const db = await fixture();
  try {
    const raw = await storeRaw(db, 'scope');
    const rpcCalls = [];
    const routes = loadRoutes(db, rpcCalls);
    const anonymous = await routes.rawGet.GET(new Request('https://fixture.test/api/admin/cs/lazada-raw-inbox'));
    assert.equal(anonymous.status, 401);
    assert.equal(rpcCalls.length, 0);
    const expired = await routes.rawGet.GET(new Request('https://fixture.test/api/admin/cs/lazada-raw-inbox', {
      headers: { authorization: 'Bearer expired' },
    }));
    assert.equal(expired.status, 401);
    assert.equal(rpcCalls.some((call) => call.bearer === 'expired'), true);
    assert.equal(rpcCalls.some((call) => call.bearer === 'expired' && call.name.startsWith('sellerpilot_read_')), false);
    const other = await routes.quarantineGet.GET(new Request('https://fixture.test/api/admin/cs/lazada-quarantine', {
      headers: { authorization: 'Bearer valid-other' },
    }));
    assert.equal(other.status, 403);
    assert.equal(rpcCalls.some((call) => call.bearer === 'valid-other' && call.name.startsWith('sellerpilot_read_')), false);

    await assert.rejects(db.query(
      "select public.sellerpilot_service_mark_lazada_im_raw_event_v1($1,$2,'normalized')",
      [otherCredential, raw.id],
    ), /LAZADA_IM_RAW_RECEIPT_REQUIRED/);
    await db.query('select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb)', [
      credential, JSON.stringify([inquiry('owned-1', 'owner one', '2026-09-08T10:00:00Z')]),
    ]);
    await assert.rejects(db.query('select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb)', [
      wrongCredential, JSON.stringify([inquiry('foreign-1', 'wrong seller credential', '2026-09-08T10:01:00Z')]),
    ]), /LAZADA_IM_TICKET_LINEAGE_MISMATCH/);

    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('reset role');
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from sellerpilot_private.lazada_im_raw_inbox'), /permission denied/);
      await assert.rejects(db.query('select * from sellerpilot_private.lazada_im_message_revisions'), /permission denied/);
    }
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.sellerpilot_read_lazada_im_raw_inbox_v1()'), /permission denied/);
    await assert.rejects(db.query('select public.sellerpilot_read_lazada_quarantine()'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});
