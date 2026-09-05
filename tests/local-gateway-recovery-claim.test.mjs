import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const persistLiveUrl = new URL(
  "../supabase/migrations/20260904232000_persist_live_gateway_claim_routing.sql",
  import.meta.url,
);
const serverlessBaseUrl = new URL(
  "../supabase/migrations/20260904195000_keep_shopee_category_reads_on_local_gateway.sql",
  import.meta.url,
);
const routingUrl = new URL(
  "../supabase/migrations/20260905014800_route_smartstore_reads_to_local_gateway.sql",
  import.meta.url,
);
const recoveryUrl = new URL(
  "../supabase/migrations/20260905015000_scope_local_gateway_recovery_lane.sql",
  import.meta.url,
);
const liveEvidencePath = process.env.SELLERPILOT_CLAIM_FIXTURE;

const READ_OPS = [
  "diagnostic.test",
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "inquiries.list",
  "listing.publication.verify",
];
const WRITE_OPS = [
  "orders.list",
  "orders.get",
  "inquiries.reply",
  "listing.create",
  "listing.update",
  "listing.stop",
  "inventory.update",
  "shipment.acknowledge",
  "shipment.confirm",
];
const CHANNELS = [
  "smartstore",
  "coupang",
  "temu",
  "elevenst",
  "qoo10",
  "ebay",
  "shopee",
  "lazada",
];
const GUC_MARKER = "sellerpilot.local_gateway_recovery_lane";

function hits(haystack, needle) {
  if (!needle) throw new Error("empty needle");
  return haystack.split(needle).length - 1;
}

function replaceOnce(haystack, needle, replacement, label) {
  const count = hits(haystack, needle);
  if (count !== 1) throw new Error(`${label} preimage hits=${count}`);
  return haystack.replace(needle, replacement);
}

function extractFunction(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`missing CREATE for ${name}`);
  const marker = "$function$";
  const open = sql.indexOf(marker, start);
  const close = sql.indexOf(marker, open + marker.length);
  if (open < 0 || close < 0) throw new Error(`missing $function$ for ${name}`);
  const semi = sql.indexOf(";", close + marker.length);
  if (semi < 0 || semi - (close + marker.length) > 8) {
    throw new Error(`missing terminator for ${name}`);
  }
  return sql.slice(start, semi + 1);
}

function composeCurrent11820(persistLive) {
  let definition = extractFunction(persistLive, "sellerpilot_11820_claim_gateway_unsafe");
  definition = replaceOnce(
    definition,
    "  where id = v_token_id;\n\n  with expired as (",
    "  where id = v_token_id;\n\n  perform sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim();\n\n  with expired as (",
    "11820 expire",
  );
  definition = replaceOnce(
    definition,
    `   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,`,
    `   order by
     case
       when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(j.id)
         or sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
         then 0
       else 1
     end,`,
    "11820 order",
  );
  definition = replaceOnce(
    definition,
    "   for update of j, c skip locked",
    `     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)
     and not (
       sellerpilot_private.qoo10_shipping_s1_activation_job_matches(j)
       and not sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(j.id)
     )
   for update of j, c skip locked`,
    "11820 exclude",
  );
  return definition;
}

function composeCurrent183000(serverlessBase) {
  let definition = extractFunction(
    serverlessBase,
    "sellerpilot_183000_claim_serverless_gateway_unsafe",
  );
  definition = replaceOnce(
    definition,
    "perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);",
    `perform public.sellerpilot_service_reap_stale_channel_gateway_jobs(100);
  perform sellerpilot_private.expire_qoo10_shipping_s1_activation_preclaim();`,
    "183000 expire",
  );
  definition = replaceOnce(
    definition,
    "when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)",
    `when sellerpilot_private.qoo10_exact_s1_activation_claim_priority(job.id)
         or sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(job.id)`,
    "183000 order",
  );
  assert.equal(hits(definition, "for update of job skip locked"), 1);
  assert.equal(hits(definition, "qoo10_shipping_s1_activation_job_matches(job)"), 0);
  return definition;
}

function padClaimSelect(definition) {
  const start = definition.indexOf("select job.id");
  const lock = definition.indexOf("for update of job skip locked", start);
  if (start < 0 || lock < 0) throw new Error("pad bounds missing");
  let n = 740;
  const padded = definition.slice(start, lock).replace(/\n/g, () => {
    n += 7;
    return `\n${" ".repeat(n)}`;
  });
  return definition.slice(0, start) + padded + definition.slice(lock);
}

async function loadClaimFixtures() {
  const persistLive = await readFile(persistLiveUrl, "utf8");
  const serverlessBase = await readFile(serverlessBaseUrl, "utf8");
  const composed11820 = composeCurrent11820(persistLive);
  const composed183000 = composeCurrent183000(serverlessBase);
  if (liveEvidencePath) {
    const evidence = JSON.parse(await readFile(liveEvidencePath, "utf8"));
    const live11820 = evidence?.claims?.sellerpilot_11820_claim_gateway_unsafe;
    const live183000 = evidence?.claims?.sellerpilot_183000_claim_serverless_gateway_unsafe;
    assert.equal(typeof live11820, "string", "explicit live fixture must contain 11820");
    assert.equal(typeof live183000, "string", "explicit live fixture must contain 183000");
    return { localDef: live11820, serverlessDef: live183000, source: "live" };
  }
  return {
    localDef: composed11820,
    serverlessDef: padClaimSelect(composed183000),
    source: "padded-composed",
  };
}

function extractClaimSelect(definition, selectMarker, lockNeedle) {
  const start = definition.indexOf(selectMarker);
  if (start < 0) throw new Error(`missing ${selectMarker}`);
  const fromIdx = definition.indexOf(
    "from sellerpilot_private.channel_gateway_jobs",
    start,
  );
  const lockIdx = definition.indexOf(lockNeedle, fromIdx);
  if (fromIdx < 0 || lockIdx < 0) {
    throw new Error(`claim FROM/lock bounds missing for ${selectMarker}`);
  }
  return definition.slice(fromIdx, lockIdx + lockNeedle.length).trim();
}

function keyOf(channel, operation) {
  return `${channel}\t${operation}`;
}

async function claimSet(db, evalSql) {
  const result = await db.query(evalSql);
  return new Set(result.rows.map((row) => keyOf(row.channel, row.operation)));
}

async function installClaimFunctions(db, localDef, serverlessDef) {
  await db.exec(`
    create schema if not exists sellerpilot_private;
    create schema if not exists vault;
    create schema if not exists extensions;
  `);
  await db.exec(localDef);
  await db.exec(serverlessDef);
}

async function functionDef(db, signature) {
  const result = await db.query(
    `select pg_get_functiondef('${signature}'::regprocedure) as d`,
  );
  return result.rows[0].d;
}

const FIXTURE_SQL = `
  create table if not exists sellerpilot_private.channel_credentials (
    id uuid primary key,
    channel text not null,
    environment text not null,
    status text not null,
    expires_at timestamptz,
    seller_account_key text,
    seller_account_key_source text,
    seller_account_verified_at timestamptz,
    last_check_status text,
    last_checked_at timestamptz
  );
  create table if not exists sellerpilot_private.channel_gateway_jobs (
    id uuid primary key,
    credential_id uuid not null,
    status text not null,
    channel text not null,
    operation text not null,
    environment text not null,
    seller_account_key text,
    prepared_credential_id uuid,
    attempt_id uuid,
    request_payload jsonb not null default '{}'::jsonb,
    response_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp(),
    completed_at timestamptz,
    updated_at timestamptz,
    provider_mutation_started_at timestamptz,
    credential_refresh_in_flight boolean not null default false,
    credential_refresh_recovery_vault_id uuid,
    oauth_exchange_completed boolean not null default false
  );
  create table if not exists sellerpilot_private.ai_cli_worker_tokens (
    scope text not null,
    status text not null,
    expires_at timestamptz not null
  );
  create or replace function sellerpilot_private.serverless_gateway_job_allowed(
    p_channel text,
    p_operation text
  ) returns boolean
  language sql immutable as $$
    select true;
  $$;
  create or replace function sellerpilot_private.serverless_static_egress_allowed(p_channel text)
  returns boolean
  language sql immutable as $$
    select p_channel in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee');
  $$;
  create or replace function sellerpilot_private.qoo10_exact_s1_activation_claim_priority(p_id uuid)
  returns boolean language sql immutable as $$ select false $$;
  create or replace function sellerpilot_private.qoo10_shipping_s1_activation_claim_priority(p_id uuid)
  returns boolean language sql immutable as $$ select false $$;
  create or replace function sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(
    j sellerpilot_private.channel_gateway_jobs
  ) returns boolean language sql immutable as $$ select false $$;
  create or replace function sellerpilot_private.qoo10_shipping_s1_activation_job_matches(
    j sellerpilot_private.channel_gateway_jobs
  ) returns boolean language sql immutable as $$ select false $$;
`;

async function seedJobs(db) {
  let n = 1;
  const inserts = [];
  for (const channel of CHANNELS) {
    const credentialId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    n += 1;
    inserts.push(`
      insert into sellerpilot_private.channel_credentials (
        id, channel, environment, status, seller_account_key,
        seller_account_key_source, seller_account_verified_at
      ) values (
        '${credentialId}', '${channel}', 'production', 'active',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'provider_certified_v1', clock_timestamp()
      );
    `);
    const operations = channel === "shopee"
      ? ["oauth.exchange", ...READ_OPS, ...WRITE_OPS]
      : [...READ_OPS, ...WRITE_OPS];
    for (const operation of operations) {
      const jobId = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      n += 1;
      inserts.push(`
        insert into sellerpilot_private.channel_gateway_jobs (
          id, credential_id, status, channel, operation, environment,
          seller_account_key
        ) values (
          '${jobId}', '${credentialId}', 'queued', '${channel}', '${operation}',
          'production',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        );
      `);
    }
  }
  await db.exec(inserts.join("\n"));
}

test("15000 uses compact SELECT WHERE GUC needle and does not splice ORDER BY", async () => {
  const recovery = await readFile(recoveryUrl, "utf8");
  assert.equal(hits(recovery, "where j.status = 'queued'"), 2);
  assert.match(recovery, /SELECT WHERE preimage drifted/);
  assert.match(recovery, /current_setting\('sellerpilot\.local_gateway_recovery_lane', true\)/);
  assert.doesNotMatch(recovery, /order by[\s\S]{0,80}local_gateway_recovery_lane/);
  assert.doesNotMatch(recovery, /sellerpilot_183000/);
  assert.doesNotMatch(recovery, /gateway:worker:once/);
  assert.doesNotMatch(recovery, /update sellerpilot_private\.channel_gateway_jobs/i);
  assert.match(recovery, /grant execute on function public\.sellerpilot_claim_local_gateway_recovery_job\(text, text\)/);
  assert.match(
    recovery,
    /revoke all on function public\.sellerpilot_claim_local_gateway_recovery_job\(text, text\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.ok("sellerpilot_claim_local_gateway_recovery_job".length < 63);
});

test("15000 PGlite replay keeps 14800 matrix unless recovery GUC is enabled", async () => {
  const routing = await readFile(routingUrl, "utf8");
  const recovery = await readFile(recoveryUrl, "utf8");
  const { localDef, serverlessDef } = await loadClaimFixtures();
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
    `);
    await installClaimFunctions(db, localDef, serverlessDef);
    await db.exec(FIXTURE_SQL);
    await seedJobs(db);
    await db.exec(`
      create function public.sellerpilot_claim_channel_gateway_job(
        p_token_hash text,
        p_worker_version text default null
      )
      returns jsonb
      language plpgsql
      as $fn$
      begin
        return jsonb_build_object(
          'lane', current_setting('sellerpilot.local_gateway_recovery_lane', true),
          'token', p_token_hash,
          'version', p_worker_version
        );
      end;
      $fn$;
    `);

    await db.exec(routing);
    const localAfter14800 = await functionDef(
      db,
      "public.sellerpilot_11820_claim_gateway_unsafe(text,text)",
    );
    const serverlessAfter14800 = await functionDef(
      db,
      "public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)",
    );
    const localAfter14800Select = extractClaimSelect(
      localAfter14800,
      "select j.id into v_job_id",
      "for update of j, c skip locked",
    );
    const after14800 = await claimSet(
      db,
      `select j.channel, j.operation ${localAfter14800Select}`,
    );

    await db.exec(recovery);
    const localAfter15000 = await functionDef(
      db,
      "public.sellerpilot_11820_claim_gateway_unsafe(text,text)",
    );
    const serverlessAfter15000 = await functionDef(
      db,
      "public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)",
    );
    await db.exec(recovery);
    const localIdempotent = await functionDef(
      db,
      "public.sellerpilot_11820_claim_gateway_unsafe(text,text)",
    );
    const serverlessIdempotent = await functionDef(
      db,
      "public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)",
    );
    assert.equal(localIdempotent, localAfter15000);
    assert.equal(serverlessIdempotent, serverlessAfter15000);
    assert.equal(serverlessAfter15000, serverlessAfter14800);
    assert.equal(hits(serverlessAfter15000, GUC_MARKER), 0);
    assert.equal(hits(localAfter15000, GUC_MARKER), 1);
    const whereAt = localAfter15000.indexOf("where j.status = 'queued'");
    const gucAt = localAfter15000.indexOf(GUC_MARKER);
    const orderAt = localAfter15000.indexOf("order by", whereAt);
    const lockAt = localAfter15000.indexOf("for update of j, c skip locked", whereAt);
    assert.ok(whereAt > 0 && gucAt > whereAt && gucAt < orderAt);
    assert.ok(lockAt > orderAt);
    assert.equal(hits(localAfter15000, "j.channel in ('coupang', 'temu')"), 1);
    assert.match(localAfter15000, /false and serverless_token\.scope = 'serverless_cs'/);
    assert.ok(
      localAfter15000.indexOf("qoo10_shipping_s1_verifier_job_matches") > whereAt
        && localAfter15000.indexOf("qoo10_shipping_s1_verifier_job_matches") < orderAt,
    );

    const localAfter15000Select = extractClaimSelect(
      localAfter15000,
      "select j.id into v_job_id",
      "for update of j, c skip locked",
    );
    const gucOff = await claimSet(
      db,
      `select j.channel, j.operation ${localAfter15000Select}`,
    );
    assert.deepEqual([...gucOff].sort(), [...after14800].sort());

    await db.exec("begin");
    await db.exec(`select set_config('${GUC_MARKER}', 'enabled', true)`);
    const gucOn = await claimSet(
      db,
      `select j.channel, j.operation ${localAfter15000Select}`,
    );
    await db.exec("rollback");
    const expected = new Set([
      keyOf("shopee", "oauth.exchange"),
      ...READ_OPS.map((operation) => keyOf("smartstore", operation)),
    ]);
    assert.deepEqual([...gucOn].sort(), [...expected].sort());
    for (const operation of ["diagnostic.test", "categories.list", "listing.create"]) {
      assert.equal(gucOn.has(keyOf("shopee", operation)), false, `shopee ${operation}`);
    }
    for (const channel of ["coupang", "qoo10", "ebay", "elevenst"]) {
      assert.equal(gucOn.has(keyOf(channel, "diagnostic.test")), false, `${channel} diagnostic`);
      assert.equal(gucOn.has(keyOf(channel, "inquiries.list")), false, `${channel} inquiries`);
      assert.equal(gucOn.has(keyOf(channel, "orders.list")), false, `${channel} orders`);
    }

    const wrapped = await db.query(
      "select public.sellerpilot_claim_local_gateway_recovery_job('ab', 'sellerpilot-cli-worker/1.60') as d",
    );
    assert.equal(wrapped.rows[0].d.lane, "enabled");
    assert.equal(wrapped.rows[0].d.version, "sellerpilot-cli-worker/1.60");
    const restored = await db.query(
      `select coalesce(current_setting('${GUC_MARKER}', true), '') as lane`,
    );
    assert.equal(restored.rows[0].lane, "");
  } finally {
    await db.close();
  }
});
