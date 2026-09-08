import assert from "node:assert/strict";
import test from "node:test";
import {
  assertElevenstIsolatedDatabaseTarget,
  ELEVENST_ISOLATED_DB_CONTRACT,
} from "../lib/cs/channels/elevenst/isolated-db";

test("11st isolated DB accepts only an explicit disposable loopback database", () => {
  assert.deepEqual(assertElevenstIsolatedDatabaseTarget({
    databaseUrl: "postgresql://fixture:secret@127.0.0.1:54329/sellerpilot_cs_elevenst_test?sslmode=disable",
    runtimeEnvironment: "test",
  }), {
    contractVersion: "sellerpilot-elevenst-isolated-db/1",
    target: "local_loopback",
    port: 54329,
    databaseClass: "elevenst_isolated",
    productionMutationAllowed: false,
  });
  assert.equal(ELEVENST_ISOLATED_DB_CONTRACT.applicationVerification, "read_only_transaction");
  assert.equal(ELEVENST_ISOLATED_DB_CONTRACT.productionMutationAllowed, false);
});

test("11st isolated DB rejects remote Supabase, production runtime and ambiguous local targets", () => {
  const rejected = [
    { databaseUrl: "postgresql://postgres:redacted@sqaoqucxakebqkiygdxb.supabase.co:5432/postgres", runtimeEnvironment: "test" },
    { databaseUrl: "postgresql://fixture:redacted@127.0.0.1:54329/sellerpilot_cs_elevenst_test", runtimeEnvironment: "production" },
    { databaseUrl: "postgresql://fixture:redacted@127.0.0.1/sellerpilot_cs_elevenst_test", runtimeEnvironment: "test" },
    { databaseUrl: "postgresql://fixture:redacted@127.0.0.1:5432/postgres", runtimeEnvironment: "test" },
    { databaseUrl: "postgresql://fixture:redacted@localhost:54329/sellerpilot_cs_elevenst_test?sslmode=require", runtimeEnvironment: "test" },
  ];
  for (const target of rejected) {
    assert.throws(
      () => assertElevenstIsolatedDatabaseTarget(target),
      /ELEVENST_ISOLATED_DB_REJECTED/u,
    );
  }
});
