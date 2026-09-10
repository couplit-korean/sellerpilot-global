import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const [
  proposalSql,
  generalMigration,
  smartstoreMigration,
  unboundCreateMigration,
  exactClaimMigration,
  hydrationMigration,
  canonicalFixtureSource,
] = await Promise.all([
  readFile(new URL("supabase/migrations/20260908145334_cs_coupang_local_read_executor.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260907110000_general_local_channel_executor.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260907161000_smartstore_local_update_executor.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260907180000_allow_unbound_listing_create_local_claim.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260908011500_allow_exact_coupang_live_verifier_local_claim.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/20260908013000_hydrate_exact_coupang_local_verifier_claim.sql", root), "utf8"),
  readFile(new URL("tests/local-channel-executor-migration.test.mjs", root), "utf8"),
]);

const release = "8".repeat(40);
const egress = "a".repeat(64);
const sellerKey = "b".repeat(64);
const tokenHash = "d".repeat(64);
const version = `sellerpilot-cli-worker/1.61+${release}.${egress.slice(0, 11)}`;
const ids = {
  owner: "00000000-0000-4000-8000-000000008001",
  credentialCreator: "00000000-0000-4000-8000-000000008002",
  tokenCreator: "00000000-0000-4000-8000-000000008003",
  approver: "00000000-0000-4000-8000-000000008004",
  credential: "00000000-0000-4000-8000-000000008005",
  token: "00000000-0000-4000-8000-000000008006",
  attempt: "00000000-0000-4000-8000-000000008007",
  job: "00000000-0000-4000-8000-000000008008",
};

function between(source, startNeedle, endNeedle, from = 0) {
  const start = source.indexOf(startNeedle, from);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle} section missing`);
  return source.slice(start, end);
}

function canonicalFixture() {
  const raw = between(
    canonicalFixtureSource,
    "const fixture = `",
    "`;\n\nasync function createDatabase()",
  ).slice("const fixture = `".length);
  return raw.replace("${release}", release);
}

function currentWrapperChain() {
  const allowedStart = exactClaimMigration.indexOf(
    "alter function sellerpilot_private.local_channel_executor_job_allowed(",
  );
  const claimStart = exactClaimMigration.indexOf(
    "alter function public.sellerpilot_claim_local_channel_executor_job(",
    allowedStart,
  );
  const exactEnd = exactClaimMigration.indexOf("notify pgrst", claimStart);
  const hydrationStart = hydrationMigration.lastIndexOf(
    "alter function public.sellerpilot_claim_local_channel_executor_job(",
  );
  const hydrationEnd = hydrationMigration.indexOf("notify pgrst", hydrationStart);
  assert.ok(allowedStart >= 0 && claimStart > allowedStart && exactEnd > claimStart);
  assert.ok(hydrationStart >= 0 && hydrationEnd > hydrationStart);
  return {
    allowed: exactClaimMigration.slice(allowedStart, claimStart),
    exactClaim: exactClaimMigration.slice(claimStart, exactEnd),
    hydrationClaim: hydrationMigration.slice(hydrationStart, hydrationEnd),
  };
}

async function database() {
  const db = new PGlite();
  await db.exec(canonicalFixture());
  await db.exec(generalMigration);
  await db.exec(`
    alter table sellerpilot_private.product_listings add column remote_id text;
    create function sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid)
    returns boolean language sql stable as $$select false$$;
  `);
  await db.exec(smartstoreMigration);
  await db.exec(unboundCreateMigration);
  await db.exec(`
    create function sellerpilot_private.coupang_exact_live_local_claim_allowed(
      uuid,uuid,uuid,text,text,text
    ) returns boolean language sql stable security definer set search_path=''
    as $$select false$$;
  `);
  const wrappers = currentWrapperChain();
  await db.exec(wrappers.allowed);
  await db.exec(wrappers.exactClaim);
  await db.exec(wrappers.hydrationClaim);
  return db;
}

async function definitionMd5s(db) {
  return (await db.query(`select
    md5(pg_get_functiondef(
      'sellerpilot_private.local_channel_executor_access(text,text)'::regprocedure
    )) access,
    md5(pg_get_functiondef(
      'sellerpilot_private.local_channel_executor_job_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
    )) allowed,
    md5(pg_get_functiondef(
      'public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure
    )) claim,
    (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
      where c.conrelid='sellerpilot_private.local_channel_executor_routes'::regclass
        and c.conname='local_channel_executor_routes_operation_check') constraint_hash
  `)).rows[0];
}

const productionMd5s = {
  access: "6b1f84d12642c644bf679af54d3f7d85",
  allowed: "51ffc1577c1e2636c11924fba65bf273",
  claim: "3eb4ef53f44490f60892312a2c0a2731",
  constraint_hash: "5ffadee0a3f1b1baa6ebcfe995c8d78b",
};

const pgliteMd5s = {
  access: "cb0a5fadd2c57453ccb304a384a6c83c",
  allowed: "f471657b5c8022d8b5624f42fd4d076f",
  claim: "41fdc44910b30e6567d101dc0b420833",
  constraint_hash: "276cc8bfd57423cf1d6cb626515e9e93",
};

async function applyProposal(db) {
  const before = await definitionMd5s(db);
  assert.deepEqual(before, pgliteMd5s);
  let executable = proposalSql;
  for (const key of Object.keys(productionMd5s)) {
    assert.match(executable, new RegExp(productionMd5s[key], "u"));
    executable = executable.replaceAll(productionMd5s[key], pgliteMd5s[key]);
  }
  await db.exec(executable);
  const after = await definitionMd5s(db);
  assert.equal(after.allowed, before.allowed);
  assert.equal(after.claim, before.claim);
}

async function seedRead(db) {
  await db.exec(`
    insert into auth.users(id) values
      ('${ids.owner}'),('${ids.credentialCreator}'),('${ids.tokenCreator}'),('${ids.approver}');
    insert into sellerpilot_private.admin_users(user_id) select id from auth.users;
    insert into sellerpilot_private.ai_cli_worker_tokens values(
      '${ids.token}','${tokenHash}','gateway','active',clock_timestamp()+interval '1 day',
      clock_timestamp(),'${version}','${ids.tokenCreator}'
    );
    insert into sellerpilot_private.channel_credentials values(
      '${ids.credential}','coupang','production','active',clock_timestamp()+interval '1 day',
      'passed','${sellerKey}','provider_certified_v1','${ids.credentialCreator}'
    );
    insert into sellerpilot_private.serverless_static_egress_policy values('coupang',false);
    insert into sellerpilot_private.channel_operation_attempts values(
      '${ids.attempt}','${ids.credential}','coupang','inquiries.list','running',null,
      '${ids.owner}','${sellerKey}'
    );
    insert into sellerpilot_private.channel_gateway_jobs values(
      '${ids.job}','${ids.credential}','${ids.attempt}',null,'coupang','inquiries.list',
      'production','queued','{"arguments":{"kind":"product"}}'::jsonb,
      null,false,null,null,false,'${sellerKey}',null,null,null,0,clock_timestamp()
    );
    insert into sellerpilot_private.local_channel_executor_routes(
      owner_id,channel,operation,credential_id,seller_account_key,worker_token_id,
      release_sha,egress_ip_sha256,approved_by,approved_at,expires_at,enabled
    ) values(
      '${ids.owner}','coupang','inquiries.list','${ids.credential}','${sellerKey}',
      '${ids.token}','${release}','${egress}','${ids.approver}',clock_timestamp(),
      clock_timestamp()+interval '1 hour',true
    );
  `);
}

async function claim(db, overrides = {}) {
  return (await db.query(
    "select public.sellerpilot_claim_local_channel_executor_job($1,$2,$3,$4) result",
    [
      overrides.tokenHash ?? tokenHash,
      overrides.version ?? version,
      overrides.release ?? release,
      overrides.egress ?? egress,
    ],
  )).rows[0].result;
}

test("canonical local-executor chain executes the production-pinned SQL with no route rows", async () => {
  const db = await database();
  try {
    assert.deepEqual(await definitionMd5s(db), pgliteMd5s);
    for (const digest of Object.values(productionMd5s)) {
      assert.match(proposalSql, new RegExp(digest, "u"));
    }
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.local_channel_executor_routes",
    )).rows[0].count, 0);
    await applyProposal(db);
    assert.equal((await db.query(
      "select count(*)::int count from sellerpilot_private.local_channel_executor_routes",
    )).rows[0].count, 0);
    const access = (await db.query(`select
      sellerpilot_private.local_channel_executor_access('coupang','inquiries.list') inquiry_read,
      sellerpilot_private.local_channel_executor_access('coupang','inquiries.reply') inquiry_reply,
      sellerpilot_private.local_channel_executor_access('coupang','orders.list') order_read,
      sellerpilot_private.local_channel_executor_access('coupang','shipment.confirm') shipment,
      sellerpilot_private.local_channel_executor_access('smartstore','inquiries.list') other_channel
    `)).rows[0];
    assert.deepEqual(access, {
      inquiry_read: "read",
      inquiry_reply: null,
      order_read: null,
      shipment: null,
      other_channel: null,
    });
  } finally {
    await db.close();
  }
});

test("actual claim requires exact seller, credential, release, egress, token and fresh route", async () => {
  const mutations = [
    ["seller", "update sellerpilot_private.channel_gateway_jobs set seller_account_key=repeat('f',64)"],
    ["credential", "update sellerpilot_private.channel_gateway_jobs set credential_id='00000000-0000-4000-8000-000000008099'"],
    ["release", `update sellerpilot_private.local_channel_executor_routes set release_sha=repeat('f',40)`],
    ["egress", `update sellerpilot_private.local_channel_executor_routes set egress_ip_sha256=repeat('f',64)`],
    ["token", "update sellerpilot_private.ai_cli_worker_tokens set status='revoked'"],
    ["expired token", "update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()-interval '1 second'"],
    ["expired route", "update sellerpilot_private.local_channel_executor_routes set approved_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'"],
    ["disabled route", "update sellerpilot_private.local_channel_executor_routes set enabled=false"],
  ];
  for (const [label, mutation] of mutations) {
    const db = await database();
    try {
      await applyProposal(db);
      await seedRead(db);
      await db.exec(mutation);
      assert.equal(await claim(db), null, label);
    } finally {
      await db.close();
    }
  }

  const db = await database();
  try {
    await applyProposal(db);
    await seedRead(db);
    assert.equal((await claim(db)).operation, "inquiries.list");
  } finally {
    await db.close();
  }
});

test("read claim rejects listing and external-detail bindings and never admits forbidden tuples", async () => {
  const db = await database();
  try {
    await applyProposal(db);
    await seedRead(db);
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set listing_id=$1 where id=$2",
      ["00000000-0000-4000-8000-000000008099", ids.job],
    );
    assert.equal((await db.query(`select sellerpilot_private.local_channel_executor_job_allowed(
      $1,$2,$3,$4,$5,$6
    ) allowed`, [ids.job, ids.credential, ids.token, version, release, egress])).rows[0].allowed, false);
    assert.equal(await claim(db), null);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      listing_id=null,request_payload=jsonb_set(request_payload,
        '{arguments,sellerpilotExternalDetail}','{"importId":"forbidden"}'::jsonb,true)
      where id=$1`, [ids.job]);
    assert.equal(await claim(db), null);

    for (const operation of [
      "inquiries.reply", "orders.list", "shipment.confirm", "listing.update",
    ]) {
      await db.query(`update sellerpilot_private.channel_gateway_jobs set
        operation=$1,request_payload='{}'::jsonb where id=$2`, [operation, ids.job]);
      await db.query(
        "update sellerpilot_private.channel_operation_attempts set operation=$1 where id=$2",
        [operation, ids.attempt],
      );
      assert.equal(await claim(db), null, operation);
    }
  } finally {
    await db.close();
  }
});
