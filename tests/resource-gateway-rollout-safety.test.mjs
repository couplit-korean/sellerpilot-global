import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260825104900_resource_bound_gateway_writes.sql",
  import.meta.url,
);

function functionDefinition(sql, name) {
  let start = sql.indexOf(`create or replace function ${name}`);
  if (start === -1) start = sql.indexOf(`create function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must have a complete SQL body`);
  return sql.slice(start, end + 4);
}

function legacyWriteRolloutFence(sql) {
  const comment = sql.indexOf("-- A legacy non-listing attempt may still be inside a direct provider call.");
  assert.notEqual(comment, -1, "legacy direct-write rollout fence comment must exist");
  const start = sql.indexOf("do $$", comment);
  assert.notEqual(start, -1, "legacy direct-write rollout fence must be a DO block");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "legacy direct-write rollout fence must be complete");
  return sql.slice(start, end + 4);
}

test("resource gateway rollout aborts while any legacy direct marketplace write is running", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const fence = legacyWriteRolloutFence(migration);
  const db = new PGlite();
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_operation_attempts (
        status text not null,
        gateway_write_required boolean not null,
        operation text not null
      );
    `);

    // A drained deployment is eligible for the resource-fence migration.
    await db.exec(fence);

    // Age is deliberately irrelevant: a running legacy provider call has an
    // unknown outcome until an operator drains and reconciles it.
    await db.exec(`
      insert into sellerpilot_private.channel_operation_attempts
        (status, gateway_write_required, operation)
      values ('running', false, 'inventory.update');
    `);
    await assert.rejects(
      db.exec(fence),
      /legacy direct marketplace writes must drain before resource-fence rollout/,
    );
  } finally {
    await db.close();
  }
});

test("resource terminal reconciliation keeps inventory and attempt fences active", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const listingId = "20000000-0000-4000-8000-000000000001";
  const runId = "30000000-0000-4000-8000-000000000001";
  const itemId = "40000000-0000-4000-8000-000000000001";
  const attemptId = "50000000-0000-4000-8000-000000000001";
  const jobId = "60000000-0000-4000-8000-000000000001";
  try {
    await db.exec(`
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, status text not null, response_payload jsonb,
        error_message text, attempt_id uuid, operation text not null,
        inventory_item_id uuid, order_id uuid, channel text not null,
        shipment_tracking text, shipment_carrier text, request_fingerprint text
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, status text not null, http_status integer,
        remote_id text, safe_message text, completed_at timestamptz
      );
      create table sellerpilot_private.inventory_sync_runs (
        id uuid primary key, status text not null, total_count integer default 0,
        succeeded_count integer default 0, failed_count integer default 0,
        completed_at timestamptz, updated_at timestamptz default now()
      );
      create table sellerpilot_private.inventory_sync_items (
        id uuid primary key, run_id uuid not null, listing_id uuid not null,
        owner_id uuid not null, requested_quantity integer not null, status text not null,
        operation_attempt_id uuid, safe_message text, completed_at timestamptz,
        updated_at timestamptz default now()
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, inventory_sync_status text, last_inventory_quantity integer,
        inventory_sync_error text, last_inventory_synced_at timestamptz,
        last_verified_at timestamptz, updated_at timestamptz default now()
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text, safe_detail jsonb
      );
    `);
    await db.exec(functionDefinition(
      migration,
      "sellerpilot_private.reconcile_gateway_resource_terminal",
    ));
    await db.exec(`
      create trigger reconcile_gateway_resource_terminal
      after update of status on sellerpilot_private.channel_gateway_jobs
      for each row execute function sellerpilot_private.reconcile_gateway_resource_terminal();
    `);
    await db.query("insert into sellerpilot_private.channel_operation_attempts(id,status) values($1,'running')", [attemptId]);
    await db.query("insert into sellerpilot_private.product_listings(id,inventory_sync_status) values($1,'pending')", [listingId]);
    await db.query("insert into sellerpilot_private.inventory_sync_runs(id,status) values($1,'running')", [runId]);
    await db.query(
      "insert into sellerpilot_private.inventory_sync_items(id,run_id,listing_id,owner_id,requested_quantity,status) values($1,$2,$3,$4,7,'running')",
      [itemId, runId, listingId, ownerId],
    );
    await db.query(
      "insert into sellerpilot_private.channel_gateway_jobs(id,status,attempt_id,operation,inventory_item_id,channel) values($1,'running',$2,'inventory.update',$3,'ebay')",
      [jobId, attemptId, itemId],
    );
    const response = {
      ok: false,
      channel: "ebay",
      operation: "inventory.update",
      remoteId: "seller-sku-1",
      safeMessage: "Provider readback failed.",
      steps: [
        { name: "bulk-inventory", ok: true, status: 204, data: {} },
        { name: "inventory-readback", ok: false, status: 503, data: {} },
      ],
    };
    const warning = "Remote inventory mutation requires manual reconciliation.";
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required',response_payload=$2::jsonb,error_message=$3 where id=$1",
      [jobId, JSON.stringify(response), warning],
    );

    assert.deepEqual((await db.query(
      "select status,http_status,remote_id,safe_message from sellerpilot_private.channel_operation_attempts where id=$1",
      [attemptId],
    )).rows[0], { status: "manual_required", http_status: 409, remote_id: "seller-sku-1", safe_message: warning });
    assert.deepEqual((await db.query(
      "select status,completed_at from sellerpilot_private.inventory_sync_items where id=$1",
      [itemId],
    )).rows[0], { status: "reconciliation_required", completed_at: null });
    assert.deepEqual((await db.query(
      "select inventory_sync_status,inventory_sync_error from sellerpilot_private.product_listings where id=$1",
      [listingId],
    )).rows[0], { inventory_sync_status: "reconciliation_required", inventory_sync_error: warning });
    assert.deepEqual((await db.query(
      "select status,completed_at from sellerpilot_private.inventory_sync_runs where id=$1",
      [runId],
    )).rows[0], { status: "reconciliation_required", completed_at: null });
    assert.equal((await db.query("select action from sellerpilot_private.operation_audit")).rows[0]?.action, "inventory_remote_reconciliation_required");
  } finally {
    await db.close();
  }
});
