import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("research recovery returns all stored photo evidence without changing legacy shape or access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function public.sellerpilot_is_admin() returns boolean language sql stable as $$
        select coalesce(current_setting('test.is_admin',true),'false')='true'
      $$;
      create schema sellerpilot_private;
      create table sellerpilot_private.ai_cli_jobs (
        id uuid primary key, kind text, status text, created_by uuid,
        request_payload jsonb, result_payload jsonb, completed_at timestamptz
      );
      create table sellerpilot_private.first_draft_image_requests (
        job_id uuid primary key, owner_id uuid, status text, attempts integer, max_attempts integer
      );
    `);
    const previous = await readFile(new URL("../../supabase/migrations/20260913141310_first_draft_retry_status.sql", import.meta.url), "utf8");
    const start = previous.indexOf("CREATE OR REPLACE FUNCTION public.sellerpilot_get_product_research_recovery(");
    assert.notEqual(start, -1);
    const definition = previous.slice(start, previous.indexOf("\n$function$;", start) + "\n$function$;".length);
    await db.exec(definition);
    await db.exec(`
      revoke all on function public.sellerpilot_get_product_research_recovery(uuid) from public,anon;
      grant execute on function public.sellerpilot_get_product_research_recovery(uuid) to authenticated,service_role;
    `);
    const metadata = async () => (await db.query(`select md5(prosrc) as source_md5,
      proacl::text as acl, prosecdef, provolatile, proconfig
      from pg_proc where oid='public.sellerpilot_get_product_research_recovery(uuid)'::regprocedure`)).rows[0];
    const oldMetadata = await metadata();
    assert.equal(oldMetadata.source_md5, "3f5e8f4ddd9671159bfb6f33e90475aa", "fixture matches the production migration guard");
    const migration = await readFile(new URL("../../supabase/migrations/20260914060000_product_research_recovery_photo_evidence.sql", import.meta.url), "utf8");
    await db.exec(migration);
    const newMetadata = await metadata();
    assert.notEqual(newMetadata.source_md5, oldMetadata.source_md5);
    assert.deepEqual({ ...newMetadata, source_md5: oldMetadata.source_md5 }, oldMetadata, "ACL, definer, stability and search_path are preserved");

    await db.exec("begin");
    const owner = "11111111-1111-4111-8111-111111111111";
    const otherOwner = "22222222-2222-4222-8222-222222222222";
    const modernJob = "33333333-3333-4333-8333-333333333333";
    const legacyJob = "44444444-4444-4444-8444-444444444444";
    const sourcePhotoEvidence = ["main", "back", "left", "right", "label", "barcode"].map((inputRole, sourceIndex) => ({
      sourceIndex, inputRole, sourceSha256: String(sourceIndex + 1).repeat(64),
      originalName: `photo-${sourceIndex + 1}.jpeg`, observedFacts: [`photo ${sourceIndex + 1} fact`],
    }));
    const legacyResult = { mode: "server-research", summary: "preserved result summary", suggestedFields: { productName: "나랑드사이다 제로 500 ml" },
      preflightAssetLineage: { portrait: { auditMode: "source-photo-catalog" } }, asset_storage_paths: { portrait: "unchanged/path.png" } };
    const request = { research_input: "same six photos", source_photo_sha256: "a".repeat(64), image_paths: ["original1"], image_specs: [{ role: "main" }] };
    for (const [id, result] of [[modernJob, { ...legacyResult, sourcePhotoEvidence }], [legacyJob, legacyResult]]) {
      await db.query(`insert into sellerpilot_private.ai_cli_jobs values ($1,'product_research','succeeded',$2,$3,$4,'2026-09-14T05:00:00Z')`, [id, owner, request, result]);
    }
    await db.query(`insert into sellerpilot_private.first_draft_image_requests values ($1,$2,'generating',2,3)`, [modernJob,owner]);
    const identity = async (uid, isAdmin) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.is_admin',$2,false)", [uid, String(isAdmin)]);
    };
    const recover = async (id) => (await db.query("select public.sellerpilot_get_product_research_recovery($1) as value", [id])).rows[0].value;
    await identity(owner, true);
    await db.exec("set local role authenticated");
    const modern = await recover(modernJob);
    assert.equal(modern.result.sourcePhotoEvidence.length, 6);
    assert.deepEqual(modern.result.sourcePhotoEvidence, sourcePhotoEvidence, "all per-photo fields, ordering and digests are preserved");
    assert.deepEqual(modern.firstDraftGeneration, { status: "generating", attempts: 2, maxAttempts: 3, exhausted: false });
    const legacy = await recover(legacyJob);
    assert.equal(Object.hasOwn(legacy.result, "sourcePhotoEvidence"), false, "legacy omission is not converted into null");
    const { sourcePhotoEvidence: returnedEvidence, ...modernUnchanged } = modern.result;
    assert.deepEqual(modernUnchanged, legacy.result, "only the optional evidence field changes");
    assert.deepEqual(modern.request, { jobId: modernJob, researchInput: request.research_input,
      sourcePhotoFingerprint: request.source_photo_sha256, imagePaths: request.image_paths, imageSpecs: request.image_specs });
    await identity(otherOwner, true);
    assert.equal(await recover(modernJob), null, "another administrator cannot read an owner's research");
    const expectDenied = async (uid, isAdmin) => {
      await identity(uid, isAdmin);
      await db.exec("savepoint denied_call");
      await assert.rejects(recover(modernJob), (error) => error.code === "42501");
      await db.exec("rollback to savepoint denied_call; release savepoint denied_call");
    };
    await expectDenied(owner, false);
    await expectDenied("", true);
    await identity(owner, true);
    await db.exec("set local role anon; savepoint anon_call");
    await assert.rejects(recover(modernJob), (error) => error.code === "42501");
    await db.exec("rollback to savepoint anon_call; release savepoint anon_call; reset role; rollback");
    assert.equal((await db.query("select count(*)::integer n from sellerpilot_private.ai_cli_jobs")).rows[0].n, 0);
    await assert.rejects(db.exec(migration), /recovery function changed/);
    await db.exec("rollback");
    assert.deepEqual(await metadata(), newMetadata, "guard rejection does not mutate the already-updated function");
  } finally {
    await db.close();
  }
});
