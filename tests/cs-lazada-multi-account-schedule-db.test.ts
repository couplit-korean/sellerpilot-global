import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { enqueueCurrentInquirySyncs } = await import("../lib/cs/operations/schedule");

const integratedRoot = process.env.SELLERPILOT_INTEGRATED_ROOT?.trim();
const migration = await readFile(integratedRoot
  ? new URL(`file://${integratedRoot}/supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql`)
  : new URL("../supabase/migrations/20260909124048_cs_lazada_multi_account_scope.sql", import.meta.url), "utf8");

const ownerOne = "00000000-0000-4000-8000-000000004001";
const ownerTwo = "00000000-0000-4000-8000-000000004002";
const credentials = {
  one: "00000000-0000-4000-8000-000000004011",
  two: "00000000-0000-4000-8000-000000004012",
  expired: "00000000-0000-4000-8000-000000004013",
  unbound: "00000000-0000-4000-8000-000000004014",
  inactive: "00000000-0000-4000-8000-000000004015",
};

function unrelatedEbayReceipt() {
 return {data:{contract:"sellerpilot-ebay-case-dispute-collection-enqueue/1",anchorAt:"2026-09-09T03:00:00.000Z",attempted:0,queued:0,pending:0,scopeBlocked:0,deferred:3,status:"not_connected"},error:null};
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema vault; create schema extensions;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable
      as $$select decode(md5(value)||md5(value||algorithm),'hex')$$;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
    create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text not null);
    create function vault.create_secret(text,text,text) returns uuid language plpgsql as $$
      declare next_id uuid:=gen_random_uuid(); begin
        insert into vault.decrypted_secrets values(next_id,$1); return next_id;
      end $$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key default gen_random_uuid(),channel text not null,environment text not null,
      version integer not null,vault_secret_id uuid not null,fingerprint text not null,
      status text not null default 'active',expires_at timestamptz,rotation_interval_days integer not null default 90,
      warning_days integer not null default 30,grace_ends_at timestamptz,
      last_rotated_at timestamptz not null default clock_timestamp(),last_checked_at timestamptz,
      last_check_status text,last_check_message text,created_by uuid not null,
      created_at timestamptz not null default clock_timestamp(),seller_account_key text,
      seller_account_key_source text not null default 'legacy_unattested',seller_account_verified_at timestamptz,
      unique(channel,environment,version)
    );
    create unique index channel_credentials_one_active_idx
      on sellerpilot_private.channel_credentials(channel,environment) where status='active';
    create table sellerpilot_private.credential_audit(
      id bigint generated always as identity primary key,credential_id uuid,channel text,
      environment text,action text,actor_user_id uuid,safe_detail jsonb,occurred_at timestamptz default now()
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,attempt_id uuid,channel text,operation text,
      environment text,request_payload jsonb,created_by uuid,seller_account_key text,
      status text not null default 'queued',created_at timestamptz not null default clock_timestamp()
    );
    create unique index channel_gateway_jobs_active_periodic_read_once_idx
      on sellerpilot_private.channel_gateway_jobs(credential_id,channel,operation,(trim(request_payload->>'periodicKey')))
      where attempt_id is null and operation in('orders.list','inquiries.list')
        and status in('queued','running') and nullif(trim(request_payload->>'periodicKey'),'') is not null;
    create table sellerpilot_private.cs_credential_capability_bindings(
      id uuid primary key default gen_random_uuid(),credential_id uuid not null,
      channel text not null,operation text not null,country text not null,
      status text not null default 'active',expires_at timestamptz
    );
    create table sellerpilot_private.channel_sync_state(
      owner_id uuid,channel_key text,data_type text,status text,imported_count integer,
      last_started_at timestamptz,last_error text,updated_at timestamptz,
      unique(owner_id,channel_key,data_type)
    );
    create function sellerpilot_private.lazada_im_lock_current_ticket_action_v1(uuid,uuid)
      returns jsonb language sql as $$select '{}'::jsonb$$;
  `);
  await db.query(`insert into auth.users values($1),($2)`, [ownerOne, ownerTwo]);
  await db.query(`insert into sellerpilot_private.admin_users values($1),($2)`, [ownerOne, ownerTwo]);
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ownerOne]);
  await db.exec(migration);
  return db;
}

async function addCredential(
  db: PGlite,
  id: string,
  owner: string,
  seller: string,
  options: { status?: string; expiresAt?: string; country?: string } = {},
) {
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,created_by,
    seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values($1,'lazada','production',(select coalesce(max(version),0)+1 from sellerpilot_private.channel_credentials),
    gen_random_uuid(),'SYNTHETIC',$4,$5,$2,$3,'provider_certified_v1',clock_timestamp())`,
  [id, owner, seller, options.status ?? "active", options.expiresAt ?? null]);
  if (options.country) {
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
      credential_id,channel,operation,country,status
    ) values($1,'lazada','inquiries.list',$2,'active')`, [id, options.country]);
  }
}

test("current scheduler reaches exact per-credential Lazada DB enqueue and isolates account failures", async () => {
  const db = await fixture();
  try {
    await addCredential(db, credentials.one, ownerOne, "a".repeat(64), { country: "MY" });
    await addCredential(db, credentials.two, ownerTwo, "b".repeat(64), { country: "SG" });
    await addCredential(db, credentials.expired, ownerOne, "c".repeat(64), {
      country: "TH", expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await addCredential(db, credentials.unbound, ownerTwo, "d".repeat(64));
    await addCredential(db, credentials.inactive, ownerOne, "e".repeat(64), {
      status: "revoked", country: "VN",
    });

    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if(name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") return unrelatedEbayReceipt();
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        assert.notEqual(args.p_channel, "lazada");
        return { data: { status: "already_pending" }, error: null };
      }
      assert.equal(name, "sellerpilot_service_enqueue_lazada_inquiry_fanout");
      await db.exec("set role service_role");
      const result = (await db.query<{ result: unknown }>(`select public.sellerpilot_service_enqueue_lazada_inquiry_fanout(
        $1,$2::jsonb,$3) result`, [
        args.p_operation,
        JSON.stringify(args.p_request_payload),
        args.p_min_interval_minutes,
      ])).rows[0]?.result;
      return { data: result, error: null };
    };

    const dependencies = { rpc, now: () => new Date("2026-09-09T03:00:00.000Z") };
    const first = await enqueueCurrentInquirySyncs(dependencies);
    const replay = await enqueueCurrentInquirySyncs(dependencies);
    await db.exec("reset role");

    assert.deepEqual(first, {
      attempted: 15, queued: 2, pending: 10, notConnected: 1,
      reconnectRequired: 1, reconciliationRequired: 1, fixedEgressRequired: 0, failed: 0,
    });
    assert.deepEqual(replay, {
      attempted: 15, queued: 0, pending: 12, notConnected: 1,
      reconnectRequired: 1, reconciliationRequired: 1, fixedEgressRequired: 0, failed: 0,
    });
    assert.equal(calls.filter(({ name }) => name === "sellerpilot_service_enqueue_lazada_inquiry_fanout").length, 2);
    assert.equal(calls.some(({ name, args }) =>
      name === "sellerpilot_service_enqueue_periodic_sync" && args.p_channel === "lazada"), false);

    const jobs = await db.query<{
      credential_id: string; created_by: string; seller_account_key: string; country: string;
    }>(`select credential_id::text,created_by::text,seller_account_key,
      request_payload->'arguments'->>'sellerpilotLazadaCountry' country
      from sellerpilot_private.channel_gateway_jobs order by credential_id`);
    assert.deepEqual(jobs.rows, [
      { credential_id: credentials.one, created_by: ownerOne, seller_account_key: "a".repeat(64), country: "MY" },
      { credential_id: credentials.two, created_by: ownerTwo, seller_account_key: "b".repeat(64), country: "SG" },
    ]);
  } finally {
    await db.close();
  }
});

test("scheduler aggregation retains healthy Lazada account evidence beside one failed account", async () => {
  const summary = await enqueueCurrentInquirySyncs({
    now: () => new Date("2026-09-09T03:00:00.000Z"),
    rpc: async (name) => name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2" ? unrelatedEbayReceipt() : name === "sellerpilot_service_enqueue_lazada_inquiry_fanout"
      ? {
        data: { status: "failed", accounts: [{ status: "queued" }, { status: "failed" }] },
        error: null,
      }
      : { data: { status: "already_pending" }, error: null },
  });
  assert.deepEqual(summary, {
    attempted: 13, queued: 1, pending: 10, notConnected: 1,
    reconnectRequired: 0, reconciliationRequired: 0, fixedEgressRequired: 0, failed: 1,
  });
});
