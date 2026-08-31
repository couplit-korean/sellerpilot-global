import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260829080317_fail_closed_overseas_listing_create.sql",
  import.meta.url,
);

const PRODUCT_ID = "10000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "20000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "30000000-0000-4000-8000-000000000001";
const FINGERPRINT = "a".repeat(64);

const fixtureSql = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema sellerpilot_private;

create table sellerpilot_private.serverless_static_egress_policy (
  channel text primary key,
  enabled boolean not null
);
insert into sellerpilot_private.serverless_static_egress_policy (channel, enabled)
values ('temu', false);

create table sellerpilot_private.runtime_fixture (
  singleton boolean primary key default true,
  configured boolean not null,
  active boolean not null,
  schedule_count integer not null
);
insert into sellerpilot_private.runtime_fixture (
  configured, active, schedule_count
) values (false, false, 0);

create table sellerpilot_private.enqueue_fixture_calls (
  channel text not null,
  request_payload jsonb not null
);

create function public.sellerpilot_service_serverless_cs_wakeup_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', fixture.configured,
    'active', fixture.active,
    'scheduleCount', fixture.schedule_count
  )
    from sellerpilot_private.runtime_fixture fixture
$$;

create function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  p_product_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_market text,
  p_target_id text,
  p_currency text,
  p_price numeric,
  p_request_fingerprint text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into sellerpilot_private.enqueue_fixture_calls (channel, request_payload)
  values (p_channel, p_request_payload);
  return jsonb_build_object('status', 'queued', 'channel', p_channel);
end;
$$;

revoke all on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_reserve_and_enqueue_listing_create(
  uuid, uuid, uuid, text, text, text, text, numeric, text, jsonb
) to service_role;
`;

function explicitEbayArguments() {
  return {
    offer: {
      marketplaceId: "EBAY_US",
      listingPolicies: {
        fulfillmentPolicyId: "fulfillment-operator",
        paymentPolicyId: "payment-operator",
        returnPolicyId: "return-operator",
      },
      merchantLocationKey: "warehouse-operator",
    },
  };
}

async function reserve(db, channel, arguments_) {
  const result = await db.query(
    `select public.sellerpilot_service_reserve_and_enqueue_listing_create(
       $1, $2, $3, $4, '', '', 'USD', 1, $5, $6::jsonb
     ) as value`,
    [
      PRODUCT_ID,
      CREDENTIAL_ID,
      ATTEMPT_ID,
      channel,
      FINGERPRINT,
      JSON.stringify({ arguments: arguments_ }),
    ],
  );
  return result.rows[0].value;
}

async function callCount(db) {
  // The production service role intentionally has no direct private-table
  // privilege; inspect the fixture as the database owner, then restore the
  // caller role used by the RPC assertions.
  await db.exec("reset role");
  const result = await db.query(
    "select count(*)::integer as count from sellerpilot_private.enqueue_fixture_calls",
  );
  await db.exec("set role service_role");
  return result.rows[0].count;
}

test("overseas listing reservation fails before enqueue until explicit prerequisites exist", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql);
    const migration = await readFile(migrationUrl, "utf8");
    assert.match(migration, /p_channel = 'temu'[\s\S]*STATIC_EGRESS_REQUIRED[\s\S]*SERVERLESS_WORKER_REQUIRED/);
    assert.match(migration, /p_channel = 'ebay'[\s\S]*EBAY_LISTING_CONFIGURATION_REQUIRED/);
    assert.doesNotMatch(migration, /cron\.|serverless_cs_wakeup_active|set_serverless_runtime_schedules_active/);
    await db.exec(migration);

    await db.exec("set role service_role");
    await assert.rejects(
      reserve(db, "temu", {}),
      /STATIC_EGRESS_REQUIRED/,
    );
    assert.equal(await callCount(db), 0);

    await db.exec("reset role");
    await db.exec("update sellerpilot_private.serverless_static_egress_policy set enabled = true where channel = 'temu'");
    await db.exec("set role service_role");
    await assert.rejects(
      reserve(db, "temu", {}),
      /SERVERLESS_WORKER_REQUIRED/,
    );
    assert.equal(await callCount(db), 0);

    await db.exec("reset role");
    await db.exec("update sellerpilot_private.runtime_fixture set configured = true, active = true, schedule_count = 6");
    await db.exec("set role service_role");
    assert.equal((await reserve(db, "temu", {})).status, "queued");
    assert.equal(await callCount(db), 1);

    await assert.rejects(
      reserve(db, "ebay", {
        offer: {
          listingPolicies: {
            fulfillmentPolicyId: "SERVER_MANAGED",
            paymentPolicyId: "payment-operator",
            returnPolicyId: "return-operator",
          },
          merchantLocationKey: "SERVER_MANAGED",
        },
      }),
      /EBAY_LISTING_CONFIGURATION_REQUIRED/,
    );
    assert.equal(await callCount(db), 1);

    assert.equal((await reserve(db, "ebay", explicitEbayArguments())).status, "queued");
    assert.equal((await reserve(db, "qoo10", {})).status, "queued");
    assert.equal(await callCount(db), 3);

    await db.exec("reset role");
    const privileges = await db.query(`
      select
        has_function_privilege(
          'service_role',
          'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)',
          'EXECUTE'
        ) as service_wrapper,
        has_function_privilege(
          'authenticated',
          'public.sellerpilot_service_reserve_and_enqueue_listing_create(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)',
          'EXECUTE'
        ) as authenticated_wrapper,
        has_function_privilege(
          'service_role',
          'public.sellerpilot_20260829_reserve_listing_unsafe(uuid,uuid,uuid,text,text,text,text,numeric,text,jsonb)',
          'EXECUTE'
        ) as service_underlying
    `);
    assert.deepEqual(privileges.rows[0], {
      service_wrapper: true,
      authenticated_wrapper: false,
      service_underlying: false,
    });
  } finally {
    await db.close();
  }
});

test("admin route readiness checks precede operation-attempt creation", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const ebayCheck = route.indexOf('channel === "ebay" && operation === "listing.create"');
  const temuCheck = route.indexOf('channel === "temu" && [');
  const claim = route.indexOf('sellerpilot_claim_channel_operation');
  assert.ok(ebayCheck >= 0 && temuCheck >= 0 && claim > ebayCheck && claim > temuCheck);
  assert.match(route, /sellerpilot_service_serverless_static_egress_status/);
  assert.match(route, /sellerpilot_service_serverless_cs_wakeup_status/);
  assert.match(route, /configuredServerlessStaticEgressChannels\(\)/);
  assert.match(route, /mode: "ebay_listing_configuration_required"/);
  assert.match(route, /mode: "serverless_worker_required"/);
});
