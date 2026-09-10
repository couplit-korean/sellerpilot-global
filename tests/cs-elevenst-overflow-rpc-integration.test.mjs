import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { executeChannelOperation } from "../lib/channels/operations.ts";
import { buildElevenstCsReadObservation } from "../lib/cs/channels/elevenst/read-observation.ts";

const identity = {
  contract: "sellerpilot-elevenst-cs-account-identity/1",
  credentialId: "33333333-3333-4333-8333-333333333333",
  sellerId: "couplit",
  sellerName: "커플릿",
  environment: "production",
  version: 1,
  verifiedAt: "2026-09-09T09:59:00.000Z",
};

const canonicalMigration = new URL(
  "../supabase/migrations/20260908140411_cs_elevenst_read_state_alimi_ledger.sql",
  import.meta.url,
);
const owner = "11111111-1111-4111-8111-111111111111";
const credential = "33333333-3333-4333-8333-333333333333";
const wrongChannelCredential = "44444444-4444-4444-8444-444444444444";
const expiredCredential = "55555555-5555-4555-8555-555555555555";
const inactiveCredential = "66666666-6666-4666-8666-666666666666";
const sellerAccountKey = "a".repeat(64);

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function qnaRowsXml(count) {
  return `<productQnas>${Array.from(
    { length: count },
    (_, index) => `<productQna><brdInfoNo>${index + 1}</brdInfoNo></productQna>`,
  ).join("")}</productQnas>`;
}

async function providerObservation(count) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(qnaRowsXml(count), {
    status: 200,
    headers: { "content-type": "application/xml;charset=UTF-8" },
  });
  try {
    const arguments_ = {
      kind: "product_qna",
      startDate: "20260902",
      endDate: "20260908",
      answerStatus: "00",
    };
    const result = await executeChannelOperation({
      channel: "elevenst",
      operation: "inquiries.list",
      payload: { api_key: "test-only-elevenst-key" },
      arguments: arguments_,
      environment: "production",
    });
    const built = buildElevenstCsReadObservation({
    identity,
      result,
      arguments: arguments_,
      checkedAt: "2026-09-09T10:00:00.000Z",
      normalizedInquiries: [],
    });
    assert.equal(result.ok, count <= 500);
    assert.equal(built.observation.providerRows, count);
    assert.equal(built.observation.parseIncomplete, count > 500);
    assert.equal(built.observation.accepted, count <= 500);
    assert.deepEqual(built.inquiries, []);
    return { ...built, result };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema extensions;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select false$$;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable set search_path=''
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text, environment text, created_by uuid, status text,
      seller_account_key text, seller_account_key_source text, seller_account_verified_at timestamptz,
      expires_at timestamptz, version integer default 1, created_at timestamptz default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(), owner_id uuid, external_ticket_id text, channel_key text,
      customer_name text, subject text, message text, status text, priority integer, received_at timestamptz,
      resolved_at timestamptz, demo boolean default false, updated_at timestamptz default now(),
      source_credential_id uuid, channel_account_id uuid, seller_account_key text,
      reply_context jsonb default '{}'::jsonb, provider_status text default 'unknown',
      provider_status_updated_at timestamptz, latest_inbound_key text,
      provider_context jsonb default '{}'::jsonb, external_order_reference text,
      ticket_kind text default 'conversation', unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(), ticket_id uuid, owner_id uuid, channel_key text,
      inbound_key text, remote_message_id text, sender_role text, body text, provider_context jsonb,
      received_at timestamptz, updated_at timestamptz default now(), unique(owner_id,channel_key,inbound_key)
    );
    create function public.sellerpilot_service_ingest_inquiries(
      p_credential_id uuid,p_channel text,p_inquiries jsonb
    ) returns integer language plpgsql security definer set search_path='' as $$
    begin
      if false then raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID'; end if;
      return jsonb_array_length(p_inquiries);
    end$$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      to service_role;
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,created_by,status,seller_account_key,
      seller_account_key_source,seller_account_verified_at,expires_at,version,created_at
    ) values
      ('${credential}','elevenst','production','${owner}','active','${sellerAccountKey}',
       'credential_incarnation_v1',now(),now()+interval '30 days',2,now()-interval '1 minute'),
      ('${wrongChannelCredential}','shopee','production','${owner}','active','${"b".repeat(64)}',
       'credential_incarnation_v1',now(),now()+interval '30 days',1,now()-interval '1 minute'),
      ('${expiredCredential}','elevenst','production','${owner}','active','${"c".repeat(64)}',
       'provider_certified_v1',now(),now()-interval '1 day',1,now()-interval '2 days'),
      ('${inactiveCredential}','elevenst','production','${owner}','grace','${"d".repeat(64)}',
       'provider_certified_v1',now(),now()+interval '30 days',1,now()-interval '2 minutes');
  `);
  const migration = await readFile(canonicalMigration, "utf8");
  await db.exec(migration);
  return { db, migration };
}

async function asRole(db, role, callback) {
  await db.exec(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function record(db, credentialId, observation, inquiries = []) {
  return asRole(db, "service_role", async () => (await db.query(
    "select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,$3::jsonb) result",
    [credentialId, JSON.stringify(observation), JSON.stringify(inquiries)],
  )).rows[0].result);
}

async function applyProposal(db) {
  await db.exec(await readFile(new URL("../supabase/migrations/20260909105504_cs_elevenst_qna_overflow_observation.sql", import.meta.url), "utf8"));
}

function variant(observation, changes) {
  const next = { ...observation, ...changes };
  return { ...next, evidenceSha256: sha(JSON.stringify(next)) };
}

test("CONT-04 reproduces canonical 501 and 5002 rejection, then stores honest overflow evidence", async () => {
  const overflow501 = await providerObservation(501);
  const overflow5002 = await providerObservation(5_002);
  assert.match(
    String(overflow501.result.steps[0]?.data.sellerpilotElevenstProductQnaParseError),
    /DB_BATCH_LIMIT_EXCEEDED/u,
  );
  assert.match(
    String(overflow5002.result.steps[0]?.data.sellerpilotElevenstProductQnaParseError),
    /PARSER_ROW_LIMIT_EXCEEDED/u,
  );

  const { db } = await fixture();
  try {
    await assert.rejects(record(db, credential, overflow501.observation), /ELEVENST_READ_OBSERVATION_INVALID/u);
    await assert.rejects(record(db, credential, overflow5002.observation));
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.elevenst_cs_read_observations",
    )).rows[0].count, 0);

    await applyProposal(db);
    for (const built of [overflow501, overflow5002]) {
      const stored = await record(db, credential, built.observation, built.inquiries);
      assert.equal(stored.accepted, false);
      assert.equal(stored.providerRows, built.observation.providerRows);
      assert.equal(stored.storedRows, 0);
    }
    assert.deepEqual((await db.query(`select provider_rows,accepted,parse_incomplete
      from sellerpilot_private.elevenst_cs_read_observations order by provider_rows`)).rows, [
      { provider_rows: 501, accepted: false, parse_incomplete: true },
      { provider_rows: 5002, accepted: false, parse_incomplete: true },
    ]);
  } finally {
    await db.close();
  }
});

test("CONT-04 proposal preserves normal success and rejects forged overflow, scope and lineage", async () => {
  const normal = await providerObservation(0);
  const overflow = await providerObservation(501);
  const { db } = await fixture();
  try {
    await applyProposal(db);
    assert.equal((await record(db, credential, normal.observation)).accepted, true);

    const overflowWithBusinessCode = variant(overflow.observation, { resultCode: "500" });
    assert.equal((await record(db, credential, overflowWithBusinessCode)).accepted, false);

    const invalid = [
      variant(overflow.observation, { parserMarker: null }),
      variant(normal.observation, { parserMarker: null }),
      variant(overflow.observation, { surface: "urgent_alimi", providerRows: 5002, statusFilter: null, parserMarker: "sellerpilot-elevenst-alimi-parser/1" }),
      variant(overflow.observation, { accepted: true }),
      variant(overflow.observation, { parseIncomplete: false }),
      variant(overflow.observation, { providerRows: 500 }),
      variant(overflow.observation, { parserMarker: "sellerpilot-elevenst-alimi-parser/1" }),
      variant(overflow.observation, { providerRows: 1_000_001 }),
      variant(overflow.observation, { scopeStart: "20260901" }),
      variant(normal.observation, { resultCode: "500" }),
    ];
    for (const observation of invalid) {
      await assert.rejects(record(db, credential, observation), /ELEVENST_READ_OBSERVATION_INVALID/u);
    }
    for (const credentialId of [wrongChannelCredential, expiredCredential, inactiveCredential]) {
      await assert.rejects(
        record(db, credentialId, variant(overflow.observation, { evidenceSha256: sha(credentialId) })),
        /ELEVENST_READ_ACTIVE_LINEAGE_REQUIRED/u,
      );
    }

    const row = (await db.query(`select owner_id::text,credential_id::text,seller_account_key
      from sellerpilot_private.elevenst_cs_read_observations where provider_rows=0`)).rows[0];
    assert.deepEqual(row, {
      owner_id: owner,
      credential_id: credential,
      seller_account_key: sellerAccountKey,
    });
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(asRole(db, role, () => db.query(
        "select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,$3::jsonb)",
        [credential, JSON.stringify(normal.observation), "[]"],
      )), { code: "42501" });
    }
    const acl = (await db.query(`select
      has_function_privilege('anon','public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)','EXECUTE') anon,
      has_function_privilege('authenticated','public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)','EXECUTE') authenticated,
      has_function_privilege('service_role','public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)','EXECUTE') service_role`)).rows[0];
    assert.deepEqual(acl, { anon: false, authenticated: false, service_role: true });
  } finally {
    await db.close();
  }
});
