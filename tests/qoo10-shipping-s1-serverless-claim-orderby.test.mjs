import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const historyUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905013100_fix_qoo10_shipping_s1_serverless_claim_orderby.sql",
  import.meta.url,
);

const BAD_EXCLUDE = `and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(job)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)
     )
   for update of job skip locked`;

test("183000 follow-up only lifts the ORDER BY boolean and keeps history", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const history = await readFile(historyUrl, "utf8");
  assert.match(followUp, /20260905003000/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(followUp, /sellerpilot_183000_claim_serverless_gateway_unsafe/);
  assert.ok(followUp.includes(BAD_EXCLUDE));
  assert.match(followUp, /v_hits <> 1/);
  assert.match(followUp, /pg_catalog\.replace\(v_definition, v_bad, v_lock\)/);
  assert.doesNotMatch(followUp, /sellerpilot_11820_claim_gateway_unsafe/);
  assert.doesNotMatch(followUp, /qoo10_shipping_s1_verifier_job_matches/);
  assert.doesNotMatch(followUp, /update sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(followUp, /sellerpilot_service_enqueue_qoo10_shipping_s1/);
  assert.doesNotMatch(history, /20260905013100/);
  const historyBlock = history.slice(
    history.indexOf("$qoo10_shipping_s1_serverless_claim$"),
    history.indexOf("$qoo10_shipping_s1_serverless_claim$;"),
  );
  assert.ok(historyBlock.includes("for update of job skip locked"));
  assert.match(
    historyBlock,
    /qoo10_shipping_s1_activation_job_matches\(job\)/,
  );
});

test("ORDER BY uuid AND boolean is 42804 and removing the AND restores claim shape", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table job (id uuid primary key, flag boolean);
      insert into job values ('457b4481-0a66-4a76-89a0-884087d0c22e', true);
    `);
    await assert.rejects(
      () => db.exec("select id from job order by id and not (flag and not flag) for update"),
      /42804|datatype mismatch|argument of AND must be type boolean/i,
    );
    const repaired = await db.query(
      "select id from job order by id for update",
    );
    assert.equal(repaired.rows.length, 1);
    assert.equal(repaired.rows[0].id, "457b4481-0a66-4a76-89a0-884087d0c22e");
  } finally {
    await db.close();
  }
});
