import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260913122015_lazada_local_executor_egress_policy.sql", import.meta.url,
), "utf8");

test("Lazada can use an approved local route without changing other egress policies", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema sellerpilot_private;
      create table sellerpilot_private.serverless_static_egress_policy (
        channel text primary key check (channel in ('coupang','smartstore','elevenst','temu','shopee')),
        enabled boolean not null default false,
        updated_at timestamptz not null default clock_timestamp()
      );
      alter table sellerpilot_private.serverless_static_egress_policy enable row level security;
      insert into sellerpilot_private.serverless_static_egress_policy(channel,enabled)
      values ('coupang',true),('smartstore',true),('elevenst',false),('temu',false),('shopee',false);
    `);
    const before = (await db.query("select * from sellerpilot_private.serverless_static_egress_policy order by channel")).rows;
    await assert.rejects(db.query("insert into sellerpilot_private.serverless_static_egress_policy(channel) values ('lazada')"), /check constraint/);
    await db.exec(migration);
    assert.deepEqual((await db.query("select * from sellerpilot_private.serverless_static_egress_policy where channel <> 'lazada' order by channel")).rows, before);
    assert.deepEqual((await db.query("select channel,enabled from sellerpilot_private.serverless_static_egress_policy where channel='lazada'")).rows, [{ channel: "lazada", enabled: false }]);
    await assert.rejects(db.query("insert into sellerpilot_private.serverless_static_egress_policy(channel) values ('unknown-market')"), /check constraint/);
    assert.deepEqual((await db.query(`select relrowsecurity as rls,
      has_table_privilege('anon',oid,'select') as anon_read,
      has_table_privilege('authenticated',oid,'update') as authenticated_write
      from pg_class where oid='sellerpilot_private.serverless_static_egress_policy'::regclass`)).rows,
    [{ rls: true, anon_read: false, authenticated_write: false }]);
    await assert.rejects(db.exec(migration), /LAZADA_EGRESS_POLICY_PRECONDITION_CHANGED/);
  } finally { await db.close(); }
});
