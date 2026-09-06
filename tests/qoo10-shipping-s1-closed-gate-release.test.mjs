import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const historyUrl = new URL(
  "../supabase/migrations/20260905003000_recover_exact_qoo10_shipping_normalization_s1.sql",
  import.meta.url,
);
const readbackUrl = new URL(
  "../supabase/migrations/20260905003100_accept_qoo10_shipping_s1_failed_ok_readback.sql",
  import.meta.url,
);
const followUpUrl = new URL(
  "../supabase/migrations/20260905013000_allow_qoo10_shipping_s1_closed_gate_release.sql",
  import.meta.url,
);

const UPDATE_JOB_ID = "089467c1-cadb-4d31-93a8-d5882c46d753";
const CREATE_JOB_ID = "687852dc-36de-4049-b170-bdf7839ccf2f";
const RELEASE = "0a26f52edc24b0aa90acd7dcea6b04f41cf9c3af";
const OTHER = "003bc8b770d802b816020dd762156cdd2287ae9b";

function replaceDefinition(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  assert.notEqual(start, -1, `missing replace ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated replace ${signature}`);
  return sql.slice(start, end + 4);
}

test("closed-gate follow-up does not rewrite 03000/03100 or source jobs", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const history = await readFile(historyUrl, "utf8");
  const readback = await readFile(readbackUrl, "utf8");
  assert.match(followUp, /20260905003000\+03100/);
  assert.match(followUp, /Do not rewrite that applied history/);
  assert.match(
    followUp,
    /create or replace function sellerpilot_private.qoo10_shipping_s1_release_is_current/,
  );
  assert.match(followUp, /not gate.is_open/);
  assert.match(followUp, /opened_channel is null/);
  const releaseFn = replaceDefinition(
    followUp,
    "sellerpilot_private.qoo10_shipping_s1_release_is_current",
  );
  assert.match(releaseFn, /not sellerpilot_private.listing_mutation_release_gate_is_effective\('qoo10'\)/);
  assert.doesNotMatch(
    releaseFn,
    /listing_mutation_release_gate_is_effective\('qoo10'\)\s+is true/,
  );
  assert.doesNotMatch(followUp, /update sellerpilot_private.channel_gateway_jobs/i);
  assert.doesNotMatch(followUp, /qoo10_shipping_s1_source_reconciliation_resolved/);
  assert.doesNotMatch(followUp, /qoo10_exact_s1_source_reconciliation_resolved/);
  assert.doesNotMatch(releaseFn, /open_channel_gate/);
  assert.doesNotMatch(followUp, /sellerpilot_service_enqueue_qoo10_shipping_s1_verifier/);
  assert.doesNotMatch(followUp, /sellerpilot_service_enqueue_qoo10_shipping_s1_activation/);
  assert.doesNotMatch(history, /20260905013000/);
  assert.doesNotMatch(readback, /20260905013000/);
  assert.ok(history.includes(UPDATE_JOB_ID));
  assert.ok(history.includes(CREATE_JOB_ID));
});

test("release_is_current is true only on a closed matching SHA gate", async () => {
  const followUp = await readFile(followUpUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.listing_mutation_release_gate (
        singleton boolean primary key default true,
        is_open boolean not null,
        opened_at timestamptz,
        opened_release_sha text,
        opened_channel text
      );
      insert into sellerpilot_private.listing_mutation_release_gate (
        singleton, is_open, opened_at, opened_release_sha, opened_channel
      ) values (true, false, null, null, null);
      create function sellerpilot_private.attested_listing_publication_release_sha(
        p_channel text
      ) returns text language sql stable as $$
        select current_setting('sellerpilot.test_attested_sha', true)
      $$;
      create function sellerpilot_private.active_serverless_runtime_release_sha()
      returns text language sql stable as $$
        select current_setting('sellerpilot.test_runtime_sha', true)
      $$;
      create function sellerpilot_private.listing_mutation_release_gate_is_effective(
        p_channel text
      ) returns boolean language sql stable as $$
        select exists (
          select 1 from sellerpilot_private.listing_mutation_release_gate gate
           where gate.singleton and gate.is_open and p_channel = 'qoo10'
        )
      $$;
    `);
    await db.exec(replaceDefinition(
      followUp,
      "sellerpilot_private.qoo10_shipping_s1_release_is_current",
    ));
    await db.exec(`
      select set_config('sellerpilot.test_attested_sha', '${RELEASE}', false);
      select set_config('sellerpilot.test_runtime_sha', '${RELEASE}', false);
    `);

    const closed = await db.query(
      "select sellerpilot_private.qoo10_shipping_s1_release_is_current($1) as ok",
      [RELEASE],
    );
    assert.equal(closed.rows[0].ok, true);

    const otherSha = await db.query(
      "select sellerpilot_private.qoo10_shipping_s1_release_is_current($1) as ok",
      [OTHER],
    );
    assert.equal(otherSha.rows[0].ok, false);

    await db.exec(`
      update sellerpilot_private.listing_mutation_release_gate
         set is_open = true,
             opened_at = now(),
             opened_release_sha = '${RELEASE}',
             opened_channel = 'qoo10'
    `);
    const openGate = await db.query(
      "select sellerpilot_private.qoo10_shipping_s1_release_is_current($1) as ok",
      [RELEASE],
    );
    assert.equal(openGate.rows[0].ok, false);
  } finally {
    await db.close();
  }
});
