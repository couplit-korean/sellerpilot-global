// Review-only SQL candidate regression. Executes extracted UPDATE statements in
// an isolated PGlite database, not whole migrations or the live completion RPC.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ledger = await readFile(new URL("../supabase/migrations/20260830100000_verified_remote_publication_ledger.sql", import.meta.url), "utf8");
const predecessor = await readFile(new URL("../supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql", import.meta.url), "utf8");
const fence = await readFile(new URL("../supabase/migrations/20260906043000_external_detail_channel_fence.sql", import.meta.url), "utf8");
const approval = await readFile(new URL("../supabase/migrations/20260906040000_external_detail_import.sql", import.meta.url), "utf8");
const product = "1ed4acfc-7603-48ec-a638-241131e59358";
const importId = "11111111-1111-4111-8111-111111111111";
const stamp = "2026-09-06 03:19:01.757195+00";
const metadataUpdate = ledger.match(/ {2}update sellerpilot_private\.products product\n {5}set status = case[\s\S]*?where product\.id = v_listing\.product_id;/)?.[0];
const successUpdate = predecessor.match(/ {4}update sellerpilot_private\.products p\n {7}set status = 'active', updated_at = now\(\)\n {5}where p\.id = v_product_id;/)?.[0];
assert.ok(metadataUpdate && successUpdate);
const preserve = (sql, alias, clock) => sql.replace(`updated_at = ${clock}`, `updated_at = case when ${alias}.external_detail_import_id is not null then ${alias}.updated_at else ${clock} end`);
const candidateMetadata = preserve(metadataUpdate, "product", "clock_timestamp()");
const candidateSuccess = preserve(successUpdate, "p", "now()");
const freezeFunction = fence.slice(fence.indexOf("create function sellerpilot_private.freeze_inflight_external_detail_product()"), fence.indexOf("revoke all on function sellerpilot_private.freeze_inflight_external_detail_product()"));
const mismatchLine = approval.split("\n").find((line) => line.includes("raise exception 'EXTERNAL_DETAIL_APPROVAL_MISMATCH'"));
assert.ok(mismatchLine);

async function fixture({ external = true, stale = false } = {}) {
  const db = new PGlite();
  await db.exec(`create schema sellerpilot_private;
    create table sellerpilot_private.products(id uuid primary key, owner_id uuid, name text, status text, updated_at timestamptz,
      external_detail_import_id uuid, detail_page_version bigint, ai_job_id uuid, detail_page_data jsonb, on_hand int, reserved int);
    create table sellerpilot_private.external_detail_imports(id uuid primary key, status text, approved_product_updated_at timestamptz, approved_detail_version bigint, payload jsonb);
    create table sellerpilot_private.product_listings(product_id uuid, requested_publication_intent text, remote_visibility text, published_at timestamptz);
    create table sellerpilot_private.channel_gateway_jobs(status text, request_payload jsonb);
    insert into sellerpilot_private.products values('${product}','${importId}','unchanged source','draft','${stamp}',${external ? `'${importId}'` : "null"},2,'${importId}','{}',1,0);
    insert into sellerpilot_private.external_detail_imports values('${importId}','approved','${stamp}',2,'{"expectedAiJobId":"${importId}"}');
    ${freezeFunction}
    create trigger external_detail_product_inflight_guard before update on sellerpilot_private.products for each row execute function sellerpilot_private.freeze_inflight_external_detail_product();
    create function check_approval() returns boolean language plpgsql as $$
      declare p sellerpilot_private.products%rowtype; r sellerpilot_private.external_detail_imports%rowtype;
      begin select * into p from sellerpilot_private.products; select * into r from sellerpilot_private.external_detail_imports;
      ${mismatchLine} return true; end $$;
    insert into sellerpilot_private.channel_gateway_jobs values('reconciliation_required','{"arguments":{"sellerpilotExternalDetail":{"importId":"${importId}"}}}');
  `);
  if (stale) await db.exec("update sellerpilot_private.products set updated_at=updated_at+interval '1 second'");
  return db;
}
async function state(db) {
  return (await db.query("select status,updated_at::text,name,detail_page_version,ai_job_id::text,detail_page_data from sellerpilot_private.products")).rows[0];
}
async function runUpdate(db, sql) {
  await db.exec(sql.replaceAll("v_listing.product_id", `'${product}'::uuid`).replaceAll("v_product_id", `'${product}'::uuid`).replaceAll("p_prior_product_status", "'draft'"));
}

test("original failed/recon bookkeeping invalidates approval without changing any source field", async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    await runUpdate(db, metadataUpdate);
    const after = await state(db);
    assert.notEqual(after.updated_at, before.updated_at);
    assert.deepEqual({ ...after, updated_at: before.updated_at }, before);
    await assert.rejects(db.query("select check_approval()"), /EXTERNAL_DETAIL_APPROVAL_MISMATCH/);
  } finally { await db.close(); }
});

test("candidate retains approval through failed/recon bookkeeping and repeated completion", async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    const imports = (await db.query("select * from sellerpilot_private.external_detail_imports")).rows;
    await runUpdate(db, candidateMetadata);
    await runUpdate(db, candidateMetadata);
    assert.deepEqual(await state(db), before);
    assert.equal((await db.query("select check_approval() as valid")).rows[0].valid, true);
    assert.deepEqual((await db.query("select * from sellerpilot_private.external_detail_imports")).rows, imports);
    assert.equal((await db.query("select status from sellerpilot_private.channel_gateway_jobs")).rows[0].status, "reconciliation_required");
  } finally { await db.close(); }
});

test("both success predecessor and final status aggregation must preserve source time", async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    await runUpdate(db, candidateSuccess);
    assert.equal((await state(db)).status, "active");
    assert.equal((await state(db)).updated_at, before.updated_at);
    await runUpdate(db, candidateMetadata);
    assert.equal((await state(db)).status, "draft");
    assert.equal((await db.query("select check_approval() as valid")).rows[0].valid, true);
  } finally { await db.close(); }
});

test("legacy products retain timestamp updates", async () => {
  for (const sql of [candidateMetadata, candidateSuccess]) {
    const db = await fixture({ external: false });
    try { const before = await state(db); await runUpdate(db, sql); assert.notEqual((await state(db)).updated_at, before.updated_at); }
    finally { await db.close(); }
  }
});

test("candidate never restores an already-stale approval timestamp", async () => {
  const db = await fixture({ stale: true });
  try {
    const before = await state(db);
    await runUpdate(db, candidateSuccess); await runUpdate(db, candidateMetadata);
    assert.equal((await state(db)).updated_at, before.updated_at);
    await assert.rejects(db.query("select check_approval()"), /EXTERNAL_DETAIL_APPROVAL_MISMATCH/);
  } finally { await db.close(); }
});

test("source mutation fences and explicit timestamp invalidation remain intact", async () => {
  const db = await fixture();
  try {
    for (const change of ["name='new source'", "detail_page_version=3", "detail_page_data='{\"new\":true}'", "ai_job_id=null"])
      await assert.rejects(db.exec(`update sellerpilot_private.products set ${change}`), /EXTERNAL_DETAIL_PRODUCT_HAS_INFLIGHT_PUBLICATION/);
    await db.exec("update sellerpilot_private.products set updated_at=updated_at+interval '1 microsecond'");
    await assert.rejects(db.query("select check_approval()"), /EXTERNAL_DETAIL_APPROVAL_MISMATCH/);
  } finally { await db.close(); }
});
