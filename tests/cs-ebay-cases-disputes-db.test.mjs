import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908135249_ebay_case_dispute_history_ledger.sql",
  import.meta.url,
), "utf8");
const owner = "10000000-0000-4000-8000-000000000001";
const otherOwner = "10000000-0000-4000-8000-000000000002";
const credential = "20000000-0000-4000-8000-000000000001";
const sellerKey = "a".repeat(64);

const resolutionCase = {
  caseId: "fixture-case-1",
  status: "OPEN",
  itemId: "fixture-item-1",
  transactionId: "fixture-transaction-1",
  creationDate: "2026-09-01T00:00:00.000Z",
  lastModifiedDate: "2026-09-02T00:00:00.000Z",
  respondByDate: null,
  claimAmount: { value: "17.50", currency: "USD" },
  sellerBinding: "matched",
};
const paymentDispute = {
  paymentDisputeId: "fixture-dispute-1",
  orderId: "fixture-order-1",
  status: "ACTION_NEEDED",
  reason: "ITEM_NOT_RECOGNIZED",
  openDate: "2026-09-01T00:00:00.000Z",
  respondByDate: "2026-09-05T00:00:00.000Z",
  closedDate: null,
  amount: { value: "25.00", currency: "USD" },
  revision: 1,
  sellerResponse: null,
  resolutionOutcome: null,
  resolutionReason: null,
  evidenceRequestCount: 0,
};

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}'),('${otherOwner}');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      as $$select auth.uid() in ('${owner}'::uuid,'${otherOwner}'::uuid)$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      created_by uuid references auth.users(id),
      channel text,
      environment text,
      status text,
      seller_account_key text,
      seller_account_key_source text,
      expires_at timestamptz,
      seller_account_verified_at timestamptz default now()
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','ebay','production','active','${sellerKey}','provider_certified_v1', null, now()
    );
  `);
  await db.exec(migration);
  return db;
}

async function record(db, kind, nativeId, status, normalized, key = sellerKey) {
  return (await db.query(
    "select public.sellerpilot_service_record_ebay_case_dispute_history_v1($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb) result",
    [credential, key, kind, nativeId, status, "2026-09-02T00:00:00.000Z", JSON.stringify(normalized)],
  )).rows[0].result;
}

test("migration rejects nested values in known fields and expired credentials without writing history", async () => {
  const db = await fixture();
  try {
    for (const normalized of [
      { ...resolutionCase, itemId: { body: "must-not-store" } },
      { ...resolutionCase, transactionId: ["must-not-store"] },
      { ...resolutionCase, itemId: "x".repeat(241) },
    ]) await assert.rejects(record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, normalized), /HISTORY_UNSAFE_PAYLOAD/);
    await db.exec("update sellerpilot_private.channel_credentials set expires_at=now()-interval '1 second'");
    await assert.rejects(record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, resolutionCase), /CREDENTIAL_UNVERIFIED/);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.ebay_case_dispute_history_events")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("both history RPC migrations reject a NULL limit instead of reading an unbounded result", async () => {
  const db = await fixture();
  try {
    await db.exec(await readFile(new URL("../supabase/migrations/20260908135323_ebay_case_dispute_history_read_v2.sql", import.meta.url), "utf8"));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    for (const query of [
      "select public.sellerpilot_read_ebay_case_dispute_history_v1($1,null,null,null)",
      "select public.sellerpilot_read_ebay_case_dispute_history_v2($1,null,null,null,null)",
    ]) await assert.rejects(db.query(query, [credential]), /HISTORY_LIMIT_INVALID/);
  } finally { await db.close(); }
});

test("executable proposal ledger records safe case/dispute states idempotently and preserves state history", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const first = await record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, resolutionCase);
    const duplicate = await record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, resolutionCase);
    const dispute = await record(db, "payment_dispute", paymentDispute.paymentDisputeId, paymentDispute.status, paymentDispute);
    const changed = await record(db, "resolution_case", resolutionCase.caseId, "CLOSED", { ...resolutionCase, status: "CLOSED" });
    assert.equal(first.inserted, true);
    assert.equal(duplicate.inserted, false);
    assert.equal(dispute.inserted, true);
    assert.equal(changed.inserted, true);
    assert.match(first.observedStateSha256, /^[0-9a-f]{64}$/);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.ebay_case_dispute_history_events")).rows[0].count, 3);
  } finally { await db.close(); }
});

test("ledger rejects buyer/raw keys, nested address data, identity mismatch, and an uncertified seller key", async () => {
  const db = await fixture();
  try {
    for (const action of [
      () => record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, { ...resolutionCase, buyerNote: "must-not-store" }),
      () => record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, {
        ...resolutionCase, claimAmount: { ...resolutionCase.claimAmount, returnAddress: "must-not-store" },
      }),
      () => record(db, "resolution_case", "different-case", resolutionCase.status, resolutionCase),
      () => record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, resolutionCase, "b".repeat(64)),
    ]) await assert.rejects(action(), /EBAY_CASE_DISPUTE_(?:HISTORY_|CREDENTIAL_)/);
    assert.equal((await db.query("select count(*)::int count from sellerpilot_private.ebay_case_dispute_history_events")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("only service role records and only the authenticated owner administrator reads through the RPC", async () => {
  const db = await fixture();
  try {
    const recordSignature = "public.sellerpilot_service_record_ebay_case_dispute_history_v1(uuid,text,text,text,text,timestamp with time zone,jsonb)";
    const readSignature = "public.sellerpilot_read_ebay_case_dispute_history_v1(uuid,text,timestamp with time zone,integer)";
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, recordSignature])).rows[0].allowed, false);
    }
    assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [recordSignature])).rows[0].allowed, true);
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed", [readSignature])).rows[0].allowed, true);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, readSignature])).rows[0].allowed, false);
    }

    await db.exec("set role service_role");
    await record(db, "resolution_case", resolutionCase.caseId, resolutionCase.status, resolutionCase);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("set role authenticated");
    const history = (await db.query(
      "select public.sellerpilot_read_ebay_case_dispute_history_v1($1,'resolution_case',null,50) result",
      [credential],
    )).rows[0].result;
    assert.equal(history.events.length, 1);
    assert.equal(history.events[0].providerNativeId, resolutionCase.caseId);
    assert.doesNotMatch(JSON.stringify(history), /buyerNote|returnAddress|must-not-store/);
    await assert.rejects(db.query("select * from sellerpilot_private.ebay_case_dispute_history_events"), /permission denied/);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherOwner]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.sellerpilot_read_ebay_case_dispute_history_v1($1,null,null,50)", [credential]),
      /EBAY_CASE_DISPUTE_HISTORY_ACCOUNT_UNAVAILABLE/,
    );
  } finally { await db.close(); }
});
