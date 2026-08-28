import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828145000_compact_legacy_periodic_gateway_reads.sql",
  import.meta.url,
);

const ids = {
  legacyOrders: "10000000-0000-4000-8000-000000000001",
  legacyWhitespace: "10000000-0000-4000-8000-000000000002",
  freshUnkeyed: "10000000-0000-4000-8000-000000000003",
  runningUnkeyed: "10000000-0000-4000-8000-000000000004",
  manualUnkeyed: "10000000-0000-4000-8000-000000000005",
  write: "10000000-0000-4000-8000-000000000006",
  competitor: "10000000-0000-4000-8000-000000000007",
  keyedSingleton: "10000000-0000-4000-8000-000000000008",
  duplicateOldest: "10000000-0000-4000-8000-000000000009",
  duplicateRunning: "10000000-0000-4000-8000-000000000010",
  duplicateNewest: "10000000-0000-4000-8000-000000000011",
  continuation: "10000000-0000-4000-8000-000000000012",
  differentChannel: "10000000-0000-4000-8000-000000000013",
  differentOperation: "10000000-0000-4000-8000-000000000014",
  manualKeyed: "10000000-0000-4000-8000-000000000015",
};

const credentialA = "20000000-0000-4000-8000-000000000001";
const manualAttempt = "30000000-0000-4000-8000-000000000001";
const workerToken = "40000000-0000-4000-8000-000000000001";
const runningClaim = "50000000-0000-4000-8000-000000000001";

async function statusMap(db) {
  const result = await db.query(
    "select id::text, status, error_message, completed_at, updated_at, claim_token, worker_token_id, lease_expires_at from sellerpilot_private.channel_gateway_jobs order by id",
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

test("legacy periodic read compaction is narrow, lossless, and uniquely fences active keys", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        credential_id uuid not null,
        attempt_id uuid,
        channel text not null,
        operation text not null,
        request_payload jsonb not null default '{}'::jsonb,
        status text not null,
        error_message text,
        claim_token uuid,
        worker_token_id uuid,
        lease_expires_at timestamptz,
        created_at timestamptz not null,
        completed_at timestamptz,
        updated_at timestamptz not null
      );
      create unique index channel_gateway_jobs_continuation_once_idx
        on sellerpilot_private.channel_gateway_jobs ((request_payload->>'continuationOf'))
        where nullif(request_payload->>'continuationOf', '') is not null;
    `);

    const insert = async ({
      id,
      credentialId = credentialA,
      attemptId = null,
      channel = "shopee",
      operation,
      payload = {},
      status = "queued",
      age = "31 minutes",
      claimed = false,
    }) => db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
        id, credential_id, attempt_id, channel, operation, request_payload,
        status, claim_token, worker_token_id, lease_expires_at, created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7, $8, $9, case when $8::uuid is null then null else clock_timestamp() + interval '5 minutes' end,
        clock_timestamp() - $10::interval, clock_timestamp() - $10::interval
      )`,
      [
        id,
        credentialId,
        attemptId,
        channel,
        operation,
        JSON.stringify(payload),
        status,
        claimed ? runningClaim : null,
        claimed ? workerToken : null,
        age,
      ],
    );

    await insert({ id: ids.legacyOrders, operation: "orders.list", age: "31 minutes" });
    await insert({
      id: ids.legacyWhitespace,
      channel: "lazada",
      operation: "inquiries.list",
      payload: { periodicKey: "   " },
      age: "2 hours",
    });
    await insert({ id: ids.freshUnkeyed, operation: "orders.list", age: "29 minutes" });
    await insert({
      id: ids.runningUnkeyed,
      operation: "orders.list",
      status: "running",
      age: "2 hours",
      claimed: true,
    });
    await insert({
      id: ids.manualUnkeyed,
      attemptId: manualAttempt,
      operation: "orders.list",
      age: "2 hours",
    });
    await insert({ id: ids.write, operation: "listing.create", age: "2 hours" });
    await insert({
      id: ids.competitor,
      operation: "competitor.search",
      payload: { periodicKey: "competitor:v1:test" },
      age: "2 hours",
    });
    await insert({
      id: ids.keyedSingleton,
      operation: "orders.list",
      payload: { periodicKey: "orders:recent-window" },
      age: "2 hours",
    });
    await insert({
      id: ids.duplicateOldest,
      operation: "inquiries.list",
      payload: { periodicKey: "inquiries:0" },
      age: "20 minutes",
    });
    await insert({
      id: ids.duplicateRunning,
      operation: "inquiries.list",
      payload: { periodicKey: "inquiries:0" },
      status: "running",
      age: "10 minutes",
      claimed: true,
    });
    await insert({
      id: ids.duplicateNewest,
      operation: "inquiries.list",
      payload: { periodicKey: "inquiries:0" },
      age: "5 minutes",
    });
    await insert({
      id: ids.continuation,
      operation: "orders.list",
      payload: {
        periodicKey: "continuation:90000000-0000-4000-8000-000000000001:1",
        continuationOf: "90000000-0000-4000-8000-000000000001",
      },
      age: "2 hours",
    });
    await insert({
      id: ids.differentChannel,
      channel: "lazada",
      operation: "orders.list",
      payload: { periodicKey: "orders:recent-window" },
      age: "2 hours",
    });
    await insert({
      id: ids.differentOperation,
      operation: "inquiries.list",
      payload: { periodicKey: "orders:recent-window" },
      age: "2 hours",
    });
    await insert({
      id: ids.manualKeyed,
      attemptId: manualAttempt,
      operation: "orders.list",
      payload: { periodicKey: "orders:recent-window" },
      age: "2 hours",
    });

    const beforeCount = await db.query(
      "select count(*)::integer as count from sellerpilot_private.channel_gateway_jobs",
    );
    const migration = await readFile(migrationUrl, "utf8");
    await db.exec(migration);
    const afterCount = await db.query(
      "select count(*)::integer as count from sellerpilot_private.channel_gateway_jobs",
    );
    assert.equal(afterCount.rows[0].count, beforeCount.rows[0].count, "migration must not delete jobs");

    const rows = await statusMap(db);
    for (const id of [ids.legacyOrders, ids.legacyWhitespace]) {
      assert.equal(rows.get(id).status, "cancelled");
      assert.equal(rows.get(id).error_message, "LEGACY_PERIODIC_READ_UNKEYED_COMPACTED");
      assert.ok(rows.get(id).completed_at);
      assert.ok(rows.get(id).updated_at);
    }
    for (const id of [ids.duplicateOldest, ids.duplicateNewest]) {
      assert.equal(rows.get(id).status, "cancelled");
      assert.equal(rows.get(id).error_message, "PERIODIC_READ_ACTIVE_DUPLICATE_COMPACTED");
      assert.equal(rows.get(id).claim_token, null);
      assert.equal(rows.get(id).worker_token_id, null);
      assert.equal(rows.get(id).lease_expires_at, null);
    }

    const untouched = [
      ids.freshUnkeyed,
      ids.runningUnkeyed,
      ids.manualUnkeyed,
      ids.write,
      ids.competitor,
      ids.keyedSingleton,
      ids.duplicateRunning,
      ids.continuation,
      ids.differentChannel,
      ids.differentOperation,
      ids.manualKeyed,
    ];
    for (const id of untouched) assert.match(rows.get(id).status, /^(queued|running)$/);
    assert.equal(rows.get(ids.runningUnkeyed).claim_token, runningClaim);
    assert.equal(rows.get(ids.duplicateRunning).claim_token, runningClaim);
    assert.equal(rows.get(ids.continuation).error_message, null);

    const indexResult = await db.query(
      `select indexdef from pg_indexes
        where schemaname = 'sellerpilot_private'
          and indexname = 'channel_gateway_jobs_active_periodic_read_once_idx'`,
    );
    assert.equal(indexResult.rows.length, 1);
    assert.match(indexResult.rows[0].indexdef, /UNIQUE INDEX/);
    assert.match(indexResult.rows[0].indexdef, /attempt_id IS NULL/);
    assert.match(indexResult.rows[0].indexdef, /status = ANY \(ARRAY\['queued'::text, 'running'::text\]\)/);

    await assert.rejects(
      insert({
        id: "60000000-0000-4000-8000-000000000001",
        operation: "orders.list",
        payload: { periodicKey: "orders:recent-window" },
        age: "0 minutes",
      }),
      /duplicate key value violates unique constraint/,
    );
    await insert({
      id: "60000000-0000-4000-8000-000000000002",
      attemptId: "30000000-0000-4000-8000-000000000002",
      operation: "orders.list",
      payload: { periodicKey: "orders:recent-window" },
      age: "0 minutes",
    });
    await insert({
      id: "60000000-0000-4000-8000-000000000003",
      operation: "listing.update",
      payload: { periodicKey: "orders:recent-window" },
      age: "0 minutes",
    });
  } finally {
    await db.close();
  }
});
