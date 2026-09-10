import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const requireFromHere = createRequire(import.meta.url);
const [adminSource, conversationRouteSource, archiveRouteSource, conversationContractSource,
  archiveContractSource, conversationUiSource, archiveUiSource, baseReadSql, proposalSql,
  proposalPatch] = await Promise.all([
  readFile(new URL('../lib/admin-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/admin/cs/tickets/[id]/messages/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/admin/cs/archive/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/cs/conversation.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/cs/archive.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/cs/conversation-timeline.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/cs/archive.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260907220000_complete_cs_archive_scope_and_media.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260908145831_cs_lazada_v3_conversation_projection.sql', import.meta.url), 'utf8'),
  readFile(new URL('../docs/cs-parallel/proposals/lazada/lazada-008-v3-conversation-projection.patch', import.meta.url), 'utf8'),
]);

const owner = '00000000-0000-4000-8000-000000000801';
const otherOwner = '00000000-0000-4000-8000-000000000802';
const credential = '00000000-0000-4000-8000-000000000803';
const otherCredential = '00000000-0000-4000-8000-000000000804';
const recalledTicket = '00000000-0000-4000-8000-000000000805';
const conflictTicket = '00000000-0000-4000-8000-000000000806';
const normalTicket = '00000000-0000-4000-8000-000000000807';
const otherChannelTicket = '00000000-0000-4000-8000-000000000808';
const seller = 'a'.repeat(64);
const otherSeller = 'b'.repeat(64);
const app = 'c'.repeat(64);
const token = 'd'.repeat(64);
const emptyAttachment = 'e'.repeat(64);
const recalledBeforeFingerprint = '1'.repeat(64);
const recalledAfterFingerprint = '2'.repeat(64);
const conflictOriginalFingerprint = '3'.repeat(64);
const conflictChangedFingerprint = '4'.repeat(64);
const normalFingerprint = '5'.repeat(64);
const unknownFingerprint = '6'.repeat(64);

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

function integratedContracts() {
  assert.match(conversationContractSource, /messageState: z\.enum/);
  assert.match(archiveContractSource, /latestMessageState:z\.enum/);
  return { conversation: conversationContractSource, archive: archiveContractSource };
}

function loadContract(source, catalog = false) {
  return evaluateTypeScript(source, (name) => {
    if (name === 'zod') return requireFromHere('zod');
    if (catalog && name.endsWith('/channels/catalog')) {
      return { activeChannelKeys: ['qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'temu'] };
    }
    throw new Error(`unexpected contract module ${name}`);
  });
}

async function fixture({ applyProposal }) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table sellerpilot_private.support_tickets(
      id uuid primary key, owner_id uuid not null, channel_key text not null,
      external_ticket_id text not null, customer_name text not null, subject text not null,
      message text not null, status text not null, received_at timestamptz not null,
      updated_at timestamptz not null, demo boolean not null default false,
      source_credential_id uuid, seller_account_key text, reply_context jsonb not null default '{}',
      provider_context jsonb not null default '{}', ticket_kind text not null default 'conversation',
      latest_inbound_key text
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null, owner_id uuid not null,
      channel_key text not null, inbound_key text not null, remote_message_id text,
      sender_role text not null, body text not null, provider_context jsonb not null default '{}',
      received_at timestamptz not null, created_at timestamptz not null, updated_at timestamptz not null
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(), ticket_id uuid not null, owner_id uuid not null,
      channel_key text not null, status text not null, queued_at timestamptz not null,
      created_at timestamptz not null, gateway_job_id uuid, provider_message_id text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, channel text not null, operation text not null, request_payload jsonb not null
    );
    create table sellerpilot_private.lazada_im_message_revisions(
      id bigint generated always as identity primary key, owner_id uuid not null, credential_id uuid not null,
      seller_account_key text not null, external_ticket_id text not null, remote_message_id text not null,
      revision_kind text not null, sender_role text not null, native_content_fingerprint text not null,
      body_fingerprint text not null, attachment_fingerprint text not null, app_fingerprint text not null,
      token_fingerprint text not null, country text not null, provider_context jsonb not null default '{}',
      first_observed_at timestamptz not null,
      unique(owner_id,seller_account_key,external_ticket_id,remote_message_id,revision_kind,native_content_fingerprint)
    );
    insert into sellerpilot_private.admin_users values('${owner}');
  `);
  await db.exec(baseReadSql);
  if (applyProposal) await db.exec(proposalSql);
  return db;
}

async function seed(db) {
  await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,channel_key,external_ticket_id,customer_name,subject,message,status,
      received_at,updated_at,source_credential_id,seller_account_key,latest_inbound_key
    ) values
      ($1,$4,'lazada','lazada-im:recalled','Synthetic buyer','Recalled','archive pre-recall secret','waiting','2026-09-08T10:01:00Z','2026-09-08T10:05:00Z',$5,$6,'recall-after-key'),
      ($2,$4,'lazada','lazada-im:conflict','Synthetic buyer','Conflict','first accepted body','waiting','2026-09-08T10:02:00Z','2026-09-08T10:05:00Z',$5,$6,'conflict-key'),
      ($3,$4,'lazada','lazada-im:normal','Synthetic buyer','Normal','normal body','waiting','2026-09-08T10:03:00Z','2026-09-08T10:05:00Z',$5,$6,'normal-key'),
      ($7,$4,'smartstore','smartstore:normal','Synthetic buyer','Other channel','other channel body','waiting','2026-09-08T10:04:00Z','2026-09-08T10:05:00Z',null,null,'other-channel-key')`,
  [recalledTicket, conflictTicket, normalTicket, owner, credential, seller, otherChannelTicket]);
  await db.query(`insert into sellerpilot_private.support_inbound_messages(
      ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,
      provider_context,received_at,created_at,updated_at
    ) values
      ($1,$4,'lazada','recall-before-key','recall-before','customer','recall-before original',$5,'2026-09-08T10:00:00Z','2026-09-08T10:04:00Z','2026-09-08T10:04:00Z'),
      ($1,$4,'lazada','recall-after-key','recall-after','customer','archive pre-recall secret',$6,'2026-09-08T10:01:00Z','2026-09-08T10:01:00Z','2026-09-08T10:04:00Z'),
      ($2,$4,'lazada','conflict-key','edit-1','customer','first accepted body',$7,'2026-09-08T10:02:00Z','2026-09-08T10:02:00Z','2026-09-08T10:02:00Z'),
      ($3,$4,'lazada','normal-key','normal-1','customer','normal body',$8,'2026-09-08T10:03:00Z','2026-09-08T10:03:00Z','2026-09-08T10:03:00Z'),
      ($9,$4,'smartstore','other-channel-key','other-channel-1','customer','other channel body','{}','2026-09-08T10:04:00Z','2026-09-08T10:04:00Z','2026-09-08T10:04:00Z')`, [
    recalledTicket, conflictTicket, normalTicket, owner,
    { nativeContentFingerprint: recalledBeforeFingerprint, nativeMedia: { imageUrl: 'https://example.test/recall-before.jpg' } },
    { nativeContentFingerprint: recalledAfterFingerprint, nativeMedia: { fileUrl: 'https://example.test/recall-after.pdf' } },
    { nativeContentFingerprint: conflictOriginalFingerprint },
    { nativeContentFingerprint: normalFingerprint }, otherChannelTicket,
  ]);
  const revisions = [
    [credential, seller, 'lazada-im:recalled', 'recall-before', 'recalled', recalledBeforeFingerprint,
      { eventKind: 'recalled', recallTargetMessageId: 'recall-before' }, '2026-09-08T09:59:00Z'],
    [credential, seller, 'lazada-im:recalled', 'recall-before', 'message', recalledBeforeFingerprint,
      { eventKind: 'message' }, '2026-09-08T10:04:00Z'],
    [credential, seller, 'lazada-im:recalled', 'recall-after', 'message', recalledAfterFingerprint,
      { eventKind: 'message' }, '2026-09-08T10:01:00Z'],
    [credential, seller, 'lazada-im:recalled', 'recall-after', 'recalled', recalledAfterFingerprint,
      { eventKind: 'recalled', recallTargetMessageId: 'recall-after' }, '2026-09-08T10:04:00Z'],
    [credential, seller, 'lazada-im:conflict', 'edit-1', 'message', conflictOriginalFingerprint,
      { eventKind: 'message' }, '2026-09-08T10:02:00Z'],
    [credential, seller, 'lazada-im:conflict', 'edit-1', 'conflict', conflictChangedFingerprint,
      { eventKind: 'message', projectionConflict: true }, '2026-09-08T10:05:00Z'],
    [credential, seller, 'lazada-im:recalled', 'unknown-order', 'message', unknownFingerprint,
      { eventKind: 'status_unverified' }, '2026-09-08T10:05:00Z'],
    [otherCredential, seller, 'lazada-im:normal', 'normal-1', 'recalled', normalFingerprint,
      { eventKind: 'recalled', recallTargetMessageId: 'normal-1' }, '2026-09-08T10:05:00Z'],
    [credential, otherSeller, 'lazada-im:normal', 'normal-1', 'recalled', normalFingerprint,
      { eventKind: 'recalled', recallTargetMessageId: 'normal-1' }, '2026-09-08T10:05:00Z'],
  ];
  for (const [credentialId, account, externalId, remoteId, kind, fingerprint, context, observed] of revisions) {
    await db.query(`insert into sellerpilot_private.lazada_im_message_revisions(
      owner_id,credential_id,seller_account_key,external_ticket_id,remote_message_id,
      revision_kind,sender_role,native_content_fingerprint,body_fingerprint,
      attachment_fingerprint,app_fingerprint,token_fingerprint,country,provider_context,first_observed_at
    ) values($1,$2,$3,$4,$5,$6,'customer',$7,$7,$8,$9,$10,'MY',$11,$12) on conflict do nothing`,
    [owner, credentialId, account, externalId, remoteId, kind, fingerprint, emptyAttachment, app, token, context, observed]);
  }
}

async function asAuthenticated(db, userId, sql, parameters = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec('set role authenticated');
  try { return await db.query(sql, parameters); }
  finally { await db.exec('reset role'); }
}

function createSupabaseFactory(db, rpcCalls) {
  return (_url, key, options = {}) => {
    const authorization = options.global?.headers?.Authorization ?? '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const userId = bearer === 'valid-admin' ? owner : bearer === 'valid-other' ? otherOwner : null;
    if (key === 'fixture-secret') return { rpc: async () => { throw new Error('GET must not use service client'); } };
    return {
      auth: { getUser: async () => userId
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
          if (name === 'sellerpilot_get_cs_conversation') {
            const result = await asAuthenticated(db, userId,
              'select public.sellerpilot_get_cs_conversation($1,$2,$3,$4,$5) value',
              [args.p_ticket_id, args.p_limit, args.p_before_time, args.p_before_key, args.p_as_of]);
            return { data: result.rows[0].value, error: null, status: 200 };
          }
          if (name === 'sellerpilot_search_cs_archive_v2') {
            const result = await asAuthenticated(db, userId,
              'select public.sellerpilot_search_cs_archive_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
              [args.p_query, args.p_channel, args.p_status, args.p_from_date, args.p_to_date,
                args.p_account_id, args.p_shop_id, args.p_ticket_kind, args.p_source, args.p_limit,
                args.p_before_time, args.p_before_id, args.p_as_of]);
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

function loadRoutes(db, rpcCalls, contractSources) {
  const createClient = createSupabaseFactory(db, rpcCalls);
  const adminApi = evaluateTypeScript(adminSource, (name) => {
    if (name === '@supabase/supabase-js') return { createClient };
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/supabase/config')) return { supabaseUrl: 'https://fixture.supabase.test', supabasePublishableKey: 'fixture-publishable' };
    throw new Error(`unexpected admin module ${name}`);
  }, { process: { env: { SUPABASE_SECRET_KEY: 'fixture-secret' } } });
  const conversationContract = loadContract(contractSources.conversation);
  const archiveContract = loadContract(contractSources.archive, true);
  const conversation = evaluateTypeScript(conversationRouteSource, (name) => {
    if (name === 'next/server') return { NextResponse: Response };
    if (name === 'zod') return requireFromHere('zod');
    if (name.endsWith('/admin-api')) return adminApi;
    if (name.endsWith('/cs/conversation')) return conversationContract;
    throw new Error(`unexpected conversation route module ${name}`);
  });
  const archive = evaluateTypeScript(archiveRouteSource, (name) => {
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/admin-api')) return adminApi;
    if (name.endsWith('/cs/archive')) return archiveContract;
    throw new Error(`unexpected archive route module ${name}`);
  });
  return { conversation, archive };
}

async function conversationGet(route, ticketId, token = 'valid-admin') {
  return route.GET(new Request(`https://fixture.test/api/admin/cs/tickets/${ticketId}/messages`, {
    headers: { authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ id: ticketId }) });
}

test('current actual conversation/archive GETs reproduce pre-recall body and preview exposure before the proposal', async () => {
  const db = await fixture({ applyProposal: false });
  try {
    await seed(db);
    const rpcCalls = [];
    const routes = loadRoutes(db, rpcCalls, { conversation: conversationContractSource, archive: archiveContractSource });
    const conversationResponse = await conversationGet(routes.conversation, recalledTicket);
    assert.equal(conversationResponse.status, 200);
    const conversationPage = await conversationResponse.json();
    assert.ok(conversationPage.messages.some((message) => message.body === 'archive pre-recall secret'));
    const archiveResponse = await routes.archive.GET(new Request('https://fixture.test/api/admin/cs/archive?channel=lazada', {
      headers: { authorization: 'Bearer valid-admin' },
    }));
    assert.equal(archiveResponse.status, 200);
    const archivePage = await archiveResponse.json();
    assert.equal(archivePage.tickets.find((ticket) => ticket.id === recalledTicket).preview, 'archive pre-recall secret');
    assert.ok(rpcCalls.some((call) => call.name === 'sellerpilot_get_cs_conversation'));
    assert.ok(rpcCalls.some((call) => call.name === 'sellerpilot_search_cs_archive_v2'));
  } finally { await db.close(); }
});

test('canonical PGlite to actual GET path masks evidence-backed recalls and labels conflicts without latest inference', async () => {
  const db = await fixture({ applyProposal: true });
  try {
    await seed(db);
    const beforeReplay = (await db.query('select count(*)::int n from sellerpilot_private.lazada_im_message_revisions')).rows[0].n;
    await db.query(`insert into sellerpilot_private.lazada_im_message_revisions(
      owner_id,credential_id,seller_account_key,external_ticket_id,remote_message_id,
      revision_kind,sender_role,native_content_fingerprint,body_fingerprint,
      attachment_fingerprint,app_fingerprint,token_fingerprint,country,provider_context,first_observed_at
    ) values($1,$2,$3,'lazada-im:recalled','recall-after','recalled','customer',$4,$4,$5,$6,$7,'MY',$8,'2026-09-08T10:04:00Z') on conflict do nothing`,
    [owner, credential, seller, recalledAfterFingerprint, emptyAttachment, app, token,
      { eventKind: 'recalled', recallTargetMessageId: 'recall-after' }]);
    assert.equal((await db.query('select count(*)::int n from sellerpilot_private.lazada_im_message_revisions')).rows[0].n, beforeReplay);

    const rpcCalls = [];
    const routes = loadRoutes(db, rpcCalls, integratedContracts());
    const recalledResponse = await conversationGet(routes.conversation, recalledTicket);
    assert.equal(recalledResponse.status, 200);
    assert.match(recalledResponse.headers.get('cache-control') ?? '', /private, no-store/);
    const recalledPage = await recalledResponse.json();
    assert.equal(recalledPage.messages.length, 2);
    assert.ok(recalledPage.messages.every((message) => message.messageState === 'recalled'));
    assert.ok(recalledPage.messages.every((message) => message.body === 'Lazada 메시지가 회수되었습니다.'));
    assert.ok(recalledPage.messages.every((message) => message.nativeMedia === null));
    assert.equal(JSON.stringify(recalledPage).includes('pre-recall secret'), false);
    assert.equal(JSON.stringify(recalledPage).includes('recall-before original'), false);
    assert.equal(recalledPage.messages.find((message) => message.remoteMessageId === 'recall-before').messageState, 'recalled');

    const conflictPage = await (await conversationGet(routes.conversation, conflictTicket)).json();
    assert.equal(conflictPage.messages[0].body, 'first accepted body');
    assert.equal(conflictPage.messages[0].messageState, 'conflict_review_required');
    assert.equal(conflictPage.messages.some((message) => message.body === 'changed body'), false);

    const normalPage = await (await conversationGet(routes.conversation, normalTicket)).json();
    assert.equal(normalPage.messages[0].body, 'normal body');
    assert.equal(normalPage.messages[0].messageState, 'normal');
    assert.equal(normalPage.messages.some((message) => message.remoteMessageId === 'unknown-order'), false);
    const otherChannelPage = await (await conversationGet(routes.conversation, otherChannelTicket)).json();
    assert.equal(otherChannelPage.messages[0].body, 'other channel body');
    assert.equal(otherChannelPage.messages[0].messageState, 'normal');

    const archiveResponse = await routes.archive.GET(new Request('https://fixture.test/api/admin/cs/archive?channel=lazada', {
      headers: { authorization: 'Bearer valid-admin' },
    }));
    assert.equal(archiveResponse.status, 200);
    const archivePage = await archiveResponse.json();
    const recalled = archivePage.tickets.find((ticket) => ticket.id === recalledTicket);
    const conflict = archivePage.tickets.find((ticket) => ticket.id === conflictTicket);
    const normal = archivePage.tickets.find((ticket) => ticket.id === normalTicket);
    assert.equal(recalled.preview, 'Lazada 메시지가 회수되었습니다.');
    assert.equal(recalled.latestMessageState, 'recalled');
    assert.equal(conflict.preview, 'first accepted body');
    assert.equal(conflict.latestMessageState, 'conflict_review_required');
    assert.equal(normal.latestMessageState, 'normal');
    assert.equal(JSON.stringify(archivePage).includes('archive pre-recall secret'), false);
    const otherChannelArchive = await (await routes.archive.GET(new Request(
      'https://fixture.test/api/admin/cs/archive?channel=smartstore',
      { headers: { authorization: 'Bearer valid-admin' } },
    ))).json();
    assert.equal(otherChannelArchive.tickets[0].preview, 'other channel body');
    assert.equal(otherChannelArchive.tickets[0].latestMessageState, 'normal');
    assert.equal((await routes.archive.GET(new Request('https://fixture.test/api/admin/cs/archive', {
      headers: { authorization: 'Bearer valid-other' },
    }))).status, 403);
  } finally { await db.close(); }
});

test('integrated shared schemas preserve V3 states and the UI renders the recall and conflict labels', () => {
  assert.match(conversationContractSource, /messageState/);
  assert.match(archiveContractSource, /latestMessageState/);
  assert.match(conversationUiSource, /conflict_review_required/);
  assert.match(archiveUiSource, /latestMessageState/);
  assert.match(proposalPatch, /messageState: z\.enum/);
  assert.match(proposalPatch, /latestMessageState:z\.enum/);
  assert.match(proposalPatch, /기존 투영 유지 · 원문\/격리함 검토 필요/);
  assert.match(proposalPatch, /최신 메시지 회수됨/);
});
