import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import ts from "typescript";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import {
  ingestLazadaSupplementalProviderPage,
  lazadaSupplementalProviderSyncRequestSchema,
} from "../lib/cs/channels/lazada/supplemental-provider-ingest";
import {
  lazadaSupplementalResyncRequestSchema,
  resyncLazadaSupplementalProviderPage,
} from "../lib/cs/channels/lazada/supplemental-provider-resync";

const syncSource = await readFile(new URL(
  "../app/api/admin/cs/channels/lazada/supplemental/sync/route.ts", import.meta.url,
), "utf8");
const resyncSource = await readFile(new URL(
  "../app/api/admin/cs/channels/lazada/supplemental/resync/route.ts", import.meta.url,
), "utf8");
const canonical = await readFile(new URL(
  "../supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql", import.meta.url,
), "utf8");
const boundary = await readFile(new URL(
  "../supabase/migrations/20260909181000_cs_lazada_supplemental_provider_ingest.sql", import.meta.url,
), "utf8");
const rounds = await readFile(new URL(
  "../supabase/migrations/20260909185000_cs_lazada_supplemental_resync_rounds.sql", import.meta.url,
), "utf8");
const admin = "00000000-0000-4000-8000-000000009101";
const credential = "00000000-0000-4000-8000-000000009102";
const binding = "00000000-0000-4000-8000-000000009103";
const startRequestId = "00000000-0000-4000-8000-000000009104";

function loadRoute(source: string, serviceClient: { rpc(name: string, args: Record<string, unknown>): Promise<unknown> }) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    Request,
    Response,
    URL,
    TextEncoder,
    JSON,
    Error,
    require: (name: string) => {
      if (name === "next/server") {
        return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      }
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({ user: { id: admin }, serviceClient }),
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/supplemental-provider-ingest")) {
        return { ingestLazadaSupplementalProviderPage, lazadaSupplementalProviderSyncRequestSchema };
      }
      if (name.endsWith("/supplemental-provider-resync")) {
        return { lazadaSupplementalResyncRequestSchema, resyncLazadaSupplementalProviderPage };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return moduleRecord.exports as { POST(request: Request): Promise<Response> };
}

function post(path: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return new Request(`https://sellerpilot.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(raw.length) },
    body: raw,
  });
}

function providerReview(id: string, body: string) {
  return {
    code: "0",
    success: true,
    data: {
      current: "1",
      page_size: "20",
      total: "1",
      data: [{
        item_id: "1001",
        order_id: "8001",
        ratings: { product_rating: "5" },
        reviews: [{
          id,
          create_time: id === "9001" ? "1640970071000" : "1640971071000",
          review_type: "PRODUCT_REVIEW",
          review_content: body,
        }],
      }],
    },
  };
}

test("actual POST rejects stale begin identity before fetch/write, then resync and replay remain correct", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const attested = withLazadaProviderAccountIdentity({
    app_key: "route-app",
    app_secret: "route-secret",
    access_token: "route-token",
    country: "my",
  }, {
    account_platform: "seller_center",
    country_user_info: [{ country: "my", seller_id: "300872000183", user_id: "200872000183" }],
  });
  const sellerKey = createHash("sha256")
    .update(["lazada", "production", attested.identity.subject].join("\u001f"), "utf8").digest("hex");
  const target = "c".repeat(64);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private; create schema extensions;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key);
      create table sellerpilot_private.admin_users(user_id uuid primary key);
      create function public.sellerpilot_is_admin() returns boolean language sql stable as $$select false$$;
      create table sellerpilot_private.channel_credentials(
        id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
        status text not null,expires_at timestamptz,seller_account_key text,
        seller_account_key_source text,seller_account_verified_at timestamptz
      );
      create table sellerpilot_private.cs_credential_capability_bindings(
        id uuid primary key,credential_id uuid not null references sellerpilot_private.channel_credentials(id),
        channel text not null,operation text not null,country text not null,target_fingerprint text not null,
        status text not null,expires_at timestamptz
      );
    `);
    await db.exec(canonical);
    await db.exec(boundary);
    await db.exec(rounds);
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query("insert into sellerpilot_private.admin_users values($1)", [admin]);
    await db.query(`insert into sellerpilot_private.channel_credentials values(
      $1,$2,'lazada','production','active',clock_timestamp()+interval '1 day',$3,
      'provider_certified_v1',clock_timestamp())`, [credential, admin, sellerKey]);
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values(
      $1,$2,'lazada','inquiries.list','MY',$3,'active',clock_timestamp()+interval '1 day')`,
    [binding, credential, target]);
    await db.exec("set role service_role");
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify({
      contractVersion: "sellerpilot-lazada-supplemental-permission-readback/1",
      verificationSource: "lazada_app_permission_readback",
      providerRequestId: "route-permission",
      providerEvidenceDigest: "d".repeat(64),
      bindingTargetFingerprint: target,
      credentialId: credential,
      sellerAccountKey: sellerKey,
      country: "MY",
      surface: "product_review",
      sourcePath: "/review/seller/list",
    })]);

    let corruptNextBeginSnapshot: Record<string, unknown> | null = null;
    let credentialReadCount = 0;
    let interleaveBeforeNextPrepare = false;
    let interleavedBegunRound: Record<string, unknown> | null = null;
    const serviceClient = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        try {
          if (name === "sellerpilot_decrypt_credential") {
            credentialReadCount += 1;
            return { data: attested.payload, error: null };
          }
          if (name === "sellerpilot_service_prepare_lazada_supplemental_read_v1"
              && interleaveBeforeNextPrepare && interleavedBegunRound) {
            interleaveBeforeNextPrepare = false;
            const completedByOtherRequest = (await db.query(`select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
              $1,$2,$3,'MY','product_review','/review/seller/list','1001',1,20,$4::jsonb,$5::jsonb
            ) value`, [
              interleavedBegunRound.continuationId,
              interleavedBegunRound.revision,
              credential,
              JSON.stringify([{
                credentialId: credential,
                country: "MY",
                surface: "product_review",
                sourcePath: "/review/seller/list",
                resourceKey: "9003",
                eventKey: "f".repeat(64),
                status: "published",
                title: "상품 리뷰 · 평점 5",
                body: "completed by other request",
                externalOrderId: "8001",
                externalItemId: "1001",
                rating: 5,
                occurredAt: "2026-09-09T18:00:00.000Z",
                observedAt: "2026-09-09T18:20:00.000Z",
                providerContext: { reviewId: "9003", itemId: "1001" },
              }]),
              JSON.stringify({
                contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
                kind: "provider_page",
                pageNumber: 1,
                pageSize: 20,
                total: 1,
                entryCount: 1,
                hasMore: false,
                nextPage: null,
              }),
            ])).rows[0]?.value as Record<string, unknown>;
            await db.query(`select public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
              $1,$2,$3,$4,'MY','/review/seller/list','1001',20,$5
            )`, [
              admin,
              completedByOtherRequest.continuationId,
              completedByOtherRequest.revision,
              credential,
              "00000000-0000-4000-8000-000000009107",
            ]);
          }
          const signatures: Record<string, { sql: string; values: unknown[] }> = {
            sellerpilot_service_prepare_lazada_supplemental_read_v1: {
              sql: "select public.sellerpilot_service_prepare_lazada_supplemental_read_v1($1,$2,$3,$4,$5) value",
              values: [args.p_credential_id, args.p_country, args.p_source_path, args.p_resource_id, args.p_page_size],
            },
            sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1: {
              sql: `select public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb) value`,
              values: [args.p_continuation_id, args.p_expected_revision, args.p_credential_id,
                args.p_country, args.p_surface, args.p_source_path, args.p_resource_id,
                args.p_page_number, args.p_page_size, JSON.stringify(args.p_rows), JSON.stringify(args.p_pagination)],
            },
            sellerpilot_service_begin_lazada_supplemental_resync_v1: {
              sql: `select public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
                $1,$2,$3,$4,$5,$6,$7,$8,$9) value`,
              values: [args.p_actor_id, args.p_completed_continuation_id, args.p_expected_completed_revision,
                args.p_credential_id, args.p_country, args.p_source_path, args.p_resource_id,
                args.p_page_size, args.p_start_request_id],
            },
          };
          const call = signatures[name];
          if (!call) throw new Error(`unexpected RPC ${name}`);
          const data = (await db.query(call.sql, call.values)).rows[0]?.value as Record<string, unknown>;
          if (name === "sellerpilot_service_begin_lazada_supplemental_resync_v1"
              && interleaveBeforeNextPrepare) {
            interleavedBegunRound = data;
          }
          if (name === "sellerpilot_service_begin_lazada_supplemental_resync_v1"
              && corruptNextBeginSnapshot) {
            const corruption = corruptNextBeginSnapshot;
            corruptNextBeginSnapshot = null;
            return {
              data: { ...data, ...corruption },
              error: null,
            };
          }
          return { data, error: null };
        } catch (error) {
          const row = error as { code?: string; message?: string };
          return { data: null, error: { code: row.code ?? "", message: row.message ?? String(error) } };
        }
      },
    };
    const sync = loadRoute(syncSource, serviceClient);
    const resync = loadRoute(resyncSource, serviceClient);
    const originalFetch = globalThis.fetch;
    const providerBodies = [providerReview("9001", "first round"), providerReview("9002", "second round")];
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      const body = providerBodies[fetchCount];
      fetchCount += 1;
      if (!body) throw new Error("unexpected provider fetch");
      return Response.json(body);
    }) as typeof fetch;
    try {
      const firstResponse = await sync.POST(post(
        "/api/admin/cs/channels/lazada/supplemental/sync",
        { credentialId: credential, country: "MY", sourcePath: "/review/seller/list", resourceId: "1001", pageSize: 20 },
      ));
      assert.equal(firstResponse.status, 200);
      const firstReceipt = await firstResponse.json() as Record<string, unknown>;
      assert.equal(firstReceipt.complete, true);

      const resyncBody = {
        credentialId: credential,
        country: "MY",
        sourcePath: "/review/seller/list",
        resourceId: "1001",
        pageSize: 20,
        completedContinuationId: firstReceipt.continuationId,
        expectedCompletedRevision: firstReceipt.revision,
        startRequestId,
      };
      const staleSnapshots = [
        { continuationId: "00000000-0000-4000-8000-000000009199" },
        { revision: 1 },
        { pageNumber: 2 },
        { grantId: "00000000-0000-4000-8000-000000009198" },
        { sellerAccountKey: "e".repeat(64) },
        { surface: "reverse_order_after_sales" },
      ];
      for (const corruption of staleSnapshots) {
        corruptNextBeginSnapshot = corruption;
        const staleIdentityResponse = await resync.POST(post(
          "/api/admin/cs/channels/lazada/supplemental/resync", resyncBody,
        ));
        assert.equal(staleIdentityResponse.status, 409);
      }
      assert.equal(fetchCount, 1, "stale begin identity must fail before a second provider fetch");
      assert.equal(credentialReadCount, 1, "stale begin identity must fail before credential decryption");
      await db.exec("reset role");
      assert.equal(Number((await db.query(
        "select count(*) count from sellerpilot_private.lazada_supplemental_cs_events",
      )).rows[0]?.count), 1, "stale begin identity must not write a supplemental event");
      await db.exec("set role service_role");

      const secondResponse = await resync.POST(post(
        "/api/admin/cs/channels/lazada/supplemental/resync", resyncBody,
      ));
      assert.equal(secondResponse.status, 200);
      const secondReceipt = await secondResponse.json() as Record<string, unknown>;
      assert.equal(secondReceipt.complete, true);
      assert.equal(secondReceipt.providerRead, true);

      const replayResponse = await resync.POST(post(
        "/api/admin/cs/channels/lazada/supplemental/resync", resyncBody,
      ));
      assert.equal(replayResponse.status, 200);
      const replayReceipt = await replayResponse.json() as Record<string, unknown>;
      assert.equal(replayReceipt.providerRead, false);
      assert.equal(replayReceipt.beginReplayed, true);
      assert.equal(fetchCount, 2);

      const secondPage = secondReceipt.pageReceipt as Record<string, unknown>;
      interleaveBeforeNextPrepare = true;
      const interleavedResponse = await resync.POST(post(
        "/api/admin/cs/channels/lazada/supplemental/resync",
        {
          ...resyncBody,
          completedContinuationId: secondPage.continuationId,
          expectedCompletedRevision: secondPage.revision,
          startRequestId: "00000000-0000-4000-8000-000000009106",
        },
      ));
      assert.equal(interleavedResponse.status, 409);
      assert.equal(fetchCount, 2, "stale request must not fetch after another request starts the next round");
      assert.equal(credentialReadCount, 2, "stale request must not decrypt after another request starts the next round");
      await db.exec("reset role");
      assert.deepEqual((await db.query(`select resource_key from sellerpilot_private.lazada_supplemental_cs_events
        order by resource_key`)).rows, [
        { resource_key: "9001" },
        { resource_key: "9002" },
        { resource_key: "9003" },
      ]);
      await db.exec("set role service_role");

      await db.exec("reset role");
      await db.query("update sellerpilot_private.lazada_supplemental_read_grants set status='revoked' where credential_id=$1",
        [credential]);
      await db.exec("set role service_role");
      const deniedResponse = await resync.POST(post(
        "/api/admin/cs/channels/lazada/supplemental/resync",
        {
          ...resyncBody,
          completedContinuationId: secondPage.continuationId,
          expectedCompletedRevision: secondPage.revision,
          startRequestId: "00000000-0000-4000-8000-000000009105",
        },
      ));
      assert.equal(deniedResponse.status, 403);
      assert.equal(fetchCount, 2);
    } finally { globalThis.fetch = originalFetch; }
    await db.exec("reset role");
    const stored = (await db.query(`select resource_key,body
      from sellerpilot_private.lazada_supplemental_cs_events order by resource_key`)).rows;
    assert.deepEqual(stored, [
      { resource_key: "9001", body: "first round" },
      { resource_key: "9002", body: "second round" },
      { resource_key: "9003", body: "completed by other request" },
    ]);
  } finally { await db.close(); }
});
