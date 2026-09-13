import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const originalSql = await readFile(new URL(
  "../supabase/migrations/20260908140409_cs_lazada_im_ingest_v3.sql",
  import.meta.url,
), "utf8");
const patchSql = await readFile(new URL(
  "../supabase/migrations/20260913111500_lazada_im_ingest_country_binding.sql",
  import.meta.url,
), "utf8");

function originalFunction(name) {
  const start = originalSql.indexOf(`create function public.${name}`);
  assert.notEqual(start, -1, `${name} source is required`);
  const end = originalSql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} terminator is required`);
  return originalSql.slice(start, end + 4);
}

const db = new PGlite({ extensions: { pgcrypto } });
after(async () => db.close());

const owner = "10000000-0000-4000-8000-000000000001";
const legacyCredential = "10000000-0000-4000-8000-000000000002";
const exactCredential = "10000000-0000-4000-8000-000000000003";
const mismatchCredential = "10000000-0000-4000-8000-000000000004";
const expiredCredential = "10000000-0000-4000-8000-000000000005";
const incompleteCredential = "10000000-0000-4000-8000-000000000006";
const account = "a".repeat(64);
const app = "b".repeat(64);
const token = "c".repeat(64);
const countries = ["MY", "PH", "SG", "TH", "VN"];

await db.exec(`
  create schema extensions;
  create extension pgcrypto with schema extensions;
  create schema auth;
  create schema sellerpilot_private;
  do $$begin create role anon; exception when duplicate_object then null; end$$;
  do $$begin create role authenticated; exception when duplicate_object then null; end$$;
  do $$begin create role service_role; exception when duplicate_object then null; end$$;

  create table auth.users(id uuid primary key);
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
  create table sellerpilot_private.lazada_im_message_revisions(
    id bigint generated always as identity primary key,
    owner_id uuid not null references auth.users(id),
    credential_id uuid not null references sellerpilot_private.channel_credentials(id),
    seller_account_key text not null,
    external_ticket_id text not null,
    remote_message_id text not null,
    revision_kind text not null,
    sender_role text not null,
    native_content_fingerprint text not null,
    body_fingerprint text not null,
    attachment_fingerprint text not null,
    app_fingerprint text not null,
    token_fingerprint text not null,
    country text not null,
    provider_context jsonb not null default '{}'::jsonb,
    first_observed_at timestamptz not null default clock_timestamp(),
    unique(owner_id,seller_account_key,external_ticket_id,remote_message_id,
      revision_kind,native_content_fingerprint)
  );

  create function public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)
  returns jsonb language sql security definer set search_path=''
  as $$select jsonb_build_object(
    'contract','lazada_ingest_v2','status','complete',
    'normalCount',jsonb_array_length($2),'quarantinedCount',0,
    'pendingCount',0,'conflictCount',0,'expiredUnstoredCount',0
  )$$;

  ${originalFunction("sellerpilot_service_lazada_im_ingest_ready_v3")}
  ${originalFunction("sellerpilot_service_ingest_lazada_inquiries_v3")}
  revoke all on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)
    from public,anon,authenticated;
  grant execute on function public.sellerpilot_service_lazada_im_ingest_ready_v3(uuid)
    to service_role;
  revoke all on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
    from public,anon,authenticated;
  grant execute on function public.sellerpilot_service_ingest_lazada_inquiries_v3(uuid,jsonb)
    to service_role;
`);

await db.query("insert into auth.users values($1)", [owner]);
for (const credential of [
  legacyCredential, exactCredential, mismatchCredential, expiredCredential, incompleteCredential,
]) {
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,status,expires_at,seller_account_key,
    seller_account_key_source,seller_account_verified_at
  ) values($1,$2,'lazada','active',now()+interval '30 days',$3,
    'provider_certified_v1',clock_timestamp())`, [credential, owner, account]);
}

async function bind(credential, country, {
  appFingerprint = app,
  tokenFingerprint = token,
  expires = "future",
} = {}) {
  await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
    credential_id,channel,operation,country,app_fingerprint,token_fingerprint,
    target_fingerprint,status,expires_at
  ) values($1,'lazada','inquiries.list',$2,$3,$4,$5,'active',
    case when $6='future' then now()+interval '1 day' else now()-interval '1 second' end
  )`, [
    credential,
    country,
    appFingerprint,
    tokenFingerprint,
    Buffer.from(`${credential}:${country}`).toString("hex").slice(0, 64).padEnd(64, "0"),
    expires,
  ]);
}

function inquiry(id, country) {
  return {
    externalTicketId: `lazada-im:session-${id}`,
    customerName: "Synthetic buyer",
    subject: "Synthetic inquiry",
    message: `message-${id}`,
    status: "waiting",
    priority: 3,
    receivedAt: "2026-09-13T10:00:00Z",
    remoteMessageId: id,
    providerContext: {
      nativeContentFingerprint: Buffer.from(id).toString("hex").slice(0, 64).padEnd(64, "0"),
      ...(country !== undefined ? { country } : {}),
    },
  };
}

async function ready(credential) {
  return (await db.query(
    "select public.sellerpilot_service_lazada_im_ingest_ready_v3($1) ready",
    [credential],
  )).rows[0].ready;
}

async function ingest(credential, rows) {
  return (await db.query(
    "select public.sellerpilot_service_ingest_lazada_inquiries_v3($1,$2::jsonb) result",
    [credential, JSON.stringify(rows)],
  )).rows[0].result;
}

test("migration accepts the reviewed live preimage and preserves owner and service-only ACLs", async () => {
  await db.exec(patchSql);
  const functions = (await db.query(`select p.proname,pg_get_userbyid(p.proowner) owner,
      p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
      has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in(
      'sellerpilot_service_lazada_im_ingest_ready_v3',
      'sellerpilot_service_ingest_lazada_inquiries_v3'
    ) order by p.proname`)).rows;
  assert.equal(functions.length, 2);
  for (const fn of functions) {
    assert.equal(fn.owner, "postgres");
    assert.equal(fn.prosecdef, true);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
    assert.equal(fn.anon_execute, false);
    assert.equal(fn.authenticated_execute, false);
    assert.equal(fn.service_execute, true);
  }
});

test("one-country legacy readiness and missing-country fallback remain valid", async () => {
  await bind(legacyCredential, "MY");
  assert.equal(await ready(legacyCredential), true);
  const accepted = await ingest(legacyCredential, [inquiry("legacy-missing")]);
  assert.equal(accepted.status, "complete");
  assert.deepEqual((await db.query(`select remote_message_id,country
    from sellerpilot_private.lazada_im_message_revisions
    where credential_id=$1`, [legacyCredential])).rows, [
    { remote_message_id: "legacy-missing", country: "MY" },
  ]);

  const rejected = await ingest(legacyCredential, [inquiry("legacy-wrong", "PH")]);
  assert.equal(rejected.status, "partial");
  assert.equal(rejected.pendingCount, 1);
  assert.equal((await db.query(`select count(*)::int n
    from sellerpilot_private.lazada_im_message_revisions
    where credential_id=$1 and remote_message_id='legacy-wrong'`, [legacyCredential])).rows[0].n, 0);
});

test("exact five-country credential binds each admitted row to its verified country", async () => {
  for (const country of countries) await bind(exactCredential, country);
  assert.equal(await ready(exactCredential), true);
  const result = await ingest(exactCredential, [
    inquiry("exact-ph", "ph"),
    inquiry("exact-vn", "VN"),
  ]);
  assert.equal(result.status, "complete");
  assert.deepEqual((await db.query(`select remote_message_id,country,app_fingerprint,token_fingerprint
    from sellerpilot_private.lazada_im_message_revisions
    where credential_id=$1 order by remote_message_id`, [exactCredential])).rows, [
    { remote_message_id: "exact-ph", country: "PH", app_fingerprint: app, token_fingerprint: token },
    { remote_message_id: "exact-vn", country: "VN", app_fingerprint: app, token_fingerprint: token },
  ]);
});

test("multi-country rows with missing, wrong, or malformed country stay pending without a MY projection", async () => {
  const malformed = inquiry("exact-malformed", 7);
  const result = await ingest(exactCredential, [
    inquiry("exact-my", "MY"),
    inquiry("exact-missing"),
    inquiry("exact-wrong", "ID"),
    malformed,
  ]);
  assert.equal(result.status, "partial");
  assert.equal(result.pendingCount, 3);
  assert.deepEqual((await db.query(`select remote_message_id,country
    from sellerpilot_private.lazada_im_message_revisions
    where credential_id=$1 and remote_message_id like 'exact-%'
    order by remote_message_id`, [exactCredential])).rows, [
    { remote_message_id: "exact-my", country: "MY" },
    { remote_message_id: "exact-ph", country: "PH" },
    { remote_message_id: "exact-vn", country: "VN" },
  ]);
});

test("partial, mixed-fingerprint, and expired five-country capability sets fail closed", async () => {
  for (const country of countries.slice(0, 4)) await bind(incompleteCredential, country);
  for (const [index, country] of countries.entries()) {
    await bind(mismatchCredential, country, {
      appFingerprint: index === 4 ? "d".repeat(64) : app,
    });
    await bind(expiredCredential, country, {
      expires: index === 4 ? "expired" : "future",
    });
  }
  assert.equal(await ready(incompleteCredential), false);
  assert.equal(await ready(mismatchCredential), false);
  assert.equal(await ready(expiredCredential), false);
  await assert.rejects(
    ingest(incompleteCredential, [inquiry("partial-set", "MY")]),
    /LAZADA_IM_INGEST_V3_BINDING_REQUIRED/,
  );
  await assert.rejects(
    ingest(mismatchCredential, [inquiry("mismatch-set", "MY")]),
    /LAZADA_IM_INGEST_V3_BINDING_REQUIRED/,
  );
  await assert.rejects(
    ingest(expiredCredential, [inquiry("expired-set", "MY")]),
    /LAZADA_IM_INGEST_V3_BINDING_REQUIRED/,
  );
});
