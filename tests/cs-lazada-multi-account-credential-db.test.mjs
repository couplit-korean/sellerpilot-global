import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
const migration = await readFile(integratedRoot
  ? new URL(`file://${integratedRoot}/supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql`)
  : new URL('../supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql', import.meta.url), 'utf8');
const ownerOne = '00000000-0000-4000-8000-000000003001';
const ownerTwo = '00000000-0000-4000-8000-000000003002';
const credentialOne = '00000000-0000-4000-8000-000000003011';
const credentialTwo = '00000000-0000-4000-8000-000000003012';
const sellerOne = 'a'.repeat(64);
const sellerTwo = 'b'.repeat(64);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema vault; create schema extensions;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable
      as $$select decode(md5(value)||md5(value||algorithm),'hex')$$;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create function vault.create_secret(text,text,text) returns uuid language plpgsql as $$
      declare next_id uuid:=gen_random_uuid(); begin
        insert into vault.decrypted_secrets values(next_id,$1); return next_id;
      end $$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key default gen_random_uuid(), channel text not null,
      environment text not null, version integer not null, vault_secret_id uuid not null,
      fingerprint text not null, status text not null default 'active', expires_at timestamptz,
      rotation_interval_days integer not null default 90, warning_days integer not null default 30,
      grace_ends_at timestamptz, last_rotated_at timestamptz not null default clock_timestamp(),
      last_checked_at timestamptz,last_check_status text,last_check_message text,
      created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
      seller_account_key text, seller_account_key_source text not null default 'legacy_unattested',
      seller_account_verified_at timestamptz, unique(channel,environment,version)
    );
    create unique index channel_credentials_one_active_idx
      on sellerpilot_private.channel_credentials(channel,environment) where status='active';
    create table sellerpilot_private.credential_audit(
      id bigint generated always as identity primary key,credential_id uuid,channel text,
      environment text,action text,actor_user_id uuid,safe_detail jsonb,occurred_at timestamptz default now()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,channel text,operation text,
      environment text,request_payload jsonb,created_by uuid,seller_account_key text,
      status text not null default 'queued',created_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null,
      channel text not null,operation text not null,country text not null,
      status text not null default 'active',expires_at timestamptz
    );
    create unique index channel_gateway_jobs_active_periodic_read_once_idx
      on sellerpilot_private.channel_gateway_jobs(credential_id,channel,operation,(trim(request_payload->>'periodicKey')))
      where attempt_id is null and operation in('orders.list','inquiries.list')
        and status in('queued','running') and nullif(trim(request_payload->>'periodicKey'),'') is not null;
    create table sellerpilot_private.channel_sync_state(
      owner_id uuid,channel_key text,data_type text,status text,imported_count integer,
      last_started_at timestamptz,last_error text,updated_at timestamptz,
      unique(owner_id,channel_key,data_type)
    );
    create function sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)
      returns jsonb language sql as $$select '{}'::jsonb$$;
  `);
  await db.query(`insert into auth.users values($1),($2)`, [ownerOne, ownerTwo]);
  await db.query(`insert into sellerpilot_private.admin_users values($1),($2)`, [ownerOne, ownerTwo]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ownerOne]);
  await db.exec(migration);
  return db;
}

async function insertCredential(db, { id, owner, seller, channel = 'lazada', environment = 'production' }) {
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,created_by,
    seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values($1,$2,$3,(select coalesce(max(version),0)+1 from sellerpilot_private.channel_credentials),
    gen_random_uuid(),'SYNTHETIC',$4,$5,$6,case when $5::text is null then null else clock_timestamp() end)`,
  [id, channel, environment, owner, seller, seller ? 'provider_certified_v1' : 'legacy_unattested']);
}

async function insertBinding(db, credentialId, country, status = 'active') {
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id,channel,operation,country,status
  ) values($1,'lazada','inquiries.list',$2,$3)`, [credentialId, country, status]);
}

test('two certified Lazada accounts coexist while duplicate seller and pending owner scopes fail closed', async () => {
  const db = await fixture();
  try {
    await insertCredential(db, { id: credentialOne, owner: ownerOne, seller: sellerOne });
    await insertCredential(db, { id: credentialTwo, owner: ownerTwo, seller: sellerTwo });
    await insertBinding(db, credentialOne, 'MY');
    await insertBinding(db, credentialTwo, 'SG');
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.channel_credentials where channel='lazada' and status='active'`)).rows[0].count, 2);
    await assert.rejects(insertCredential(db, {
      id: '00000000-0000-4000-8000-000000003013', owner: ownerTwo, seller: sellerOne,
    }), /duplicate key/);
    await insertCredential(db, {
      id: '00000000-0000-4000-8000-000000003014', owner: ownerOne, seller: null,
    });
    await assert.rejects(insertCredential(db, {
      id: '00000000-0000-4000-8000-000000003015', owner: ownerOne, seller: null,
    }), /duplicate key/);
    await insertCredential(db, {
      id: '00000000-0000-4000-8000-000000003016', owner: ownerOne,
      seller: 'c'.repeat(64), channel: 'smartstore',
    });
    await assert.rejects(insertCredential(db, {
      id: '00000000-0000-4000-8000-000000003017', owner: ownerTwo,
      seller: 'd'.repeat(64), channel: 'smartstore',
    }), /duplicate key/);
  } finally { await db.close(); }
});

test('shared admins list both accounts and exact periodic reads never cross owner, credential or seller lineage', async () => {
  const db = await fixture();
  try {
    await insertCredential(db, { id: credentialOne, owner: ownerOne, seller: sellerOne });
    await insertCredential(db, { id: credentialTwo, owner: ownerTwo, seller: sellerTwo });
    await insertBinding(db, credentialOne, 'MY');
    await insertBinding(db, credentialTwo, 'SG');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ownerTwo]);
    const listed = await db.query(`select id::text,owner_id::text,seller_account_key from public.sellerpilot_list_active_lazada_credentials()`);
    assert.deepEqual(new Set(listed.rows.map(row => row.id)), new Set([credentialOne, credentialTwo]));
    assert.deepEqual(new Set(listed.rows.map(row => row.owner_id)), new Set([ownerOne, ownerTwo]));

    await db.exec('set role service_role');
    const first = (await db.query(`select public.sellerpilot_service_enqueue_lazada_periodic_sync(
      $1,'inquiries.list',$2::jsonb,5) result`, [credentialOne, JSON.stringify({ periodicKey: 'inquiries:bootstrap', arguments: { bootstrap: true } })])).rows[0].result;
    const second = (await db.query(`select public.sellerpilot_service_enqueue_lazada_periodic_sync(
      $1,'inquiries.list',$2::jsonb,5) result`, [credentialTwo, JSON.stringify({ periodicKey: 'inquiries:bootstrap', arguments: { bootstrap: true } })])).rows[0].result;
    const repeated = (await db.query(`select public.sellerpilot_service_enqueue_lazada_periodic_sync(
      $1,'inquiries.list',$2::jsonb,5) result`, [credentialOne, JSON.stringify({ periodicKey: 'inquiries:bootstrap', arguments: { bootstrap: true } })])).rows[0].result;
    await db.exec('reset role');
    assert.equal(first.status, 'queued'); assert.equal(second.status, 'queued'); assert.equal(repeated.status, 'already_pending');
    assert.equal(first.country, 'MY'); assert.equal(second.country, 'SG');
    const jobs = await db.query(`select credential_id::text,created_by::text,seller_account_key,
      request_payload->>'periodicKey' periodic_key,
      request_payload->'arguments'->>'sellerpilotLazadaCountry' country
      from sellerpilot_private.channel_gateway_jobs order by credential_id`);
    assert.equal(jobs.rows.length, 2);
    assert.deepEqual(jobs.rows.map(row => [row.credential_id,row.created_by,row.seller_account_key]), [
      [credentialOne,ownerOne,sellerOne], [credentialTwo,ownerTwo,sellerTwo],
    ]);
    assert.notEqual(jobs.rows[0].periodic_key, jobs.rows[1].periodic_key);
    assert.ok(jobs.rows.every(row => /^lazada:v1:[a-f0-9]{32}$/.test(row.periodic_key)));
    assert.deepEqual(jobs.rows.map(row => row.country), ['MY', 'SG']);
  } finally { await db.close(); }
});

test('bounded fanout isolates inactive, expired and country-invalid accounts while valid accounts continue', async () => {
  const db = await fixture();
  const credentialExpired = '00000000-0000-4000-8000-000000003013';
  const credentialInactive = '00000000-0000-4000-8000-000000003014';
  const credentialUnbound = '00000000-0000-4000-8000-000000003015';
  try {
    await insertCredential(db, { id: credentialOne, owner: ownerOne, seller: sellerOne });
    await insertCredential(db, { id: credentialTwo, owner: ownerTwo, seller: sellerTwo });
    await insertCredential(db, { id: credentialExpired, owner: ownerOne, seller: 'c'.repeat(64) });
    await insertCredential(db, { id: credentialInactive, owner: ownerTwo, seller: 'd'.repeat(64) });
    await insertCredential(db, { id: credentialUnbound, owner: ownerOne, seller: 'e'.repeat(64) });
    await insertBinding(db, credentialOne, 'MY');
    await insertBinding(db, credentialTwo, 'SG');
    await insertBinding(db, credentialExpired, 'TH');
    await insertBinding(db, credentialInactive, 'VN');
    await db.query(`update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()-interval '1 minute' where id=$1`, [credentialExpired]);
    await db.query(`update sellerpilot_private.channel_credentials set status='revoked' where id=$1`, [credentialInactive]);

    await db.exec('set role service_role');
    const payload = JSON.stringify({ periodicKey: 'inquiries:bootstrap', arguments: { bootstrap: true } });
    const first = (await db.query(`select public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
      'inquiries.list',$1::jsonb,5) result`, [payload])).rows[0].result;
    const replay = (await db.query(`select public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
      'inquiries.list',$1::jsonb,5) result`, [payload])).rows[0].result;
    const mismatch = (await db.query(`select public.sellerpilot_service_enqueue_lazada_periodic_sync(
      $1,'inquiries.list',$2::jsonb,5) result`, [credentialOne, JSON.stringify({
        periodicKey: 'inquiries:mismatch', arguments: { sellerpilotLazadaCountry: 'SG' },
      })])).rows[0].result;
    await db.exec('reset role');

    const statuses = new Map(first.accounts.map(account => [account.credentialId, account.status]));
    assert.equal(statuses.get(credentialOne), 'queued');
    assert.equal(statuses.get(credentialTwo), 'queued');
    assert.equal(statuses.get(credentialExpired), 'reconnect_required');
    assert.equal(statuses.get(credentialUnbound), 'reconciliation_required');
    assert.equal(statuses.has(credentialInactive), false);
    assert.equal(replay.accounts.find(account => account.credentialId === credentialOne).status, 'already_pending');
    assert.equal(replay.accounts.find(account => account.credentialId === credentialTwo).status, 'already_pending');
    assert.equal(mismatch.status, 'reconciliation_required');
    assert.equal(mismatch.reason, 'country_binding_mismatch');
    assert.equal((await db.query(`select count(*)::integer count from sellerpilot_private.channel_gateway_jobs`)).rows[0].count, 2);
  } finally { await db.close(); }
});

test('exact Lazada rotation preserves the selected owner and does not revoke another account', async () => {
  const db = await fixture();
  try {
    await insertCredential(db, { id: credentialOne, owner: ownerOne, seller: sellerOne });
    await insertCredential(db, { id: credentialTwo, owner: ownerTwo, seller: sellerTwo });
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ownerOne]);
    const rotated = (await db.query(`select public.sellerpilot_rotate_lazada_credential(
      $1,'production',$2::jsonb,null,90,30,0)::text id`, [credentialTwo, JSON.stringify({ app_key: 'two', app_secret: 'secret', country: 'my', access_token: 'next' })])).rows[0].id;
    const rows = await db.query(`select id::text,created_by::text,status from sellerpilot_private.channel_credentials where id in($1,$2,$3) order by id`, [credentialOne, credentialTwo, rotated]);
    assert.deepEqual(rows.rows.find(row => row.id === credentialOne), { id: credentialOne, created_by: ownerOne, status: 'active' });
    assert.deepEqual(rows.rows.find(row => row.id === credentialTwo), { id: credentialTwo, created_by: ownerTwo, status: 'revoked' });
    assert.deepEqual(rows.rows.find(row => row.id === rotated), { id: rotated, created_by: ownerTwo, status: 'active' });
  } finally { await db.close(); }
});
