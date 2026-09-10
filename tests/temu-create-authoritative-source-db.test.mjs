import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260910025000_temu_create_authoritative_sources.sql",
  import.meta.url,
), "utf8");
const producerMigration = await readFile(new URL(
  "../supabase/migrations/20260910033000_temu_create_producer_context.sql",
  import.meta.url,
), "utf8");
const route = await readFile(new URL(
  "../docs/product-channel-parallel/reports/temu/temu-002-r24-channel-operations.route.patch",
  import.meta.url,
), "utf8");

const owner = "10000000-0000-4000-8000-000000000001";
const product = "20000000-0000-4000-8000-000000000002";
const credential = "30000000-0000-4000-8000-000000000003";
const job = "40000000-0000-4000-8000-000000000004";
const claim = "50000000-0000-4000-8000-000000000005";
const accountSubject = `temu-account:sha256:${"1".repeat(64)}`;
const tokenSubject = `temu:sha256:${"2".repeat(64)}`;
const requestFingerprint = "a".repeat(64);
const revisionFingerprint = "b".repeat(64);
const categoryPlan = "c".repeat(64);
const categoryRequest = "d".repeat(64);
const categoryResponse = "e".repeat(64);
const credentialFingerprint = "f".repeat(64);
const sourceEvidence = "7".repeat(64);

function evidence() {
  return {
    contract: "temu_create_authoritative_source_v1",
    requestFingerprint,
    product: { productId: product, revisionFingerprint },
    credential: { credentialId: credential, version: 3, active: true },
    account: { partnerAccountSubject: accountSubject, tokenIdentitySubject: tokenSubject, mallId: "11", regionId: "22" },
    app: { appId: "sellerpilot-app", state: "active", complianceState: "approved" },
    category: {
      categoryPlanSha256: categoryPlan,
      requestEvidenceSha256: categoryRequest,
      responseEvidenceSha256: categoryResponse,
      leafCategoryVerified: true,
      categoryRecommendationVerified: true,
      categoryAttributesVerified: true,
      categoryComplianceVerified: true,
      certificationDecisionVerified: true,
    },
    shipping: {
      defaultTemplateId: "template-1",
      storeDefaultShippingVerified: true,
      warehouseVerified: true,
      feeRuleVerified: true,
      returnPolicyVerified: true,
    },
    egress: { endpointHost: "openapi-b-global.temu.com", state: "static_ip_verified" },
    assets: {
      productId: product,
      productRevisionFingerprint: revisionFingerprint,
      representativeImages: ["https://asset.invalid/representative.png"],
      detailImages: Array.from({ length: 8 }, (_, index) => `https://asset.invalid/detail-${index + 1}.png`),
    },
    duplicateRead: {
      goodsReadComplete: true,
      skuReadComplete: true,
      goodsEmpty: true,
      skuEmpty: true,
      continuationPresent: false,
      existingGoodsRecoveryUsed: false,
    },
  };
}

async function fixture({ appState = "active", complianceState = "approved" } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid not null references auth.users(id),
      updated_at timestamptz not null, detail_page_version integer
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid not null references auth.users(id),
      channel text not null, environment text not null, version integer not null,
      fingerprint text not null, status text not null, expires_at timestamptz,
      seller_account_key text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid not null,
      channel text not null, operation text not null, environment text not null,
      request_payload jsonb not null, request_fingerprint text,
      status text not null, created_by uuid not null, claim_token uuid,
      lease_expires_at timestamptz, provider_mutation_started_at timestamptz
    );
    create table sellerpilot_private.synthetic_provider_boundary_calls(
      execution_mode text not null, job_id uuid not null
    );
    create function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
    returns boolean language plpgsql as $$begin
      update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
       where id=$2 and claim_token=$3 and provider_mutation_started_at is null;
      if found then insert into sellerpilot_private.synthetic_provider_boundary_calls values('local',$2); end if;
      return found;
    end$$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
    returns boolean language plpgsql as $$begin
      update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp()
       where id=$2 and claim_token=$3 and provider_mutation_started_at is null;
      if found then insert into sellerpilot_private.synthetic_provider_boundary_calls values('serverless',$2); end if;
      return found;
    end$$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.products values('${product}','${owner}',clock_timestamp());
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','temu','production',3,'${credentialFingerprint}',
      'active',clock_timestamp()+interval '1 day','${"9".repeat(64)}'
    );
  `);
  await db.exec(migration);
  await db.exec(producerMigration);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await db.query(`select public.sellerpilot_service_record_temu_create_app_gate_v1(
    $1,$2,$3,$4,'sellerpilot-app',$5,$6,null,clock_timestamp(),$7
  )`, [owner, product, credential, accountSubject, appState, complianceState, "6".repeat(64)]);
  return db;
}

test("producer context exposes exact current revisions but no credential secret", async () => {
  const db = await fixture();
  const result = (await db.query(`select public.sellerpilot_service_temu_create_source_context_v1(
    $1,$2,$3) result`, [owner, product, credential])).rows[0].result;
  assert.equal(result.contract, "temu_create_source_context_v1");
  assert.equal(result.status, "ready");
  assert.equal(result.productRevision, "1");
  assert.equal(result.credentialVersion, 3);
  assert.equal(result.credentialFingerprint, credentialFingerprint);
  assert.equal(JSON.stringify(result).includes("access_token"), false);
  const gate = (await db.query(`select public.sellerpilot_service_read_temu_create_app_gate_v1(
    $1,$2,$3) result`, [owner, product, credential])).rows[0].result;
  assert.equal(gate.partnerAccountSubject, accountSubject);
  assert.equal(gate.appId, "sellerpilot-app");
  await db.close();
});

async function appendSource(db, expectedCurrent = null) {
  const updatedAt = (await db.query(
    "select updated_at from sellerpilot_private.products where id=$1", [product],
  )).rows[0].updated_at;
  const result = await db.query(`select public.sellerpilot_service_record_temu_create_authoritative_source_v1(
    $1,$2,$3,1,'1',$4,$5,3,$6,$7,$8,'11','22',$9,$10,$11,$12,
    clock_timestamp(),clock_timestamp()+interval '4 minutes',$13,$14,$15
  ) result`, [owner, product, credential, revisionFingerprint, updatedAt,
    credentialFingerprint, accountSubject, tokenSubject, requestFingerprint,
    categoryPlan, categoryRequest, categoryResponse, sourceEvidence, evidence(), expectedCurrent]);
  return result.rows[0].result;
}

async function enqueue(db, binding) {
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,request_fingerprint,
    status,created_by,claim_token,lease_expires_at
  ) values($1,$2,'temu','listing.create','production',$3,$4,'running',$5,$6,
    clock_timestamp()+interval '1 hour')`, [job, credential, {
      arguments: { sellerpilotTemuAuthoritativeSource: binding },
    }, requestFingerprint, owner, claim]);
}

test("actual migration applies and Inactive/Reviewing app rows stop before source read", async () => {
  for (const state of [
    { appState: "inactive", complianceState: "approved" },
    { appState: "active", complianceState: "reviewing" },
  ]) {
    const db = await fixture(state);
    const gate = (await db.query(`select public.sellerpilot_service_read_temu_create_app_gate_v1(
      $1,$2,$3) result`, [owner, product, credential])).rows[0].result;
    assert.equal(gate.status, "blocked");
    const rows = (await db.query("select count(*)::integer count from sellerpilot_private.temu_create_authoritative_sources")).rows[0].count;
    assert.equal(rows, 0);
    await db.close();
  }
});

test("append replay is idempotent and one current row is exact request-bound", async () => {
  const db = await fixture();
  const first = await appendSource(db);
  const replay = await appendSource(db);
  assert.equal(first.sourceId, replay.sourceId);
  assert.equal(first.evidenceSha256, sourceEvidence);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const immutableSnapshot = (await db.query(`select evidence from sellerpilot_private.temu_create_authoritative_sources
    where id=$1`, [first.sourceId])).rows[0].evidence;
  assert.deepEqual(immutableSnapshot, evidence());
  const current = (await db.query(`select public.sellerpilot_service_read_temu_create_authoritative_source_v1(
    $1,$2,$3,$4) result`, [owner, product, credential, requestFingerprint])).rows[0].result;
  assert.equal(current.status, "ready");
  assert.equal(current.sourceId, first.sourceId);
  const mismatch = (await db.query(`select public.sellerpilot_service_read_temu_create_authoritative_source_v1(
    $1,$2,$3,$4) result`, [owner, product, credential, "0".repeat(64)])).rows[0].result;
  assert.equal(mismatch.status, "missing");
  await db.close();
});

test("local final boundary consumes once and response-loss retry cannot start twice", async () => {
  const db = await fixture();
  const source = await appendSource(db);
  const binding = {
    contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId,
    sourceRevision: 1,
    evidenceSha256: sourceEvidence,
    requestFingerprint,
  };
  await enqueue(db, binding);
  const first = (await db.query(`select public.sellerpilot_service_begin_gateway_provider_mutation(
    'worker',$1,$2) result`, [job, claim])).rows[0].result;
  const retry = (await db.query(`select public.sellerpilot_service_begin_gateway_provider_mutation(
    'worker',$1,$2) result`, [job, claim])).rows[0].result;
  assert.equal(first, true);
  assert.equal(retry, false);
  const consumed = (await db.query(`select consumed_job_id,consumed_claim_token,consumed_at
    from sellerpilot_private.temu_create_authoritative_current`)).rows[0];
  assert.equal(consumed.consumed_job_id, job);
  assert.equal(consumed.consumed_claim_token, claim);
  assert.ok(consumed.consumed_at);
  const providerCalls = (await db.query(`select count(*)::integer count
    from sellerpilot_private.synthetic_provider_boundary_calls where job_id=$1`, [job])).rows[0].count;
  assert.equal(providerCalls, 1);
  await db.close();
});

test("serverless final boundary uses the same row lock and one-shot consumption", async () => {
  const db = await fixture();
  const source = await appendSource(db);
  const binding = {
    contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId,
    sourceRevision: 1,
    evidenceSha256: sourceEvidence,
    requestFingerprint,
  };
  await enqueue(db, binding);
  const first = (await db.query(`select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    'worker',$1,$2) result`, [job, claim])).rows[0].result;
  const retry = (await db.query(`select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
    'worker',$1,$2) result`, [job, claim])).rows[0].result;
  assert.equal(first, true);
  assert.equal(retry, false);
  const consumed = (await db.query(`select consumed_job_id from sellerpilot_private.temu_create_authoritative_current`)).rows[0];
  assert.equal(consumed.consumed_job_id, job);
  const providerCalls = (await db.query(`select count(*)::integer count
    from sellerpilot_private.synthetic_provider_boundary_calls where job_id=$1`, [job])).rows[0].count;
  assert.equal(providerCalls, 1);
  await db.close();
});

test("malformed nested evidence is rejected by the actual SQL producer", async () => {
  const db = await fixture();
  const malformed = evidence();
  malformed.assets.detailImages.pop();
  const updatedAt = (await db.query(
    "select updated_at from sellerpilot_private.products where id=$1", [product],
  )).rows[0].updated_at;
  await assert.rejects(db.query(`select public.sellerpilot_service_record_temu_create_authoritative_source_v1(
    $1,$2,$3,1,'1',$4,$5,3,$6,$7,$8,'11','22',$9,$10,$11,$12,
    clock_timestamp(),clock_timestamp()+interval '4 minutes',$13,$14,null
  )`, [owner, product, credential, revisionFingerprint, updatedAt, credentialFingerprint,
    accountSubject, tokenSubject, requestFingerprint, categoryPlan, categoryRequest,
    categoryResponse, sourceEvidence, malformed]), /TEMU_CREATE_SOURCE_INVALID/u);
  const rows = (await db.query(`select count(*)::integer count
    from sellerpilot_private.temu_create_authoritative_sources`)).rows[0].count;
  assert.equal(rows, 0);
  await db.close();
});

test("credential drift and retire both fail closed at the final boundary", async () => {
  for (const mutation of [
    "update sellerpilot_private.channel_credentials set version=4",
    "update sellerpilot_private.products set updated_at=updated_at+interval '1 second'",
    null,
  ]) {
    const db = await fixture();
    const source = await appendSource(db);
    const binding = { contract: "temu_create_authoritative_source_binding_v1", sourceId: source.sourceId,
      sourceRevision: 1, evidenceSha256: sourceEvidence, requestFingerprint };
    await enqueue(db, binding);
    if (mutation) await db.exec(mutation);
    else {
      const retired = (await db.query(`select public.sellerpilot_service_retire_temu_create_authoritative_source_v1(
        $1,$2,$3,$4,$5,'test-drift') result`, [owner, product, credential, source.sourceId, sourceEvidence])).rows[0].result;
      assert.equal(retired, true);
    }
    const begun = (await db.query(`select public.sellerpilot_service_begin_gateway_provider_mutation(
      'worker',$1,$2) result`, [job, claim])).rows[0].result;
    assert.equal(begun, false);
    await db.close();
  }
});

test("a newer Inactive app observation revokes an unconsumed source at final boundary", async () => {
  const db = await fixture();
  const source = await appendSource(db);
  const binding = { contract: "temu_create_authoritative_source_binding_v1", sourceId: source.sourceId,
    sourceRevision: 1, evidenceSha256: sourceEvidence, requestFingerprint };
  await enqueue(db, binding);
  await db.query(`select public.sellerpilot_service_record_temu_create_app_gate_v1(
    $1,$2,$3,$4,'sellerpilot-app','inactive','approved',null,
    clock_timestamp(),$5
  )`, [owner, product, credential, accountSubject, "8".repeat(64)]);
  const begun = (await db.query(`select public.sellerpilot_service_begin_gateway_provider_mutation(
    'worker',$1,$2) result`, [job, claim])).rows[0].result;
  assert.equal(begun, false);
  const providerCalls = (await db.query(`select count(*)::integer count
    from sellerpilot_private.synthetic_provider_boundary_calls where job_id=$1`, [job])).rows[0].count;
  assert.equal(providerCalls, 0);
  await db.close();
});

test("the actual route binds the source after fingerprint and before claim", () => {
  const clientSourceRemoval = route.indexOf(
    "delete effectiveArguments.sellerpilotTemuAuthoritativeSource",
  );
  const binding = route.indexOf("produceTemuCreateAuthoritativeSourceBeforeClaim", clientSourceRemoval);
  const finalization = route.indexOf("bindTemuFinalCreatePayloadBeforeEnqueue", binding);
  assert.ok(clientSourceRemoval >= 0 && binding > clientSourceRemoval && finalization > binding);
});
