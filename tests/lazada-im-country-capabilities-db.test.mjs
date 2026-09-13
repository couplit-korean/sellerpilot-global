import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const original = await readFile(new URL('../supabase/migrations/20260913060000_lazada_im_capability_bootstrap.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260913082500_lazada_im_preserve_country_capabilities.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const secret = {
  im_identity_source: 'lazada.oauth_token', im_app_key: 'fixture-app',
  im_access_token: 'fixture-access', im_refresh_token: 'fixture-refresh',
  im_access_token_expires_at: '2099-01-01T00:00:00Z',
  country_user_info: [{ country: 'my', seller_id: '10001' }, { country: 'sg', seller_id: '10002' }],
  im_country_user_info: [{ country: 'my', seller_id: '10001' }, { country: 'sg', seller_id: '10002' }],
};

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private; create schema vault; create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$ select sha256(convert_to($1,'UTF8')) $$;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,status text,seller_account_key text,
      seller_account_key_source text,seller_account_verified_at timestamptz,
      created_by uuid,expires_at timestamptz,vault_secret_id uuid);
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,channel text,operation text,status text,request_payload jsonb,
      response_payload jsonb,credential_id uuid,seller_account_key text,created_by uuid,
      prepared_credential_id uuid,credential_refresh_in_flight boolean default false,
      credential_refresh_recovery_vault_id uuid);
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,scope text,status text,expires_at timestamptz);
    create table sellerpilot_private.cs_credential_capability_bindings(
      credential_id uuid,channel text,operation text,country text,app_fingerprint text,
      token_fingerprint text,target_fingerprint text,status text,verified_job_id uuid,
      verified_at timestamptz,expires_at timestamptz,updated_at timestamptz,
      unique(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint));
    create table sellerpilot_private.gateway_completion_receipts(job_id uuid primary key,worker_token_id uuid);
  `);
  const functions = original.slice(original.indexOf('create function sellerpilot_private.lazada_im_secret_binding'),
    original.indexOf('-- Preserve the current Temu wrapper'));
  await db.exec(functions);
  await db.query('insert into vault.decrypted_secrets values($1,$2)', [id(1), JSON.stringify(secret)]);
  await db.query(`insert into sellerpilot_private.channel_credentials values(
    $1,'lazada','production','active','fixture-seller','provider_certified_v1',now(),$2,null,$1)`, [id(1), id(2)]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,'gateway','active','2099-01-01')", [id(3)]);
  return db;
}

async function diagnostic(db, number, country, payload = secret, proofPatch = {}) {
  const proof = (await db.query('select sellerpilot_private.lazada_im_secret_binding($1::jsonb,$2) proof',
    [JSON.stringify(payload), country])).rows[0].proof;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs
    (id,channel,operation,status,request_payload,response_payload,credential_id,seller_account_key,created_by,prepared_credential_id)
    values($1,'lazada','diagnostic.test','succeeded',$2,$3,$4,'fixture-seller',$5,$4)`,
  [id(number), JSON.stringify({ arguments: { lazadaImCapabilityProbe: true, country } }),
    JSON.stringify({ ok: true, diagnostic: { status: 'passed', lazadaImCapability: {
      ...proof, responseSha256: 'a'.repeat(64), observedAt: new Date().toISOString(), ...proofPatch,
    } } }), id(1), id(2)]);
  await db.query('insert into sellerpilot_private.gateway_completion_receipts values($1,$2)', [id(number), id(3)]);
}

async function active(db) {
  return (await db.query("select country from sellerpilot_private.cs_credential_capability_bindings where status='active' order by country")).rows.map(r => r.country);
}

test('country diagnostics preserve other valid grants and invalidate stale identities/tokens', async t => {
  const db = await setup();
  try {
    // Reproduce the production defect before applying the actual forward migration.
    await diagnostic(db, 10, 'MY');
    await diagnostic(db, 11, 'SG');
    assert.deepEqual(await active(db), ['SG']);
    await db.exec(migration);
    await t.test('MY and SG proofs for the same current token coexist', async () => {
      await diagnostic(db, 12, 'MY');
      assert.deepEqual(await active(db), ['MY', 'SG']);
      await diagnostic(db, 13, 'SG');
      assert.deepEqual(await active(db), ['MY', 'SG']);
    });
    await t.test('wrong seller evidence cannot activate a country or supersede valid proof', async () => {
      await assert.rejects(diagnostic(db, 14, 'MY', secret, { sellerId: '99999' }), /PROOF_MISMATCH/);
      assert.deepEqual(await active(db), ['MY', 'SG']);
    });
    await t.test('a removed country grant is superseded without inventing another grant', async () => {
      const myOnly = { ...secret, im_country_user_info: [secret.im_country_user_info[0]] };
      await db.query('update vault.decrypted_secrets set decrypted_secret=$1 where id=$2', [JSON.stringify(myOnly), id(1)]);
      await diagnostic(db, 15, 'MY', myOnly);
      assert.deepEqual(await active(db), ['MY']);
    });
    await t.test('rotating the shared IM token invalidates old country proofs', async () => {
      const rotated = { ...secret, im_access_token: 'rotated-fixture-access' };
      await db.query('update vault.decrypted_secrets set decrypted_secret=$1 where id=$2', [JSON.stringify(rotated), id(1)]);
      await diagnostic(db, 16, 'SG', rotated);
      assert.deepEqual(await active(db), ['SG']);
      await diagnostic(db, 17, 'MY', rotated);
      assert.deepEqual(await active(db), ['MY', 'SG']);
    });
    await t.test('private trigger remains inaccessible and reapply fails on source drift', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const privilege = (await db.query("select has_function_privilege($1,'sellerpilot_private.record_lazada_im_diagnostic_receipt()','EXECUTE') ok", [role])).rows[0].ok;
        assert.equal(privilege, false);
      }
      await assert.rejects(db.exec(migration), /PREIMAGE_DRIFT/);
      await db.exec('rollback');
      assert.deepEqual(await active(db), ['MY', 'SG']);
    });
  } finally { await db.close(); }
});
