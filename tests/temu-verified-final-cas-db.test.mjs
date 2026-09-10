import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = await Promise.all([
  "20260910025000_temu_create_authoritative_sources.sql",
  "20260910033000_temu_create_producer_context.sql",
  "20260910040500_temu_operator_app_observation_source.sql",
  "20260910040600_temu_official_app_attestation_and_final_body_cas.sql",
  "20260910045500_temu_verified_receipt_and_null_safe_attestation_r24.sql",
].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")));
const owner = "10000000-0000-4000-8000-000000000001";
const product = "20000000-0000-4000-8000-000000000002";
const credential = "30000000-0000-4000-8000-000000000003";
const attempt = "40000000-0000-4000-8000-000000000004";
const job = "50000000-0000-4000-8000-000000000005";
const claim = "60000000-0000-4000-8000-000000000006";
const account = `temu-account:sha256:${"1".repeat(64)}`;
const token = `temu:sha256:${"2".repeat(64)}`;
const requestFingerprint = "a".repeat(64);
const revisionFingerprint = "b".repeat(64);
const credentialFingerprint = "f".repeat(64);
const credentialSecret = "70000000-0000-4000-8000-000000000007";
const receiptSecret = "q".repeat(32);
const receiptSecretBase64 = Buffer.from(receiptSecret).toString("base64");
const receiptKeyId = "receipt-key-1";
const { privateKey: collectorPrivateKey, publicKey: collectorPublicKey } =
  generateKeyPairSync("ed25519");
const uiContractSha256 = "8a9403966b16dd11744d181a8280dbc176b76b3a40aa77d4cd8d5ed54025eaca";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function routeReceipt(envelope, signature, attestationSha256) {
  const signatureSha256 = createHash("sha256").update(Buffer.from(signature, "base64")).digest("hex");
  const material = ["temu_collector_route_receipt_v1", attestationSha256,
    signatureSha256, envelope.challengeId, envelope.appId,
    envelope.receiptKeyId].join("\n");
  return createHmac("sha256", Buffer.from(receiptSecretBase64, "base64"))
    .update(material).digest("hex");
}

function sourceEvidence(overrides = {}) {
  return {
    contract: "temu_create_authoritative_source_v1", requestFingerprint,
    product: { productId: product, revisionFingerprint },
    credential: { credentialId: credential, version: overrides.credentialVersion ?? 3, active: true },
    account: { partnerAccountSubject: account, tokenIdentitySubject: token,
      mallId: "11", regionId: "22" },
    app: { appId: overrides.appId ?? "sellerpilot-app", state: "active", complianceState: "approved" },
    category: { categoryPlanSha256: "c".repeat(64),
      requestEvidenceSha256: "d".repeat(64), responseEvidenceSha256: "e".repeat(64),
      leafCategoryVerified: true, categoryRecommendationVerified: true,
      categoryAttributesVerified: true, categoryComplianceVerified: true,
      certificationDecisionVerified: true },
    shipping: { defaultTemplateId: "template-1", storeDefaultShippingVerified: true,
      warehouseVerified: true, feeRuleVerified: true, returnPolicyVerified: true },
    egress: { endpointHost: "openapi-b-global.temu.com", state: "static_ip_verified" },
    assets: { productId: product, productRevisionFingerprint: revisionFingerprint,
      representativeImages: ["https://asset.invalid/main.jpg"],
      detailImages: Array.from({ length: 8 }, (_, i) => `https://asset.invalid/${i}.jpg`) },
    duplicateRead: { goodsReadComplete: true, skuReadComplete: true, goodsEmpty: true,
      skuEmpty: true, continuationPresent: false, existingGoodsRecoveryUsed: false },
  };
}

function finalArguments(source) {
  const images = Array.from({ length: 8 }, (_, index) => {
    const digest = String(index + 1).repeat(64);
    return { role: `detail-${index + 1}`, objectPath: `normalized/${digest.slice(0, 2)}/${digest}.jpg`,
      contentSha256: digest };
  });
  return {
    body: { goodsBasic: { goodsName: "exact final body" } },
    sellerpilotTemuAuthoritativeSource: source,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailImages: images,
      providerTransportImages: images,
    },
  };
}

async function fixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions; create schema vault;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.products(id uuid primary key,owner_id uuid not null references auth.users(id),updated_at timestamptz not null,detail_page_version integer);
    create table vault.decrypted_secrets(id uuid primary key,name text,decrypted_secret text,created_at timestamptz not null default clock_timestamp());
    create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid not null references auth.users(id),channel text not null,environment text not null,version integer not null,fingerprint text not null,status text not null,expires_at timestamptz,seller_account_key text,vault_secret_id uuid references vault.decrypted_secrets(id));
    create table sellerpilot_private.channel_operation_attempts(id uuid primary key,owner_id uuid not null,credential_id uuid not null,channel text not null,operation text not null,request_fingerprint text not null,status text not null);
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,credential_id uuid not null,attempt_id uuid,channel text not null,operation text not null,environment text not null,request_payload jsonb not null,request_fingerprint text,status text not null,created_by uuid not null,claim_token uuid,lease_expires_at timestamptz,provider_mutation_started_at timestamptz);
    create table sellerpilot_private.synthetic_provider_boundary_calls(mode text,job_id uuid);
    create function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid) returns boolean language plpgsql as $$begin update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$2 and claim_token=$3 and provider_mutation_started_at is null; if found then insert into sellerpilot_private.synthetic_provider_boundary_calls values('local',$2); end if; return found; end$$;
    create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid) returns boolean language plpgsql as $$begin update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$2 and claim_token=$3 and provider_mutation_started_at is null; if found then insert into sellerpilot_private.synthetic_provider_boundary_calls values('serverless',$2); end if; return found; end$$;
    insert into auth.users values('${owner}');
    insert into sellerpilot_private.products values('${product}','${owner}',clock_timestamp(),1);
    insert into vault.decrypted_secrets(id,name,decrypted_secret) values
      ('${credentialSecret}','credential-temu','{"app_key":"sellerpilot-app","app_secret":"test","access_token":"test"}'),
      ('80000000-0000-4000-8000-000000000008','sellerpilot_temu_collector_db_receipt_v1.${receiptKeyId}','${receiptSecretBase64}'),
      ('81000000-0000-4000-8000-000000000008','sellerpilot_temu_collector_db_receipt_policy_v1.${receiptKeyId}','{"status":"current"}'),
      ('82000000-0000-4000-8000-000000000008','sellerpilot_temu_collector_signing_policy_v1.collector-key-1','{"status":"current"}');
    insert into sellerpilot_private.channel_credentials values('${credential}','${owner}','temu','production',3,'${credentialFingerprint}','active',clock_timestamp()+interval '1 day','key','${credentialSecret}');
  `);
  for (const migration of migrations) await db.exec(migration);
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  return db;
}

async function attest(db, overrides = {}) {
  const nonceCharacter = overrides.nonceCharacter ?? "A";
  const nonce = nonceCharacter.repeat(43);
  const nonceSha = createHash("sha256").update(nonce).digest("hex");
  const challenge = (await db.query(`select public.sellerpilot_service_issue_temu_collector_challenge_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, revisionFingerprint, nonceSha, "collector-key-1", receiptKeyId])).rows[0].result;
  const envelope = { contract: "temu_operator_collector_attestation_v1", uiContractSha256,
    keyId: "collector-key-1",
    receiptKeyId,
    challengeId: challenge.challengeId, nonce, ownerId: owner, productId: product,
    credentialId: credential, credentialVersion: 3, credentialFingerprint,
    credentialVaultSecretId: credentialSecret, productRevisionFingerprint: revisionFingerprint,
    partnerAccountSubject: account, appId: overrides.appId ?? "sellerpilot-app",
    appState: overrides.appState ?? "active",
    complianceState: overrides.complianceState ?? "approved", rejectionReason: null,
    observedAt: overrides.observedAt ?? new Date().toISOString(),
    mallId: "11", regionId: "22",
    shipping: { defaultTemplateId: "template-1",
      warehouseVerified: overrides.shippingVerified ?? true,
      feeRuleVerified: overrides.shippingVerified ?? true,
      returnPolicyVerified: overrides.shippingVerified ?? true,
      ...(overrides.shippingExtra ?? {}) },
    egress: { state: overrides.egressState ?? "static_ip_verified",
      verificationMethod: overrides.egressMethod ?? "temu_allowlist_readback" } };
  if (overrides.omitCredentialVersion) delete envelope.credentialVersion;
  if (overrides.omitCredentialVaultSecretId) delete envelope.credentialVaultSecretId;
  if (overrides.omitShippingLeaf) delete envelope.shipping[overrides.omitShippingLeaf];
  if (overrides.omitEgressLeaf) delete envelope.egress[overrides.omitEgressLeaf];
  const signature = sign(null, Buffer.from(canonical(envelope), "utf8"),
    collectorPrivateKey).toString("base64");
  assert.equal(verify(null, Buffer.from(canonical(envelope), "utf8"),
    collectorPublicKey, Buffer.from(signature, "base64")), true);
  const attestationSha256 = createHash("sha256")
    .update(canonical(envelope)).digest("hex");
  if (overrides.beforeConsume) await overrides.beforeConsume(db);
  await db.exec("select set_config('request.jwt.claim.role','sellerpilot_temu_collector_verifier',false)");
  const receipt = (await db.query(`select public.sellerpilot_verifier_record_temu_collector_receipt_v1($1,$2,$3,$4) result`,
    [envelope, signature, attestationSha256,
      routeReceipt(envelope, signature, attestationSha256)])).rows[0].result;
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const result = (await db.query(`select public.sellerpilot_service_consume_temu_collector_attestation_v2($1,$2,$3,$4) result`,
    [envelope, signature, attestationSha256, receipt.receiptId])).rows[0].result;
  return { envelope, signature, attestationSha256, receiptId: receipt.receiptId, result };
}

async function appendSource(db, overrides = {}) {
  const updatedAt = (await db.query("select updated_at from sellerpilot_private.products where id=$1", [product])).rows[0].updated_at;
  try { return (await db.query(`select public.sellerpilot_service_record_temu_create_authoritative_source_v1(
    $1,$2,$3,1,'1',$4,$5,$6,$7,$8,$9,'11','22',$10,$11,$12,$13,clock_timestamp(),
    clock_timestamp()+interval '4 minutes',$14,$15,null) result`, [owner, product, credential,
    revisionFingerprint, updatedAt, overrides.credentialVersion ?? 3,
    overrides.credentialFingerprint ?? credentialFingerprint, account, token, requestFingerprint,
    "c".repeat(64), "d".repeat(64), "e".repeat(64), "7".repeat(64),
    sourceEvidence(overrides)])).rows[0].result; }
  catch (error) { error.message = `appendSource: ${error.message}`; throw error; }
}

test("unsigned legacy app rows cannot unlock the verified CREATE gate", async () => {
  const db = await fixture();
  await db.query(`select public.sellerpilot_service_record_temu_create_app_gate_v1($1,$2,$3,$4,'sellerpilot-app','active','approved',null,clock_timestamp(),$5)`,
    [owner, product, credential, account, "6".repeat(64)]);
  const gate = (await db.query(`select public.sellerpilot_service_read_temu_verified_create_app_gate_v1($1,$2,$3) result`, [owner, product, credential])).rows[0].result;
  assert.equal(gate.status, "missing");
  await db.close();
});

test("one signed-collector transaction records all sources and consumes nonce once", async () => {
  const db = await fixture();
  const { envelope, result } = await attest(db);
  assert.equal(result.contract, "temu_verified_collector_record_v1");
  const validity = await db.query(`select sellerpilot_private.temu_current_attestation_valid($1,$2,$3,$4) result`,
    [result.attestationId, owner, product, credential]);
  assert.equal(validity.rows[0].result, true);
  const bundle = (await db.query(`select public.sellerpilot_service_read_temu_verified_authoritative_sources_v1($1,$2,$3,'11','22',$4) result`,
    [owner, product, account, revisionFingerprint])).rows[0].result;
  assert.equal(bundle.collectorAttestationId, result.attestationId);
  assert.ok(bundle.appSnapshot && bundle.shippingSnapshot && bundle.egressAttestation);
  const signature = sign(null, Buffer.from(canonical(envelope), "utf8"),
    collectorPrivateKey).toString("base64");
  const attestationSha256 = createHash("sha256").update(canonical(envelope)).digest("hex");
  await db.exec("select set_config('request.jwt.claim.role','sellerpilot_temu_collector_verifier',false)");
  const duplicateReceipt = (await db.query(`select public.sellerpilot_verifier_record_temu_collector_receipt_v1($1,$2,$3,$4) result`,
    [envelope, signature, attestationSha256, routeReceipt(envelope, signature, attestationSha256)])).rows[0].result;
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const replay = (await db.query(`select public.sellerpilot_service_consume_temu_collector_attestation_v2($1,$2,$3,$4) result`,
    [envelope, signature, attestationSha256, duplicateReceipt.receiptId])).rows[0].result;
  assert.deepEqual(replay, result);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.temu_authoritative_source_observations")).rows[0].count, 3);
  await db.close();
});

test("credential app_key pins challenge and rejects a different signed app identity", async () => {
  const db = await fixture();
  await assert.rejects(attest(db, { appId: "another-approved-app" }),
    /VERIFIED_RECEIPT_SCOPE_CHANGED/u);
  await db.close();
});

test("service-role cannot mint a verified receipt or persist an arbitrary signature", async () => {
  const db = await fixture();
  const nonce = "Z".repeat(43);
  const nonceSha = createHash("sha256").update(nonce).digest("hex");
  const challenge = (await db.query(`select public.sellerpilot_service_issue_temu_collector_challenge_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, revisionFingerprint, nonceSha, "collector-key-1", receiptKeyId])).rows[0].result;
  assert.equal(challenge.expectedAppId, "sellerpilot-app");
  const envelope = { contract: "temu_operator_collector_attestation_v1", uiContractSha256,
    keyId: "collector-key-1", receiptKeyId,
    challengeId: challenge.challengeId, nonce, ownerId: owner, productId: product,
    credentialId: credential, credentialVersion: 3, credentialFingerprint,
    credentialVaultSecretId: credentialSecret, productRevisionFingerprint: revisionFingerprint,
    partnerAccountSubject: account, appId: challenge.expectedAppId, appState: "active",
    complianceState: "approved", rejectionReason: null, observedAt: new Date().toISOString(),
    mallId: "11", regionId: "22", shipping: { defaultTemplateId: "template-1",
      warehouseVerified: true, feeRuleVerified: true, returnPolicyVerified: true },
    egress: { state: "static_ip_verified", verificationMethod: "temu_allowlist_readback" } };
  const attestationSha256 = createHash("sha256").update(canonical(envelope)).digest("hex");
  const arbitrarySignature = Buffer.alloc(64, 8).toString("base64");
  await assert.rejects(db.query(`select public.sellerpilot_verifier_record_temu_collector_receipt_v1($1,$2,$3,$4)`,
    [envelope, arbitrarySignature, attestationSha256,
      routeReceipt(envelope, arbitrarySignature, attestationSha256)]),
  /VERIFIER_ROLE_REQUIRED/u);
  await assert.rejects(db.query(`select public.sellerpilot_service_consume_temu_collector_attestation_v2($1,$2,$3,$4)`,
    [envelope, arbitrarySignature, attestationSha256,
      "88000000-0000-4000-8000-000000000008"]), /VERIFIED_RECEIPT_REQUIRED/u);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.temu_verified_collector_attestations")).rows[0].count, 0);
  await db.close();
});

test("DB rejects noncanonical hashes, unknown nested leaves, and post-challenge credential revoke", async () => {
  const noncanonicalDb = await fixture();
  const nonce = "Y".repeat(43);
  const challenge = (await noncanonicalDb.query(`select public.sellerpilot_service_issue_temu_collector_challenge_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, revisionFingerprint,
      createHash("sha256").update(nonce).digest("hex"), "collector-key-1", receiptKeyId])).rows[0].result;
  const envelope = { contract: "temu_operator_collector_attestation_v1", uiContractSha256,
    keyId: "collector-key-1", receiptKeyId,
    challengeId: challenge.challengeId, nonce, ownerId: owner, productId: product,
    credentialId: credential, credentialVersion: 3, credentialFingerprint,
    credentialVaultSecretId: credentialSecret, productRevisionFingerprint: revisionFingerprint,
    partnerAccountSubject: account, appId: "sellerpilot-app", appState: "active",
    complianceState: "approved", rejectionReason: null, observedAt: new Date().toISOString(),
    mallId: "11", regionId: "22", shipping: { defaultTemplateId: "template-1",
      warehouseVerified: true, feeRuleVerified: true, returnPolicyVerified: true },
    egress: { state: "static_ip_verified", verificationMethod: "temu_allowlist_readback" } };
  const signature = sign(null, Buffer.from(canonical(envelope), "utf8"),
    collectorPrivateKey).toString("base64");
  const noncanonicalHash = createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
  await noncanonicalDb.exec("select set_config('request.jwt.claim.role','sellerpilot_temu_collector_verifier',false)");
  await assert.rejects(noncanonicalDb.query(`select public.sellerpilot_verifier_record_temu_collector_receipt_v1($1,$2,$3,$4)`,
    [envelope, signature, noncanonicalHash,
      routeReceipt(envelope, signature, noncanonicalHash)]), /VERIFIED_RECEIPT_INVALID/u);
  await noncanonicalDb.close();

  const leafDb = await fixture();
  await assert.rejects(attest(leafDb, { nonceCharacter: "X",
    shippingExtra: { attackerControlled: true } }), /VERIFIED_RECEIPT_INVALID/u);
  await leafDb.close();

  const revokedDb = await fixture();
  await assert.rejects(attest(revokedDb, { nonceCharacter: "W",
    beforeConsume: (db) => db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1", [credential]) }),
  /CREDENTIAL_CHANGED/u);
  assert.equal((await revokedDb.query("select count(*)::integer count from sellerpilot_private.temu_verified_collector_attestations")).rows[0].count, 0);
  await revokedDb.close();

  const rotatedDb = await fixture();
  await assert.rejects(attest(rotatedDb, { nonceCharacter: "V",
    beforeConsume: async (db) => {
      await db.query("insert into vault.decrypted_secrets(id,name,decrypted_secret) values($1,'rotated-temu',$2)",
        ["90000000-0000-4000-8000-000000000009",
          JSON.stringify({ app_key: "other-app", app_secret: "new", access_token: "new" })]);
      await db.query("update sellerpilot_private.channel_credentials set version=4,fingerprint=$2,vault_secret_id=$3 where id=$1",
        [credential, "e".repeat(64), "90000000-0000-4000-8000-000000000009"]);
    } }), /CREDENTIAL_CHANGED/u);
  assert.equal((await rotatedDb.query("select count(*)::integer count from sellerpilot_private.temu_verified_collector_attestations")).rows[0].count, 0);
  await rotatedDb.close();
});

for (const missing of [
  { omitCredentialVersion: true },
  { omitCredentialVaultSecretId: true },
  { omitShippingLeaf: "warehouseVerified" },
  { omitShippingLeaf: "feeRuleVerified" },
  { omitShippingLeaf: "returnPolicyVerified" },
  { omitEgressLeaf: "state" },
  { omitEgressLeaf: "verificationMethod" },
]) test(`NULL-safe receipt rejects missing required leaf ${JSON.stringify(missing)}`, async () => {
  const db = await fixture();
  await assert.rejects(attest(db, missing), /VERIFIED_RECEIPT_INVALID/u);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.temu_verified_collector_attestations")).rows[0].count, 0);
  await db.close();
});

test("blocked attestation records a deterministic denial and exact replay result", async () => {
  const db = await fixture();
  const blocked = await attest(db, { nonceCharacter: "Q", appState: "inactive" });
  assert.equal(blocked.result.status, "blocked");
  assert.equal(blocked.result.denialCode, "TEMU_APP_INACTIVE");
  await db.exec("select set_config('request.jwt.claim.role','sellerpilot_temu_collector_verifier',false)");
  const receipt = (await db.query(`select public.sellerpilot_verifier_record_temu_collector_receipt_v1($1,$2,$3,$4) result`,
    [blocked.envelope, blocked.signature, blocked.attestationSha256,
      routeReceipt(blocked.envelope, blocked.signature, blocked.attestationSha256)])).rows[0].result;
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  const replay = (await db.query(`select public.sellerpilot_service_consume_temu_collector_attestation_v2($1,$2,$3,$4) result`,
    [blocked.envelope, blocked.signature, blocked.attestationSha256, receipt.receiptId])).rows[0].result;
  assert.deepEqual(replay, blocked.result);
  const gate = (await db.query(`select public.sellerpilot_service_read_temu_verified_create_app_gate_v1($1,$2,$3) result`,
    [owner, product, credential])).rows[0].result;
  assert.equal(gate.status, "blocked");
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.temu_collector_attestation_outcomes")).rows[0].count, 1);
  await db.close();
});

test("new shipping or egress revoke retires the bound source before provider mutation", async () => {
  const db = await fixture();
  const firstAttestation = await attest(db, { nonceCharacter: "A" });
  const source = await appendSource(db);
  const sourceBinding = { contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId, sourceRevision: 1, evidenceSha256: "7".repeat(64), requestFingerprint,
    productRevisionFingerprint: revisionFingerprint };
  const args = finalArguments(sourceBinding);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1,$2,$3,'temu','listing.create',$4,'running')",
    [attempt, owner, credential, requestFingerprint]);
  const final = (await db.query(`select public.sellerpilot_service_record_temu_final_create_payload_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, attempt, source.sourceId, requestFingerprint, args])).rows[0].result;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,$3,'temu','listing.create','production',$4,$5,'running',$6,$7,clock_timestamp()+interval '1 hour',null)`,
    [job, credential, attempt, { arguments: { ...args, sellerpilotTemuFinalPayload: final } }, requestFingerprint, owner, claim]);
  const bound = (await db.query("select collector_attestation_id from sellerpilot_private.temu_create_authoritative_sources where id=$1",
    [source.sourceId])).rows[0];
  assert.equal(bound.collector_attestation_id, firstAttestation.result.attestationId);

  await attest(db, { nonceCharacter: "B", shippingVerified: false,
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    egressState: "blocked_until_stable_ip", egressMethod: "temu_global_endpoint_probe" });
  const current = (await db.query("select retired_at,retire_reason from sellerpilot_private.temu_create_authoritative_current where source_id=$1",
    [source.sourceId])).rows[0];
  assert.ok(current.retired_at);
  assert.equal(current.retire_reason, "collector_attestation_superseded");
  const gate = (await db.query("select public.sellerpilot_service_read_temu_verified_create_app_gate_v1($1,$2,$3) result",
    [owner, product, credential])).rows[0].result;
  assert.equal(gate.status, "blocked");
  await assert.rejects(appendSource(db),
    /COLLECTOR_ATTESTATION_MISMATCH|CAS_MISMATCH|REPLAY_NOT_CURRENT/u);
  const allowed = (await db.query("select public.sellerpilot_service_begin_gateway_provider_mutation('worker',$1,$2) result",
    [job, claim])).rows[0].result;
  assert.equal(allowed, false);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.synthetic_provider_boundary_calls")).rows[0].count, 0);
  await db.close();
});

test("credential Vault rotation cannot reuse an old attestation for a new source incarnation", async () => {
  const db = await fixture();
  await attest(db, { nonceCharacter: "R" });
  const rotatedSecret = "91000000-0000-4000-8000-000000000009";
  await db.query("insert into vault.decrypted_secrets(id,name,decrypted_secret) values($1,'rotated-live',$2)",
    [rotatedSecret, JSON.stringify({ app_key: "other-app", app_secret: "new", access_token: "new" })]);
  await db.query("update sellerpilot_private.channel_credentials set version=4,fingerprint=$2,vault_secret_id=$3 where id=$1",
    [credential, "e".repeat(64), rotatedSecret]);
  await assert.rejects(appendSource(db, { credentialVersion: 4,
    credentialFingerprint: "e".repeat(64), appId: "sellerpilot-app" }),
  /COLLECTOR_ATTESTATION_MISMATCH|CURRENT_SCOPE_MISMATCH/u);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.temu_create_authoritative_sources")).rows[0].count, 0);
  await db.close();
});

test("gate, source, final and provider all recheck current credential and key policy", async () => {
  const db = await fixture();
  await attest(db, { nonceCharacter: "S" });
  const source = await appendSource(db);
  const sourceBinding = { contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId, sourceRevision: 1, evidenceSha256: "7".repeat(64),
    requestFingerprint, productRevisionFingerprint: revisionFingerprint };
  const args = finalArguments(sourceBinding);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1,$2,$3,'temu','listing.create',$4,'running')",
    [attempt, owner, credential, requestFingerprint]);
  const final = (await db.query(`select public.sellerpilot_service_record_temu_final_create_payload_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, attempt, source.sourceId, requestFingerprint, args])).rows[0].result;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,$3,'temu','listing.create','production',$4,$5,'running',$6,$7,clock_timestamp()+interval '1 hour',null)`,
    [job, credential, attempt, { arguments: { ...args, sellerpilotTemuFinalPayload: final } },
      requestFingerprint, owner, claim]);
  await db.query("update sellerpilot_private.channel_credentials set status='revoked' where id=$1", [credential]);
  const gate = (await db.query(`select public.sellerpilot_service_read_temu_verified_create_app_gate_v1($1,$2,$3) result`,
    [owner, product, credential])).rows[0].result;
  assert.equal(gate.status, "missing");
  const sourceRead = (await db.query(`select public.sellerpilot_service_read_temu_create_authoritative_source_v1($1,$2,$3,$4) result`,
    [owner, product, credential, requestFingerprint])).rows[0].result;
  assert.equal(sourceRead.status, "missing");
  await assert.rejects(db.query(`select public.sellerpilot_service_record_temu_final_create_payload_v1($1,$2,$3,$4,$5,$6,$7)`,
    [owner, product, credential, attempt, source.sourceId, requestFingerprint, args]),
  /R24_SCOPE_CHANGED/u);
  const allowed = (await db.query("select public.sellerpilot_service_begin_gateway_provider_mutation('worker',$1,$2) result",
    [job, claim])).rows[0].result;
  assert.equal(allowed, false);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.synthetic_provider_boundary_calls")).rows[0].count, 0);
  await db.close();
});

test("legacy public HMAC consume RPC is removed and verifier mint is role-bound", async () => {
  const db = await fixture();
  const rows = (await db.query(`select
    to_regprocedure('public.sellerpilot_service_consume_temu_collector_attestation_v1(jsonb,text,text,text)') legacy,
    has_function_privilege('service_role','public.sellerpilot_verifier_record_temu_collector_receipt_v1(jsonb,text,text,text)','EXECUTE') service_can_mint,
    has_function_privilege('sellerpilot_temu_collector_verifier','public.sellerpilot_verifier_record_temu_collector_receipt_v1(jsonb,text,text,text)','EXECUTE') verifier_can_mint`)).rows[0];
  assert.equal(rows.legacy, null);
  assert.equal(rows.service_can_mint, false);
  assert.equal(rows.verifier_can_mint, true);
  await db.close();
});

for (const mode of ["gateway", "serverless_gateway"]) test(`${mode} final CAS consumes once; body drift starts zero provider calls`, async () => {
  const db = await fixture();
  await attest(db);
  const source = await appendSource(db);
  const sourceBinding = { contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId, sourceRevision: 1, evidenceSha256: "7".repeat(64), requestFingerprint,
    productRevisionFingerprint: revisionFingerprint };
  const args = finalArguments(sourceBinding);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1,$2,$3,'temu','listing.create',$4,'running')",
    [attempt, owner, credential, requestFingerprint]);
  let final;
  try { final = (await db.query(`select public.sellerpilot_service_record_temu_final_create_payload_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, attempt, source.sourceId, requestFingerprint, args])).rows[0].result; }
  catch (error) { error.message = `finalize: ${error.message}`; throw error; }
  const bound = { ...args, sellerpilotTemuFinalPayload: final };
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,$3,'temu','listing.create','production',$4,$5,'running',$6,$7,clock_timestamp()+interval '1 hour',null)`,
    [job, credential, attempt, { arguments: bound }, requestFingerprint, owner, claim]);
  await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,body,goodsBasic,goodsName}',to_jsonb('drifted'::text)) where id=$1", [job]);
  const beginName = `sellerpilot_service_begin_${mode}_provider_mutation`;
  const blocked = (await db.query(`select public.${beginName}('worker',$1,$2) result`, [job, claim])).rows[0].result;
  assert.equal(blocked, false);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.synthetic_provider_boundary_calls")).rows[0].count, 0);
  await db.close();
});

for (const mode of ["gateway", "serverless_gateway"]) test(`${mode} exact final CAS crosses the provider boundary once after response loss`, async () => {
  const db = await fixture();
  await attest(db);
  const source = await appendSource(db);
  const sourceBinding = { contract: "temu_create_authoritative_source_binding_v1",
    sourceId: source.sourceId, sourceRevision: 1, evidenceSha256: "7".repeat(64), requestFingerprint,
    productRevisionFingerprint: revisionFingerprint };
  const args = finalArguments(sourceBinding);
  await db.query("insert into sellerpilot_private.channel_operation_attempts values($1,$2,$3,'temu','listing.create',$4,'running')",
    [attempt, owner, credential, requestFingerprint]);
  const final = (await db.query(`select public.sellerpilot_service_record_temu_final_create_payload_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [owner, product, credential, attempt, source.sourceId, requestFingerprint, args])).rows[0].result;
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs values($1,$2,$3,'temu','listing.create','production',$4,$5,'running',$6,$7,clock_timestamp()+interval '1 hour',null)`,
    [job, credential, attempt, { arguments: { ...args, sellerpilotTemuFinalPayload: final } }, requestFingerprint, owner, claim]);
  const beginName = `sellerpilot_service_begin_${mode}_provider_mutation`;
  const first = (await db.query(`select public.${beginName}('worker',$1,$2) result`, [job, claim])).rows[0].result;
  const retry = (await db.query(`select public.${beginName}('worker',$1,$2) result`, [job, claim])).rows[0].result;
  assert.equal(first, true);
  assert.equal(retry, false);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.synthetic_provider_boundary_calls")).rows[0].count, 1);
  await db.close();
});
