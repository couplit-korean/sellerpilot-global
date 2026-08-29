import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260830090000_recover_product_research_context.sql",
  import.meta.url,
);

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const SUCCEEDED_JOB_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_JOB_ID = "20000000-0000-4000-8000-000000000002";
const FAILED_JOB_ID = "20000000-0000-4000-8000-000000000003";
const WRONG_KIND_JOB_ID = "20000000-0000-4000-8000-000000000004";

async function createFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create function auth.uid()
    returns uuid
    language sql stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function public.sellerpilot_is_admin()
    returns boolean
    language sql stable
    as $$
      select auth.uid() is not null
        and coalesce(current_setting('request.jwt.claim.is_admin', true), 'false') = 'true'
    $$;
    create table sellerpilot_private.ai_cli_jobs (
      id uuid primary key,
      kind text not null,
      status text not null,
      request_payload jsonb not null default '{}'::jsonb,
      result_payload jsonb,
      created_by uuid not null,
      completed_at timestamptz
    );
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.query(
    `insert into sellerpilot_private.ai_cli_jobs(
       id, kind, status, request_payload, result_payload, created_by, completed_at
     ) values
       ($1, 'product_research', 'succeeded', '{"research_input":"owner product","source_photo_sha256":"${"a".repeat(64)}","image_paths":["owner/path"],"image_specs":[{"role":"main"}]}', '{"mode":"server-research"}', $2, now()),
       ($3, 'product_research', 'succeeded', '{"research_input":"other product"}', '{"mode":"server-research"}', $4, now()),
       ($5, 'product_research', 'failed', '{"research_input":"failed product"}', null, $2, now()),
       ($6, 'product_studio', 'succeeded', '{"research_input":"wrong kind"}', '{"mode":"server-research"}', $2, now())`,
    [SUCCEEDED_JOB_ID, OWNER_ID, OTHER_JOB_ID, OTHER_OWNER_ID, FAILED_JOB_ID, WRONG_KIND_JOB_ID],
  );
  return db;
}

test("creator-only recovery returns only a successful product-research job owned by the caller", async () => {
  const db = await createFixture();
  try {
    await db.exec(`set request.jwt.claim.sub = '${OWNER_ID}'`);
    await db.exec("set request.jwt.claim.is_admin = 'true'");
    const owned = await db.query(
      "select public.sellerpilot_get_product_research_recovery($1) as recovery",
      [SUCCEEDED_JOB_ID],
    );
    const recovery = owned.rows[0].recovery;
    assert.equal(recovery.id, SUCCEEDED_JOB_ID);
    assert.equal(recovery.kind, "product_research");
    assert.equal(recovery.status, "succeeded");
    assert.equal(recovery.request.jobId, SUCCEEDED_JOB_ID);
    assert.equal(recovery.request.researchInput, "owner product");
    assert.equal(recovery.request.sourcePhotoFingerprint, "a".repeat(64));
    assert.equal(recovery.result.mode, "server-research");

    const wrongOwner = await db.query(
      "select public.sellerpilot_get_product_research_recovery($1) as recovery",
      [OTHER_JOB_ID],
    );
    assert.equal(wrongOwner.rows[0].recovery, null);

    const failed = await db.query(
      "select public.sellerpilot_get_product_research_recovery($1) as recovery",
      [FAILED_JOB_ID],
    );
    assert.equal(failed.rows[0].recovery, null);

    const wrongKind = await db.query(
      "select public.sellerpilot_get_product_research_recovery($1) as recovery",
      [WRONG_KIND_JOB_ID],
    );
    assert.equal(wrongKind.rows[0].recovery, null);

    const catalog = await db.query(`
      select
        procedure.prosecdef,
        procedure.proconfig,
        has_function_privilege('anon', procedure.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', procedure.oid, 'execute') as service_execute
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'sellerpilot_get_product_research_recovery'
    `);
    assert.equal(catalog.rows[0].prosecdef, true);
    assert.deepEqual(catalog.rows[0].proconfig, ["search_path=\"\""]);
    assert.equal(catalog.rows[0].anon_execute, false);
    assert.equal(catalog.rows[0].authenticated_execute, true);
    assert.equal(catalog.rows[0].service_execute, false);

    await db.exec("set request.jwt.claim.is_admin = 'false'");
    await assert.rejects(
      db.query("select public.sellerpilot_get_product_research_recovery($1)", [SUCCEEDED_JOB_ID]),
      /administrator access required/,
    );

    await db.exec("set request.jwt.claim.sub = ''");
    await assert.rejects(
      db.query("select public.sellerpilot_get_product_research_recovery($1)", [SUCCEEDED_JOB_ID]),
      /administrator access required/,
    );
  } finally {
    await db.close();
  }
});

test("recovery migration, route, and UI keep the ownership, image, and stale-write fences explicit", async () => {
  const [migration, route, page, desktopCss, mobileCss] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../app/api/ai/product-research/recover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/commerce-ux-refactor.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\) is null[\s\S]*sellerpilot_is_admin/);
  assert.match(migration, /job\.created_by = auth\.uid\(\)/);
  assert.match(migration, /job\.kind = 'product_research'/);
  assert.match(migration, /job\.status = 'succeeded'/);
  assert.match(migration, /'result', jsonb_build_object\([\s\S]*'preflightAssetLineage'/);
  assert.doesNotMatch(migration, /'result', job\.result_payload/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);

  const authentication = route.indexOf("authenticateAdminRequest(request)");
  const creatorRpc = route.indexOf('"sellerpilot_get_product_research_recovery"', authentication);
  const storedRequestValidation = route.indexOf("productResearchJobRequestSchema.safeParse");
  const preservedPathValidation = route.indexOf("validatePreservedStudioUploadPaths(", storedRequestValidation);
  const sourceVerification = route.indexOf("verifyPreservedStudioImages({", preservedPathValidation);
  const sourceHash = route.indexOf("sha256PreservedStudioOriginalImage(", preservedPathValidation);
  const generatedVerification = route.indexOf("verifyGeneratedStudioImages({", sourceHash);
  const responseSigning = route.indexOf("const [sourceSigning, generatedSigning]", generatedVerification);
  assert.ok(authentication >= 0);
  assert.ok(creatorRpc > authentication);
  assert.ok(storedRequestValidation > creatorRpc);
  assert.ok(preservedPathValidation > storedRequestValidation);
  assert.ok(sourceVerification > preservedPathValidation);
  assert.ok(sourceHash > preservedPathValidation);
  assert.ok(generatedVerification > sourceHash);
  assert.ok(responseSigning > generatedVerification);
  assert.match(route, /preflight\.preflight\.assetDigests\[assetId\]/);
  assert.match(route, /generatedSigned\.length !== generatedPaths\.length/);
  assert.match(route, /createSignedUrls\(\[preserved\.originalPaths\[0\]\], 10 \* 60\)/);
  assert.match(route, /createSignedUrls\(generatedPaths, 60 \* 60\)/);
  assert.match(route, /withPromiseTimeout\([\s\S]*15_000/);
  assert.match(route, /sourcePhotoSha256 !== storedRequest\.data\.sourcePhotoFingerprint/);
  assert.match(route, /asset_storage_paths: undefined/);
  assert.match(route, /issueProductResearchLineageReceipt/);
  assert.match(route, /cache-control": "no-store, max-age=0/);

  const recoveryFunction = page.indexOf("const recoverCompletedProductResearch = async");
  const recoveryToken = page.indexOf("photoSelectionFence.nextMain()", recoveryFunction);
  const recoveryRequest = page.indexOf('authenticatedFetch("/api/ai/product-research/recover"', recoveryFunction);
  const sourceDigest = page.indexOf("productSourcePhotoSha256(file)", recoveryRequest);
  const staleFence = page.indexOf("productResearchRecoveryGenerationRef.current === recoveryGeneration", sourceDigest);
  const resultApply = page.indexOf("applyCompletedProductResearch({", staleFence);
  assert.ok(recoveryFunction >= 0);
  assert.ok(recoveryToken > recoveryFunction && recoveryToken < recoveryRequest);
  assert.ok(sourceDigest > recoveryRequest);
  assert.ok(staleFence > sourceDigest);
  assert.ok(resultApply > staleFence);
  assert.match(page, /restoredMainPhotoFileRef\.current === nextFile[\s\S]*restoredMainPhotoFileRef\.current = null/);
  assert.match(page, /productResearchRecoveryControllerRef\.current\?\.abort[\s\S]*selectMainPhoto/);
  assert.match(page, /recovery\s*\? clearUnchangedResearchAppliedValues/);
  assert.match(page, /if \(recovery\) closeGeneratedProductRegistration\(\)/);
  assert.match(page, /sellerSku:[^\n]*AUTO-\$\{jobId\.replaceAll/);
  assert.doesNotMatch(page, /sellerSku:[^\n]*crypto\.randomUUID/);
  assert.equal((page.match(/applyCompletedProductResearch\(\{/g) ?? []).length, 2);
  assert.match(page, /!initialProduct\?\.id && !researchResult[\s\S]*product-research-recovery/);
  assert.match(page, /disabled=\{recoveringProductResearch\}/);
  assert.match(desktopCss, /\.product-research-recovery/);
  assert.match(mobileCss, /\.product-research-recovery[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});
