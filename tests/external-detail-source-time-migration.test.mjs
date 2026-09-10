// Full function DDL/preimage regression only. No worker/RPC/provider execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const fixture = JSON.parse(await readFile(new URL("./fixtures/external-detail-source-time-live-20260906.json", import.meta.url), "utf8"));
const migration = await readFile(new URL("../supabase/migrations/20260906222500_preserve_external_detail_source_time_on_completion.sql", import.meta.url), "utf8");
const targets = fixture.functions.filter((row) => row.patchedDefinition);
const wrappers = fixture.functions.filter((row) => !row.patchedDefinition);
const md5 = (value) => createHash("md5").update(value).digest("hex");
const body = (definition) => definition.slice(definition.indexOf("AS $function$") + 13, definition.lastIndexOf("$function$"));

async function setup() {
  const db = new PGlite();
  await db.exec("create schema sellerpilot_private; create role anon; create role authenticated; create role service_role;");
  for (const row of fixture.functions) {
    await db.exec(row.definition);
    await db.exec(`revoke all on function ${row.signature} from public, anon, authenticated, service_role;`);
    if (!row.patchedDefinition) await db.exec(`grant execute on function ${row.signature} to service_role;`);
  }
  return db;
}
async function snapshot(db) {
  const rows = [];
  for (const row of fixture.functions) {
    const found = (await db.query(`select pg_get_functiondef(oid) as definition,md5(prosrc) as source_md5,
      proowner,proacl::text,proconfig,prosecdef,provolatile,proparallel,proisstrict,proleakproof
      from pg_proc where oid=to_regprocedure($1)`, [row.signature])).rows[0];
    rows.push({ signature: row.signature, ...found });
  }
  return rows;
}
async function rejected(db, expected) {
  try { await assert.rejects(db.exec(migration), expected); }
  finally { await db.exec("rollback"); }
}

test("captured live sources match supplied hashes and each candidate changes exactly one timestamp expression", () => {
  assert.deepEqual(targets.map((row) => row.source_md5), ["00f2ed7e65763f98b46229a897e07837", "19fa8a75c97d100498d60a4624071f53"]);
  for (const row of targets) {
    assert.equal(md5(body(row.definition)), row.source_md5);
    assert.equal(md5(body(row.patchedDefinition)), row.patchedSourceMd5);
    assert.equal(row.definition.split(row.beforeStatement).length, 2);
    assert.equal(row.patchedDefinition, row.definition.replace(row.beforeStatement, row.afterStatement));
    assert.equal(row.patchedDefinition.replace(row.afterStatement, row.beforeStatement), row.definition);
    assert.match(row.afterStatement, /external_detail_import_id is not null then (?:p|product)\.updated_at/);
    assert.doesNotMatch(row.afterStatement, /approved_product_updated_at|update .*external_detail_imports/);
  }
});

test("actual migration changes only two complete function bodies; wrappers, ACLs and attributes remain byte-equivalent", async () => {
  const db = await setup();
  try {
    const before = await snapshot(db);
    for (const [index, row] of fixture.functions.entries()) assert.equal(before[index].definition, row.definition);
    await db.exec(migration);
    const after = await snapshot(db);
    for (const [index, row] of fixture.functions.entries()) {
      assert.equal(after[index].definition, row.patchedDefinition ?? row.definition);
      assert.equal(after[index].source_md5, row.patchedSourceMd5 ?? row.source_md5);
      assert.deepEqual({ ...after[index], definition: before[index].definition, source_md5: before[index].source_md5 }, before[index]);
    }
    assert.equal(wrappers.length, 2);
  } finally { await db.close(); }
});

test("identical rerun is a no-op across complete functions and privileges", async () => {
  const db = await setup();
  try {
    await db.exec(migration); const before = await snapshot(db);
    await db.exec(migration); assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("second-function source drift refuses migration and rolls the first patch back atomically", async () => {
  const db = await setup();
  try {
    await db.exec(targets[1].definition.replace("\ndeclare\n", "\ndeclare  \n"));
    const before = await snapshot(db);
    await rejected(db, /EXTERNAL_DETAIL_SOURCE_TIME_SOURCE_DRIFT/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("already-patched source drift and function-attribute drift are not accepted as idempotence", async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec(targets[0].patchedDefinition.replace("\ndeclare\n", "\ndeclare  \n"));
    await rejected(db, /EXTERNAL_DETAIL_SOURCE_TIME_SOURCE_DRIFT/);
    await db.exec(targets[0].patchedDefinition);
    await db.exec(`alter function ${targets[0].signature} security invoker`);
    await rejected(db, /EXTERNAL_DETAIL_SOURCE_TIME_SOURCE_DRIFT/);
  } finally { await db.close(); }
});

test("missing target fails closed without modifying the other function", async () => {
  const db = await setup();
  try {
    await db.exec(`drop function ${targets[1].signature}`);
    const before = await snapshot(db);
    await rejected(db, /EXTERNAL_DETAIL_SOURCE_TIME_FUNCTION_MISSING/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("captured originals restore exact source hashes, definitions and ACLs; reviewed migration can then reapply", async () => {
  const db = await setup();
  try {
    const before = await snapshot(db);
    await db.exec(migration);
    const changed = await snapshot(db);
    for (const row of targets) assert.equal(changed.find((value) => value.signature === row.signature).source_md5, row.patchedSourceMd5);
    // Isolated rollback only: verify expected postimage before restoring each captured original.
    await db.exec("begin");
    for (const row of targets) await db.exec(row.definition);
    await db.exec("commit");
    assert.deepEqual(await snapshot(db), before);
    await db.exec(migration);
    assert.deepEqual(await snapshot(db), changed);
  } finally { await db.close(); }
});
