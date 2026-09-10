import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./inquiry-reply-migration-dynamic.test.mjs", import.meta.url);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const fixtureEnd = fixtureSource.indexOf('test("Smartstore product');
assert.ok(fixtureEnd > 0);
const fixtureModule = fixtureSource.slice(0, fixtureEnd)
  .replace(
    'from "@electric-sql/pglite"',
    `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`,
  )
  .replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const fixture = await import(`data:text/javascript;base64,${Buffer.from(
  `${fixtureModule}\nexport { createDatabase, seedAdminAndCredential, setClaims, scalar, ADMIN_ID };\n`,
).toString("base64")}`);

const migration = await readFile(new URL(
  "../supabase/migrations/20260910014500_elevenst_credential_version_cas.sql",
  import.meta.url,
), "utf8");
const TOKEN_HASH = "7".repeat(64);
const CLAIM = "00000000-0000-4000-8000-000000000051";

async function rotate(db, expectedId, expectedVersion, sellerId) {
  return fixture.scalar(db, `select public.sellerpilot_rotate_elevenst_credential_exact(
    $1,$2,'production',$3::jsonb,now()+interval '180 days',90,30,7
  )`, [expectedId, expectedVersion, JSON.stringify({
    api_key: sellerId.repeat(32).slice(0, 32),
    seller_id: sellerId,
  })]);
}

async function insertRunningJob(db, credentialId, channel, request, claimToken) {
  return fixture.scalar(db, `insert into sellerpilot_private.channel_gateway_jobs(
    credential_id,channel,operation,environment,request_payload,status,
    claim_token,created_by,started_at,lease_expires_at
  ) values($1,$2,'listing.create','production',$3::jsonb,'running',
    $4,$5,clock_timestamp(),clock_timestamp()+interval '5 minutes') returning id`, [
    credentialId,
    channel,
    JSON.stringify(request),
    claimToken,
    fixture.ADMIN_ID,
  ]);
}

test("11st exact credential rotation and worker execution use one current version", async () => {
  const db = await fixture.createDatabase();
  try {
    const qoo10Credential = await fixture.seedAdminAndCredential(db);
    const elevenstV1 = await fixture.scalar(db, `select public.sellerpilot_rotate_credential(
      'elevenst','production',$1::jsonb,now()+interval '180 days',90,30,7
    )`, [JSON.stringify({ api_key: "A".repeat(32), seller_id: "seller-v1" })]);
    const versionV1 = await fixture.scalar(db,
      "select version from sellerpilot_private.channel_credentials where id=$1",
      [elevenstV1]);
    assert.equal(versionV1, 1);

    await db.exec(migration);
    assert.equal(await fixture.scalar(db, `select to_regprocedure(
      'public.sellerpilot_rotate_credential(text,text,jsonb,timestamp with time zone,integer,integer,integer)'
    ) is not null`), true, "the shared rotation contract must remain installed");

    const rotations = await Promise.allSettled([
      rotate(db, elevenstV1, versionV1, "seller-v2a"),
      rotate(db, elevenstV1, versionV1, "seller-v2b"),
    ]);
    assert.equal(rotations.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(rotations.filter((entry) => entry.status === "rejected").length, 1);
    assert.match(String(rotations.find((entry) => entry.status === "rejected")?.reason),
      /ELEVENST_CREDENTIAL_SOURCE_STALE/u);
    const credentialsAfterRace = (await db.query(`select id,version,status
      from sellerpilot_private.channel_credentials
      where channel='elevenst' and environment='production' order by version`)).rows;
    assert.deepEqual(credentialsAfterRace.map(({ version, status }) => ({ version, status })), [
      { version: 1, status: "grace" },
      { version: 2, status: "active" },
    ]);
    const elevenstV2 = credentialsAfterRace[1].id;
    await assert.rejects(rotate(db, elevenstV1, 1, "seller-stale"),
      /ELEVENST_CREDENTIAL_SOURCE_STALE/u);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.channel_credentials where channel='elevenst'`), 2);

    await fixture.setClaims(db);
    await fixture.scalar(db, `select public.sellerpilot_issue_ai_worker_token(
      '11st CAS worker',$1,'777777777777',now()+interval '30 days','gateway'
    )`, [TOKEN_HASH]);
    const binding = {
      contract: "sellerpilot_elevenst_credential_binding_v1",
      credentialId: elevenstV2,
      credentialVersion: 2,
      environment: "production",
      sellerIdSha256: "8".repeat(64),
    };
    const elevenstJob = await insertRunningJob(db, elevenstV2, "elevenst", {
      arguments: { sellerpilotElevenstCredentialBinding: binding },
    }, CLAIM);
    await fixture.setClaims(db, "service_role");
    const verified = await fixture.scalar(db, `select public.sellerpilot_service_elevenst_gateway_credential_version(
      $1,$2,$3
    )`, [TOKEN_HASH, elevenstJob, CLAIM]);
    assert.deepEqual(verified, {
      contract: "sellerpilot-elevenst-gateway-credential-version/1",
      status: "verified",
      jobId: elevenstJob,
      credentialId: elevenstV2,
      credentialVersion: 2,
      environment: "production",
    });

    await fixture.setClaims(db);
    await rotate(db, elevenstV2, 2, "seller-v3");
    await fixture.setClaims(db, "service_role");
    await assert.rejects(fixture.scalar(db, `select public.sellerpilot_service_elevenst_gateway_credential_version(
      $1,$2,$3
    )`, [TOKEN_HASH, elevenstJob, CLAIM]), /ELEVENST_GATEWAY_CREDENTIAL_VERSION_MISMATCH/u);
    await assert.rejects(db.query(`update sellerpilot_private.channel_gateway_jobs
      set provider_mutation_started_at=clock_timestamp() where id=$1`, [elevenstJob]),
    /ELEVENST_GATEWAY_CREDENTIAL_VERSION_MISMATCH/u);
    assert.equal(await fixture.scalar(db, `select provider_mutation_started_at is null
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [elevenstJob]), true);

    const qoo10Job = await insertRunningJob(
      db,
      qoo10Credential,
      "qoo10",
      { arguments: {} },
      "00000000-0000-4000-8000-000000000052",
    );
    await db.query(`update sellerpilot_private.channel_gateway_jobs
      set provider_mutation_started_at=clock_timestamp() where id=$1`, [qoo10Job]);
    assert.equal(await fixture.scalar(db, `select provider_mutation_started_at is not null
      from sellerpilot_private.channel_gateway_jobs where id=$1`, [qoo10Job]), true,
    "the 11st trigger must not change another channel");

    assert.equal(await fixture.scalar(db, `select has_function_privilege(
      'service_role','public.sellerpilot_service_elevenst_gateway_credential_version(text,uuid,uuid)','EXECUTE'
    )`), true);
    assert.equal(await fixture.scalar(db, `select has_function_privilege(
      'authenticated','public.sellerpilot_service_elevenst_gateway_credential_version(text,uuid,uuid)','EXECUTE'
    )`), false);
    await assert.rejects(db.exec(migration), /ELEVENST_CREDENTIAL_VERSION_CAS_ALREADY_DEFINED/u);
  } finally {
    await db.close();
  }
});
