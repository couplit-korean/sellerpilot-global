import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { normalizeLazadaImHistory } from '../lib/channels/lazada-im.ts';

const requireFromHere = createRequire(import.meta.url);
const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
async function readIntegratedCanonical(relative) {
  if (integratedRoot) return readFile(resolve(integratedRoot, relative), 'utf8');
  try { return await readFile(new URL(`../${relative}`, import.meta.url), 'utf8'); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return readFile(new URL(`../.local/cs-integration-sandbox/repo/${relative}`, import.meta.url), 'utf8');
  }
}
async function readConcurrentFence() {
  if (!integratedRoot) return readFile(new URL(
    '../docs/cs-parallel/proposals/lazada/lazada-010-concurrent-revision-reply-fence.sql',
    import.meta.url,
  ), 'utf8');
  try {
    return await readIntegratedCanonical(
      'supabase/migrations/20260909111201_cs_lazada_concurrent_reply_fence.sql',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return readIntegratedCanonical(
      'supabase/migrations/20260909103500_cs_lazada_concurrent_revision_reply_fence.sql',
    );
  }
}
const canonicalProjectionUrl = new URL(
  '../supabase/migrations/20260908145831_cs_lazada_v3_conversation_projection.sql',
  import.meta.url,
);
async function readCanonicalProjection() {
  if (integratedRoot) {
    return {
      source: 'integration-canonical-migration',
      sql: await readIntegratedCanonical(
        'supabase/migrations/20260908145831_cs_lazada_v3_conversation_projection.sql',
      ),
    };
  }
  try {
    return {
      source: 'canonical-migration',
      sql: await readFile(canonicalProjectionUrl, 'utf8'),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      source: 'frozen-008-proposal-fallback',
      sql: await readFile(new URL(
        '../docs/cs-parallel/proposals/lazada/lazada-008-v3-conversation-projection.sql',
        import.meta.url,
      ), 'utf8'),
    };
  }
}

const [v3Sql, projection, guardSql, draftQueueSql, concurrentFenceSql, adminSource, conversationRouteSource, conversationContractSource,
  sharedSources] = await Promise.all([
  readIntegratedCanonical('supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql'),
  readCanonicalProjection(),
  readIntegratedCanonical('supabase/migrations/20260908153837_cs_lazada_ordinary_workspace_reply_guard.sql'),
  readIntegratedCanonical('supabase/migrations/20260908172414_isolate_cs_reply_draft_queue.sql'),
  readConcurrentFence(),
  readFile(new URL('../lib/admin-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/admin/cs/tickets/[id]/messages/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/cs/conversation.ts', import.meta.url), 'utf8'),
  Promise.all([
    '../app/use-operations-snapshot.ts', '../app/page.tsx',
    '../app/cs/workspace-contracts.ts', '../app/cs/workspace.tsx',
    '../app/api/ai/support-reply/route.ts', '../app/api/operations/snapshot/route.ts',
    '../app/api/admin/cs/reply/route.ts', '../lib/channels/gateway.ts',
    '../lib/cs/operations/enqueue-reply.ts',
  ].map((file) => readFile(new URL(file, import.meta.url), 'utf8'))).then((sources) => sources.join('\n')),
]);

const owner = '00000000-0000-4000-8000-000000000901';
const credential = '00000000-0000-4000-8000-000000000902';
const seller = 'a'.repeat(64);
const app = 'b'.repeat(64);
const token = 'c'.repeat(64);
const target = 'd'.repeat(64);

function evaluateTypeScript(source, requireModule, globals = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  const sandbox = vm.createContext({
    module: moduleRecord, exports: moduleRecord.exports, require: requireModule,
    Request, Response, URL, URLSearchParams, setTimeout, clearTimeout, ...globals,
  });
  vm.runInContext(compiled, sandbox);
  return moduleRecord.exports;
}

function historyRow(messageId, body, status = 0, sendTime = '2026-09-08T10:00:00Z') {
  return {
    message_id: messageId,
    content: { txt: body },
    from_account_type: 1,
    type: 1,
    template_id: 1,
    send_time: sendTime,
    status,
  };
}

function normalize(sessionId, row) {
  return normalizeLazadaImHistory([{
    name: `inquiries-message:${sessionId}:1`,
    data: {
      sellerpilotSession: { session_id: sessionId, title: 'Synthetic buyer', site_id: 'MY' },
      data: { message_list: [row] },
    },
  }], undefined, { rawStorageReady: true });
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.channels(key text primary key);
    insert into sellerpilot_private.channels values('lazada'),('smartstore');
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid not null references auth.users(id),
      channel text not null, status text not null, expires_at timestamptz,
      seller_account_key text, seller_account_key_source text,
      seller_account_verified_at timestamptz, environment text not null default 'production'
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key default gen_random_uuid(), credential_id uuid not null,
      channel text not null, operation text not null, country text not null,
      app_fingerprint text not null, token_fingerprint text not null,
      target_fingerprint text not null, status text not null, expires_at timestamptz
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
      external_ticket_id text not null, channel_key text not null references sellerpilot_private.channels(key),
      customer_name text not null, subject text not null, message text not null,
      translated_message text, reply_draft text, status text not null default 'waiting',
      priority integer not null default 3, received_at timestamptz not null, resolved_at timestamptz,
      demo boolean not null default false, updated_at timestamptz not null default now(),
      source_credential_id uuid, seller_account_key text, provider_status text not null default 'unknown',
      provider_status_updated_at timestamptz, latest_inbound_key text,
      provider_context jsonb not null default '{}'::jsonb,
      reply_context jsonb not null default '{}'::jsonb, channel_account_id uuid,
      ticket_kind text not null default 'conversation', order_id uuid,
      external_order_reference text, reply_delivery_status text not null default 'never',
      reply_delivery_error text, reply_operation_attempt_id uuid, reply_gateway_job_id uuid,
      last_delivery_job_id uuid,
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null references sellerpilot_private.support_tickets(id),
      owner_id uuid not null references auth.users(id), channel_key text not null,
      inbound_key text not null, remote_message_id text, sender_role text not null,
      body text not null, provider_context jsonb not null default '{}'::jsonb,
      received_at timestamptz not null, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique(owner_id,channel_key,inbound_key)
    );
    create table sellerpilot_private.lazada_unordered_messages(
      owner_id uuid not null, seller_account_key text not null, external_ticket_id text not null,
      remote_message_id text not null, body text not null, sender_role text not null,
      native_content_fingerprint text not null,
      unique(owner_id,seller_account_key,external_ticket_id,remote_message_id,native_content_fingerprint)
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid, channel text not null, operation text not null,
      status text not null, claim_token uuid, response_payload jsonb not null default '{}'::jsonb,
      request_payload jsonb not null default '{}'::jsonb, created_by uuid,
      seller_account_key text, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),provider_mutation_started_at timestamptz,
      error_message text,completed_at timestamptz,lease_expires_at timestamptz,worker_token_id uuid
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null, owner_id uuid not null,
      channel_key text not null, status text not null, queued_at timestamptz not null default now(),
      created_at timestamptz not null default now(), gateway_job_id uuid,
      provider_message_id text, acknowledged_at timestamptz, acknowledged_by uuid,
      acknowledgement_reason text, safe_message text, reconciliation_reason text,
      provider_request_id text, started_at timestamptz, completed_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key, kind text not null, request_payload jsonb not null, created_by uuid,
      status text not null default 'queued',result_payload jsonb,error_message text,
      lease_expires_at timestamptz,created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),completed_at timestamptz
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null
    );
    create function sellerpilot_private.worker_token_has_scope(text,text,boolean default true)
      returns boolean language sql stable set search_path='' as $$select exists(
        select 1 from sellerpilot_private.ai_cli_worker_tokens token
         where token.token_hash=$1 and token.scope=$2 and token.status='active'
           and (not $3 or token.expires_at>clock_timestamp()))$$;
    create function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean default true)
      returns boolean language sql stable set search_path='' as $$select exists(
        select 1 from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.ai_cli_worker_tokens token on token.id=job.worker_token_id
        where token.token_hash=$1 and job.id=$2 and job.claim_token=$3
          and job.status='running' and (not $4 or job.lease_expires_at>clock_timestamp()))$$;
    create function public.sellerpilot_service_gateway_completion_context(text,uuid,uuid)
    returns jsonb language sql stable security definer set search_path=''
    as $$select null::jsonb$$;
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
            v_owner,v_row->>'externalTicketId','lazada',v_row->>'customerName',v_row->>'subject',
            v_row->>'message','waiting',3,v_received,false,p_credential_id,v_account,'waiting',v_key,p_credential_id
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
            status='waiting',provider_status='waiting',resolved_at=null,updated_at=now()
           where ticket.id=v_ticket and (ticket.latest_inbound_key is null or v_received >= (
             select received_at from sellerpilot_private.support_inbound_messages
              where ticket_id=ticket.id and inbound_key=ticket.latest_inbound_key
           ));
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

    create function public.sellerpilot_get_cs_conversation(uuid,integer,timestamptz,text,timestamptz)
      returns jsonb language sql stable security definer set search_path='' as $$select '{}'::jsonb$$;
    create function public.sellerpilot_search_cs_archive_v2(text,text,text,date,date,uuid,text,text,text,integer,timestamptz,uuid,timestamptz)
      returns jsonb language sql stable security definer set search_path='' as $$select '{}'::jsonb$$;
    create function public.sellerpilot_get_cs_workspace_snapshot()
      returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object('tickets',coalesce(jsonb_agg(jsonb_build_object(
        'ticketId',ticket.id,'message',ticket.message,'translatedMessage',ticket.translated_message,
        'replyDraft',ticket.reply_draft,'providerStatus',ticket.provider_status,
        'latestInboundKey',ticket.latest_inbound_key,'ticketKind',ticket.ticket_kind
      ) order by ticket.received_at),'[]'::jsonb),'summary',jsonb_build_object('queued',0))
      from sellerpilot_private.support_tickets ticket where not ticket.demo$$;
    create function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
      returns jsonb language sql stable security definer set search_path='' as $$
      select case when auth.uid() is null or not public.sellerpilot_is_admin() then null else (
        select jsonb_build_object('id',ticket.id,'channel_key',ticket.channel_key,
          'status',ticket.status,'provider_status',ticket.provider_status,
          'latest_inbound_key',ticket.latest_inbound_key,'provider_context',ticket.provider_context,
          'environment','production') from sellerpilot_private.support_tickets ticket
         where ticket.id=p_id and not ticket.demo limit 1) end$$;
    create function public.sellerpilot_update_ticket(uuid,text,text,text)
      returns boolean language plpgsql security definer set search_path='' as $$
      begin
        if not public.sellerpilot_is_admin() then raise exception 'administrator access required'; end if;
        if nullif($4,'') is distinct from (select latest_inbound_key from sellerpilot_private.support_tickets where id=$1)
          then raise exception 'INQUIRY_CONTEXT_STALE'; end if;
        update sellerpilot_private.support_tickets set status=$2,reply_draft=nullif(trim($3),''),updated_at=now() where id=$1;
        return found;
      end$$;
    create function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)
      returns uuid language plpgsql security definer set search_path='' as $$
      declare v_ticket sellerpilot_private.support_tickets%rowtype;
      begin
        if not public.sellerpilot_is_admin() then raise exception 'administrator access required'; end if;
        select * into v_ticket from sellerpilot_private.support_tickets where id=$2 and owner_id=auth.uid();
        if not found then raise exception 'support ticket not found'; end if;
        if nullif($3,'') is distinct from v_ticket.latest_inbound_key then raise exception 'INQUIRY_CONTEXT_STALE'; end if;
        insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload,created_by)
        values($1,'support_reply',jsonb_build_object(
          'ticket_id',v_ticket.id,'message',v_ticket.message,'target_locale',$4,'tone',$5),auth.uid());
        return $1;
      end$$;
    create function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)
      returns uuid language plpgsql security definer set search_path='' as $$
      declare v_id uuid:=gen_random_uuid();
      begin
        insert into sellerpilot_private.channel_gateway_jobs(id,channel,operation,status,request_payload)
        values(v_id,$2,'inquiries.reply','queued',$4||jsonb_build_object('reply',$3));
        return v_id;
      end$$;
    create function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql security definer set search_path='' as $$begin
        update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
         where id=$2 and claim_token=$3 and status='running'; return found; end$$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
      returns boolean language plpgsql security definer set search_path='' as $$begin
        update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
         where id=$2 and claim_token=$3 and status='running'; return found; end$$;
    grant execute on function public.sellerpilot_get_cs_workspace_snapshot() to authenticated;
    grant execute on function public.sellerpilot_get_ticket_reply_context_v2(uuid) to authenticated;
    grant execute on function public.sellerpilot_update_ticket(uuid,text,text,text) to authenticated;
    grant execute on function public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text) to authenticated;
    grant execute on function public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb) to service_role;
  `);
  await db.query('insert into auth.users values($1)', [owner]);
  await db.query('insert into sellerpilot_private.admin_users values($1)', [owner]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,status,expires_at,seller_account_key,seller_account_key_source,
    seller_account_verified_at,environment
  ) values($1,$2,'lazada','active',now()+interval '30 days',$3,'provider_certified_v1',now(),'production')`,
  [credential, owner, seller]);
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id,channel,operation,country,app_fingerprint,token_fingerprint,target_fingerprint,status,expires_at
  ) values($1,'lazada','inquiries.list','MY',$2,$3,$4,'active',now()+interval '1 day')`,
  [credential, app, token, target]);
  await db.exec(v3Sql);
  await db.exec(projection.sql);
  await db.exec(guardSql);
  return db;
}

async function currentQueueFixture() {
  const db = await fixture();
  await db.exec(draftQueueSql);
  await db.exec(concurrentFenceSql);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens
    values(gen_random_uuid(),$1,'ai','active',clock_timestamp()+interval '1 day')`, ['9'.repeat(64)]);
  return db;
}

async function claims(db, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [role === 'authenticated' ? owner : '']);
  await db.exec(`set role ${role}`);
}

async function ingest(db, rows) {
  await claims(db, 'service_role');
  try {
    return (await db.query(
      'select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb) value',
      [credential, JSON.stringify(rows)],
    )).rows[0].value;
  } finally { await db.exec('reset role'); }
}

async function ticket(db, sessionId) {
  return (await db.query(
    `select * from sellerpilot_private.support_tickets where external_ticket_id=$1`,
    [`lazada-im:${sessionId}`],
  )).rows[0];
}

function loadConversationRoute(db) {
  const projectionAwareContractSource = conversationContractSource;
  assert.notEqual(projectionAwareContractSource.includes('messageState: z.enum('), false);
  const createClient = (_url, key, options = {}) => {
    const authorization = options.global?.headers?.Authorization ?? '';
    const userId = authorization === 'Bearer valid-admin' ? owner : null;
    if (key === 'fixture-secret') return { rpc: async () => { throw new Error('GET must not use service client'); } };
    return {
      auth: { getUser: async () => userId
        ? { data: { user: { id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-08T00:00:00Z' } }, error: null }
        : { data: { user: null }, error: { status: 401 } } },
      rpc: async (name, args = {}) => {
        try {
          if (!userId) return { data: null, error: { status: 401 }, status: 401 };
          await claims(db, 'authenticated');
          if (name === 'sellerpilot_is_admin') {
            const result = await db.query('select public.sellerpilot_is_admin() value');
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          if (name === 'sellerpilot_get_cs_conversation') {
            const result = await db.query(
              'select public.sellerpilot_get_cs_conversation($1,$2,$3,$4,$5) value',
              [args.p_ticket_id,args.p_limit,args.p_before_time,args.p_before_key,args.p_as_of],
            );
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          throw new Error(`unexpected rpc ${name}`);
        } catch (error) {
          return { data: null, error: { message: error instanceof Error ? error.message : 'db failure' }, status: 400 };
        } finally { await db.exec('reset role'); }
      },
    };
  };
  const adminApi = evaluateTypeScript(adminSource, (name) => {
    if (name === '@supabase/supabase-js') return { createClient };
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/supabase/config')) return { supabaseUrl: 'https://fixture.test', supabasePublishableKey: 'fixture' };
    throw new Error(`unexpected admin import ${name}`);
  }, { process: { env: { SUPABASE_SECRET_KEY: 'fixture-secret' } } });
  const contract = evaluateTypeScript(projectionAwareContractSource, (name) => {
    if (name === 'zod') return requireFromHere('zod');
    throw new Error(`unexpected contract import ${name}`);
  });
  return evaluateTypeScript(conversationRouteSource, (name) => {
    if (name === 'next/server') return { NextResponse: Response };
    if (name === 'zod') return requireFromHere('zod');
    if (name.endsWith('/admin-api')) return adminApi;
    if (name.endsWith('/cs/conversation')) return contract;
    throw new Error(`unexpected route import ${name}`);
  });
}

async function conversationGet(route, ticketId) {
  return route.GET(new Request(`https://fixture.test/api/admin/cs/tickets/${ticketId}/messages`, {
    headers: { authorization: 'Bearer valid-admin' },
  }), { params: Promise.resolve({ id: ticketId }) });
}

test('production normalizer -> actual V3 ingest -> canonical 008 GET converges recall order, conflict, and replay', async () => {
  const db = await fixture();
  try {
    const afterOriginal = normalize('recall-after', historyRow('same-after', 'recall after secret', 0, '2026-09-08T10:01:00Z'));
    const afterRecall = normalize('recall-after', historyRow('same-after', 'recall after secret', 1, '2026-09-08T10:01:00Z'));
    assert.equal((await ingest(db, afterOriginal)).status, 'complete');
    assert.equal((await ingest(db, afterRecall)).recallCount, 1);

    const beforeRecall = normalize('recall-before', historyRow('same-before', 'recall before secret', 1, '2026-09-08T10:02:00Z'));
    const beforeOriginal = normalize('recall-before', historyRow('same-before', 'recall before secret', 0, '2026-09-08T10:02:00Z'));
    assert.equal((await ingest(db, beforeRecall)).status, 'partial');
    assert.equal((await ingest(db, beforeOriginal)).status, 'complete');

    const conflictOriginal = normalize('conflict', historyRow('same-conflict', 'accepted original', 0, '2026-09-08T10:03:00Z'));
    const conflictChanged = normalize('conflict', historyRow('same-conflict', 'changed body', 0, '2026-09-08T10:03:00Z'));
    assert.equal((await ingest(db, conflictOriginal)).status, 'complete');
    assert.equal((await ingest(db, conflictChanged)).status, 'partial');

    const replay = normalize('replay', historyRow('same-replay', 'normal replay body', 0, '2026-09-08T10:04:00Z'));
    assert.equal((await ingest(db, replay)).status, 'complete');
    const replayCounts = (await db.query(`select
      (select count(*)::int from sellerpilot_private.support_inbound_messages where remote_message_id='same-replay') messages,
      (select count(*)::int from sellerpilot_private.lazada_im_message_revisions where remote_message_id='same-replay') revisions`)).rows[0];
    assert.equal((await ingest(db, replay)).status, 'complete');
    assert.deepEqual((await db.query(`select
      (select count(*)::int from sellerpilot_private.support_inbound_messages where remote_message_id='same-replay') messages,
      (select count(*)::int from sellerpilot_private.lazada_im_message_revisions where remote_message_id='same-replay') revisions`)).rows[0], replayCounts);

    await db.exec(`update sellerpilot_private.support_tickets set
      translated_message='translated retained body',reply_draft='saved stale draft'`);
    const route = loadConversationRoute(db);
    for (const sessionId of ['recall-after','recall-before']) {
      const row = await ticket(db, sessionId);
      const response = await conversationGet(route, row.id);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.messages[0].messageState, 'recalled');
      assert.equal(page.messages[0].body, 'Lazada 메시지가 회수되었습니다.');
      assert.doesNotMatch(JSON.stringify(page), /recall (?:after|before) secret/);
    }
    const conflictRow = await ticket(db, 'conflict');
    const conflictPage = await (await conversationGet(route, conflictRow.id)).json();
    assert.equal(conflictPage.messages[0].messageState, 'conflict_review_required');
    assert.equal(conflictPage.messages[0].body, 'accepted original');
    assert.doesNotMatch(JSON.stringify(conflictPage), /changed body/);
    const replayRow = await ticket(db, 'replay');
    const replayPage = await (await conversationGet(route, replayRow.id)).json();
    assert.equal(replayPage.messages[0].messageState, 'normal');
    assert.equal(replayPage.messages[0].body, 'normal replay body');
    assert.match(projection.sql, /lazada_im_projection_state_v1/);
    assert.ok(['canonical-migration','integration-canonical-migration','frozen-008-proposal-fallback'].includes(projection.source));
  } finally { await db.close(); }
});

test('009 ordinary workspace masks recalled previews and atomically blocks saved draft, AI draft, and reply enqueue', async () => {
  const db = await fixture();
  try {
    const original = normalize('recalled', historyRow('recalled-id', 'retained original secret', 0));
    await ingest(db, original);
    await ingest(db, normalize('recalled', historyRow('recalled-id', 'retained original secret', 1)));
    const normal = normalize('normal', historyRow('normal-id', 'normal actionable body', 0, '2026-09-08T10:01:00Z'));
    await ingest(db, normal);
    await ingest(db, normalize('conflict', historyRow('conflict-id', 'accepted conflict body', 0, '2026-09-08T10:02:00Z')));
    assert.equal((await ingest(db, normalize('conflict', historyRow('conflict-id', 'changed conflict body', 0, '2026-09-08T10:02:00Z')))).status, 'partial');
    await db.exec(`update sellerpilot_private.support_tickets set
      translated_message='translated retained body',reply_draft='saved stale draft'`);
    const recalled = await ticket(db, 'recalled');
    const actionable = await ticket(db, 'normal');
    const conflicted = await ticket(db, 'conflict');

    await claims(db, 'authenticated');
    const workspace = (await db.query('select public.sellerpilot_get_cs_workspace_snapshot() value')).rows[0].value;
    const recalledCard = workspace.tickets.find((row) => row.ticketId === recalled.id);
    const normalCard = workspace.tickets.find((row) => row.ticketId === actionable.id);
    const conflictCard = workspace.tickets.find((row) => row.ticketId === conflicted.id);
    assert.deepEqual({
      message: recalledCard.message,
      translatedMessage: recalledCard.translatedMessage,
      replyDraft: recalledCard.replyDraft,
      latestMessageState: recalledCard.latestMessageState,
      replyAllowed: recalledCard.replyAllowed,
    }, {
      message: 'Lazada 메시지가 회수되었습니다.', translatedMessage: null, replyDraft: null,
      latestMessageState: 'recalled', replyAllowed: false,
    });
    assert.equal(JSON.stringify(recalledCard).includes('retained original secret'), false);
    assert.equal(JSON.stringify(recalledCard).includes('saved stale draft'), false);
    assert.equal(normalCard.message, 'normal actionable body');
    assert.equal(normalCard.replyDraft, 'saved stale draft');
    assert.equal(normalCard.latestMessageState, 'normal');
    assert.equal(normalCard.replyAllowed, true);
    assert.equal(conflictCard.message, 'accepted conflict body');
    assert.equal(conflictCard.translatedMessage, null);
    assert.equal(conflictCard.replyDraft, null);
    assert.equal(conflictCard.latestMessageState, 'conflict_review_required');
    assert.equal(conflictCard.replyAllowed, false);
    assert.doesNotMatch(JSON.stringify(conflictCard), /changed conflict body|saved stale draft/);

    const context = (await db.query('select public.sellerpilot_get_ticket_reply_context_v2($1) value', [recalled.id])).rows[0].value;
    assert.equal(context.latest_message_state, 'recalled');
    assert.equal(context.reply_allowed, false);
    await assert.rejects(db.query(`select public.sellerpilot_create_support_reply_job(
      gen_random_uuid(),$1,$2,'ko-KR','polite')`, [recalled.id,recalled.latest_inbound_key]),
    /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    await assert.rejects(db.query(`select public.sellerpilot_create_support_reply_job(
      gen_random_uuid(),$1,$2,'ko-KR','polite')`, [conflicted.id,conflicted.latest_inbound_key]),
    /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    await assert.rejects(db.query(`select public.sellerpilot_update_ticket(
      $1,'waiting','new unsafe draft',$2)`, [recalled.id,recalled.latest_inbound_key]),
    /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    assert.equal((await db.query(`select public.sellerpilot_update_ticket(
      $1,'waiting',null,$2) value`, [recalled.id,recalled.latest_inbound_key])).rows[0].value, true);
    const aiJob = '00000000-0000-4000-8000-000000000909';
    assert.equal((await db.query(`select public.sellerpilot_create_support_reply_job(
      $1,$2,$3,'ko-KR','polite') value`, [aiJob,actionable.id,actionable.latest_inbound_key])).rows[0].value, aiJob);
    await db.exec('reset role');
    const payload = (await db.query('select request_payload from sellerpilot_private.ai_cli_jobs where id=$1',[aiJob])).rows[0].request_payload;
    assert.equal(payload.message, 'normal actionable body');
    assert.doesNotMatch(JSON.stringify(payload), /retained original secret/);

    await claims(db, 'service_role');
    await assert.rejects(db.query(`select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      $1,'lazada','must not send',jsonb_build_object('sellerpilotExpectedInboundKey',$2::text))`,
    [recalled.id,recalled.latest_inbound_key]), /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    await assert.rejects(db.query(`select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      $1,'lazada','must not send conflict',jsonb_build_object('sellerpilotExpectedInboundKey',$2::text))`,
    [conflicted.id,conflicted.latest_inbound_key]), /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    const queued = (await db.query(`select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      $1,'lazada','safe synthetic reply',jsonb_build_object('sellerpilotExpectedInboundKey',$2::text)) value`,
    [actionable.id,actionable.latest_inbound_key])).rows[0].value;
    assert.match(queued, /^[0-9a-f-]{36}$/);
    await db.exec('reset role');
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.channel_gateway_jobs
      where operation='inquiries.reply'`)).rows[0].n, 1);
    for (const role of ['anon','authenticated','service_role']) {
      const acl = (await db.query(`select
        has_function_privilege($1,'sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz)','EXECUTE') private_state,
        has_function_privilege($1,'public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()','EXECUTE') unsafe_workspace,
        has_function_privilege($1,'public.sellerpilot_get_cs_workspace_snapshot()','EXECUTE') workspace,
        has_function_privilege($1,'public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)','EXECUTE') ai_draft,
        has_function_privilege($1,'public.sellerpilot_enqueue_inquiry_reply_gateway_job(uuid,text,text,jsonb)','EXECUTE') enqueue`,
      [role])).rows[0];
      assert.equal(acl.private_state, false);
      assert.equal(acl.unsafe_workspace, false);
      assert.equal(acl.workspace, role === 'authenticated');
      assert.equal(acl.ai_draft, role === 'authenticated');
      assert.equal(acl.enqueue, role === 'service_role');
    }
  } finally { await db.close(); }
});

test('009 integrated shared source wires list/search, local review checks, API feedback, and gateway mapping', () => {
  assert.match(sharedSources, /latestMessageState\?: "normal" \| "recalled" \| "conflict_review_required"/);
  assert.match(sharedSources, /selected\.latestMessageState === "normal"/);
  assert.match(sharedSources, /currentTicket\.latestInboundKey !== ticket\.latestInboundKey/);
  assert.match(sharedSources, /StatusBadge status="메시지 회수"/);
  assert.match(sharedSources, /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
  assert.match(sharedSources, /CHANNEL_GATEWAY_REPLY_MESSAGE_NOT_ACTIONABLE/);
});

test('actual 008/009, dedicated draft queue, and 010 keep shared-admin recall and non-Lazada queue behavior', async () => {
  const db = await currentQueueFixture();
  const sharedAdmin = '00000000-0000-4000-8000-000000000911';
  const aiHash = '9'.repeat(64);
  try {
    assert.equal((await ingest(db, normalize('actual-queue-recall', historyRow(
      'actual-queue-message', 'actual dedicated queue secret', 0,
    )))).status, 'complete');
    const lazadaTicket = await ticket(db, 'actual-queue-recall');
    await db.query('insert into auth.users values($1)', [sharedAdmin]);
    await db.query('insert into sellerpilot_private.admin_users values($1)', [sharedAdmin]);
    const secondCredential = '00000000-0000-4000-8000-000000000915';
    const secondSeller = '8'.repeat(64);
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,created_by,channel,status,expires_at,seller_account_key,seller_account_key_source,
      seller_account_verified_at,environment
    ) values($1,$2,'lazada','active',clock_timestamp()+interval '30 days',$3,
      'provider_certified_v1',clock_timestamp(),'production')`,
    [secondCredential, sharedAdmin, secondSeller]);
    const secondTicket = '00000000-0000-4000-8000-000000000916';
    await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
      priority,received_at,demo,updated_at,source_credential_id,seller_account_key,latest_inbound_key
    ) values($1,$2,'lazada-im:actual-account-two','lazada','Synthetic buyer','Account two',
      'account two body','waiting',3,clock_timestamp(),false,clock_timestamp(),$3,$4,'account-two-inbound')`,
    [secondTicket, sharedAdmin, secondCredential, secondSeller]);
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
      provider_context,received_at
    ) values($1,$2,'lazada','account-two-inbound','account-two-message','customer','account two body',
      jsonb_build_object('nativeContentFingerprint',$3::text),clock_timestamp())`,
    [secondTicket, sharedAdmin, '7'.repeat(64)]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
    await db.exec('set role authenticated');
    const secondDraft = '00000000-0000-4000-8000-000000000917';
    assert.equal((await db.query(`select public.sellerpilot_create_cs_reply_draft(
      $1,$2,'account-two-inbound','ko-KR','polite')::text id`, [secondDraft, secondTicket])).rows[0].id, secondDraft);
    assert.equal((await db.query('select public.sellerpilot_cancel_cs_reply_draft($1) cancelled', [secondDraft])).rows[0].cancelled, true);
    for (const [invalidTicket, invalidOwner, invalidSeller] of [
      ['00000000-0000-4000-8000-000000000918', owner, secondSeller],
      ['00000000-0000-4000-8000-000000000919', sharedAdmin, seller],
    ]) {
      const inboundKey = `invalid-${invalidTicket.slice(-3)}`;
      await db.exec('reset role');
      await db.query(`insert into sellerpilot_private.support_tickets(
        id,owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
        priority,received_at,demo,updated_at,source_credential_id,seller_account_key,latest_inbound_key
      ) values($1,$2,$3,'lazada','Synthetic buyer','Invalid lineage','invalid body','waiting',
        3,clock_timestamp(),false,clock_timestamp(),$4,$5,$6)`,
      [invalidTicket, invalidOwner, `lazada-im:${inboundKey}`, secondCredential, invalidSeller, inboundKey]);
      await db.query(`insert into sellerpilot_private.support_inbound_messages(
        ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
        provider_context,received_at
      ) values($1,$2,'lazada',$3,$4,'customer','invalid body',
        jsonb_build_object('nativeContentFingerprint',$5::text),clock_timestamp())`,
      [invalidTicket, invalidOwner, inboundKey, `${inboundKey}-message`, '6'.repeat(64)]);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
      await db.exec('set role authenticated');
      await assert.rejects(db.query(`select public.sellerpilot_create_cs_reply_draft(
        gen_random_uuid(),$1,$2,'ko-KR','polite')`, [invalidTicket, inboundKey]), /LAZADA_IM_REPLY_LINEAGE_UNBOUND/);
    }
    const recalledDraftId = '00000000-0000-4000-8000-000000000912';
    assert.equal((await db.query(`select public.sellerpilot_create_cs_reply_draft(
      $1,$2,$3,'ko-KR','polite')::text id`,
    [recalledDraftId, lazadaTicket.id, lazadaTicket.latest_inbound_key])).rows[0].id, recalledDraftId);
    await db.exec('reset role');
    await db.exec('set role service_role');
    const claimed = (await db.query('select public.sellerpilot_claim_cs_reply_draft($1) claim', [aiHash])).rows[0].claim;
    await db.exec('reset role');
    assert.equal(claimed.id, recalledDraftId);
    assert.equal(claimed.request.message, 'actual dedicated queue secret');

    assert.equal((await ingest(db, normalize('actual-queue-recall', historyRow(
      'actual-queue-message', 'actual dedicated queue secret', 1,
    )))).status, 'complete');
    await db.exec('set role service_role');
    const completion = (await db.query(`select public.sellerpilot_complete_cs_reply_draft(
      $1,$2,$3,'succeeded',$4::jsonb,null) result`, [aiHash, recalledDraftId,
      claimed.claim_token, JSON.stringify({ mode: 'support-reply', targetLocale: 'ko-KR', draft: 'must never be retained' })])).rows[0].result;
    await db.exec('reset role');
    assert.equal(completion, 'lease_lost');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
    await db.exec('set role authenticated');
    const recalledRead = (await db.query('select public.sellerpilot_get_cs_reply_draft($1) value', [recalledDraftId])).rows[0].value;
    await db.exec('reset role');
    assert.equal(recalledRead.status, 'failed');
    assert.equal(recalledRead.result, null);
    assert.doesNotMatch(JSON.stringify(recalledRead), /actual dedicated queue secret|must never be retained/);

    const smartstoreTicket = '00000000-0000-4000-8000-000000000913';
    await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
      priority,received_at,demo,updated_at,latest_inbound_key
    ) values($1,$2,'smartstore:actual-queue','smartstore','Synthetic buyer','Normal queue',
      'normal non-Lazada body','waiting',3,clock_timestamp(),false,clock_timestamp(),'smartstore-inbound')`,
    [smartstoreTicket, owner]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
    await db.exec('set role authenticated');
    const normalDraftId = '00000000-0000-4000-8000-000000000914';
    await db.query(`select public.sellerpilot_create_cs_reply_draft(
      $1,$2,'smartstore-inbound','ko-KR','polite')`, [normalDraftId, smartstoreTicket]);
    await db.exec('reset role');
    await db.exec('set role service_role');
    const normalClaim = (await db.query('select public.sellerpilot_claim_cs_reply_draft($1) claim', [aiHash])).rows[0].claim;
    assert.equal(normalClaim.id, normalDraftId);
    assert.equal((await db.query(`select public.sellerpilot_complete_cs_reply_draft(
      $1,$2,$3,'succeeded',$4::jsonb,null) result`, [aiHash, normalDraftId,
      normalClaim.claim_token, JSON.stringify({ mode: 'support-reply', targetLocale: 'ko-KR', draft: 'normal safe draft' })])).rows[0].result, 'completed');
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sharedAdmin]);
    await db.exec('set role authenticated');
    const normalRead = (await db.query('select public.sellerpilot_get_cs_reply_draft($1) value', [normalDraftId])).rows[0].value;
    await db.exec('reset role');
    assert.equal(normalRead.status, 'succeeded');
    assert.equal(normalRead.result.draft, 'normal safe draft');
  } finally { await db.close(); }
});

test('known unresolved 009 cutoff defect: recall observed after statement start can pass the enqueue gate', async () => {
  const db = await fixture();
  try {
    await ingest(db, normalize('cutoff-probe', historyRow('cutoff-id', 'synthetic retained body')));
    const current = await ticket(db, 'cutoff-probe');
    await db.exec(`create function pg_temp.observe_then_enqueue(p_credential uuid,p_rows jsonb,p_ticket uuid)
      returns uuid language plpgsql as $$
      begin
        perform pg_sleep(0.01);
        perform public.sellerpilot_service_ingest_lazada_inquiries_v3(p_credential,p_rows);
        return public.sellerpilot_enqueue_inquiry_reply_gateway_job(
          p_ticket,'lazada','synthetic reply','{}'::jsonb);
      end $$`);
    const result = await db.query('select pg_temp.observe_then_enqueue($1,$2::jsonb,$3) job_id', [
      credential,
      JSON.stringify(normalize('cutoff-probe', historyRow('cutoff-id', 'synthetic retained body', 1))),
      current.id,
    ]);
    assert.ok(result.rows[0].job_id, 'Defect probe expects the currently unsafe enqueue; this is not a release pass.');
    const state = await db.query(`select sellerpilot_private.lazada_im_ticket_projection_state_v1(
      $1,clock_timestamp()) state`, [current.id]);
    assert.equal(state.rows[0].state, 'recalled');
  } finally { await db.close(); }
});
