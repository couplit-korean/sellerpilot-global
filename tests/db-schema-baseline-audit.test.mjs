import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";
import { listMigrationSourceFiles, protectedUntrackedMigration } from "./migration-source-files.mjs";
import { BASELINE_QUERY, PROJECT_REF, baselineReadTransaction, compareBaselines, summarizeBaseline } from "../scripts/audit-db-schema-baseline.mjs";

const fixture = () => ({projectRef: PROJECT_REF, checkedAt: "2026-09-05T00:00:00Z",
  functions: [{identity: "public.test()", definition_sha256: "a", acl: "{postgres=X/postgres}", security_definer: true}],
  relations: [{identity: "sellerpilot_private.test", columns_sha256: "b", triggers_sha256: "c", acl: "{}"}],
  migrationHistory: [{version: "20260902112000", name: "test", statements_sha256: "d", statement_count: 1}],
});

test("baseline read is a single catalog SELECT without secret or operational row reads", () => {
  assert.match(BASELINE_QUERY, /^select jsonb_build_object\(/);
  assert.doesNotMatch(BASELINE_QUERY, /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke|call)\s/i);
  assert.doesNotMatch(BASELINE_QUERY, /vault\.|decrypted_secret|channel_credentials|support_tickets|commerce_orders/);
  assert.match(BASELINE_QUERY, /pg_get_functiondef/);
  assert.match(BASELINE_QUERY, /pg_get_triggerdef/);
  assert.match(BASELINE_QUERY, /pg_policy/);
  assert.match(BASELINE_QUERY, /p\.proacl/);
  assert.doesNotMatch(BASELINE_QUERY, /p\.proconfig as settings/);
  assert.match(BASELINE_QUERY, /settings_sha256/);
  assert.equal(baselineReadTransaction(), `begin read only;\n${BASELINE_QUERY};\ncommit;`);
});
test("capture time does not change catalog hash or prove historical replay", () => {
  const before = fixture(); const after = {...before, checkedAt: "2026-09-06T00:00:00Z"};
  assert.equal(summarizeBaseline(before).catalogSha256, summarizeBaseline(after).catalogSha256);
  assert.equal(summarizeBaseline(before).historicalReplayProven, false);
  assert.equal(summarizeBaseline(before).productionMutationPerformed, false);
  assert.deepEqual(compareBaselines(before, after), []);
});
test("changed function definition and ACL are not accepted as identical", () => {
  for (const field of ["definition_sha256", "acl", "security_definer"]) {
    const before = fixture(); const after = fixture(); after.functions[0][field] = "drift";
    assert.deepEqual(compareBaselines(before, after), [{kind: "functions", identity: "public.test()", change: "changed"}]);
  }
});
test("trigger and relation metadata drift are visible", () => {
  const before = fixture(); const after = fixture(); after.relations[0].triggers_sha256 = "drift";
  assert.deepEqual(compareBaselines(before, after), [{kind: "relations", identity: "sellerpilot_private.test", change: "changed"}]);
});
test("same function catalog does not conceal changed statement history", () => {
  const before = fixture(); const after = fixture(); after.migrationHistory[0].statements_sha256 = "drift";
  assert.equal(compareBaselines(before, after)[0].kind, "migrationHistory");
});
test("added and removed definitions are separately reported", () => {
  const before = fixture(); const after = fixture(); after.functions = [{...before.functions[0], identity: "public.new()"}];
  assert.deepEqual(compareBaselines(before, after).map(x => x.change).sort(), ["added", "removed"]);
});
test("wrong project and duplicate identities fail closed", () => {
  const wrong = {...fixture(), projectRef: "other-project"};
  assert.throws(() => summarizeBaseline(wrong), /project mismatch/);
  assert.throws(() => compareBaselines(fixture(), wrong), /project mismatch/);
  const duplicate = fixture(); duplicate.functions.push({...duplicate.functions[0]});
  assert.throws(() => summarizeBaseline(duplicate), /duplicate/);
});
test("catalog ordering does not affect stable fingerprint", () => {
  const before = fixture(); before.functions.push({...before.functions[0], identity: "public.second()"});
  const after = {...before, functions: [...before.functions].reverse()};
  assert.equal(summarizeBaseline(before).catalogSha256, summarizeBaseline(after).catalogSha256);
});

test("DB replay excludes only the protected operator file, not a failing release migration", async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const actual = await listMigrationSourceFiles(directory);
  const all = await readdir(directory);
  assert.deepEqual(actual, all.filter(name => name !== protectedUntrackedMigration));
  assert.ok(!actual.includes(protectedUntrackedMigration));
  assert.ok(actual.includes("20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql"));
  assert.ok(actual.includes("20260905130000_reject_inventory_idempotency_conflicts.sql"));
});
