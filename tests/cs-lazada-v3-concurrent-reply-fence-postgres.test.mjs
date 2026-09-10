import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const optIn = process.env.SELLERPILOT_LAZADA_POSTGRES_TWO_SESSION === '1';
const adminUrlValue = process.env.SELLERPILOT_LAZADA_POSTGRES_ADMIN_URL?.trim() ?? '';
const psqlBin = process.env.SELLERPILOT_LAZADA_PSQL_BIN?.trim() || 'psql';
const fixtureSql = await readFile(new URL(
  '../docs/cs-review-20260909/lazada/lazada-010-postgres-two-session-fixture.sql',
  import.meta.url,
), 'utf8');
const proposalSql = await readFile(new URL(
  '../supabase/migrations/20260909111201_cs_lazada_concurrent_reply_fence.sql',
  import.meta.url,
), 'utf8');

const owner = '00000000-0000-4000-8000-000000003001';
const sharedAdmin = '00000000-0000-4000-8000-000000003008';
const credential = '00000000-0000-4000-8000-000000003002';
const enqueueTicket = '00000000-0000-4000-8000-000000003003';
const providerTicket = '00000000-0000-4000-8000-000000003004';
const providerJob = '00000000-0000-4000-8000-000000003005';
const workerToken = '00000000-0000-4000-8000-000000003006';
const claimToken = '00000000-0000-4000-8000-000000003007';
const draftJob = '00000000-0000-4000-8000-000000003009';
const aiWorkerToken = '00000000-0000-4000-8000-000000003010';
const seller = 'a'.repeat(64);
const native = 'b'.repeat(64);
const tokenHash = 'c'.repeat(64);
const aiTokenHash = 'd'.repeat(64);

function validatedLocalAdminUrl(value) {
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SELLERPILOT_LAZADA_POSTGRES_ADMIN_URL must use postgresql://');
  }
  const host = parsed.hostname.toLowerCase();
  const socketHost = parsed.searchParams.get('host') ?? '';
  const tcpLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  const socketLocal = !host && socketHost.startsWith('/');
  if (!tcpLocal && !socketLocal) {
    throw new Error('SELLERPILOT_LAZADA_POSTGRES_ADMIN_URL must target localhost or a local Unix socket');
  }
  return parsed;
}

function databaseUrl(adminUrl, databaseName) {
  const target = new URL(adminUrl);
  target.pathname = `/${databaseName}`;
  return target.toString();
}

function isolatedProposal(sql) {
  // Supabase API roles are cluster-global. This disposable database proves
  // transaction ordering only; existing PGlite/DB tests retain ACL coverage.
  return sql.replace(/(?:revoke all|grant execute) on function[\s\S]*?;\s*/giu, '');
}

function spawnPsql(connectionUrl, sql, applicationName) {
  const child = spawn(psqlBin, [
    '--no-psqlrc', '--quiet', '--no-align', '--tuples-only',
    '--set', 'ON_ERROR_STOP=1', '--dbname', connectionUrl,
  ], {
    env: { ...process.env, PGAPPNAME: applicationName },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(sql);
  let settled = false;
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
  return { child, finished, get settled() { return settled; }, get stdout() { return stdout; } };
}

async function runPsql(connectionUrl, sql, applicationName = 'sellerpilot-lazada-fence-harness') {
  const session = spawnPsql(connectionUrl, sql, applicationName);
  const result = await session.finished;
  if (result.code !== 0) {
    throw new Error(`psql failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

async function waitForMarker(process, marker, timeoutMs = 5_000) {
  const started = Date.now();
  while (!process.stdout.includes(marker)) {
    if (process.settled) throw new Error(`psql session exited before marker ${marker}`);
    if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for ${marker}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function recallJson(suffix) {
  return JSON.stringify([{
    externalTicketId: `lazada-im:${suffix}`,
    remoteMessageId: `remote-${suffix}`,
    revisionKind: 'recalled',
    nativeContentFingerprint: native,
    providerContext: { eventKind: 'recalled', recallTargetMessageId: `remote-${suffix}` },
  }]).replaceAll("'", "''");
}

function recallTransaction(suffix, marker) {
  return `
    begin;
    select public.sellerpilot_service_ingest_lazada_inquiries_v3(
      '${credential}'::uuid,'${recallJson(suffix)}'::jsonb
    );
    \\echo ${marker}
    select pg_sleep(1.2);
    commit;
  `;
}

function psqlAvailable() {
  const result = spawnSync(psqlBin, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function prerequisiteReason() {
  if (!optIn) return 'set SELLERPILOT_LAZADA_POSTGRES_TWO_SESSION=1 to opt in';
  if (!adminUrlValue) return 'set SELLERPILOT_LAZADA_POSTGRES_ADMIN_URL to a local PostgreSQL admin URL';
  if (!psqlAvailable()) return `psql is unavailable; set SELLERPILOT_LAZADA_PSQL_BIN to an existing local psql binary`;
  try { validatedLocalAdminUrl(adminUrlValue); } catch (error) {
    return error instanceof Error ? error.message : 'invalid local PostgreSQL URL';
  }
  return null;
}

test('two-session harness is local-only and keeps the exact 010 lock/fresh-state contracts', () => {
  const runnableProposal = isolatedProposal(proposalSql);
  assert.throws(() => validatedLocalAdminUrl('postgresql://example.com/postgres'), /localhost|local Unix socket/);
  assert.doesNotThrow(() => validatedLocalAdminUrl('postgresql://127.0.0.1/postgres'));
  assert.match(proposalSql, /for update;[\s\S]*?'lazada-im-v3:'/);
  assert.match(proposalSql, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(/);
  assert.match(proposalSql, /'infinity'::timestamptz/);
  assert.match(proposalSql, /sellerpilot_service_begin_gateway_provider_mutation/);
  assert.match(proposalSql, /sellerpilot_create_cs_reply_draft/);
  assert.match(proposalSql, /sellerpilot_claim_cs_reply_draft/);
  assert.match(proposalSql, /sellerpilot_complete_cs_reply_draft/);
  assert.doesNotMatch(runnableProposal, /(?:revoke all|grant execute) on function/i);
  assert.equal((runnableProposal.match(/create function/giu) ?? []).length, 13);
});

const missingPrerequisite = prerequisiteReason();
test('real PostgreSQL serializes recall before enqueue and forbids provider-start after recall', {
  skip: missingPrerequisite || false,
  timeout: 30_000,
}, async () => {
  const adminUrl = validatedLocalAdminUrl(adminUrlValue);
  const databaseName = `sellerpilot_lazada_fence_${process.pid}_${randomBytes(4).toString('hex')}`;
  assert.match(databaseName, /^[a-z0-9_]+$/);
  const testUrl = databaseUrl(adminUrl, databaseName);
  const cleanup = async () => {
    await runPsql(adminUrl, `
      select pg_terminate_backend(pid) from pg_stat_activity
       where datname='${databaseName}' and pid<>pg_backend_pid();
      drop database if exists ${databaseName};
    `, 'sellerpilot-lazada-fence-cleanup');
  };

  await runPsql(adminUrl, `create database ${databaseName};`, 'sellerpilot-lazada-fence-create');
  try {
    await runPsql(testUrl, `${fixtureSql}\n${isolatedProposal(proposalSql)}`, 'sellerpilot-lazada-fence-setup');
    await runPsql(testUrl, `
      insert into auth.users values('${owner}'),('${sharedAdmin}');
      insert into sellerpilot_private.admin_users values('${owner}'),('${sharedAdmin}');
      insert into sellerpilot_private.channel_credentials(
        id,created_by,channel,seller_account_key,seller_account_key_source,seller_account_verified_at
      ) values('${credential}','${owner}','lazada','${seller}','provider_certified_v1',clock_timestamp());
      insert into sellerpilot_private.ai_cli_worker_tokens
        values
        ('${workerToken}','${tokenHash}','gateway','active',clock_timestamp()+interval '1 day'),
        ('${aiWorkerToken}','${aiTokenHash}','ai','active',clock_timestamp()+interval '1 day');
      insert into sellerpilot_private.support_tickets(
        id,owner_id,channel_key,source_credential_id,seller_account_key,external_ticket_id,latest_inbound_key
      ) values
        ('${enqueueTicket}','${owner}','lazada','${credential}','${seller}','lazada-im:enqueue','inbound-enqueue'),
        ('${providerTicket}','${owner}','lazada','${credential}','${seller}','lazada-im:provider','inbound-provider');
      insert into sellerpilot_private.support_inbound_messages(
        id,ticket_id,owner_id,channel_key,inbound_key,remote_message_id,provider_context
      ) values
        (gen_random_uuid(),'${enqueueTicket}','${owner}','lazada','inbound-enqueue','remote-enqueue',
         jsonb_build_object('nativeContentFingerprint','${native}')),
        (gen_random_uuid(),'${providerTicket}','${owner}','lazada','inbound-provider','remote-provider',
         jsonb_build_object('nativeContentFingerprint','${native}'));
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,status,seller_account_key,request_payload,
        lease_expires_at,worker_token_id,claim_token
      ) values(
        '${providerJob}','${credential}','lazada','inquiries.reply','running','${seller}',
        jsonb_build_object('sellerpilotTicketId','${providerTicket}','sellerpilotInboundKey','inbound-provider'),
        clock_timestamp()+interval '1 day','${workerToken}','${claimToken}'
      );
    `);

    const sharedDraftCreated = await runPsql(testUrl, `
      select set_config('request.jwt.claim.sub','${sharedAdmin}',false);
      select public.sellerpilot_update_ticket(
        '${providerTicket}','waiting','shared administrator draft','inbound-provider'
      );
      select public.sellerpilot_create_cs_reply_draft(
        '${draftJob}','${providerTicket}','inbound-provider','ko-KR','polite'
      );
    `, 'sellerpilot-lazada-shared-admin-draft');
    assert.match(sharedDraftCreated, /t[\s\S]*00000000-0000-4000-8000-000000003009/);
    const claimedDraft = JSON.parse(await runPsql(testUrl, `
      select public.sellerpilot_claim_cs_reply_draft('${aiTokenHash}');
    `, 'sellerpilot-lazada-ai-draft-claim'));
    assert.equal(claimedDraft.id, draftJob);
    assert.equal(claimedDraft.request.message, 'synthetic body');

    const recallBeforeEnqueue = spawnPsql(testUrl, recallTransaction('enqueue', 'RECALL_ENQUEUE_LOCKED'),
      'sellerpilot-lazada-recall-before-enqueue');
    await waitForMarker(recallBeforeEnqueue, 'RECALL_ENQUEUE_LOCKED');
    const enqueueStartedAt = Date.now();
    const enqueue = spawnPsql(testUrl, `select public.sellerpilot_enqueue_inquiry_reply_gateway_job(
      '${enqueueTicket}','lazada','synthetic approved reply','{}'::jsonb
    );`, 'sellerpilot-lazada-enqueue-waiter');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(enqueue.settled, false, 'enqueue must wait for the recall transaction lineage lock');
    const [recallEnqueueResult, enqueueResult] = await Promise.all([
      recallBeforeEnqueue.finished, enqueue.finished,
    ]);
    assert.equal(recallEnqueueResult.code, 0, recallEnqueueResult.stderr);
    assert.notEqual(enqueueResult.code, 0, 'enqueue must fail after observing the committed recall');
    assert.match(enqueueResult.stderr, /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    assert.ok(Date.now() - enqueueStartedAt >= 900, 'enqueue returned before the lock holder committed');
    assert.equal(await runPsql(testUrl, `select count(*) from sellerpilot_private.channel_gateway_jobs
      where request_payload->>'sellerpilotTicketId'='${enqueueTicket}';`), '0');
    const blockedCurrentDraft = spawnPsql(testUrl, `
      select set_config('request.jwt.claim.sub','${sharedAdmin}',false);
      select public.sellerpilot_create_cs_reply_draft(
        gen_random_uuid(),'${enqueueTicket}','inbound-enqueue','ko-KR','polite'
      );
    `, 'sellerpilot-lazada-current-draft-after-recall');
    const blockedCurrentDraftResult = await blockedCurrentDraft.finished;
    assert.notEqual(blockedCurrentDraftResult.code, 0);
    assert.match(blockedCurrentDraftResult.stderr, /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);

    const recallBeforeProvider = spawnPsql(testUrl, recallTransaction('provider', 'RECALL_PROVIDER_LOCKED'),
      'sellerpilot-lazada-recall-before-provider');
    await waitForMarker(recallBeforeProvider, 'RECALL_PROVIDER_LOCKED');
    const providerStart = spawnPsql(testUrl, `select public.sellerpilot_service_begin_gateway_provider_mutation(
      '${tokenHash}','${providerJob}','${claimToken}'
    );`, 'sellerpilot-lazada-provider-start-waiter');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(providerStart.settled, false, 'provider-start must wait for the recall transaction lineage lock');
    const [recallProviderResult, providerStartResult] = await Promise.all([
      recallBeforeProvider.finished, providerStart.finished,
    ]);
    assert.equal(recallProviderResult.code, 0, recallProviderResult.stderr);
    assert.equal(providerStartResult.code, 0, providerStartResult.stderr);
    assert.equal(providerStartResult.stdout.trim(), 'f');
    assert.equal(await runPsql(testUrl, `select concat_ws('|',status,
      coalesce(provider_mutation_started_at::text,'NULL'))
      from sellerpilot_private.channel_gateway_jobs where id='${providerJob}';`), 'failed|NULL');
    const blockedUpdate = spawnPsql(testUrl, `
      select set_config('request.jwt.claim.sub','${sharedAdmin}',false);
      select public.sellerpilot_update_ticket(
        '${providerTicket}','resolved','newly exposed draft','inbound-provider'
      );
    `, 'sellerpilot-lazada-shared-admin-update-after-recall');
    const blockedUpdateResult = await blockedUpdate.finished;
    assert.notEqual(blockedUpdateResult.code, 0);
    assert.match(blockedUpdateResult.stderr, /LAZADA_IM_LATEST_MESSAGE_NOT_ACTIONABLE/);
    assert.equal(await runPsql(testUrl, `select public.sellerpilot_complete_cs_reply_draft(
      '${aiTokenHash}','${draftJob}','${claimedDraft.claim_token}','succeeded',
      jsonb_build_object('mode','support-reply','targetLocale','ko-KR','draft','newly generated secret draft'),null
    );`, 'sellerpilot-lazada-ai-complete-after-recall'), 'lease_lost');
    const maskedDraft = JSON.parse(await runPsql(testUrl, `
      select set_config('request.jwt.claim.sub','${sharedAdmin}',false);
      select public.sellerpilot_get_cs_reply_draft('${draftJob}');
    `, 'sellerpilot-lazada-shared-admin-get-after-recall').then(output => output.split('\n').at(-1)));
    assert.equal(maskedDraft.status, 'failed');
    assert.equal(maskedDraft.result, null);
    assert.doesNotMatch(JSON.stringify(maskedDraft), /synthetic body|newly generated secret draft/);
  } finally {
    await cleanup();
  }
});
