import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = await import("react");

const root = new URL("../", import.meta.url);
const baseMigration = new URL("supabase/migrations/20260908140411_cs_elevenst_read_state_alimi_ledger.sql", root);
const overflowMigration = new URL("../supabase/migrations/20260909105504_cs_elevenst_qna_overflow_observation.sql", import.meta.url);
const proposal = new URL("supabase/migrations/20260909121547_cs_elevenst_multi_account_identity.sql", root);
const admin = "22222222-2222-4222-8222-222222222222";
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "77777777-7777-4777-8777-777777777777";
const credentialA = "33333333-3333-4333-8333-333333333333";
const credentialB = "44444444-4444-4444-8444-444444444444";
const accountKeyA = "a".repeat(64);
const accountKeyB = "b".repeat(64);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/lib/admin-api")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const authenticateAdminRequest=(...args)=>globalThis.__elevenstAuthenticateAdmin(...args);export const isAdminApiError=()=>false",
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {panel:'panel',messages:'messages',accountSelector:'accountSelector'}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { executeElevenstInquiry } = await import("../lib/channels/elevenst-inquiries.ts");
const { buildElevenstCsReadObservation } = await import("../lib/cs/channels/elevenst/read-observation.ts");
const { GET } = await import("../app/api/admin/cs/channels/elevenst/read-state/route.ts");
const {
  ElevenstReadStatePanel,
  ElevenstReadStateSummary,
  fetchElevenstReadAccounts,
  fetchElevenstReadState,
} = await import("../app/cs/channels/elevenst/read-state.tsx");

async function createFixture() {
  const db = new PGlite();
  await db.exec([
    "create role anon noinherit; create role authenticated noinherit; create role service_role noinherit;",
    "create schema auth; create schema extensions; create schema sellerpilot_private;",
    "create function auth.uid() returns uuid language sql stable set search_path='' as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    "create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path='' as $$select auth.uid()='22222222-2222-4222-8222-222222222222'::uuid$$;",
    "create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable set search_path='' as $$select sha256(value)$$;",
    "create table sellerpilot_private.channel_credentials(id uuid primary key,channel text,environment text,created_by uuid,status text,seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,expires_at timestamptz,version integer,created_at timestamptz);",
    "create table sellerpilot_private.support_tickets(id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,resolved_at timestamptz,demo boolean default false,updated_at timestamptz,source_credential_id uuid,channel_account_id uuid,seller_account_key text,reply_context jsonb,provider_status text,provider_status_updated_at timestamptz,latest_inbound_key text,provider_context jsonb,external_order_reference text,ticket_kind text,unique(owner_id,channel_key,external_ticket_id));",
    "create table sellerpilot_private.support_inbound_messages(id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,received_at timestamptz,updated_at timestamptz,unique(owner_id,channel_key,inbound_key));",
    "create function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) returns integer language plpgsql security definer set search_path='' as $$begin if false then raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID'; end if; return 0; end$$;",
    "revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) from public,anon,authenticated,service_role;",
    "grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb) to service_role;",
  ].join("\n"));
  await db.query("insert into sellerpilot_private.channel_credentials values($1,'elevenst','production',$2,'active',$3,'credential_incarnation_v1',now(),now()+interval '1 day',2,now()),($4,'elevenst','production',$5,'active',$6,'credential_incarnation_v1',now(),now()+interval '1 day',3,now())", [credentialA, ownerA, accountKeyA, credentialB, ownerB, accountKeyB]);
  await db.query("insert into sellerpilot_private.channel_credentials values('55555555-5555-4555-8555-555555555555','elevenst','production',$1,'grace',$2,'credential_incarnation_v1',now(),now()+interval '1 day',4,now())", [ownerA, "c".repeat(64)]);
  await db.exec(await readFile(baseMigration, "utf8"));
  await db.exec(await readFile(overflowMigration, "utf8"));
  for (const [surface, statusFilter, parserMarker] of [
    ["product_qna", "00", "sellerpilot-elevenst-product-qna-parser/1"],
    ["urgent_alimi", null, "sellerpilot-elevenst-alimi-parser/1"],
  ]) {
    const observation = {
      surface, sellerId: "couplit", sellerName: "커플릿",
      scopeStart: "20260901", scopeEnd: "20260907", statusFilter,
      checkedAt: "2026-09-07T01:00:00.000Z", httpStatus: 200, accepted: true,
      resultCode: surface === "urgent_alimi" ? "0" : "200", providerRows: 0,
      parserMarker, parseIncomplete: false,
      evidenceSha256: createHash("sha256").update("legacy:" + surface).digest("hex"),
    };
    await db.exec("set role service_role");
    try {
      await db.query("select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,'[]'::jsonb)", [credentialA, JSON.stringify(observation)]);
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec(await readFile(proposal, "utf8"));
  return db;
}

async function serviceIdentity(db, credentialId) {
  await db.exec("set role service_role");
  try {
    return (await db.query("select public.sellerpilot_service_elevenst_cs_account_identity_v1($1) result", [credentialId])).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function writeActualProviderObservation(db, credentialId, identity, kind, checkedAt) {
  const arguments_ = kind === "product_qna"
    ? { kind, startDate: "20260903", endDate: "20260909", answerStatus: "00" }
    : { kind, startDate: "20260811", endDate: "20260909" };
  const execution = await executeElevenstInquiry({
    operation: "inquiries.list",
    payload: { api_key: "fixture-only" },
    arguments: arguments_,
  });
  const result = {
    ok: execution.steps.every((step) => step.ok),
    channel: "elevenst",
    operation: "inquiries.list",
    steps: execution.steps,
    safeMessage: "fixture provider read",
  };
  const receipt = buildElevenstCsReadObservation({
    result, arguments: arguments_, checkedAt, normalizedInquiries: [], identity,
  });
  await db.exec("set role service_role");
  try {
    return (await db.query("select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,$3::jsonb) result", [credentialId, JSON.stringify(receipt.observation), JSON.stringify(receipt.inquiries)])).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

function installAuthenticatedRpc(db) {
  globalThis.__elevenstAuthenticateAdmin = async () => ({
    userClient: {
      rpc: async (name, args = {}) => {
        await db.exec("set role authenticated");
        try {
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
          if (name === "sellerpilot_read_elevenst_cs_accounts_v1") {
            const data = (await db.query("select public.sellerpilot_read_elevenst_cs_accounts_v1() result")).rows[0].result;
            return { data, error: null };
          }
          if (name === "sellerpilot_read_elevenst_cs_read_state_v3") {
            const data = (await db.query("select public.sellerpilot_read_elevenst_cs_read_state_v3($1) result", [args.p_credential_id])).rows[0].result;
            return { data, error: null };
          }
          return { data: null, error: { code: "unexpected_rpc" } };
        } catch (error) {
          return { data: null, error: { code: error.code ?? "rpc_error" } };
        } finally {
          await db.exec("reset role");
        }
      },
    },
  });
}

test("CONT-07 actual provider parser to builder to canonical writer to GET/UI isolates two credential accounts", async () => {
  const db = await createFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const xml = String(input).includes("/prodqnalist/")
      ? "<productQnas><resultCode>200</resultCode></productQnas>"
      : "<alimi><resultCode>0</resultCode></alimi>";
    return new Response(xml, { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } });
  };
  try {
    const identityA = await serviceIdentity(db, credentialA);
    const identityB = await serviceIdentity(db, credentialB);
    assert.deepEqual([identityA.sellerId, identityA.sellerName], ["couplit", "커플릿"]);
    assert.match(identityB.sellerId, /^account_[a-f0-9]{32}$/u);
    assert.equal(identityB.sellerName, "11번가 연결 계정 · v3");
    assert.notEqual(identityB.sellerId, accountKeyB);
    for (const [credentialId, identity, minute] of [[credentialA, identityA, "10"], [credentialB, identityB, "20"]]) {
      for (const [kind, second] of [["product_qna", "00"], ["urgent_alimi", "01"]]) {
        const receipt = await writeActualProviderObservation(db, credentialId, identity, kind, "2026-09-09T10:" + minute + ":" + second + ".000Z");
        assert.equal(receipt.contract, "sellerpilot-elevenst-cs-read-record/1");
        assert.equal(receipt.accepted, true);
      }
    }
    const rows = (await db.query("select credential_id,seller_id,seller_name,surface from sellerpilot_private.elevenst_cs_read_observations where checked_at >= '2026-09-09T00:00:00Z' order by credential_id,surface")).rows;
    assert.equal(rows.length, 4);
    assert.deepEqual(new Set(rows.filter((row) => row.credential_id === credentialA).map((row) => row.seller_id)), new Set(["couplit"]));
    assert.deepEqual(new Set(rows.filter((row) => row.credential_id === credentialB).map((row) => row.seller_id)), new Set([identityB.sellerId]));
    installAuthenticatedRpc(db);
    const authenticatedFetch = async (input) => GET(new Request("https://sellerpilot.test" + input));
    const accounts = await fetchElevenstReadAccounts(authenticatedFetch);
    assert.deepEqual(accounts.map((account) => account.credentialId), [credentialB, credentialA]);
    assert.doesNotMatch(JSON.stringify(accounts), new RegExp(accountKeyA + "|" + accountKeyB, "u"));
    const first = await fetchElevenstReadState(authenticatedFetch, accounts[1].credentialId);
    const second = await fetchElevenstReadState(authenticatedFetch, accounts[0].credentialId);
    await assert.rejects(fetchElevenstReadState(async () => ({ok: true, json: async () => first}), credentialB), /ELEVENST_READ_ACCOUNT_MISMATCH/u);
    assert.deepEqual([first.sellerId, first.credentialId], ["couplit", credentialA]);
    assert.deepEqual([second.sellerId, second.credentialId], [identityB.sellerId, credentialB]);
    assert.match(renderToStaticMarkup(createElement(ElevenstReadStateSummary, { state: first })), /판매자 couplit · 커플릿/u);
    assert.match(renderToStaticMarkup(createElement(ElevenstReadStateSummary, { state: second })), /11번가 연결 계정 · v3/u);
    const panel = renderToStaticMarkup(createElement(ElevenstReadStatePanel, { authenticatedFetch }));
    assert.match(panel, /<select/u);
    assert.doesNotMatch(panel, /type="text"|credential ID|판매자 ID/u);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__elevenstAuthenticateAdmin;
    await db.close();
  }
});

test("CONT-07 writer rejects caller-forged identity and ACLs separate service write from admin reads", async () => {
  const db = await createFixture();
  try {
    const identity = await serviceIdentity(db, credentialB);
    const forged = {
      surface: "product_qna", sellerId: "couplit", sellerName: "커플릿",
      scopeStart: "20260903", scopeEnd: "20260909", statusFilter: "00",
      checkedAt: "2026-09-09T11:00:00.000Z", httpStatus: 200, accepted: true,
      resultCode: "200", providerRows: 0,
      parserMarker: "sellerpilot-elevenst-product-qna-parser/1", parseIncomplete: false,
      evidenceSha256: createHash("sha256").update("forged").digest("hex"),
    };
    await db.exec("set role service_role");
    try {
      await assert.rejects(db.query("select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,'[]'::jsonb)", [credentialB, JSON.stringify(forged)]), /ELEVENST_READ_CREDENTIAL_IDENTITY_MISMATCH/u);
    } finally {
      await db.exec("reset role");
    }
    assert.match(identity.sellerId, /^account_/u);
    const acl = (await db.query("select has_function_privilege('anon','public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)','EXECUTE') service_anon,has_function_privilege('authenticated','public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)','EXECUTE') service_authenticated,has_function_privilege('service_role','public.sellerpilot_service_elevenst_cs_account_identity_v1(uuid)','EXECUTE') service_service,has_function_privilege('anon','public.sellerpilot_read_elevenst_cs_accounts_v1()','EXECUTE') accounts_anon,has_function_privilege('authenticated','public.sellerpilot_read_elevenst_cs_accounts_v1()','EXECUTE') accounts_authenticated,has_function_privilege('service_role','public.sellerpilot_read_elevenst_cs_accounts_v1()','EXECUTE') accounts_service")).rows[0];
    assert.deepEqual(acl, {
      service_anon: false, service_authenticated: false, service_service: true,
      accounts_anon: false, accounts_authenticated: true, accounts_service: false,
    });
  } finally {
    await db.close();
  }
});
