import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const recovery = await readFile(new URL(
  "../supabase/migrations/20260913044500_restore_shopee_refresh_and_create_stage_contracts.sql",
  import.meta.url,
), "utf8");
const sql = recovery.slice(0,recovery.indexOf('-- Reviewed source: 20260909204000')).replace(/do \$recovery_guard\$[\s\S]*?end \$recovery_guard\$;/u,'')+'commit;';
const boundsFix = await readFile(new URL(
  "../supabase/migrations/20260913092500_shopee_refresh_shop_merchant_bounds.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000006001";
const credential = "00000000-0000-4000-8000-000000006002";
const vaultId = "00000000-0000-4000-8000-000000006003";
const worker = "00000000-0000-4000-8000-000000006004";
const jobOne = "00000000-0000-4000-8000-000000006005";
const claimOne = "00000000-0000-4000-8000-000000006006";
const jobTwo = "00000000-0000-4000-8000-000000006007";
const claimTwo = "00000000-0000-4000-8000-000000006008";
const tokenHash = "a".repeat(64);
const shops = ["1719148844", "1758392145", "1758392144", "1758392135",
  "1758392139", "1758392137", "1758392161", "1758392178"];

function target(id, revision) {
  return {
    type: "shop", id,
    access_token: `synthetic-access-${id}-${revision}`,
    refresh_token: `synthetic-refresh-${id}-${revision}`,
    access_token_expires_at: `203${revision}-01-01T00:00:00.000Z`,
    refresh_token_expires_at: `203${revision}-02-01T00:00:00.000Z`,
  };
}

const targets = shops.map((id) => target(id, 0));
const base = {
  partner_id: "2013267", partner_key: "synthetic-partner-key-never-production",
  shop_id: shops[0], shopee_targets: targets,
  access_token: targets[0].access_token, refresh_token: targets[0].refresh_token,
  access_token_expires_at: targets[0].access_token_expires_at,
  refresh_token_expires_at: targets[0].refresh_token_expires_at,
  provider_account_subject: "shopee:main:synthetic",
  provider_account_identity_version: "provider-account-identity/1",
};

function candidateFor(id, revision) {
  const next = target(id, revision);
  return {
    ...base, shop_id: id,
    shopee_targets: targets.map((item) => item.id === id ? next : item),
    access_token: next.access_token, refresh_token: next.refresh_token,
    access_token_expires_at: next.access_token_expires_at,
    refresh_token_expires_at: next.refresh_token_expires_at,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private; create schema vault; create schema extensions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
      version integer not null,status text not null,vault_secret_id uuid not null
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,status text not null,expires_at timestamptz not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
      channel text not null,operation text not null,status text not null,claim_token uuid not null,
      worker_token_id uuid not null references sellerpilot_private.ai_cli_worker_tokens(id),
      lease_expires_at timestamptz not null,credential_refresh_in_flight boolean not null default false
    );
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create table sellerpilot_private.test_refresh_stages(
      job_id uuid not null,payload jsonb not null,recovery_only boolean not null
    );
    create function sellerpilot_private.serverless_cs_job_is_owned(text,uuid,uuid,boolean)
    returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from sellerpilot_private.channel_gateway_jobs job
        join sellerpilot_private.ai_cli_worker_tokens token on token.id=job.worker_token_id
       where job.id=$2 and job.claim_token=$3 and job.status='running'
         and job.lease_expires_at>clock_timestamp() and token.token_hash=$1
         and token.status='active' and token.expires_at>clock_timestamp())
    $$;
    create function public.sellerpilot_service_begin_serverless_cs_credential_refresh(text,uuid,uuid)
    returns boolean language plpgsql security definer set search_path='' as $$
    begin
      update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=true
       where id=$2 and claim_token=$3 and not credential_refresh_in_flight;
      return found;
    end $$;
    create function public.sellerpilot_service_prepare_serverless_cs_credential_refresh(
      text,uuid,uuid,jsonb,timestamptz default null,boolean default false,boolean default false
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    begin
      if not exists(select 1 from sellerpilot_private.channel_gateway_jobs
        where id=$2 and claim_token=$3 and credential_refresh_in_flight) then
        return jsonb_build_object('status','conflict');
      end if;
      insert into sellerpilot_private.test_refresh_stages values($2,$4,$6);
      update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=false where id=$2;
      return jsonb_build_object('status',case when $6 then 'recovery_preserved' else 'prepared' end,
        'credential_id',(select credential_id from sellerpilot_private.channel_gateway_jobs where id=$2));
    end $$;
  `);
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,'shopee','production',7,'active',$3)",
    [credential, owner, vaultId]);
  await db.query("insert into vault.decrypted_secrets values($1,$2)", [vaultId, JSON.stringify(base)]);
  await db.query("insert into sellerpilot_private.ai_cli_worker_tokens values($1,$2,'active',now()+interval '1 day')",
    [worker, tokenHash]);
  for (const [job, claim] of [[jobOne, claimOne], [jobTwo, claimTwo]]) {
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,status,claim_token,worker_token_id,lease_expires_at
    ) values($1,$2,'shopee','inquiries.list','running',$3,$4,now()+interval '1 hour')`,
    [job, credential, claim, worker]);
  }
  await db.exec(sql);
  return db;
}

async function begin(db, job, claim, shopId) {
  return (await db.query(`select public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(
    $1,$2,$3,'shop',$4
  ) result`, [tokenHash, job, claim, shopId])).rows[0].result;
}

test("SQL target CAS serializes refresh and preserves the other seven shops", async () => {
  const db = await fixture();
  try {
    assert.equal((await begin(db, jobOne, claimOne, shops[0])).status, "acquired");
    assert.equal((await begin(db, jobOne, claimOne, shops[0])).status, "reused");
    assert.equal((await begin(db, jobTwo, claimTwo, shops[1])).status, "busy");
    const candidate = candidateFor(shops[0], 1);
    const prepared = (await db.query(`select public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
      $1,$2,$3,'shop',$4,$5::jsonb,null,false,false
    ) result`, [tokenHash, jobOne, claimOne, shops[0], JSON.stringify(candidate)])).rows[0].result;
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.targetId, shops[0]);
    const staged = (await db.query("select payload from sellerpilot_private.test_refresh_stages where job_id=$1", [jobOne])).rows[0].payload;
    assert.deepEqual(staged.shopee_targets.slice(1), base.shopee_targets.slice(1));
    assert.deepEqual(staged.shopee_targets[0], candidate.shopee_targets[0]);
    assert.equal((await begin(db, jobTwo, claimTwo, shops[1])).status, "acquired");
  } finally { await db.close(); }
});

test("SQL target CAS rejects widened and stale candidates before staging", async () => {
  const db = await fixture();
  try {
    assert.equal((await begin(db, jobOne, claimOne, shops[0])).status, "acquired");
    const widened = candidateFor(shops[0], 1);
    widened.shopee_targets[1] = target(shops[1], 9);
    await assert.rejects(db.query(`select public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
      $1,$2,$3,'shop',$4,$5::jsonb,null,false,false
    )`, [tokenHash, jobOne, claimOne, shops[0], JSON.stringify(widened)]),
    /SHOPEE_TARGET_REFRESH_NON_TARGET_CHANGED/u);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.test_refresh_stages")).rows[0].n, 0);

    await db.query("update sellerpilot_private.channel_credentials set version=8 where id=$1", [credential]);
    const stale = (await db.query(`select public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
      $1,$2,$3,'shop',$4,$5::jsonb,null,false,false
    ) result`, [tokenHash, jobOne, claimOne, shops[0], JSON.stringify(candidateFor(shops[0], 1))])).rows[0].result;
    assert.equal(stale.status, "conflict");
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.test_refresh_stages")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("target refresh claims and merge helpers are service-only", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const acl = (await db.query(`select
        has_table_privilege($1,'sellerpilot_private.cs_shopee_target_refresh_claims','SELECT') direct,
        has_function_privilege($1,'public.sellerpilot_service_begin_cs_shopee_target_refresh_v1(text,uuid,uuid,text,text)','EXECUTE') begin_refresh,
        has_function_privilege($1,'sellerpilot_private.shopee_target_refresh_merge_v1(jsonb,jsonb,text,text,boolean)','EXECUTE') merge_refresh`, [role])).rows[0];
      assert.equal(acl.direct, false);
      assert.equal(acl.begin_refresh, role === "service_role");
      assert.equal(acl.merge_refresh, false);
    }
  } finally { await db.close(); }
});

test("eight shops plus merchant retain exact target isolation through recovery and preparation", async () => {
  const db = await fixture();
  try {
    const merchant = { ...target("5511564", 0), type: "merchant" };
    const withMerchant = { ...base, shopee_targets: [...targets, merchant] };
    const candidate = { ...candidateFor(shops[0], 1), shopee_targets: [...candidateFor(shops[0], 1).shopee_targets, merchant] };
    const merge = (source, next, recoveryOnly = false, type = "shop", targetId = shops[0]) => db.query(
      "select sellerpilot_private.shopee_target_refresh_merge_v1($1::jsonb,$2::jsonb,$3,$4,$5) result",
      [JSON.stringify(source), JSON.stringify(next), type, targetId, recoveryOnly],
    );
    await assert.rejects(merge(withMerchant, candidate), /SHOPEE_TARGET_REFRESH_PAYLOAD_INVALID/);
    await db.exec(boundsFix);
    for (const recoveryOnly of [true, false]) {
      const merged = (await merge(withMerchant, candidate, recoveryOnly)).rows[0].result;
      assert.equal(merged.shopee_targets.length, 9);
      assert.deepEqual(merged.shopee_targets.slice(1), withMerchant.shopee_targets.slice(1));
      assert.deepEqual(merged.shopee_targets[0], candidate.shopee_targets[0]);
    }
    const widened = structuredClone(candidate);
    widened.shopee_targets[8] = { ...merchant, access_token: "changed-other-merchant" };
    await assert.rejects(merge(withMerchant, widened), /SHOPEE_TARGET_REFRESH_NON_TARGET_CHANGED/);
    const nineShops = { ...base, shopee_targets: [...targets, target("99999999", 0)] };
    await assert.rejects(merge(nineShops, nineShops), /SHOPEE_TARGET_REFRESH_PAYLOAD_INVALID/);
    const extraTarget = { ...candidate, shopee_targets: [...candidate.shopee_targets, target("99999999", 0)] };
    await assert.rejects(merge(withMerchant, extraTarget), /SHOPEE_TARGET_REFRESH_PAYLOAD_INVALID/);
    const nextMerchant = { ...target(merchant.id, 1), type: "merchant" };
    const merchantCandidate = {
      ...withMerchant, merchant_id: merchant.id,
      shopee_targets: [...targets, nextMerchant],
      access_token: nextMerchant.access_token, refresh_token: nextMerchant.refresh_token,
      access_token_expires_at: nextMerchant.access_token_expires_at,
      refresh_token_expires_at: nextMerchant.refresh_token_expires_at,
    };
    const merchantMerged = (await merge(withMerchant, merchantCandidate, false, "merchant", merchant.id)).rows[0].result;
    assert.deepEqual(merchantMerged.shopee_targets.slice(0, 8), targets);
    assert.deepEqual(merchantMerged.shopee_targets[8], nextMerchant);
    await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where id=$2", [JSON.stringify(withMerchant), vaultId]);
    assert.equal((await begin(db, jobOne, claimOne, shops[0])).status, "acquired");
    const prepared = (await db.query(`select public.sellerpilot_service_prepare_cs_shopee_target_refresh_v1(
      $1,$2,$3,'shop',$4,$5::jsonb,null,false,false
    ) result`, [tokenHash, jobOne, claimOne, shops[0], JSON.stringify(candidate)])).rows[0].result;
    assert.equal(prepared.status, "prepared");
    assert.deepEqual((await db.query("select payload from sellerpilot_private.test_refresh_stages")).rows[0].payload.shopee_targets, candidate.shopee_targets);
    await assert.rejects(db.exec(boundsFix), /SHOPEE_REFRESH_BOUNDS_PREIMAGE_DRIFT/);
    await db.exec("rollback");
  } finally { await db.close(); }
});

test("expired refresh lease cannot discard an unresolved provider outcome and retry under another job", async () => {
  const db = await fixture();
  try {
    await db.exec(boundsFix);
    assert.equal((await begin(db, jobOne, claimOne, shops[0])).status, "acquired");
    await db.query("update sellerpilot_private.cs_shopee_target_refresh_claims set lease_expires_at=now()-interval '1 minute' where credential_id=$1", [credential]);
    await db.query("update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required' where id=$1", [jobOne]);
    await assert.rejects(begin(db, jobTwo, claimTwo, shops[0]), /SHOPEE_PRIOR_REFRESH_RECONCILIATION_REQUIRED/);
    const existing = (await db.query("select job_id,claim_token,target_id from sellerpilot_private.cs_shopee_target_refresh_claims where credential_id=$1", [credential])).rows[0];
    assert.deepEqual(existing, { job_id: jobOne, claim_token: claimOne, target_id: shops[0] });
    assert.equal((await db.query("select credential_refresh_in_flight value from sellerpilot_private.channel_gateway_jobs where id=$1", [jobTwo])).rows[0].value, false);
    assert.equal((await db.query("select count(*)::int n from sellerpilot_private.test_refresh_stages")).rows[0].n, 0);
    // Only the normal completed/reconciled state releases the prior claim.
    await db.query("update sellerpilot_private.channel_gateway_jobs set credential_refresh_in_flight=false where id=$1", [jobOne]);
    assert.equal((await begin(db, jobTwo, claimTwo, shops[0])).status, "acquired");
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query("select has_function_privilege($1,'sellerpilot_private.guard_shopee_unresolved_refresh_claim()','EXECUTE') ok", [role])).rows[0].ok, false);
    }
  } finally { await db.close(); }
});
