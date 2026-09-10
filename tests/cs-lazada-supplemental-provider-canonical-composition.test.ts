import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const base = await readFile(new URL("20260816060000_channel_credentials_and_roles.sql", migrations), "utf8");
const lineage = await readFile(new URL("20260825111800_bind_listing_seller_accounts.sql", migrations), "utf8");
const bindings = await readFile(new URL("20260908000000_add_cs_credential_capability_bindings.sql", migrations), "utf8");
const multiAccount = await readFile(new URL("20260909124048_cs_lazada_multi_account_scope.sql", migrations), "utf8");
const canonicalLedger = await readFile(new URL("20260909165423_cs_lazada_supplemental_read_ledger.sql", migrations), "utf8");
const boundary = await readFile(new URL("20260909181000_cs_lazada_supplemental_provider_ingest.sql", migrations), "utf8");

function fragment(source: string, pattern: RegExp, name: string) {
  const value = source.match(pattern)?.[0];
  assert.ok(value, `missing canonical ${name}`);
  return value;
}

const adminTable = fragment(base, /create table if not exists sellerpilot_private\.admin_users \([\s\S]*?\n\);/u, "admin table");
const credentialTable = fragment(base, /create table if not exists sellerpilot_private\.channel_credentials \([\s\S]*?\n\);/u, "credential table");
const originalIndex = fragment(base, /create unique index if not exists channel_credentials_one_active_idx[\s\S]*?;/u, "credential index");
const isAdmin = fragment(base, /create or replace function public\.sellerpilot_is_admin\(\)[\s\S]*?\$\$;/u, "admin function");
const sellerColumns = fragment(lineage, /alter table sellerpilot_private\.channel_credentials\n\s{2}add column[\s\S]*?;/u, "seller columns");
const sellerConstraint = fragment(lineage, /alter table sellerpilot_private\.channel_credentials\n\s{2}drop constraint[\s\S]*?\n\s{2}\);/u, "seller constraint");
const sellerNotNull = fragment(lineage, /alter table sellerpilot_private\.channel_credentials\n\s{2}alter column seller_account_key_source set not null;/u, "seller not null");
const bindingTable = fragment(bindings, /create table sellerpilot_private\.cs_credential_capability_bindings\([\s\S]*?\n\);/u, "binding table");
const bindingIndex = fragment(bindings, /create index cs_credential_capability_bindings_health_idx[\s\S]*?;/u, "binding index");
const bindingAcl = fragment(bindings, /alter table sellerpilot_private\.cs_credential_capability_bindings enable row level security;\nrevoke all on sellerpilot_private\.cs_credential_capability_bindings from public,anon,authenticated,service_role;/u, "binding ACL");
const multiIndexes = fragment(multiAccount, /drop index if exists sellerpilot_private\.channel_credentials_one_active_idx;[\s\S]*?seller_account_key is null;/u, "multi-account indexes");

test("canonical credential, generated binding, supplemental grant and ACLs compose", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const owner = "00000000-0000-4000-8000-000000008301";
  const credential = "00000000-0000-4000-8000-000000008302";
  const job = "00000000-0000-4000-8000-000000008303";
  const bindingId = "00000000-0000-4000-8000-000000008304";
  const subject = `lazada:v1:${"B".repeat(40)}`;
  const sellerKey = createHash("sha256")
    .update(["lazada", "production", subject].join("\u001f"), "utf8").digest("hex");
  const generated = csCredentialBindingEvidence({
    channel: "lazada",
    operation: "inquiries.list",
    credential: {
      app_key: "canonical-app",
      app_secret: "canonical-secret",
      access_token: "canonical-token",
      country: "MY",
      provider_account_subject: subject,
    },
    request: { arguments: {} },
  });
  assert.ok(generated);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private; create schema extensions;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      ${adminTable}
      ${credentialTable}
      ${originalIndex}
      ${sellerColumns}
      ${sellerConstraint}
      ${sellerNotNull}
      create table sellerpilot_private.channel_gateway_jobs(id uuid primary key);
      ${bindingTable}
      ${bindingIndex}
      ${bindingAcl}
      ${isAdmin}
      ${multiIndexes}
    `);
    await db.exec(canonicalLedger);
    await db.exec(boundary);
    await db.query("insert into auth.users values($1)", [owner]);
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,created_by,
      seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values($1,'lazada','production',1,$2,'canonical',$3,$4,'provider_certified_v1',clock_timestamp())`, [
      credential, "00000000-0000-4000-8000-000000008305", owner, sellerKey,
    ]);
    await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1)", [job]);
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
      id,credential_id,channel,operation,country,app_fingerprint,token_fingerprint,target_fingerprint,
      status,verified_job_id,verified_at,expires_at
    ) values($1,$2,'lazada','inquiries.list','MY',$3,$4,$5,'active',$6,clock_timestamp(),clock_timestamp()+interval '1 day')`, [
      bindingId, credential, generated.appFingerprint, generated.tokenFingerprint,
      generated.targetFingerprints[0], job,
    ]);
    await db.exec("set role service_role");
    const grant = (await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb) value`, [bindingId, JSON.stringify({
      contractVersion: "sellerpilot-lazada-supplemental-permission-readback/1",
      verificationSource: "lazada_app_permission_readback",
      providerRequestId: "canonical-permission-readback",
      providerEvidenceDigest: "f".repeat(64),
      bindingTargetFingerprint: generated.targetFingerprints[0],
      credentialId: credential,
      sellerAccountKey: sellerKey,
      country: "MY",
      surface: "product_review",
      sourcePath: "/review/seller/list",
    })])).rows[0]?.value;
    assert.equal(grant.status, "active");
    const prepared = (await db.query(`select public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
      $1,'MY','/review/seller/list','1001',20) value`, [credential])).rows[0]?.value;
    assert.equal(prepared.sellerAccountKey, sellerKey);
    assert.equal(prepared.pageNumber, 1);
    await assert.rejects(db.query("select count(*) from sellerpilot_private.lazada_supplemental_read_grants"),
      /permission denied/u);
    await assert.rejects(db.query("select count(*) from sellerpilot_private.lazada_supplemental_read_progress"),
      /permission denied/u);
  } finally { await db.close(); }
});
