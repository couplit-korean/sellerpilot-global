import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const operator = "00000000-0000-4000-8000-000000000100";
const owner = "00000000-0000-4000-8000-000000000101";
const otherSeller = "00000000-0000-4000-8000-000000000102";
const credential = "00000000-0000-4000-8000-000000000201";
const otherCredential = "00000000-0000-4000-8000-000000000202";

const bindingSql = await readFile(new URL(
  "../supabase/migrations/20260908140403_cs_smartstore_order_binding_v2.sql",
  import.meta.url,
), "utf8");
const checkpointSql = await readFile(new URL(
  "../supabase/migrations/20260908140405_cs_smartstore_history_checkpoint.sql",
  import.meta.url,
), "utf8");

async function commonDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    insert into sellerpilot_private.admin_users values ('${operator}');
    create function public.sellerpilot_is_admin() returns boolean
      language sql stable security definer set search_path=''
      as $$select exists(
        select 1 from sellerpilot_private.admin_users where user_id=auth.uid()
      )$$;
    select set_config('request.jwt.claim.sub','${operator}',false);
  `);
  return db;
}

async function insertBindingCase(db, { id, ownerId = owner, context, reference = null, status }) {
  await db.query(`
    insert into sellerpilot_private.support_tickets
      (id,owner_id,channel_key,provider_context,external_order_reference,demo)
    values ($1,$2,'smartstore',$3,$4,false)
  `, [id, ownerId, context, reference]);
  await db.query(`
    insert into sellerpilot_private.cs_order_bindings(ticket_id,channel,status)
    values ($1,'smartstore',$2)
  `, [id, status]);
}

test("003 SQL executes and preserves malformed IDs, seller scope, and revoked auth boundaries", async () => {
  const db = await commonDatabase();
  try {
    await db.exec(`
      create table sellerpilot_private.support_tickets(
        id uuid primary key, owner_id uuid not null, channel_key text not null,
        provider_context jsonb not null, external_order_reference text, demo boolean not null
      );
      create table sellerpilot_private.cs_order_bindings(
        ticket_id uuid primary key, channel text not null, status text not null
      );
      create table sellerpilot_private.channel_credentials(
        id uuid primary key, created_by uuid, channel text, environment text, status text,
        seller_account_key text, seller_account_key_source text, seller_account_verified_at timestamptz,
        expires_at timestamptz, version integer, created_at timestamptz
      );
      insert into sellerpilot_private.channel_credentials values
        ('${credential}','${owner}','smartstore','production','active','seller-a',
         'credential_incarnation_v1',now(),null,1,now());
      revoke all on sellerpilot_private.support_tickets from public,anon,authenticated,service_role;
      revoke all on sellerpilot_private.cs_order_bindings from public,anon,authenticated,service_role;
      revoke all on sellerpilot_private.channel_credentials from public,anon,authenticated,service_role;
    `);
    const cases = [
      ["301", { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: ["10001"] }, "10001", "exact"],
      ["302", { kind: "customer", orderReferenceState: "ambiguous_product_orders", productOrderIds: ["10001", "10002"] }, null, "not_applicable"],
      ["303", { kind: "customer", orderReferenceState: "invalid_product_order_list", productOrderIds: [] }, null, "not_applicable"],
      ["304", { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: ["10001", null] }, "10001", "exact"],
      ["305", { kind: "product", orderReferenceState: "unavailable" }, null, "not_applicable"],
    ];
    for (const [suffix, context, reference, status] of cases) {
      await insertBindingCase(db, {
        id: `00000000-0000-4000-8000-000000000${suffix}`,
        context,
        reference,
        status,
      });
    }
    await insertBindingCase(db, {
      id: "00000000-0000-4000-8000-000000000306",
      ownerId: otherSeller,
      context: { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: ["90001"] },
      reference: "90001",
      status: "exact",
    });

    await db.exec(bindingSql);
    for (const role of ["anon", "service_role"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_read_smartstore_cs_order_binding_health_v2()','execute') allowed",
        [role],
      )).rows[0].allowed, false);
    }

    await db.exec("set role authenticated");
    const result = (await db.query(
      "select public.sellerpilot_read_smartstore_cs_order_binding_health_v2() result",
    )).rows[0].result;
    assert.equal(result.contract, "sellerpilot-cs-smartstore-order-binding-health/2");
    assert.equal(result.csCommerceMutationAllowed, false);
    assert.deepEqual(Object.fromEntries(result.groups.map(group => [group.status, group.count])), {
      ambiguous_product_orders: 1,
      contract_mismatch: 1,
      exact: 1,
      invalid_product_order_list: 1,
      not_applicable: 1,
    });
    await assert.rejects(
      db.query("select * from sellerpilot_private.support_tickets"),
      /permission denied/,
    );

    await db.exec("reset role");
    await db.exec("delete from sellerpilot_private.admin_users");
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.sellerpilot_read_smartstore_cs_order_binding_health_v2()"),
      /administrator access required/,
    );
  } finally {
    await db.close();
  }
});

async function checkpoint(db) {
  return (await db.query(
    "select public.sellerpilot_next_smartstore_history_window_v1($1,$2,$3,$4) result",
    ["2024-01-01", "2024-02-29", credential, "production"],
  )).rows[0].result;
}

async function insertScan(db, { ownerId = owner, credentialId = credential, scope, kind, status = "completed" }) {
  await db.query(`
    insert into sellerpilot_private.cs_history_scans
      (owner_id,credential_id,channel,environment,scope_key,ticket_kind,status,
       scan_completed_at,reconciled_at,unprocessed_count)
    values ($1,$2,'smartstore','production',$3,$4,$5,
      case when $5='completed' then now() else null end,
      case when $5='completed' then now() else null end,0)
  `, [ownerId, credentialId, scope, kind, status]);
}

test("004 SQL advances only after both kinds and rejects other sellers and revoked credentials", async () => {
  const db = await commonDatabase();
  try {
    await db.exec(`
      create table sellerpilot_private.channel_credentials(
        id uuid primary key, created_by uuid not null, channel text not null,
        environment text not null, status text not null, expires_at timestamptz
      );
      create table sellerpilot_private.cs_history_scans(
        id bigint generated always as identity primary key,
        owner_id uuid not null, credential_id uuid not null, channel text not null,
        environment text not null, scope_key text not null, ticket_kind text not null,
        status text not null, scan_completed_at timestamptz, reconciled_at timestamptz,
        unprocessed_count integer not null
      );
      insert into sellerpilot_private.channel_credentials values
        ('${credential}','${owner}','smartstore','production','active','2099-01-01'),
        ('${otherCredential}','${otherSeller}','smartstore','production','active','2099-01-01');
      revoke all on sellerpilot_private.channel_credentials from public,anon,authenticated,service_role;
      revoke all on sellerpilot_private.cs_history_scans from public,anon,authenticated,service_role;
    `);
    await db.exec(checkpointSql);
    await db.exec("set role authenticated");

    let result = await checkpoint(db);
    assert.deepEqual([result.totalWindowCount, result.completedWindowCount, result.remainingWindowCount], [2, 0, 2]);
    assert.deepEqual([result.nextWindow.fromDate, result.nextWindow.throughDate], ["2024-01-31", "2024-02-29"]);

    await db.exec("reset role");
    await insertScan(db, {
      scope: "inquiries:history:00000000-0000-4000-8000-000000000401:smartstore:product:2024-01-31:2024-02-29",
      kind: "product",
    });
    await insertScan(db, {
      ownerId: otherSeller,
      credentialId: otherCredential,
      scope: "inquiries:history:00000000-0000-4000-8000-000000000402:smartstore:customer:2024-01-31:2024-02-29",
      kind: "customer",
    });
    await insertScan(db, {
      scope: "inquiries:history:00000000-0000-4000-8000-000000000401:smartstore:customer:2024-01-31:2024-02-29",
      kind: "customer",
      status: "running",
    });
    await db.exec("set role authenticated");
    result = await checkpoint(db);
    assert.equal(result.completedWindowCount, 0);
    assert.equal(result.nextWindow.fromDate, "2024-01-31");

    await db.exec("reset role");
    await db.exec(`
      update sellerpilot_private.cs_history_scans
         set status='completed',scan_completed_at=now(),reconciled_at=now()
       where owner_id='${owner}' and ticket_kind='customer'
    `);
    await db.exec("set role authenticated");
    result = await checkpoint(db);
    assert.equal(result.completedWindowCount, 1);
    assert.deepEqual([result.nextWindow.fromDate, result.nextWindow.throughDate], ["2024-01-01", "2024-01-30"]);

    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.channel_credentials set status='revoked' where id='${credential}'`);
    await db.exec("set role authenticated");
    await assert.rejects(checkpoint(db), /SMARTSTORE_HISTORY_CHECKPOINT_CREDENTIAL_INVALID/);

    await db.exec("reset role");
    await db.exec(`update sellerpilot_private.channel_credentials set status='active' where id='${credential}'`);
    for (const kind of ["product", "customer"]) {
      await insertScan(db, {
        scope: `inquiries:history:00000000-0000-4000-8000-000000000403:smartstore:${kind}:2024-01-01:2024-01-30`,
        kind,
      });
    }
    await db.exec("set role authenticated");
    result = await checkpoint(db);
    assert.equal(result.completedWindowCount, 2);
    assert.equal(result.complete, true);
    assert.equal(result.nextWindow, null);

    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [otherSeller]);
    await db.exec("set role authenticated");
    await assert.rejects(checkpoint(db), /administrator access required/);
    await assert.rejects(
      db.query("select * from sellerpilot_private.cs_history_scans"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
