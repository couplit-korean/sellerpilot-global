import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";
import { executeCsProviderJob } from "../lib/cs/operations/provider";

const migration = await readFile(new URL(
  "../supabase/migrations/20260909134538_temu_cs_verified_account_binding_context.sql",
  import.meta.url,
), "utf8");
const jobId = "00000000-0000-4000-8000-00000000c201";
const secondJobId = "00000000-0000-4000-8000-00000000c202";
const credentialId = "00000000-0000-4000-8000-00000000c211";
const secondCredentialId = "00000000-0000-4000-8000-00000000c212";
const claimToken = "00000000-0000-4000-8000-00000000c221";
const secondClaimToken = "00000000-0000-4000-8000-00000000c222";
const sellerOwner = "00000000-0000-4000-8000-00000000c231";
const secondSellerOwner = "00000000-0000-4000-8000-00000000c232";
const sharedAdministrator = "00000000-0000-4000-8000-00000000c299";
const credential = {
  app_key: "fixture-app",
  app_secret: "fixture-secret",
  access_token: "fixture-token",
};
const sellerAccountKey = createHash("sha256")
  .update("temu\u001fproduction\u001ftemu:mall:1024", "utf8")
  .digest("hex");

function bindingContext(overrides: Record<string, unknown> = {}) {
  return {
    contract: "sellerpilot-cs-credential-context/1" as const,
    status: "verified" as const,
    credentialId,
    sellerAccountKey,
    sellerAccountKeySource: "provider_certified_v1" as const,
    sellerAccountVerifiedAt: "2026-09-09T10:45:00.000Z",
    ownerBinding: "job_credential_same_owner" as const,
    workerIdentityCompared: false as const,
    ...overrides,
  };
}

function providerInput(context: ReturnType<typeof bindingContext> | undefined) {
  return {
    job: {
      id: jobId,
      claim_token: claimToken,
      credential_id: credentialId,
      channel: "temu" as const,
      operation: "inquiries.list",
      environment: "production" as const,
      request: { arguments: { kind: "after_sales" } },
      credential,
      attempt_count: 1,
      ...(context ? { credential_binding_context: context } : {}),
    },
    signal: new AbortController().signal,
    hooks: {
      beginCredentialMutation: async () => {},
      stageCredentialRefresh: async () => {},
      beginProviderMutation: async () => {},
      assertLeaseHealthy: async () => {},
    },
  };
}

function identityResponse() {
  return Response.json({
    success: true,
    result: {
      mallId: 1024,
      apiScopeList: [
        "bg.open.accesstoken.info.get",
        "bg.aftersales.parentaftersales.list.get",
      ],
    },
  });
}

const inquiryResult = {
  ok: true,
  channel: "temu" as const,
  operation: "inquiries.list" as const,
  steps: [{
    name: "inquiries",
    ok: true,
    status: 200,
    data: { result: { data: [] } },
  }],
  safeMessage: "ok",
};

test("verified Temu mall identity becomes common credential evidence without exposing secrets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => identityResponse();
  try {
    const context = bindingContext();
    const result = await executeCsProviderJob(providerInput(context), async () => inquiryResult);
    assert.equal(result.steps[0]?.name, "credential-binding:temu");
    assert.equal(result.steps[0]?.data.status, "verified");
    const common = csCredentialBindingEvidence({
      channel: "temu",
      operation: "inquiries.list",
      credential,
      request: { arguments: { seller_id: "caller-must-not-be-trusted" } },
      providerResult: result,
      credentialBindingContext: context,
    });
    assert.equal(common?.contract, "sellerpilot-cs-credential-binding/1");
    assert.equal(common?.targetFingerprints.length, 1);
    assert.equal(common?.sellerAccountKey, sellerAccountKey);
    assert.deepEqual(common?.targetFingerprints, [sellerAccountKey]);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing and mismatched relational account identities fail before inquiry execution", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => identityResponse();
  let inquiryCalls = 0;
  const executor = async () => {
    inquiryCalls += 1;
    return inquiryResult;
  };
  try {
    await assert.rejects(
      executeCsProviderJob(providerInput(undefined), executor),
      /TEMU_CS_ACCOUNT_BINDING_UNAVAILABLE:TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED/,
    );
    await assert.rejects(
      executeCsProviderJob(providerInput(bindingContext({ sellerAccountKey: "f".repeat(64) })), executor),
      /TEMU_CS_ACCOUNT_BINDING_UNAVAILABLE:TEMU_SELLER_ACCOUNT_KEY_MISMATCH/,
    );
    assert.equal(inquiryCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verified identity remains separate from operational inquiry connectivity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => identityResponse();
  let inquiryCalls = 0;
  try {
    await assert.rejects(executeCsProviderJob(providerInput(bindingContext()), async () => {
      inquiryCalls += 1;
      throw new Error("TEMU_AFTER_SALES_PROVIDER_UNAVAILABLE");
    }), /TEMU_AFTER_SALES_PROVIDER_UNAVAILABLE/);
    assert.equal(inquiryCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function databaseFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.ai_cli_worker_tokens(
      token_hash text primary key, created_by uuid not null
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, channel text not null, environment text not null,
      created_by uuid, seller_account_key text, seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key, credential_id uuid not null, channel text not null,
      operation text not null, environment text not null, status text not null,
      claim_token uuid not null, created_by uuid, seller_account_key text
    );
    insert into sellerpilot_private.ai_cli_worker_tokens values('shared-token','${sharedAdministrator}');
    insert into sellerpilot_private.channel_credentials values
      ('${credentialId}','temu','production','${sellerOwner}','${sellerAccountKey}',
       'provider_certified_v1','2026-09-09T10:45:00Z'),
      ('${secondCredentialId}','temu','production','${secondSellerOwner}','${sellerAccountKey}',
       'provider_certified_v1','2026-09-09T10:45:00Z');
    insert into sellerpilot_private.channel_gateway_jobs values
      ('${jobId}','${credentialId}','temu','inquiries.list','production','running',
       '${claimToken}','${sellerOwner}','${sellerAccountKey}'),
      ('${secondJobId}','${secondCredentialId}','temu','inquiries.list','production','running',
       '${secondClaimToken}','${secondSellerOwner}','${sellerAccountKey}');
    create function public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)
      returns jsonb language sql security definer set search_path='' as $$
      select jsonb_build_object(
        'id',job.id,'credential_id',job.credential_id,'channel',job.channel,
        'operation',job.operation,'status',job.status,
        'normalization_timestamp','2026-09-09T10:45:00Z'
      )
      from sellerpilot_private.channel_gateway_jobs job
      where $1='shared-token' and job.id=$2 and job.claim_token=$3
      $$;
    revoke all on function public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)
      to service_role;
  `);
  await db.exec(migration);
  return db;
}

async function context(db: PGlite, id = jobId, claim = claimToken) {
  return (await db.query(
    "select public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result",
    ["shared-token", id, claim],
  )).rows[0]?.result as Record<string, unknown>;
}

test("common context binds job to credential owner while one shared administrator serves distinct sellers", async () => {
  const db = await databaseFixture();
  try {
    for (const [id, claim, owner] of [
      [jobId, claimToken, sellerOwner],
      [secondJobId, secondClaimToken, secondSellerOwner],
    ]) {
      const result = await context(db, id, claim);
      const binding = result.credential_binding_context as Record<string, unknown>;
      assert.equal(binding.status, "verified");
      assert.equal(binding.ownerBinding, "job_credential_same_owner");
      assert.equal(binding.workerIdentityCompared, false);
      assert.notEqual(owner, sharedAdministrator);
    }

    await db.query(
      "update sellerpilot_private.channel_credentials set seller_account_key=null where id=$1",
      [credentialId],
    );
    assert.equal(
      ((await context(db)).credential_binding_context as Record<string, unknown>).blocker,
      "TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED",
    );
    await db.query(
      "update sellerpilot_private.channel_credentials set seller_account_key=$1,created_by=$2 where id=$3",
      [sellerAccountKey, secondSellerOwner, credentialId],
    );
    assert.equal(
      ((await context(db)).credential_binding_context as Record<string, unknown>).blocker,
      "TEMU_JOB_CREDENTIAL_OWNER_MISMATCH",
    );
    assert.equal((await db.query(
      "select has_function_privilege('anon','public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)','EXECUTE') allowed",
    )).rows[0]?.allowed, false);
    assert.equal((await db.query(
      "select has_function_privilege('service_role','public.sellerpilot_service_serverless_cs_completion_context(text,uuid,uuid)','EXECUTE') allowed",
    )).rows[0]?.allowed, true);
  } finally {
    await db.close();
  }
});
