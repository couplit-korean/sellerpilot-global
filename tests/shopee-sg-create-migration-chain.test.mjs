import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
const historicalRepair =
  "20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql";
const canonicalClaim = "20260904232000_persist_live_gateway_claim_routing.sql";
const executionLineage =
  "20260910013000_bind_shopee_sg_create_execution_lineage.sql";
const createResume =
  "20260910023000_shopee_create_resume_reconciliation.sql";
const r6Hardening =
  "20260910044000_shopee_create_transport_and_successor_hardening_r6.sql";
const protectedMigrations = new Set([
  "20260903150000_unblock_shopee_second_oauth_deadlock.sql",
  "20260908062000_smartstore_repair_adoption_recheck_generation2.sql",
]);
const excludedMigrations = new Set([
  ...protectedMigrations,
  "20260831131500_retire_pre_v3_competitor_search_queue.sql",
  "20260831132000_competitor_identity_lineage_fence.sql",
]);
const shopeeStructuralTail = [
  "20260908142023_cs_shopee_history_ledger.sql",
  "20260908142025_cs_shopee_target_refresh_cas.sql",
  "20260909193500_shopee_exact_target_lineage_v2.sql",
  "20260909204000_shopee_exact_target_cache_receipt_v3.sql",
  executionLineage,
  createResume,
  r6Hardening,
];

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "")
    .replace(/^create extension if not exists pg_cron with schema pg_catalog;\s*$/gim, "")
    .replace(/^create extension if not exists pg_net with schema extensions;\s*$/gim, "");
}

async function compatibilityLayer() {
  const fixture = await readFile(
    new URL("./provider-listing-lineage-rebind.test.mjs", import.meta.url),
    "utf8",
  );
  const match = fixture.match(
    /const supabaseCompatibilityLayer = String\.raw`([\s\S]*?)`;\n/u,
  );
  assert.ok(match, "shared PGlite compatibility layer is required");
  return match[1];
}

async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}

function tagged(source, tag) {
  return [...source.matchAll(
    new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, "gu"),
  )].map((match) => match[1]);
}

function claimFixture(markers) {
  return `
    create or replace function public.sellerpilot_11820_claim_gateway_unsafe(
      p_token_hash text,
      p_worker_version text default null
    ) returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    begin
      /*
${markers.join("\n")}
      where serverless_token.scope = 'serverless_cs'
      */
      return '{}'::jsonb;
    end
    $function$;
  `;
}

async function applyHistoricalFixture(migration, markers) {
  const db = new PGlite();
  try {
    await db.exec(claimFixture(markers));
    await db.exec(migration);
    return (await db.query(
      "select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) source",
    )).rows[0]?.source;
  } finally {
    await db.close();
  }
}

test("historical Shopee marker cardinality rejects mixed and partial claim sources", async () => {
  const migration = await readFile(new URL(historicalRepair, migrationUrl), "utf8");
  const [operatorOld, attributeOld] = tagged(migration, "old");
  const [operatorNew, attributeNew] = tagged(migration, "new");
  const [published] = tagged(migration, "published");
  assert.ok(operatorOld && attributeOld && operatorNew && attributeNew && published);

  const sourceOnly = await applyHistoricalFixture(migration, [published]);
  assert.equal(sourceOnly.split(published).length - 1, 1);
  assert.equal(sourceOnly.includes(operatorOld), false);
  assert.equal(sourceOnly.includes(operatorNew), false);

  const operatorOldResult = await applyHistoricalFixture(migration, [
    operatorOld,
    attributeOld,
    attributeOld,
    attributeOld,
  ]);
  assert.equal(operatorOldResult.split(operatorNew).length - 1, 1);
  assert.equal(operatorOldResult.split(attributeNew).length - 1, 3);
  assert.equal(operatorOldResult.includes(operatorOld), false);
  assert.equal(operatorOldResult.replaceAll(attributeNew, "").includes(attributeOld), false);

  const operatorNewResult = await applyHistoricalFixture(migration, [
    operatorNew,
    attributeNew,
    attributeNew,
    attributeNew,
  ]);
  assert.equal(operatorNewResult.split(operatorNew).length - 1, 1);
  assert.equal(operatorNewResult.split(attributeNew).length - 1, 3);

  const rejected = [
    ["duplicate new marker", [
      operatorNew, operatorNew, attributeNew, attributeNew, attributeNew,
    ]],
    ["mixed published and operator", [
      published, operatorOld, attributeOld, attributeOld, attributeOld,
    ]],
    ["partial attributes", [operatorOld, attributeOld, attributeOld]],
    ["mixed attributes", [
      operatorOld, attributeOld, attributeOld, attributeNew,
    ]],
    ["unknown predecessor", ["j.channel = 'shopee' and unknown_preimage"]],
  ];
  for (const [label, markers] of rejected) {
    await assert.rejects(
      applyHistoricalFixture(migration, markers),
      /11820 Shopee marker cardinality drift/u,
      label,
    );
  }
});

test("the source-only Shopee claim chain reaches the SG execution fence", async () => {
  const available = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const names = [
    ...available.filter((name) => name <= canonicalClaim),
    ...shopeeStructuralTail,
  ].filter((name) => !excludedMigrations.has(name));
  for (const protectedName of protectedMigrations) {
    assert.equal(names.includes(protectedName), false);
  }

  const db = new PGlite();
  try {
    await db.exec(await compatibilityLayer());
    const reached = new Set();
    for (const name of names) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
      reached.add(name);
    }
    assert.equal(reached.has(historicalRepair), true);
    assert.equal(reached.has(canonicalClaim), true);
    assert.equal(reached.has(executionLineage), true);
    assert.equal(reached.has(createResume), true);
    assert.equal(reached.has(r6Hardening), true);

    const canonicalSource = (await db.query(
      "select pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure) source",
    )).rows[0]?.source;
    assert.match(canonicalSource,
      /false and j\.channel = 'shopee' and j\.operation in/u);

    const providerFence = (await db.query(
      "select pg_get_functiondef('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure) source",
    )).rows[0]?.source;
    assert.match(providerFence,
      /shopee_sg_create_execution_lineage_current_v1[\s\S]*?is not true/u);

    const receiptTable = (await db.query(
      "select to_regclass('sellerpilot_private.shopee_sg_global_create_receipts')::text name",
    )).rows[0]?.name;
    assert.equal(receiptTable,
      "sellerpilot_private.shopee_sg_global_create_receipts");
    const recordSource = (await db.query(
      "select pg_get_functiondef('public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(text,uuid,uuid,text,jsonb,jsonb,jsonb)'::regprocedure) source",
    )).rows[0]?.source;
    assert.match(recordSource,
      /shopee_sg_create_execution_lineage_current_v1[\s\S]*?global_item_list/u);
    const resumeSource = (await db.query(
      "select pg_get_functiondef('public.sellerpilot_service_read_shopee_sg_create_resume_v1(text,uuid,uuid)'::regprocedure) source",
    )).rows[0]?.source;
    assert.match(resumeSource,
      /receipt\.request_fingerprint[\s\S]*?receipt\.prepared_arguments/u);
    const successor = (await db.query(
      "select to_regprocedure('sellerpilot_private.rebind_shopee_sg_successor_v1(uuid,uuid)')::text name",
    )).rows[0]?.name;
    assert.equal(successor,
      "sellerpilot_private.rebind_shopee_sg_successor_v1(uuid,uuid)");
    const warehouseBody = (await db.query(
      "select pg_get_functiondef('sellerpilot_private.assert_shopee_sg_wh_list_body_v1(jsonb)'::regprocedure) source",
    )).rows[0]?.source;
    assert.match(warehouseBody, /SHOPEE_SG_WAREHOUSE_LIST_BODY_FORBIDDEN/u);
  } finally {
    await db.close();
  }
});

test("durable SG stages replace repeated one-shot generic begins", async () => {
  const db = new PGlite();
  const ownerId = "10000000-0000-4000-8000-000000000001";
  const credentialId = "20000000-0000-4000-8000-000000000001";
  const tokenId = "30000000-0000-4000-8000-000000000001";
  const attemptId = "40000000-0000-4000-8000-000000000001";
  const listingId = "50000000-0000-4000-8000-000000000001";
  const jobId = "60000000-0000-4000-8000-000000000001";
  const claimToken = "70000000-0000-4000-8000-000000000001";
  const tokenHash = "8".repeat(64);
  const preparedSha = "c".repeat(64);
  const requestFingerprint = "a".repeat(64);
  const imageDigests = Array.from(
    { length: 9 },
    (_value, index) => (index + 1).toString(16).padStart(64, "0"),
  );
  const imageUrls = imageDigests.map((digest) =>
    `https://qa.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
  const lineage = {
    contract: "shopee_sg_create_execution_lineage_v1",
    credentialId,
    credentialVersion: 81,
    targetId: "1719148844",
    marketCode: "SG",
  };
  const requestPayload = { arguments: {
    imageUrls,
    publicationExpectedFingerprint: requestFingerprint,
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      approvedDetailPageVersion: 7,
      approvedManifestDigest: "b".repeat(64),
    },
    merchantId: "5511564",
    sellerpilotShopeeSgCreateContext: { merchantId: "5511564" },
    sellerpilotShopeeSgCreateExecutionLineage: lineage,
    body: {
      global_item_sku: "AUTO-780720401E2D4E4EA45F",
      global_item_name: "Lotte Sand Milk Cream Biscuits 315g Pack of 6",
    },
    publish: {
      shop_id: "1719148844",
      item: { item_name: "Lotte Sand Milk Cream Biscuits 315g - 6 Packs" },
    },
  } };
  try {
    await db.exec(await compatibilityLayer());
    await db.exec(`
      create schema if not exists sellerpilot_private;
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        version integer not null
      );
      create table sellerpilot_private.ai_cli_worker_tokens (
        id uuid primary key,
        token_hash text not null,
        scope text not null,
        status text not null,
        expires_at timestamptz not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        attempt_id uuid references sellerpilot_private.channel_operation_attempts(id),
        listing_id uuid references sellerpilot_private.product_listings(id),
        created_by uuid references auth.users(id),
        credential_id uuid references sellerpilot_private.channel_credentials(id),
        request_payload jsonb not null,
        provider_mutation_started_at timestamptz,
        claim_token uuid,
        status text not null,
        lease_expires_at timestamptz,
        worker_token_id uuid references sellerpilot_private.ai_cli_worker_tokens(id),
        channel text not null,
        operation text not null,
        environment text not null,
        updated_at timestamptz not null default clock_timestamp()
      );
      create function sellerpilot_private.shopee_sg_create_execution_lineage_current_v1(
        p_job_id uuid,
        p_claim_token uuid
      ) returns boolean language sql stable set search_path = '' as $$
        select exists (
          select 1
            from sellerpilot_private.channel_gateway_jobs job
            join sellerpilot_private.channel_credentials credential
              on credential.id=job.credential_id
           where job.id=p_job_id and job.claim_token=p_claim_token
             and job.status='running'
             and job.lease_expires_at>clock_timestamp()
             and job.request_payload#>>
               '{arguments,sellerpilotShopeeSgCreateExecutionLineage,credentialId}'
                 =job.credential_id::text
             and (job.request_payload#>>
               '{arguments,sellerpilotShopeeSgCreateExecutionLineage,credentialVersion}')::integer
                 =credential.version
        )
      $$;
      create function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
        p_token_hash text,
        p_job_id uuid,
        p_claim_token uuid
      ) returns boolean language plpgsql security definer set search_path = '' as $$
      declare v_started boolean;
      begin
        update sellerpilot_private.channel_gateway_jobs job
           set provider_mutation_started_at=clock_timestamp(),updated_at=clock_timestamp()
          from sellerpilot_private.ai_cli_worker_tokens token
         where job.id=p_job_id and job.claim_token=p_claim_token
           and job.status='running' and job.lease_expires_at>clock_timestamp()
           and job.provider_mutation_started_at is null
           and token.id=job.worker_token_id and token.token_hash=p_token_hash
           and token.status='active' and token.expires_at>clock_timestamp()
        returning true into v_started;
        return coalesce(v_started,false);
      end
      $$;
    `);
    await db.exec(withoutUnavailableExtensions(
      await readFile(new URL(createResume, migrationUrl), "utf8"),
    ));
    await db.query("insert into auth.users(id) values($1)", [ownerId]);
    await db.query(
      "insert into sellerpilot_private.channel_credentials(id,version) values($1,81)",
      [credentialId],
    );
    await db.query(
      `insert into sellerpilot_private.ai_cli_worker_tokens(
         id,token_hash,scope,status,expires_at
       ) values($1,$2,'gateway','active',clock_timestamp()+interval '1 day')`,
      [tokenId, tokenHash],
    );
    await db.query(
      "insert into sellerpilot_private.channel_operation_attempts(id) values($1)",
      [attemptId],
    );
    await db.query(
      "insert into sellerpilot_private.product_listings(id) values($1)",
      [listingId],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         id,attempt_id,listing_id,created_by,credential_id,request_payload,
         claim_token,status,lease_expires_at,worker_token_id,channel,operation,environment
       ) values($1,$2,$3,$4,$5,$6::jsonb,$7,'running',
         clock_timestamp()+interval '1 hour',$8,'shopee','listing.create','production')`,
      [jobId, attemptId, listingId, ownerId, credentialId,
        JSON.stringify(requestPayload), claimToken, tokenId],
    );

    const beginSql = `select public.sellerpilot_service_begin_serverless_gateway_provider_mutation(
      $1,$2,$3
    ) value`;
    assert.equal(await scalar(db, beginSql, [tokenHash, jobId, claimToken]), true);
    assert.equal(await scalar(db, beginSql, [tokenHash, jobId, claimToken]), false,
      "the generic provider begin is one-shot");

    const readState = () => scalar(db,
      `select public.sellerpilot_service_read_shopee_sg_create_stage_state_v1(
         $1,$2,$3
       ) value`, [tokenHash, jobId, claimToken]);
    assert.deepEqual(await readState(), {
      contract: "sellerpilot-shopee-sg-create-stage/1",
      status: "ready",
      genericProviderMutationStarted: true,
      nextSequence: 0,
      completedStages: [],
      startedStage: null,
    });
    const beginStage = (sequence, stage, sourceUrl = null, sourceSha = null,
      globalItemId = null) => scalar(db,
      `select public.sellerpilot_service_begin_shopee_sg_create_stage_v1(
         $1,$2,$3,$4,$5,$6,$7,$8,$9
       ) value`, [tokenHash, jobId, claimToken, sequence, stage, preparedSha,
        sourceUrl, sourceSha, globalItemId]);
    const completeStage = (sequence, stage, outputId, result,
      sourceUrl = null, sourceSha = null, globalItemId = null) => scalar(db,
      `select public.sellerpilot_service_complete_shopee_sg_create_stage_v1(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb
       ) value`, [tokenHash, jobId, claimToken, sequence, stage, preparedSha,
        sourceUrl, sourceSha, globalItemId, outputId, JSON.stringify(result)]);

    await assert.rejects(
      beginStage(0, "image-upload", imageUrls[0], "f".repeat(64)),
      /IMAGE_STAGE_SOURCE_INVALID/u,
    );
    assert.equal((await readState()).nextSequence, 0);
    for (let index = 0; index < 9; index += 1) {
      const begun = await beginStage(
        index, "image-upload", imageUrls[index], imageDigests[index],
      );
      assert.equal(begun.status, "started");
      if (index === 0) {
        const uncertain = await readState();
        assert.equal(uncertain.nextSequence, 0);
        assert.deepEqual(uncertain.startedStage, {
          sequence: 0,
          stage: "image-upload",
          preparedPayloadSha256: preparedSha,
          sourceUrl: imageUrls[0],
          sourceSha256: imageDigests[0],
          globalItemId: null,
        });
        await assert.rejects(
          beginStage(1, "image-upload", imageUrls[1], imageDigests[1]),
          /STAGE_SEQUENCE_INVALID/u,
        );
      }
      const completed = await completeStage(
        index, "image-upload", `image-${index + 1}`,
        { imageId: `image-${index + 1}` }, imageUrls[index], imageDigests[index],
      );
      assert.equal(completed.status, "completed");
      if (index === 0) {
        await db.query(
          `update sellerpilot_private.channel_gateway_jobs
              set request_payload=jsonb_set(
                request_payload,
                '{arguments,sellerpilotPublicationAssetBinding,approvedManifestDigest}',
                to_jsonb($2::text)
              )
            where id=$1`,
          [jobId, "d".repeat(64)],
        );
        await assert.rejects(
          beginStage(1, "image-upload", imageUrls[1], imageDigests[1]),
          /STAGE_PAYLOAD_DRIFT/u,
        );
        await db.query(
          "update sellerpilot_private.channel_gateway_jobs set request_payload=$2::jsonb where id=$1",
          [jobId, JSON.stringify(requestPayload)],
        );
      }
    }
    const replay = await beginStage(
      0, "image-upload", imageUrls[0], imageDigests[0],
    );
    assert.equal(replay.status, "completed");
    assert.equal(replay.outputId, "image-1");
    await assert.rejects(
      beginStage(0, "image-upload", imageUrls[0], "f".repeat(64)),
      /REPLAY_MISMATCH|SOURCE_INVALID/u,
    );

    await db.exec("begin");
    await db.query(
      "update sellerpilot_private.channel_gateway_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [jobId],
    );
    await assert.rejects(
      beginStage(9, "global-item-create"),
      /STAGE_OWNERSHIP_LOST/u,
    );
    await db.exec("rollback");
    assert.equal((await readState()).nextSequence, 9);

    assert.equal((await beginStage(9, "global-item-create")).status, "started");
    const preparedArguments = {
      ...requestPayload.arguments,
      sellerpilotProviderLocalCategoryId: "200787",
      sellerpilotShopeeSgCreatePrewriteEvidence: {
        contract: "sellerpilot_shopee_sg_create_prewrite_v1",
        payloadSha256: preparedSha,
        credential: { credentialId, credentialVersion: 81 },
        provider: { merchantId: "5511564", shopId: "1719148844" },
      },
    };
    const globalItemId = "7001";
    const globalCreate = {
      error: "",
      response: { global_item_id: globalItemId },
      sellerpilotReconciliation: "official-exact-global-readback",
    };
    const globalReadback = { error: "", response: { global_item_list: [{
      global_item_id: globalItemId,
      global_item_sku: "AUTO-780720401E2D4E4EA45F",
      global_item_name: "Lotte Sand Milk Cream Biscuits 315g Pack of 6",
    }] } };
    const globalRecorded = await scalar(db,
      `select public.sellerpilot_service_record_shopee_sg_global_create_readback_v1(
         $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb
       ) value`, [tokenHash, jobId, claimToken, globalItemId,
        JSON.stringify(globalCreate), JSON.stringify(globalReadback),
        JSON.stringify(preparedArguments)]);
    assert.equal(globalRecorded.status, "recorded");
    assert.equal((await readState()).nextSequence, 10);

    assert.equal((await beginStage(
      10, "local-publish", null, null, globalItemId,
    )).status, "started");
    const localItemId = "8001";
    const localResult = {
      sellerpilotReconciliation: "official-exact-local-readback",
      publishedReadback: { error: "", response: { published_item: [{
        global_item_id: Number(globalItemId),
        shop_id: 1719148844,
        item_id: Number(localItemId),
      }] } },
      localReadback: { error: "", response: { item_list: [{
        item_id: Number(localItemId),
        item_sku: "AUTO-780720401E2D4E4EA45F",
        item_name: "Lotte Sand Milk Cream Biscuits 315g - 6 Packs",
        category_id: 200787,
      }] } },
      localItemId,
    };
    assert.equal((await completeStage(
      10, "local-publish", localItemId, localResult,
      null, null, globalItemId,
    )).status, "completed");
    assert.equal((await readState()).nextSequence, 11);
    assert.equal((await db.query(
      "select count(*)::integer count from sellerpilot_private.shopee_sg_create_stage_receipts where listing_id=$1 and status='completed'",
      [listingId],
    )).rows[0]?.count, 11);
  } finally {
    await db.close();
  }
});
