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
const shippingOrderByUrl = new URL(
  "../supabase/migrations/20260905013100_fix_qoo10_shipping_s1_serverless_claim_orderby.sql",
  import.meta.url,
);
const routingUrl = new URL(
  "../supabase/migrations/20260905014800_route_smartstore_reads_to_local_gateway.sql",
  import.meta.url,
);
const routingLibUrl = new URL(
  "../lib/channels/smartstore-local-read-routing.ts",
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

const OLD_PADDED_183000_BLOCK = `     and sellerpilot_private.serverless_gateway_job_allowed(
       job.channel,
       job.operation
     )
     and (
       job.channel not in ('coupang', 'smartstore', 'elevenst', 'temu', 'shopee')`;

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

function extractClaimFromWhere(definition, selectMarker) {
  const start = definition.indexOf(selectMarker);
  if (start < 0) throw new Error(`missing ${selectMarker}`);
  const fromIdx = definition.indexOf(
    "from sellerpilot_private.channel_gateway_jobs",
    start,
  );
  const orderIdx = definition.indexOf("order by", fromIdx);
  if (fromIdx < 0 || orderIdx < 0) {
    throw new Error(`claim FROM/ORDER BY bounds missing for ${selectMarker}`);
  }
  return definition.slice(fromIdx, orderIdx).trim();
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
    for (const operation of [...READ_OPS, ...WRITE_OPS]) {
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

function serverlessEvalFn(name, fromWhere) {
  return `
    create function public.${name}()
    returns table(channel text, operation text)
    language plpgsql as $fn$
    declare
      v_coupang_reads_waiting boolean := false;
      v_coupang_read_environment text;
      v_coupang_read_slot integer := 0;
    begin
      return query
      select job.channel, job.operation
      ${fromWhere};
    end;
    $fn$;
  `;
}

test("14800 uses compact SELECT WHERE and does not splice padded ORDER BY", async () => {
  const [routing, routingLib, shippingOrderBy] = await Promise.all([
    readFile(routingUrl, "utf8"),
    readFile(routingLibUrl, "utf8"),
    readFile(shippingOrderByUrl, "utf8"),
  ]);
  assert.match(routing, /where job\.status = 'queued'/);
  assert.match(routing, /and job\.channel is distinct from 'smartstore'/);
  assert.match(routing, /qoo10_shipping_s1_verifier_job_matches/);
  assert.match(routing, /S1 ORDER BY 42804 preimage drifted/);
  assert.match(routing, /SELECT WHERE preimage drifted/);
  assert.doesNotMatch(routing, /E' {3}order by\\n {5}case'/);
  assert.equal(hits(routing, OLD_PADDED_183000_BLOCK), 0);
  assert.doesNotMatch(routing, /serverless_static_egress_policy/);
  assert.doesNotMatch(routing, /gateway:worker:once/);
  assert.doesNotMatch(routing, /20260903150000/);
  assert.doesNotMatch(shippingOrderBy, /20260905014800/);
  for (const operation of READ_OPS) {
    assert.match(routing, new RegExp(`'${operation}'`));
    assert.match(routingLib, new RegExp(`"${operation}"`));
  }
});

test("live/padded 183000 misses the old indent block and keeps unique SELECT WHERE", async () => {
  const { localDef, serverlessDef, source } = await loadClaimFixtures();
  assert.ok(source === "live" || source === "padded-composed", source);
  assert.equal(hits(localDef, "j.channel in ('coupang', 'smartstore', 'temu')"), 1);
  assert.equal(hits(localDef, `     and not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs running`), 1);
  assert.equal(hits(serverlessDef, "where job.status = 'queued'"), 1);
  assert.equal(hits(serverlessDef, "and job.status = 'queued'"), 1);
  assert.equal(hits(serverlessDef, OLD_PADDED_183000_BLOCK), 0);
  assert.equal(hits(serverlessDef, "and job.channel is distinct from 'smartstore'"), 0);
  const whereAt = serverlessDef.indexOf("where job.status = 'queued'");
  const selectAt = serverlessDef.indexOf("select job.id");
  const queuedReadOrder = serverlessDef.indexOf("order by queued_read");
  const claimOrder = serverlessDef.indexOf("order by", whereAt);
  const lockAt = serverlessDef.indexOf("for update of job skip locked", whereAt);
  assert.ok(selectAt > 0 && whereAt > selectAt);
  assert.ok(queuedReadOrder > 0 && queuedReadOrder < selectAt);
  assert.ok(claimOrder > whereAt);
  assert.ok(lockAt > claimOrder);
});

test("14800 PGlite replay on padded live defs is idempotent and keeps the claim matrix", async () => {
  const routing = await readFile(routingUrl, "utf8");
  const { localDef, serverlessDef } = await loadClaimFixtures();
  const db = new PGlite();
  try {
    await installClaimFunctions(db, localDef, serverlessDef);
    await db.exec(FIXTURE_SQL);
    await seedJobs(db);

    const localBeforeFrom = extractClaimFromWhere(localDef, "select j.id into v_job_id");
    const localBeforeSelect = extractClaimSelect(
      localDef,
      "select j.id into v_job_id",
      "for update of j, c skip locked",
    );
    await assert.rejects(
      () => db.exec(`select j.channel, j.operation ${localBeforeSelect}`),
      /42804|datatype mismatch|argument of AND must be type boolean/i,
    );
    const serverlessBeforeFrom = extractClaimFromWhere(serverlessDef, "select job.id");
    const localBefore = await claimSet(db, `select j.channel, j.operation ${localBeforeFrom}`);
    await db.exec(serverlessEvalFn("eval_serverless_before", serverlessBeforeFrom));
    const serverlessBefore = await claimSet(
      db,
      "select channel, operation from public.eval_serverless_before()",
    );

    await db.exec(routing);
    const localAfterDef = await functionDef(
      db,
      "public.sellerpilot_11820_claim_gateway_unsafe(text,text)",
    );
    const serverlessAfterDef = await functionDef(
      db,
      "public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)",
    );
    await db.exec(routing);
    const localIdempotent = await functionDef(
      db,
      "public.sellerpilot_11820_claim_gateway_unsafe(text,text)",
    );
    const serverlessIdempotent = await functionDef(
      db,
      "public.sellerpilot_183000_claim_serverless_gateway_unsafe(text,text)",
    );
    assert.equal(localIdempotent, localAfterDef);
    assert.equal(serverlessIdempotent, serverlessAfterDef);
    assert.equal(hits(serverlessAfterDef, "where job.status = 'queued'"), 1);
    assert.equal(hits(serverlessAfterDef, "and job.channel is distinct from 'smartstore'"), 1);
    const whereAt = serverlessAfterDef.indexOf("where job.status = 'queued'");
    const excludeAt = serverlessAfterDef.indexOf("and job.channel is distinct from 'smartstore'");
    const orderAt = serverlessAfterDef.indexOf("order by", whereAt);
    const lockAt = serverlessAfterDef.indexOf("for update of job skip locked", whereAt);
    assert.ok(excludeAt > whereAt && excludeAt < orderAt);
    assert.ok(lockAt > orderAt);
    assert.match(localAfterDef, /where j\.status = 'queued'/);
    assert.match(localAfterDef, /j\.channel in \('coupang', 'temu'\)/);
    assert.equal(hits(localAfterDef, "j.channel in ('coupang', 'smartstore', 'temu')"), 0);
    assert.match(localAfterDef, /false and serverless_token\.scope = 'serverless_cs'/);
    assert.match(localAfterDef, /qoo10_shipping_s1_verifier_job_matches/);
    const localWhereAt = localAfterDef.indexOf("where j.status = 'queued'");
    const localOrderAt = localAfterDef.indexOf("order by", localWhereAt);
    const localVerifierAt = localAfterDef.indexOf("qoo10_shipping_s1_verifier_job_matches");
    const localActivationAt = localAfterDef.indexOf("qoo10_shipping_s1_activation_job_matches");
    assert.ok(localVerifierAt > localWhereAt && localVerifierAt < localOrderAt);
    assert.ok(localActivationAt > localWhereAt && localActivationAt < localOrderAt);
    assert.equal(
      hits(
        localAfterDef,
        `     j.id\n     and not sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(j)`,
      ),
      0,
    );
    assert.match(serverlessAfterDef, /qoo10_shipping_s1_activation_claim_priority/);
    assert.match(serverlessAfterDef, /order by queued_read/);

    const localAfterSelect = extractClaimSelect(
      localAfterDef,
      "select j.id into v_job_id",
      "for update of j, c skip locked",
    );
    const serverlessAfterFrom = extractClaimFromWhere(serverlessAfterDef, "select job.id");
    const localAfter = await claimSet(db, `select j.channel, j.operation ${localAfterSelect}`);
    await db.exec(serverlessEvalFn("eval_serverless_after", serverlessAfterFrom));
    const serverlessAfter = await claimSet(
      db,
      "select channel, operation from public.eval_serverless_after()",
    );

    const changedLocal = [];
    const changedServerless = [];
    for (const channel of CHANNELS) {
      for (const operation of [...READ_OPS, ...WRITE_OPS]) {
        const key = keyOf(channel, operation);
        if (localBefore.has(key) !== localAfter.has(key)) changedLocal.push(key);
        if (serverlessBefore.has(key) !== serverlessAfter.has(key)) changedServerless.push(key);
      }
    }
    for (const operation of READ_OPS) {
      const key = keyOf("smartstore", operation);
      assert.equal(localBefore.has(key), false, `pre local ${key}`);
      assert.equal(localAfter.has(key), true, `post local ${key}`);
      assert.equal(serverlessBefore.has(key), true, `pre serverless ${key}`);
      assert.equal(serverlessAfter.has(key), false, `post serverless ${key}`);
    }
    for (const operation of WRITE_OPS) {
      const key = keyOf("smartstore", operation);
      assert.equal(localBefore.has(key), false, `pre local write ${key}`);
      assert.equal(localAfter.has(key), false, `post local write ${key}`);
      assert.equal(serverlessBefore.has(key), true, `pre serverless write ${key}`);
      assert.equal(serverlessAfter.has(key), false, `post serverless write ${key}`);
    }
    assert.deepEqual(
      changedLocal.sort(),
      READ_OPS.map((operation) => keyOf("smartstore", operation)).sort(),
    );
    assert.deepEqual(changedServerless.filter((key) => !key.startsWith("smartstore\t")), []);
    for (const channel of ["qoo10", "ebay", "coupang"]) {
      const key = keyOf(channel, "diagnostic.test");
      assert.equal(localBefore.has(key), localAfter.has(key), `local ${key} drifted`);
      assert.equal(
        serverlessBefore.has(key),
        serverlessAfter.has(key),
        `serverless ${key} drifted`,
      );
    }
  } finally {
    await db.close();
  }
});
