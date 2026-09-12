import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  aiGeneratedAssetPath,
  aiGeneratedAssetSpecs,
  coreFirstDraftAssetIds,
} from "../lib/ai-generated-assets";

const ownerId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const claimToken = "33333333-3333-4333-8333-333333333333";
const workerTokenHash = "a".repeat(64);
const sourcePhotoSha256 = "b".repeat(64);
const migrationUrl = new URL(
  "../supabase/migrations/20260912120000_first_draft_image_requests.sql",
  import.meta.url,
);

const bootstrap = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema if not exists public;
create or replace function public.sellerpilot_is_admin()
returns boolean language sql stable
as $$ select auth.uid() is not null $$;

create schema if not exists sellerpilot_private;
create table if not exists sellerpilot_private.ai_cli_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'test',
  token_hash text not null unique,
  scope text not null default 'ai',
  status text not null default 'active',
  expires_at timestamptz not null default now() + interval '30 days',
  last_seen_at timestamptz
);
create table if not exists sellerpilot_private.ai_cli_jobs (
  id uuid primary key,
  kind text not null,
  status text not null default 'queued',
  request_payload jsonb not null,
  result_payload jsonb,
  created_by uuid not null,
  updated_at timestamptz not null default now()
);
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
`;

function degradedResult(auditMode = "source-photo-catalog") {
  return {
    mode: "server-research",
    summary: "pglite first draft image adoption fixture summary",
    suggestedFields: {
      productName: "fixture product",
      categoryHint: "일반 상품",
      brandName: null,
      manufacturer: null,
      countryOfOrigin: null,
      material: null,
      packageContents: null,
      description: "fixture description",
      gtin: null,
    },
    searchQueries: [
      { locale: "ko-KR", query: "fixture" },
      { locale: "en-US", query: "fixture" },
      { locale: "ja-JP", query: "fixture" },
      { locale: "zh-TW", query: "fixture" },
      { locale: "ms-MY", query: "fixture" },
      { locale: "id-ID", query: "fixture" },
    ],
    details: { features: ["a", "b", "c", "d"], specifications: [], usage: [], cautions: ["c1", "c2"] },
    sources: [],
    warnings: [],
    preflightVersion: 1,
    researchInputSha256: "c".repeat(64),
    sourcePhotoSha256,
    asset_storage_paths: Object.fromEntries(coreFirstDraftAssetIds.map((assetId) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
      return [assetId, aiGeneratedAssetPath(jobId, spec, claimToken)];
    })),
    preflightAssetLineage: Object.fromEntries(coreFirstDraftAssetIds.map((assetId, index) => {
      const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
      return [assetId, {
        digest: (index + 1).toString(16).repeat(64),
        role: spec.role,
        auditMode,
        sourceRole: "main",
      }];
    })),
  };
}

function assetEntry(assetId, index) {
  const spec = aiGeneratedAssetSpecs.find((asset) => asset.id === assetId);
  return {
    id: assetId,
    path: aiGeneratedAssetPath(jobId, spec, claimToken),
    digest: (index + 10).toString(16).repeat(64),
    bytes: 1024,
    width: spec.width,
    height: spec.height,
  };
}

async function bootDatabase({ result = degradedResult() } = {}) {
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(`
    insert into auth.users (id, email) values ('${ownerId}', 'owner@example.com');
    insert into sellerpilot_private.ai_cli_worker_tokens (token_hash, scope) values ('${workerTokenHash}', 'ai');
    insert into sellerpilot_private.ai_cli_jobs (id, kind, status, request_payload, result_payload, created_by)
    values (
      '${jobId}', 'product_research', 'succeeded',
      ${sqlLiteral(JSON.stringify({
        research_input: "https://example.com/fixture 상품",
        source_photo_sha256: sourcePhotoSha256,
        image_paths: [`${ownerId}/${jobId}/input/001.jpg`],
        image_specs: [{
          name: "001.jpg",
          role: "main",
          originalPath: `${ownerId}/${jobId}/original/001.source`,
        }],
      }))}::jsonb,
      ${sqlLiteral(JSON.stringify(result))}::jsonb,
      '${ownerId}'
    );
  `);
  return db;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function setActor(db, userId) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function callJson(db, sql, params) {
  const result = await db.query(sql, params);
  return result.rows[0];
}

test("first draft image queue claims one degraded research job and adopts verified assets", async () => {
  const db = await bootDatabase();

  await setActor(db, ownerId);
  const { result: enqueued } = await callJson(db,
    "select public.sellerpilot_enqueue_first_draft_image_request($1) as result",
    [jobId],
  );
  assert.deepEqual(enqueued.status, "queued");

  // Enqueueing twice never creates a second request or regenerates finished work.
  const again = await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);
  assert.equal(again.result.status, "queued");

  const claimed = await callJson(db,
    "select public.sellerpilot_service_claim_first_draft_image_request($1) as result",
    [workerTokenHash],
  );
  assert.equal(claimed.result.jobId, jobId);
  assert.equal(claimed.result.ownerId, ownerId);
  assert.equal(claimed.result.result.sourcePhotoSha256, sourcePhotoSha256);
  assert.deepEqual(claimed.result.verifiedAssets, {});

  // One generating request is not re-claimed by the same or another poll.
  const secondClaim = await callJson(db,
    "select public.sellerpilot_service_claim_first_draft_image_request($1) as result",
    [workerTokenHash],
  );
  assert.equal(secondClaim.result, null);

  const state = await callJson(db,
    "select public.sellerpilot_service_get_first_draft_image_request($1, $2) as result",
    [workerTokenHash, jobId],
  );
  assert.equal(state.result.status, "generating");
  assert.equal(state.result.request.source_photo_sha256, sourcePhotoSha256);

  // A wrong canonical size or a non-canonical path is rejected outright.
  await db.exec(`insert into storage.objects (bucket_id, name) values ('sellerpilot-ai', '${aiGeneratedAssetPath(jobId, aiGeneratedAssetSpecs.find((asset) => asset.id === "portrait"), claimToken)}')`);
  const wrongSize = await callJson(db,
    "select public.sellerpilot_service_record_first_draft_image_assets($1, $2, $3::jsonb) as result",
    [workerTokenHash, jobId, JSON.stringify([{ ...assetEntry("portrait", 0), width: 1200, height: 1200 }])],
  );
  assert.equal(wrongSize.result, null);
  const wrongPath = await callJson(db,
    "select public.sellerpilot_service_record_first_draft_image_assets($1, $2, $3::jsonb) as result",
    [workerTokenHash, jobId, JSON.stringify([{ ...assetEntry("portrait", 0), path: "results/other/portrait.png" }])],
  );
  assert.equal(wrongPath.result, null);

  const entries = coreFirstDraftAssetIds.map((assetId, index) => assetEntry(assetId, index));
  await db.exec(entries.map((entry) => `insert into storage.objects (bucket_id, name) values ('sellerpilot-ai', '${entry.path}')`).join(";\n"));

  const firstBatch = await callJson(db,
    "select public.sellerpilot_service_record_first_draft_image_assets($1, $2, $3::jsonb) as result",
    [workerTokenHash, jobId, JSON.stringify(entries.slice(0, 5))],
  );
  assert.equal(firstBatch.result.status, "recorded");
  assert.deepEqual(firstBatch.result.pending, [entries[5].id]);
  const midway = await callJson(db, "select result_payload as result from sellerpilot_private.ai_cli_jobs where id = $1", [jobId]);
  assert.equal(midway.result.preflightAssetLineage.portrait.auditMode, "source-photo-catalog");

  const finalBatch = await callJson(db,
    "select public.sellerpilot_service_record_first_draft_image_assets($1, $2, $3::jsonb) as result",
    [workerTokenHash, jobId, JSON.stringify(entries.slice(5))],
  );
  assert.equal(finalBatch.result.status, "done");

  const adopted = await callJson(db, "select result_payload as result from sellerpilot_private.ai_cli_jobs where id = $1", [jobId]);
  for (const [index, assetId] of coreFirstDraftAssetIds.entries()) {
    const lineage = adopted.result.preflightAssetLineage[assetId];
    assert.equal(lineage.auditMode, "segmented-source-composite", assetId);
    assert.equal(lineage.digest, entries[index].digest, assetId);
    assert.equal(lineage.role, aiGeneratedAssetSpecs.find((asset) => asset.id === assetId).role);
    assert.equal(lineage.sourceRole, "main");
  }
  // Only the lineage changed; digests stay the uploaded bytes and the app can
  // still read the same result through the recovery contract.
  assert.deepEqual(adopted.result.asset_storage_paths, degradedResult().asset_storage_paths);
  assert.equal(adopted.result.sourcePhotoSha256, sourcePhotoSha256);
  assert.equal(adopted.result.researchInputSha256, "c".repeat(64));
  assert.deepEqual(
    Object.fromEntries(Object.entries(adopted.result).filter(([key]) => key !== "preflightAssetLineage")),
    Object.fromEntries(Object.entries(degradedResult()).filter(([key]) => key !== "preflightAssetLineage")),
  );

  const request = await callJson(db, "select status, completed_at is not null as completed from sellerpilot_private.first_draft_image_requests where job_id = $1", [jobId]);
  assert.equal(request.status, "done");
  assert.equal(request.completed, true);

  // A finished request is neither re-claimed nor re-enqueued.
  const afterDone = await callJson(db, "select public.sellerpilot_service_claim_first_draft_image_request($1) as result", [workerTokenHash]);
  assert.equal(afterDone.result, null);
  await setActor(db, ownerId);
  const reEnqueue = await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);
  assert.equal(reEnqueue.result.status, "already-generated");

  await db.close();
});

test("first draft image queue fails closed for foreign, incomplete or finished jobs", async () => {
  const db = await bootDatabase();
  await setActor(db, ownerId);

  const foreign = await callJson(db,
    "select public.sellerpilot_enqueue_first_draft_image_request($1) as result",
    ["99999999-9999-4999-8999-999999999999"],
  );
  assert.equal(foreign.result.status, "missing");

  await db.exec(`update sellerpilot_private.ai_cli_jobs set status = 'running' where id = '${jobId}'`);
  const running = await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);
  assert.equal(running.result.status, "not-completed");

  await db.exec(`update sellerpilot_private.ai_cli_jobs
    set status = 'succeeded',
        result_payload = jsonb_set(result_payload, '{preflightAssetLineage,portrait,auditMode}', '"segmented-source-composite"')
    where id = '${jobId}'`);
  const adopted = await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);
  assert.equal(adopted.result.status, "already-generated");

  await db.exec(`update sellerpilot_private.ai_cli_jobs
    set result_payload = result_payload - 'asset_storage_paths'
    where id = '${jobId}'`);
  const noAssets = await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);
  assert.equal(noAssets.result.status, "no-assets");

  // An unknown worker token can never claim or record.
  await assert.rejects(
    () => db.query("select public.sellerpilot_service_claim_first_draft_image_request($1)", ["d".repeat(64)]),
    /invalid worker token/,
  );
  await assert.rejects(
    () => db.query("select public.sellerpilot_service_record_first_draft_image_assets($1, $2, $3::jsonb)", [
      "d".repeat(64), jobId, JSON.stringify([assetEntry("portrait", 0)]),
    ]),
    /invalid worker token/,
  );

  await db.close();
});

test("a failed generation attempt returns to the queue and stops retrying after three attempts", async () => {
  const db = await bootDatabase();
  await setActor(db, ownerId);
  await callJson(db, "select public.sellerpilot_enqueue_first_draft_image_request($1) as result", [jobId]);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = await callJson(db, "select public.sellerpilot_service_claim_first_draft_image_request($1) as result", [workerTokenHash]);
    assert.equal(claim.result.jobId, jobId, `attempt ${attempt}`);
    const released = await callJson(
      db,
      "select public.sellerpilot_service_release_first_draft_image_request($1, $2, $3) as result",
      [workerTokenHash, jobId, "codex image generation failed"],
    );
    assert.equal(released.result, true);
    const request = await callJson(db, "select status, attempts, last_error from sellerpilot_private.first_draft_image_requests where job_id = $1", [jobId]);
    assert.equal(request.status, "queued");
    assert.equal(request.attempts, attempt);
    assert.equal(request.last_error, "codex image generation failed");
  }

  const exhausted = await callJson(db, "select public.sellerpilot_service_claim_first_draft_image_request($1) as result", [workerTokenHash]);
  assert.equal(exhausted.result, null);

  await db.close();
});
