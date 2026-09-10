import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { isValidElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { chromium, type Browser } from "playwright-core";
import ts from "typescript";
import { build } from "vite";
import { z } from "zod";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import * as supplementalContract from "../lib/cs/channels/lazada/supplemental-contract";
import {
  ingestLazadaSupplementalProviderPage,
  lazadaSupplementalProviderSyncRequestSchema,
} from "../lib/cs/channels/lazada/supplemental-provider-ingest";
import {
  lazadaSupplementalResyncRequestSchema,
  resyncLazadaSupplementalProviderPage,
} from "../lib/cs/channels/lazada/supplemental-provider-resync";
import * as uiContracts from "../lib/cs/channels/lazada/supplemental-ui-workflow";

const [syncSource, resyncSource, uiSource, canonical, boundary, rounds, uiMigration, panelSource] = await Promise.all([
  readFile(new URL("../app/api/admin/cs/channels/lazada/supplemental/sync/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/cs/channels/lazada/supplemental/resync/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/cs/channels/lazada/supplemental/ui/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909181000_cs_lazada_supplemental_provider_ingest.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260909185000_cs_lazada_supplemental_resync_rounds.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260910051500_cs_lazada_supplemental_ui_scopes.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/cs/channels/lazada/supplemental-read.tsx", import.meta.url), "utf8"),
]);

const admin = "00000000-0000-4000-8000-000000010101";
const credential = "00000000-0000-4000-8000-000000010102";
const otherCredential = "00000000-0000-4000-8000-000000010103";
const binding = "00000000-0000-4000-8000-000000010104";
const otherBinding = "00000000-0000-4000-8000-000000010105";
const resyncRequestId = "00000000-0000-4000-8000-000000010106";
type RpcClient = { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> };

function loadRoute(source: string, userClient: RpcClient, serviceClient: RpcClient) {
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
    URLSearchParams,
    TextEncoder,
    JSON,
    Error,
    require: (name: string) => {
      if (name === "next/server") {
        return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      }
      if (name === "zod") return { z };
      if (name.endsWith("/admin-api")) {
        return {
          authenticateAdminRequest: async () => ({ user: { id: admin }, userClient, serviceClient }),
          isAdminApiError: () => false,
        };
      }
      if (name.endsWith("/supplemental-provider-ingest")) {
        return { ingestLazadaSupplementalProviderPage, lazadaSupplementalProviderSyncRequestSchema };
      }
      if (name.endsWith("/supplemental-provider-resync")) {
        return { lazadaSupplementalResyncRequestSchema, resyncLazadaSupplementalProviderPage };
      }
      if (name.endsWith("/supplemental-ui-workflow")) return uiContracts;
      if (name.endsWith("/supplemental-contract")) return supplementalContract;
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return moduleRecord.exports as {
    GET?(request: Request): Promise<Response>;
    POST?(request: Request): Promise<Response>;
  };
}

function loadControls() {
  const compiled = ts.transpileModule(panelSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    window: undefined,
    require: (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name.endsWith("/supplemental-ui-workflow")) return uiContracts;
      if (name.endsWith("/product-review-reply-composer")) {
        return { LazadaProductReviewReplyComposer: () => null };
      }
      if (name.endsWith(".module.css")) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`unexpected controls import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  return moduleRecord.exports.LazadaSupplementalReadControls as (props: Record<string, unknown>) => ReactNode;
}

function providerReview(id: string, body: string, options: {
  resourceId?: string;
  current?: number;
  pageSize?: number;
  total?: number;
} = {}) {
  const current = options.current ?? 1;
  const pageSize = options.pageSize ?? 20;
  const total = options.total ?? 1;
  return {
    code: "0",
    success: true,
    data: {
      current: String(current),
      page_size: String(pageSize),
      total: String(total),
      data: [{
        item_id: options.resourceId ?? "1001",
        order_id: "8001",
        ratings: { product_rating: "5" },
        reviews: [{
          id,
          create_time: String(1640970071000 + current * 1_000),
          review_type: "PRODUCT_REVIEW",
          review_content: body,
        }],
      }],
    },
  };
}

function collectElements(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean, result: ReactNode[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, result);
  } else if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if (predicate(props)) result.push(node);
    collectElements(props.children as ReactNode, predicate, result);
  }
  return result;
}

test("rendered admin controls drive actual GET/POST handlers and PGlite with replay-safe account lineage", async () => {
  const LazadaSupplementalReadControls = loadControls();
  const db = new PGlite({ extensions: { pgcrypto } });
  const attested = withLazadaProviderAccountIdentity({
    app_key: "ui-app", app_secret: "ui-secret", access_token: "ui-token", country: "my",
  }, {
    account_platform: "seller_center",
    country_user_info: [{ country: "my", seller_id: "300872000183", user_id: "200872000183" }],
  });
  const sellerKey = createHash("sha256")
    .update(["lazada", "production", attested.identity.subject].join("\u001f"), "utf8").digest("hex");
  const target = "c".repeat(64);
  const uiRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const actionBodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema sellerpilot_private; create schema extensions;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key);
      create table sellerpilot_private.admin_users(user_id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
        as $$select exists(select 1 from sellerpilot_private.admin_users where user_id=auth.uid())$$;
      create table sellerpilot_private.channel_credentials(
        id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
        version integer not null,fingerprint text not null,status text not null,expires_at timestamptz,
        seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz
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
    await db.exec(uiMigration);
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query("insert into sellerpilot_private.admin_users values($1)", [admin]);
    await db.query(`insert into sellerpilot_private.channel_credentials values
      ($1,$3,'lazada','production',1,'UI-A','active',clock_timestamp()+interval '1 day',$4,'provider_certified_v1',clock_timestamp()),
      ($2,$3,'lazada','production',2,'UI-B','active',clock_timestamp()+interval '1 day',$5,'provider_certified_v1',clock_timestamp())`,
    [credential, otherCredential, admin, sellerKey, "b".repeat(64)]);
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings values
      ($1,$3,'lazada','inquiries.list','MY',$5,'active',clock_timestamp()+interval '1 day'),
      ($2,$4,'lazada','inquiries.list','SG',$5,'active',clock_timestamp()+interval '1 day')`,
    [binding, otherBinding, credential, otherCredential, target]);
    await db.exec("set role service_role");
    await db.query(`select public.sellerpilot_service_record_lazada_supplemental_read_grant_v1(
      $1,$2::jsonb)`, [binding, JSON.stringify({
      contractVersion: "sellerpilot-lazada-supplemental-permission-readback/1",
      verificationSource: "lazada_app_permission_readback",
      providerRequestId: "ui-permission",
      providerEvidenceDigest: "d".repeat(64),
      bindingTargetFingerprint: target,
      credentialId: credential,
      sellerAccountKey: sellerKey,
      country: "MY",
      surface: "product_review",
      sourcePath: "/review/seller/list",
    })]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);

    const queryRpc = async (name: string, args: Record<string, unknown>, role: "authenticated" | "service_role") => {
      try {
        await db.exec(`set role ${role}`);
        const calls: Record<string, { sql: string; values: unknown[] }> = {
          sellerpilot_list_lazada_supplemental_ui_scopes_v1: {
            sql: "select public.sellerpilot_list_lazada_supplemental_ui_scopes_v1() value", values: [],
          },
          sellerpilot_read_lazada_supplemental_ui_scope_v1: {
            sql: "select public.sellerpilot_read_lazada_supplemental_ui_scope_v1($1,$2,$3,$4,$5) value",
            values: [args.p_credential_id, args.p_country, args.p_source_path, args.p_resource_id, args.p_limit],
          },
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
        const call = calls[name];
        if (!call) throw new Error(`unexpected RPC ${name}`);
        return { data: (await db.query(call.sql, call.values)).rows[0]?.value, error: null };
      } catch (error) {
        const row = error as { code?: string; message?: string };
        return { data: null, error: { code: row.code ?? "", message: row.message ?? String(error) } };
      } finally {
        await db.exec("reset role");
      }
    };
    const userClient: RpcClient = {
      rpc: async (name, args = {}) => {
        uiRpcCalls.push({ name, args });
        return queryRpc(name, args, "authenticated");
      },
    };
    const serviceClient: RpcClient = {
      rpc: async (name, args = {}) => {
        if (name === "sellerpilot_decrypt_credential") return { data: attested.payload, error: null };
        return queryRpc(name, args, "service_role");
      },
    };
    const ui = loadRoute(uiSource, userClient, serviceClient);
    const sync = loadRoute(syncSource, userClient, serviceClient);
    const resync = loadRoute(resyncSource, userClient, serviceClient);
    let loseNextResyncResponse = false;
    const authenticatedFetch = async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://sellerpilot.test");
      const request = new Request(url, init);
      if (init?.method === "POST") {
        actionBodies.push({ path: url.pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      }
      if (url.pathname.endsWith("/supplemental/ui")) return ui.GET!(request);
      if (url.pathname.endsWith("/supplemental/sync")) return sync.POST!(request);
      if (url.pathname.endsWith("/supplemental/resync")) {
        const response = await resync.POST!(request);
        if (loseNextResyncResponse) {
          loseNextResyncResponse = false;
          throw new Error("simulated response loss after commit");
        }
        return response;
      }
      throw new Error(`unexpected path ${url.pathname}`);
    };
    const originalFetch = globalThis.fetch;
    const providerResponses: Array<{ body: unknown; status: number }> = [
      { body: providerReview("9001", "first UI round"), status: 200 },
      { body: providerReview("9002", "second UI round"), status: 200 },
    ];
    let providerFetches = 0;
    globalThis.fetch = (async () => {
      const response = providerResponses[providerFetches++];
      if (!response) throw new Error("unexpected provider fetch");
      return Response.json(response.body, { status: response.status });
    }) as typeof fetch;
    try {
      const scopes = await uiContracts.fetchLazadaSupplementalUiScopes(authenticatedFetch);
      assert.deepEqual(scopes.accounts.map((account) => account.label), ["Lazada 운영 v1 · UI-A", "Lazada 운영 v2 · UI-B"]);
      const authorized = scopes.accounts[0].scopes.find((scope) => scope.sourcePath === "/review/seller/list")!;
      assert.equal(authorized.permissionState, "authorized");
      const selection = {
        credentialId: credential,
        country: "MY" as const,
        surface: "product_review" as const,
        sourcePath: "/review/seller/list" as const,
        resourceId: "1001",
        pageSize: 20,
      };
      const workflow = uiContracts.createLazadaSupplementalUiWorkflow(
        authenticatedFetch, uiContracts.createLazadaSupplementalMemoryStore(), () => resyncRequestId,
      );
      workflow.activate(selection);
      const operations: Array<ReturnType<typeof workflow.execute>> = [];
      const controls = LazadaSupplementalReadControls({
        scopes,
        fields: selection,
        state: null,
        busy: false,
        error: "",
        message: "",
        onAccount() {}, onCountry() {}, onSurface() {}, onSourcePath() {}, onResource() {},
        onRefresh() {},
        onAction() { operations.push(workflow.execute(selection)); },
      });
      const html = renderToStaticMarkup(controls);
      assert.match(html, /Lazada 운영 v1 · UI-A/);
      assert.match(html, /상품 리뷰 목록/);
      assert.match(html, /실행 가능한 읽기 권한/);
      assert.doesNotMatch(html, /grantId|답글 보내기|환불 승인/u);
      const action = collectElements(controls, (props) => props["data-lazada-supplemental-action"] === "true")[0];
      assert.ok(isValidElement(action));
      (action.props as { onClick(): void }).onClick();
      (action.props as { onClick(): void }).onClick();
      assert.equal(operations.length, 2);
      assert.equal(operations[0], operations[1], "double-click must coalesce to one exact-scope operation");
      const first = await operations[0];
      assert.equal(first.status, "applied");
      if (first.status !== "applied") throw new Error("first state not applied");
      assert.equal(first.state.credentialId, credential);
      assert.equal(first.state.progress?.runNumber, 1);
      assert.equal(first.state.progress?.complete, true);
      assert.equal(first.state.events[0]?.body, "first UI round");
      assert.equal(providerFetches, 1);
      assert.equal(actionBodies.filter((call) => call.path.endsWith("/sync")).length, 1);

      loseNextResyncResponse = true;
      await assert.rejects(workflow.execute(selection), /simulated response loss/u);
      assert.equal(providerFetches, 2, "the lost response occurs after the resync commit");
      const lostBody = actionBodies.at(-1)!.body;
      assert.equal(lostBody.startRequestId, resyncRequestId);
      assert.equal("mode" in lostBody, false, "strict resync route body must not receive UI storage metadata");
      const recovered = await workflow.execute(selection);
      assert.equal(recovered.status, "applied");
      if (recovered.status !== "applied") throw new Error("recovered state not applied");
      assert.equal(recovered.state.progress?.runNumber, 2);
      assert.equal(recovered.state.progress?.complete, true);
      assert.equal(recovered.state.events.length, 2);
      assert.equal(providerFetches, 2, "same request ID replay must not repeat provider read");
      const resyncBodies = actionBodies.filter((call) => call.path.endsWith("/resync")).map((call) => call.body);
      assert.equal(resyncBodies.length, 2);
      assert.deepEqual(resyncBodies.map((body) => body.startRequestId), [resyncRequestId, resyncRequestId]);
      assert.deepEqual(resyncBodies.map((body) => body.completedContinuationId),
        [first.state.progress?.continuationId, first.state.progress?.continuationId]);
      assert.deepEqual(resyncBodies.map((body) => body.expectedCompletedRevision),
        [first.state.progress?.revision, first.state.progress?.revision]);

      providerResponses.push(
        { body: providerReview("9101", "initial continuation page", {
          resourceId: "1002", current: 1, pageSize: 1, total: 2,
        }), status: 200 },
        { body: { code: "ProviderUnavailable", message: "no write" }, status: 500 },
        { body: providerReview("9102", "retried continuation page", {
          resourceId: "1002", current: 2, pageSize: 1, total: 2,
        }), status: 200 },
      );
      const continuationSelection = { ...selection, resourceId: "1002", pageSize: 1 };
      const continuationRequestIds = [
        "00000000-0000-4000-8000-000000010110",
        "00000000-0000-4000-8000-000000010111",
      ];
      const continuationStore = uiContracts.createLazadaSupplementalMemoryStore();
      const continuationWorkflow = uiContracts.createLazadaSupplementalUiWorkflow(
        authenticatedFetch, continuationStore, () => continuationRequestIds.shift()!,
      );
      continuationWorkflow.activate(continuationSelection);
      const initialPage = await continuationWorkflow.execute(continuationSelection);
      assert.equal(initialPage.status, "applied");
      if (initialPage.status !== "applied") throw new Error("initial continuation state not applied");
      assert.equal(initialPage.state.progress?.complete, false);
      assert.equal(initialPage.state.progress?.pageNumber, 2);
      assert.equal(initialPage.state.progress?.revision, 1);
      const initialContinuationId = initialPage.state.progress?.continuationId;
      await assert.rejects(continuationWorkflow.execute(continuationSelection), /HTTP_502/u);
      const unchangedAfterNoWrite = await uiContracts.fetchLazadaSupplementalUiScope(
        authenticatedFetch, continuationSelection,
      );
      assert.equal(unchangedAfterNoWrite.progress?.continuationId, initialContinuationId);
      assert.equal(unchangedAfterNoWrite.progress?.revision, 1);
      assert.equal(unchangedAfterNoWrite.progress?.pageNumber, 2);
      assert.equal(unchangedAfterNoWrite.progress?.complete, false);
      const retry = await continuationWorkflow.execute(continuationSelection);
      assert.equal(retry.status, "applied");
      if (retry.status !== "applied") throw new Error("continuation retry state not applied");
      assert.equal(retry.replayRecovered, false);
      assert.equal(retry.state.progress?.continuationId, initialContinuationId);
      assert.equal(retry.state.progress?.revision, 2);
      assert.equal(retry.state.progress?.complete, true);
      assert.equal(retry.state.events.length, 2);
      assert.equal(providerFetches, 5);
      const continuationPosts = actionBodies.filter((call) => call.path.endsWith("/sync")
        && call.body.resourceId === "1002");
      assert.equal(continuationPosts.length, 3, "initial page, no-write attempt and same pending retry must all POST");
      assert.equal(continuationRequestIds.length, 0, "the retry must reuse pending ownership without allocating a third ID");

      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const delayedFetch: typeof authenticatedFetch = async (input, init) => {
        const response = await authenticatedFetch(input, init);
        if (String(input).includes(`credentialId=${credential}`)) await gate;
        return response;
      };
      const staleWorkflow = uiContracts.createLazadaSupplementalUiWorkflow(
        delayedFetch, uiContracts.createLazadaSupplementalMemoryStore(),
      );
      staleWorkflow.activate(selection);
      const staleRead = staleWorkflow.refresh(selection);
      const otherSelection = {
        credentialId: otherCredential,
        country: "SG" as const,
        surface: "product_review" as const,
        sourcePath: "/review/seller/list" as const,
        resourceId: "1001",
        pageSize: 20,
      };
      staleWorkflow.activate(otherSelection);
      release();
      assert.deepEqual(await staleRead, { status: "stale" });

      const blockedControls = LazadaSupplementalReadControls({
        scopes,
        fields: otherSelection,
        state: null,
        busy: false,
        error: "",
        message: "",
        onAccount() {}, onCountry() {}, onSurface() {}, onSourcePath() {}, onResource() {},
        onRefresh() {}, onAction() { throw new Error("blocked action invoked"); },
      });
      const blockedHtml = renderToStaticMarkup(blockedControls);
      assert.match(blockedHtml, /실행 차단/);
      assert.match(blockedHtml, /disabled="" data-lazada-supplemental-action="true"/u);
      assert.doesNotMatch(panelSource, /setInterval|setTimeout|reply\/add|return\/update|cancel\/create/u);
      assert.match(panelSource, /<LazadaSupplementalReadControls/u);
      assert.ok(uiRpcCalls.some((call) => call.name === "sellerpilot_read_lazada_supplemental_ui_scope_v1"
        && call.args.p_credential_id === credential && call.args.p_country === "MY"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await db.close();
  }
});

test("UI read route rejects caller-added scope fields before its read-only RPC", async () => {
  let calls = 0;
  const client: RpcClient = {
    rpc: async () => { calls += 1; return { data: null, error: null }; },
  };
  const ui = loadRoute(uiSource, client, client);
  const response = await ui.GET!(new Request(
    `https://sellerpilot.test/api/admin/cs/channels/lazada/supplemental/ui?view=scope&credentialId=${credential}`
      + "&country=MY&sourcePath=%2Freview%2Fseller%2Flist&resourceId=1001&limit=50&grantId=forged",
  ));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.doesNotMatch(uiSource, /fetch\(|reply\/add|return\/update|cancel\/create/u);
});

const pendingProbeSelection = {
  credentialId: "00000000-0000-4000-8000-000000010201",
  country: "SG" as const,
  surface: "product_review" as const,
  sourcePath: "/review/seller/list" as const,
  resourceId: "1",
  pageSize: 20,
};
const pendingProbeProgress = {
  continuationId: "00000000-0000-4000-8000-000000010202",
  revision: 1,
  pageNumber: 2,
  runNumber: 1,
  complete: false,
  startRequestId: null,
  parentContinuationId: null,
  parentRevision: null,
  updatedAt: "2026-09-09T21:00:00.000Z",
};
const pendingProbeState = {
  contractVersion: "sellerpilot-lazada-supplemental-ui-scope/1" as const,
  checkedAt: "2026-09-09T21:00:00.000Z",
  credentialId: pendingProbeSelection.credentialId,
  accountLabel: "account",
  country: "SG" as const,
  surface: "product_review" as const,
  sourcePath: "/review/seller/list" as const,
  resourceId: "1",
  permissionState: "authorized" as const,
  progress: pendingProbeProgress,
  events: [],
  automaticReadEnabled: false as const,
  replyEnabled: false as const,
  mutationAllowed: false as const,
};

test("unchanged initial continuation retries after a no-write failure instead of false recovery", async () => {
  const store = uiContracts.createLazadaSupplementalMemoryStore();
  let posts = 0;
  const workflow = uiContracts.createLazadaSupplementalUiWorkflow(async (_input, init) => {
    if (init?.method === "POST") {
      posts += 1;
      return Response.json({ code: "NO_WRITE" }, { status: 503 });
    }
    return Response.json(pendingProbeState);
  }, store, () => "00000000-0000-4000-8000-000000010203");
  workflow.activate(pendingProbeSelection);
  await assert.rejects(workflow.execute(pendingProbeSelection), /HTTP_503/u);
  const stored = store.read(uiContracts.lazadaSupplementalUiScopeKey(pendingProbeSelection));
  assert.deepEqual(stored, {
    mode: "sync",
    requestId: "00000000-0000-4000-8000-000000010203",
    baseline: {
      continuationId: pendingProbeProgress.continuationId,
      revision: 1,
      pageNumber: 2,
      runNumber: 1,
      complete: false,
    },
  });
  await assert.rejects(workflow.execute(pendingProbeSelection), /HTTP_503/u);
  assert.equal(posts, 2);
  assert.deepEqual(store.read(uiContracts.lazadaSupplementalUiScopeKey(pendingProbeSelection)), stored);
});

test("late old success and failure cannot compare-and-clear a newer same-scope request owner", async () => {
  for (const outcome of ["success", "failure"] as const) {
    const store = uiContracts.createLazadaSupplementalMemoryStore();
    let resolvePost!: (response: Response) => void;
    let rejectPost!: (error: Error) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const post = new Promise<Response>((resolve, reject) => { resolvePost = resolve; rejectPost = reject; });
    const oldWorkflow = uiContracts.createLazadaSupplementalUiWorkflow(async (_input, init) => {
      if (init?.method === "POST") {
        signalStarted();
        return post;
      }
      return Response.json(pendingProbeState);
    }, store, () => "00000000-0000-4000-8000-000000010204");
    oldWorkflow.activate(pendingProbeSelection);
    const oldOperation = oldWorkflow.execute(pendingProbeSelection);
    await started;
    oldWorkflow.activate(null);
    const replacement = {
      mode: "resync" as const,
      requestId: "00000000-0000-4000-8000-000000010205",
      startRequestId: "00000000-0000-4000-8000-000000010205",
      completedContinuationId: pendingProbeProgress.continuationId,
      expectedCompletedRevision: 2,
    };
    const scopeKey = uiContracts.lazadaSupplementalUiScopeKey(pendingProbeSelection);
    store.write(scopeKey, replacement);
    if (outcome === "success") {
      resolvePost(Response.json({
        contractVersion: "sellerpilot-lazada-supplemental-page-ingest/1",
        continuationId: pendingProbeProgress.continuationId,
        revision: 2,
        complete: true,
      }));
      assert.equal((await oldOperation).status, "stale");
    } else {
      rejectPost(new Error("old response lost"));
      await assert.rejects(oldOperation, /old response lost/u);
    }
    assert.deepEqual(store.read(scopeKey), replacement);
  }
});

const repositoryRoot = new URL("..", import.meta.url);

async function firstBrowserExecutable(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit local browser candidates.
    }
  }
  return null;
}

function panelSessionFixtureSource() {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LazadaSupplementalReadPanel } from "../../app/cs/channels/lazada/supplemental-read.tsx";

const credentialId = "00000000-0000-4000-8000-000000010102";
const pending = [];
const calls = [];
const fetchers = new Map();

function scopesBody(label) {
  return {
    contractVersion: "sellerpilot-lazada-supplemental-ui-scopes/1",
    checkedAt: "2026-09-09T20:00:00.000Z",
    accounts: [{ credentialId, label, scopes: [{
      country: "MY", surface: "product_review", sourcePath: "/review/seller/list",
      permissionState: "authorized", resourceRequired: true, resourceLabel: "Lazada 상품 Item ID",
      message: "fixture authorized",
    }] }],
    automaticReadEnabled: false, replyEnabled: false, mutationAllowed: false,
  };
}

function scopeBody(label, progress = null) {
  return {
    contractVersion: "sellerpilot-lazada-supplemental-ui-scope/1",
    checkedAt: "2026-09-09T20:00:00.000Z",
    credentialId, accountLabel: label, country: "MY", surface: "product_review",
    sourcePath: "/review/seller/list", resourceId: "1001", permissionState: "authorized",
    progress, events: [], automaticReadEnabled: false, replyEnabled: false, mutationAllowed: false,
  };
}

function fetcherFor(session) {
  if (!fetchers.has(session)) fetchers.set(session, (input, init = {}) => new Promise((resolve, reject) => {
    const call = { session, input: String(input), method: init.method || "GET", body: init.body || "" };
    calls.push(call);
    pending.push({ ...call, resolve, reject });
  }));
  return fetchers.get(session);
}

function take(session, includes) {
  const index = pending.findIndex((entry) => entry.session === session && entry.input.includes(includes));
  if (index < 0) throw new Error("pending call not found: " + session + " " + includes);
  return pending.splice(index, 1)[0];
}

function Fixture() {
  const [session, setSession] = useState("A");
  const [mounted, setMounted] = useState(true);
  globalThis.testHarness = {
    switchSession: setSession,
    mount: () => setMounted(true),
    unmount: () => setMounted(false),
    scopesBody,
    scopeBody,
    resolve(sessionName, includes, body, status = 200) {
      take(sessionName, includes).resolve(Response.json(body, { status }));
    },
    reject(sessionName, includes, message) {
      take(sessionName, includes).reject(new Error(message));
    },
    pendingCount(sessionName, includes) {
      return pending.filter((entry) => entry.session === sessionName && entry.input.includes(includes)).length;
    },
    calls: () => calls.slice(),
    storageSize: () => sessionStorage.length,
  };
  return <main data-session={session}>
    {mounted ? <LazadaSupplementalReadPanel authenticatedFetch={fetcherFor(session)} /> : <p data-unmounted>unmounted</p>}
  </main>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

async function buildPanelSessionFixture(workspace: string) {
  const fixtureRoot = join(workspace, "fixture");
  const output = join(workspace, "dist");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(join(fixtureRoot, "index.html"),
    '<!doctype html><html lang="ko"><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>');
  await writeFile(join(fixtureRoot, "src.tsx"), panelSessionFixtureSource());
  await build({
    root: fixtureRoot,
    base: "./",
    logLevel: "silent",
    build: { outDir: output, emptyOutDir: true },
  });
  return output;
}

async function servePanelSessionFixture(output: string) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.local").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) return void response.writeHead(400).end();
    void readFile(join(output, relativePath)).then((content) => {
      const contentType = relativePath.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" }).end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a local port");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

type BrowserHarness = {
  switchSession(session: string): void;
  mount(): void;
  unmount(): void;
  scopesBody(label: string): unknown;
  scopeBody(label: string, progress?: unknown): unknown;
  resolve(session: string, includes: string, body: unknown, status?: number): void;
  reject(session: string, includes: string, message: string): void;
  pendingCount(session: string, includes: string): number;
  calls(): Array<{ session: string; input: string; method: string; body: string }>;
  storageSize(): number;
};

test("actual panel isolates fetcher sessions, unmounts late work and preserves response-loss replay", {
  timeout: 90_000,
}, async () => {
  const executablePath = await firstBrowserExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "Lazada panel session test requires a local Chrome executable");
  const workspace = await mkdtemp(join(new URL(".", repositoryRoot).pathname, ".tmp-lazada-panel-session-"));
  const profile = await mkdtemp(join(tmpdir(), "sellerpilot-lazada-panel-profile-"));
  let browser: Browser | undefined;
  let server: Server | undefined;
  try {
    const output = await buildPanelSessionFixture(workspace);
    const fixture = await servePanelSessionFixture(output);
    server = fixture.server;
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
    });
    const page = await browser.newPage();
    const browserErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    await page.route(/^https?:\/\//, (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === "127.0.0.1" || host === "localhost") void route.continue();
      else void route.abort();
    });
    await page.goto(fixture.url, { waitUntil: "load" });
    const switchSession = (session: string) => page.evaluate((nextSession) =>
      (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness.switchSession(nextSession), session);
    const rejectCall = (session: string, includes: string, message: string) => page.evaluate(
      ([sessionName, match, errorMessage]) =>
        (globalThis as typeof globalThis & { testHarness: BrowserHarness })
          .testHarness.reject(sessionName, match, errorMessage),
      [session, includes, message],
    );
    const storageSize = () => page.evaluate(() =>
      (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness.storageSize());
    const allCalls = () => page.evaluate(() =>
      (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness.calls());
    const pending = (session: string, includes: string) => page.waitForFunction(
      ([sessionName, match]) => (globalThis as typeof globalThis & { testHarness: BrowserHarness })
        .testHarness.pendingCount(sessionName, match) === 1,
      [session, includes],
    );
    const openPanel = async () => page.evaluate(() => {
      const details = document.querySelector("details");
      if (!details?.open) details?.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const resolveScopes = async (session: string, label: string) => page.evaluate(
      ([sessionName, accountLabel]) => {
        const harness = (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness;
        harness.resolve(sessionName, "view=scopes", harness.scopesBody(accountLabel));
      },
      [session, label],
    );

    await openPanel();
    await pending("A", "view=scopes");
    await switchSession("B");
    await page.locator('main[data-session="B"]').waitFor();
    await openPanel();
    await pending("B", "view=scopes");
    await resolveScopes("A", "OLD-A");
    await page.waitForTimeout(30);
    assert.match(await page.locator("main").innerText(), /연결 범위 확인 중/u);
    assert.doesNotMatch(await page.locator("main").innerText(), /OLD-A/u);
    await resolveScopes("B", "SESSION-B");
    await page.getByLabel("Lazada 연결 계정").waitFor();
    assert.match(await page.locator("main").innerText(), /SESSION-B/u);

    await page.getByLabel("Lazada 상품 Item ID").fill("1001");
    await page.locator('[data-lazada-supplemental-refresh="true"]').click();
    await pending("B", "view=scope");
    await switchSession("C");
    await page.locator('main[data-session="C"]').waitFor();
    await openPanel();
    await pending("C", "view=scopes");
    await rejectCall("B", "view=scope", "late old refresh error");
    await page.waitForTimeout(30);
    assert.match(await page.locator("main").innerText(), /연결 범위 확인 중/u);
    assert.doesNotMatch(await page.locator("main").innerText(), /저장 상태를 불러오지 못했습니다/u);
    await resolveScopes("C", "SESSION-C");
    await page.getByLabel("Lazada 연결 계정").waitFor();

    await page.getByLabel("Lazada 상품 Item ID").fill("1001");
    await page.locator('[data-lazada-supplemental-action="true"]').click();
    await pending("C", "view=scope");
    await page.evaluate(() => {
      const harness = (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness;
      harness.resolve("C", "view=scope", harness.scopeBody("SESSION-C"));
    });
    await pending("C", "/supplemental/sync");
    assert.equal(await storageSize(), 1);
    await switchSession("D");
    await page.locator('main[data-session="D"]').waitFor();
    await openPanel();
    await pending("D", "view=scopes");
    await rejectCall("C", "/supplemental/sync", "response lost after provider commit");
    await page.waitForTimeout(30);
    assert.match(await page.locator("main").innerText(), /연결 범위 확인 중/u);
    assert.doesNotMatch(await page.locator("main").innerText(), /요청 결과를 확인하지 못했습니다/u);
    assert.equal(await storageSize(), 1);

    await page.evaluate(() =>
      (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness.unmount());
    await page.locator("[data-unmounted]").waitFor();
    await resolveScopes("D", "LATE-D");
    await page.waitForTimeout(30);
    assert.equal(await page.locator("details").count(), 0);
    await page.evaluate(() => {
      const harness = (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness;
      harness.switchSession("E");
      harness.mount();
    });
    await page.locator('main[data-session="E"]').waitFor();
    await page.locator("details").waitFor();
    await openPanel();
    await pending("E", "view=scopes");
    await resolveScopes("E", "SESSION-E");
    await page.getByLabel("Lazada 상품 Item ID").fill("1001");
    await page.locator('[data-lazada-supplemental-action="true"]').click();
    await pending("E", "view=scope");
    await page.evaluate(() => {
      const harness = (globalThis as typeof globalThis & { testHarness: BrowserHarness }).testHarness;
      harness.resolve("E", "view=scope", harness.scopeBody("SESSION-E", {
        continuationId: "00000000-0000-4000-8000-000000010190",
        revision: 1, pageNumber: 1, runNumber: 1, complete: true,
        startRequestId: null, parentContinuationId: null, parentRevision: null,
        updatedAt: "2026-09-09T20:20:00.000Z",
      }));
    });
    await page.getByText(/같은 요청 ID로 안전하게 복구했습니다/u).waitFor();
    assert.equal(await storageSize(), 0);
    const calls = await allCalls();
    assert.equal(calls.filter((call) => call.session === "C" && call.input.includes("/supplemental/sync")).length, 1);
    assert.equal(calls.filter((call) => call.session === "E" && call.method === "POST").length, 0);
    assert.deepEqual(browserErrors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await rm(workspace, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
