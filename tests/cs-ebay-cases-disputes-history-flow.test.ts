import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import ts from "typescript";
import { recordEbayCaseDisputeHistoryPage } from "../lib/channels/cs/ebay/case-dispute-history";
import * as syncModule from "../lib/channels/cs/ebay/case-dispute-history-sync";
import {
  syncEbayPaymentDisputeHistory,
  syncEbayResolutionCaseHistoryWindow,
} from "../lib/channels/cs/ebay/case-dispute-history-sync";
import {
  ebayCaseDisputeHistoryPageSchema,
  ebayCaseDisputeHistoryQuerySchema,
  ebayCaseDisputeHistorySyncRequestSchema,
  ebayCaseDisputeHistorySyncResponseSchema,
  readEbayCaseDisputeHistoryUiResponse,
  syncEbayCaseDisputeHistoryUiResponse,
} from "../lib/cs/channels/ebay/case-dispute-history";
import * as pages from "../lib/channels/ebay-message-pages";
import * as identity from "../lib/channels/provider-account-identity";

const ledgerSql = await readFile(new URL(
  "../supabase/migrations/20260908135249_ebay_case_dispute_history_ledger.sql",
  import.meta.url,
), "utf8");
const readV2Sql = await readFile(new URL(
  "../supabase/migrations/20260908135323_ebay_case_dispute_history_read_v2.sql",
  import.meta.url,
), "utf8");
const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/ebay/cases-disputes/history/route.ts",
  import.meta.url,
), "utf8");
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const syncRouteSource = await readFile(new URL(
  "../app/api/admin/cs/channels/ebay/cases-disputes/history/sync/route.ts",
  import.meta.url,
), "utf8");
const compiledSyncRoute = ts.transpileModule(syncRouteSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const historyComponentSource = await readFile(new URL(
  "../app/cs/channels/ebay/case-dispute-history.tsx",
  import.meta.url,
), "utf8");

const owner = "40000000-0000-4000-8000-000000000001";
const credential = "50000000-0000-4000-8000-000000000001";
const providerSubject = "ebay:eias:history-flow-seller";
const sellerKey = crypto.createHash("sha256").update(["ebay", "production", providerSubject].join("\u001f")).digest("hex");
const caseEntry = {
  caseId: "flow-case-1",
  status: "OPEN",
  itemId: "flow-item-1",
  transactionId: "flow-transaction-1",
  creationDate: "2026-09-01T00:00:00.000Z",
  lastModifiedDate: "2026-09-02T00:00:00.000Z",
  respondByDate: null,
  claimAmount: { value: "31.00", currency: "USD" },
  sellerBinding: "matched" as const,
};
const disputeEntry = {
  paymentDisputeId: "flow-dispute-1",
  orderId: "flow-order-1",
  status: "ACTION_NEEDED",
  reason: "ITEM_NOT_RECOGNIZED",
  openDate: "2026-09-03T00:00:00.000Z",
  respondByDate: null,
  closedDate: null,
  amount: { value: "42.00", currency: "USD" },
};

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer
      as $$select auth.uid()='${owner}'::uuid$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key, created_by uuid references auth.users(id), channel text,
      environment text, status text, seller_account_key text, seller_account_key_source text,
      expires_at timestamptz,
      seller_account_verified_at timestamptz default now()
    );
    insert into sellerpilot_private.channel_credentials values(
      '${credential}','${owner}','ebay','production','active','${sellerKey}','provider_certified_v1', null, now()
    );
  `);
  await db.exec(ledgerSql);
  await db.exec(readV2Sql);
  return db;
}

function serviceClient(db: PGlite) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "sellerpilot_service_record_ebay_case_dispute_history_v1");
      try {
        await db.exec("set role service_role");
        const result = (await db.query(
          "select public.sellerpilot_service_record_ebay_case_dispute_history_v1($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb) result",
          [args.p_credential_id, args.p_seller_account_key, args.p_resource_kind,
            args.p_provider_native_id, args.p_provider_status, args.p_provider_updated_at,
            JSON.stringify(args.p_normalized_safe)],
        )).rows[0].result;
        return { data: result, error: null };
      } catch (error) {
        return { data: null, error };
      } finally {
        await db.exec("reset role");
      }
    },
  };
}

function userClient(db: PGlite) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "sellerpilot_read_ebay_case_dispute_history_v2");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
        await db.exec("set role authenticated");
        const result = (await db.query(
          "select public.sellerpilot_read_ebay_case_dispute_history_v2($1,$2,$3::timestamptz,$4::bigint,$5) result",
          [args.p_credential_id, args.p_resource_kind, args.p_before_observed_at,
            args.p_before_id, args.p_limit],
        )).rows[0].result;
        return { data: result, error: null };
      } catch (error) {
        return { data: null, error };
      } finally {
        await db.exec("reset role");
      }
    },
  };
}

class TestResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}) {
    return new TestResponse(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    });
  }
}

function historyRoute(db: PGlite) {
  const client = userClient(db);
  const sandbox = vm.createContext({
    exports: {}, Request, Response: TestResponse, URL, Object,
    require(name: string) {
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ userClient: client, serviceClient: {} }),
        isAdminApiError: () => false,
      };
      if (name.endsWith("/cs/channels/ebay/case-dispute-history")) {
        return { ebayCaseDisputeHistoryPageSchema, ebayCaseDisputeHistoryQuerySchema };
      }
      throw new Error(`unexpected history route import ${name}`);
    },
  });
  vm.runInContext(compiledRoute, sandbox);
  return sandbox.exports.GET as (request: Request) => Promise<Response>;
}

function historySyncRoute(db: PGlite) {
  const databaseService = serviceClient(db);
  const admin = {
    userClient: {
      rpc: async (name: string) => {
        assert.equal(name, "sellerpilot_list_owned_ebay_message_accounts");
        return { data: [{
          id: credential,
          environment: "production",
          version: 1,
          seller_account_key: sellerKey,
          seller_account_key_source: "provider_certified_v1",
        }], error: null };
      },
    },
    serviceClient: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "sellerpilot_decrypt_credential") return {
          data: {
            access_token: "fixture-token",
            marketplace_id: "EBAY_US",
            ebay_user_id: "fixture-seller",
            provider_account_identity_version: "v1",
            provider_account_subject: providerSubject,
          },
          error: null,
        };
        return databaseService.rpc(name, args);
      },
    },
  };
  const sandbox = vm.createContext({
    exports: {}, Request, Response: TestResponse, URL, Object, JSON, TextEncoder,
    require(name: string) {
      if (name === "node:crypto") return crypto;
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => admin,
        isAdminApiError: () => false,
      };
      if (name.endsWith("/channels/cs/ebay/case-dispute-history-sync")) return syncModule;
      if (name.endsWith("/channels/ebay-message-pages")) {
        return { ebayVerifiedMessageAccountIdentifiers: pages.ebayVerifiedMessageAccountIdentifiers };
      }
      if (name.endsWith("/channels/provider-account-identity")) return identity;
      if (name.endsWith("/cs/channels/ebay/case-dispute-history")) {
        return { ebayCaseDisputeHistorySyncRequestSchema, ebayCaseDisputeHistorySyncResponseSchema };
      }
      throw new Error(`unexpected history sync route import ${name}`);
    },
  });
  vm.runInContext(compiledSyncRoute, sandbox);
  return sandbox.exports.POST as (request: Request) => Promise<Response>;
}

test("normalized provider page flows through ledger ingest, owner API, and UI client without raw customer fields", async () => {
  const db = await database();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      assert.equal(init?.method, "GET");
      if (target.pathname === "/post-order/v2/casemanagement/search") {
        assert.equal(new Headers(init.headers).get("authorization"), "IAF fixture-token");
        return Response.json({
          members: [{
            caseId: caseEntry.caseId,
            caseStatusEnum: caseEntry.status,
            itemId: caseEntry.itemId,
            transactionId: caseEntry.transactionId,
            creationDate: { value: caseEntry.creationDate },
            lastModifiedDate: { value: caseEntry.lastModifiedDate },
            respondByDate: null,
            claimAmount: caseEntry.claimAmount,
            seller: "fixture-seller",
            buyer: "must-not-store",
          }],
          paginationOutput: { limit: 200, offset: 0, totalEntries: 1, totalPages: 1 },
          totalNumberOfCases: 1,
        });
      }
      assert.equal(target.pathname, "/sell/fulfillment/v1/payment_dispute_summary");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
      return Response.json({
        paymentDisputeSummaries: [{
          paymentDisputeId: disputeEntry.paymentDisputeId,
          orderId: disputeEntry.orderId,
          paymentDisputeStatus: disputeEntry.status,
          reason: disputeEntry.reason,
          openDate: disputeEntry.openDate,
          respondByDate: disputeEntry.respondByDate,
          closedDate: disputeEntry.closedDate,
          amount: disputeEntry.amount,
          buyerUsername: "must-not-store",
        }],
        limit: 200,
        offset: 0,
        total: 1,
      });
    };
    const POST = historySyncRoute(db);
    const syncFetch = (_path: string, init?: RequestInit) => POST(new Request("https://fixture.test/api/admin/cs/channels/ebay/cases-disputes/history/sync", {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    }));
    const caseReceipt = await syncEbayCaseDisputeHistoryUiResponse({
      authenticatedFetch: syncFetch,
      credentialId: credential,
      resourceKind: "resolution_case",
      startTime: "2026-09-01T00:00:00.000Z",
      endTime: "2026-09-08T00:00:00.000Z",
    });
    const disputeReceipt = await syncEbayCaseDisputeHistoryUiResponse({
      authenticatedFetch: syncFetch,
      credentialId: credential,
      resourceKind: "payment_dispute",
    });
    assert.equal(caseReceipt.observedCount, 1);
    assert.equal(caseReceipt.insertedCount, 1);
    assert.equal(caseReceipt.state, "complete");
    assert.equal(caseReceipt.resumeOffset, null);
    assert.equal(disputeReceipt.observedCount, 1);
    assert.equal(disputeReceipt.insertedCount, 1);

    const GET = historyRoute(db);
    const authenticatedFetch = (path: string) => GET(new Request(`https://fixture.test${path}`));
    const caseHistory = await readEbayCaseDisputeHistoryUiResponse({
      authenticatedFetch, credentialId: credential, resourceKind: "resolution_case",
    });
    assert.equal(caseHistory.events.length, 1);
    assert.equal(caseHistory.events[0].providerNativeId, caseEntry.caseId);
    assert.equal(caseHistory.events[0].resourceKind, "resolution_case");
    assert.doesNotMatch(JSON.stringify(caseHistory), /buyer|address|access_token/i);
    const disputeHistory = await readEbayCaseDisputeHistoryUiResponse({
      authenticatedFetch, credentialId: credential, resourceKind: "payment_dispute",
    });
    assert.equal(disputeHistory.events[0].providerNativeId, disputeEntry.paymentDisputeId);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("history ingest refuses unavailable pages and unchecked seller identity before any RPC", async () => {
  let calls = 0;
  const serviceClient = { rpc: async () => { calls += 1; return { data: null, error: null }; } };
  await assert.rejects(recordEbayCaseDisputeHistoryPage({
    serviceClient, credentialId: credential, sellerAccountKey: sellerKey,
    resourceKind: "payment_dispute",
    page: { availability: "not_available_or_not_found", httpStatus: 404, entries: [], total: null, offset: 0, nextOffset: null },
  }), /SOURCE_UNAVAILABLE/);
  await assert.rejects(recordEbayCaseDisputeHistoryPage({
    serviceClient, credentialId: credential, sellerAccountKey: sellerKey,
    resourceKind: "resolution_case",
    page: {
      availability: "readable", httpStatus: 200,
      entries: [{ ...caseEntry, sellerBinding: "not_checked" }], total: 1,
      offset: 0, nextOffset: null,
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    },
  }), /SELLER_UNVERIFIED/);
  assert.equal(calls, 0);
});

test("history sync preserves local 404/403 fixtures as unavailable and never records them", async () => {
  const originalFetch = globalThis.fetch;
  let rpcCalls = 0;
  const serviceClient = { rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } };
  try {
    globalThis.fetch = async url => new Response(null, {
      status: new URL(String(url)).pathname.includes("payment_dispute") ? 404 : 403,
    });
    const payment = await syncEbayPaymentDisputeHistory({
      serviceClient, payload: { access_token: "fixture-token" }, environment: "production",
      credentialId: credential, sellerAccountKey: sellerKey,
    });
    assert.deepEqual(payment, {
      state: "unavailable",
      availability: "not_available_or_not_found", httpStatus: 404, pages: 1,
      completedPages: 0,
      total: null, observedCount: null, insertedCount: null,
      resumeOffset: null, partialPageMayExist: false, interruptionReason: null,
    });
    const resolution = await syncEbayResolutionCaseHistoryWindow({
      serviceClient, payload: { access_token: "fixture-token" }, environment: "production",
      credentialId: credential, sellerAccountKey: sellerKey,
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
      verifiedSellerIdentifiers: ["fixture-seller"],
    });
    assert.deepEqual(resolution, {
      state: "unavailable",
      availability: "authorization_required", httpStatus: 403, pages: 1,
      completedPages: 0,
      total: null, observedCount: null, insertedCount: null,
      resumeOffset: null, partialPageMayExist: false, interruptionReason: null,
    });
    assert.equal(rpcCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("history sync preserves completed page progress and resumes after provider interruption", async () => {
  const originalFetch = globalThis.fetch;
  const offsets: number[] = [];
  let rpcCalls = 0;
  try {
    globalThis.fetch = async url => {
      const target = new URL(String(url));
      const offset = Number(target.searchParams.get("offset"));
      offsets.push(offset);
      if (offset === 200) return new Response(null, { status: 429 });
      return Response.json({
        paymentDisputeSummaries: [{
          paymentDisputeId: "resume-dispute-1", orderId: "resume-order-1",
          paymentDisputeStatus: "ACTION_NEEDED", reason: "ITEM_NOT_RECOGNIZED",
          openDate: "2026-09-03T00:00:00.000Z", amount: { value: "42.00", currency: "USD" },
        }],
        limit: 200,
        offset,
        next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=200&offset=200",
      });
    };
    const result = await syncEbayPaymentDisputeHistory({
      serviceClient: {
        rpc: async (_name, args) => {
          rpcCalls += 1;
          return { data: {
            contract: "sellerpilot-ebay-case-dispute-history-record/1",
            resourceKind: "payment_dispute",
            providerNativeId: args.p_provider_native_id,
            eventId: "1",
            observedStateSha256: "a".repeat(64),
            inserted: true,
          }, error: null };
        },
      },
      payload: { access_token: "fixture-token" }, environment: "production",
      credentialId: credential, sellerAccountKey: sellerKey,
    });
    assert.deepEqual(result, {
      state: "interrupted", availability: "rate_limited", httpStatus: 429,
      pages: 2, completedPages: 1, total: null, observedCount: 1, insertedCount: 1,
      resumeOffset: 200, partialPageMayExist: false, interruptionReason: "provider_unavailable",
    });
    assert.deepEqual(offsets, [0, 200]);
    assert.equal(rpcCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("history sync reports a conservative retry cursor when page recording fails", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const target = new URL(String(url));
      const offset = Number(target.searchParams.get("offset"));
      return Response.json({
        paymentDisputeSummaries: [{
          paymentDisputeId: "partial-dispute-1", orderId: "partial-order-1",
          paymentDisputeStatus: "ACTION_NEEDED", reason: "ITEM_NOT_RECOGNIZED",
          openDate: "2026-09-03T00:00:00.000Z", amount: { value: "42.00", currency: "USD" },
        }],
        limit: 200, offset, total: 1,
      });
    };
    const result = await syncEbayPaymentDisputeHistory({
      serviceClient: { rpc: async () => ({ data: null, error: new Error("fixture write failure") }) },
      payload: { access_token: "fixture-token" }, environment: "production",
      credentialId: credential, sellerAccountKey: sellerKey,
    });
    assert.deepEqual(result, {
      state: "interrupted", availability: "readable", httpStatus: 200,
      pages: 1, completedPages: 0, total: 1, observedCount: 0, insertedCount: 0,
      resumeOffset: 0, partialPageMayExist: true, interruptionReason: "history_record_failed",
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("history sync returns and accepts the next cursor at the bounded page limit", async () => {
  const originalFetch = globalThis.fetch;
  const requestedOffsets: number[] = [];
  try {
    globalThis.fetch = async url => {
      const target = new URL(String(url));
      const offset = Number(target.searchParams.get("offset"));
      requestedOffsets.push(offset);
      const isResumeTerminalPage = offset === 20_000;
      return Response.json({
        paymentDisputeSummaries: [], limit: 200, offset,
        ...(isResumeTerminalPage ? {} : {
          next: `https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=200&offset=${offset + 200}`,
        }),
      });
    };
    const input = {
      serviceClient: { rpc: async () => { throw new Error("empty pages do not write"); } },
      payload: { access_token: "fixture-token" }, environment: "production" as const,
      credentialId: credential, sellerAccountKey: sellerKey,
    };
    const first = await syncEbayPaymentDisputeHistory(input);
    assert.deepEqual(first, {
      state: "page_limit_reached", availability: "readable", httpStatus: 200,
      pages: 100, completedPages: 100, total: null, observedCount: 0, insertedCount: 0,
      resumeOffset: 20_000, partialPageMayExist: false, interruptionReason: "page_limit_reached",
    });
    const resumed = await syncEbayPaymentDisputeHistory({ ...input, resumeOffset: first.resumeOffset! });
    assert.equal(resumed.state, "complete");
    assert.equal(resumed.completedPages, 1);
    assert.equal(resumed.resumeOffset, null);
    assert.equal(requestedOffsets.at(-1), 20_000);
  } finally { globalThis.fetch = originalFetch; }
});

test("history sync request accepts only page-aligned resume offsets and sends the cursor", async () => {
  assert.equal(ebayCaseDisputeHistorySyncRequestSchema.safeParse({
    credentialId: credential, resourceKind: "payment_dispute", resumeOffset: 1,
  }).success, false);
  let requestBody: Record<string, unknown> | null = null;
  const response = await syncEbayCaseDisputeHistoryUiResponse({
    authenticatedFetch: async (_path, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        contract: "sellerpilot-ebay-case-dispute-history-sync/1",
        credentialId: credential, resourceKind: "payment_dispute",
        state: "complete", availability: "readable", httpStatus: 200,
        pages: 1, completedPages: 1, total: 0, observedCount: 0, insertedCount: 0,
        resumeOffset: null, partialPageMayExist: false, interruptionReason: null,
      });
    },
    credentialId: credential, resourceKind: "payment_dispute", resumeOffset: 200,
  });
  assert.equal(response.state, "complete");
  assert.equal(requestBody?.resumeOffset, 200);
});

test("history read v2 uses an observed-at plus event-id cursor without gaps", async () => {
  const db = await database();
  try {
    const service = serviceClient(db);
    for (const [index, status] of ["OPEN", "WAITING_SELLER", "CLOSED"].entries()) {
      await recordEbayCaseDisputeHistoryPage({
        serviceClient: service, credentialId: credential, sellerAccountKey: sellerKey,
        resourceKind: "resolution_case",
        page: {
          availability: "readable", httpStatus: 200,
          entries: [{ ...caseEntry, status, lastModifiedDate: `2026-09-0${index + 2}T00:00:00.000Z` }], total: 1,
          offset: 0, nextOffset: null,
          startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
        },
      });
    }
    const client = userClient(db);
    const first = (await client.rpc("sellerpilot_read_ebay_case_dispute_history_v2", {
      p_credential_id: credential, p_resource_kind: "resolution_case",
      p_before_observed_at: null, p_before_id: null, p_limit: 2,
    })).data as Record<string, unknown>;
    const firstPage = ebayCaseDisputeHistoryPageSchema.parse(first);
    assert.equal(firstPage.events.length, 2);
    assert.ok(firstPage.nextBeforeObservedAt && firstPage.nextBeforeId);
    const second = (await client.rpc("sellerpilot_read_ebay_case_dispute_history_v2", {
      p_credential_id: credential, p_resource_kind: "resolution_case",
      p_before_observed_at: firstPage.nextBeforeObservedAt,
      p_before_id: firstPage.nextBeforeId,
      p_limit: 2,
    })).data;
    const secondPage = ebayCaseDisputeHistoryPageSchema.parse(second);
    assert.equal(secondPage.events.length, 1);
    assert.equal(new Set([...firstPage.events, ...secondPage.events].map(event => event.eventId)).size, 3);
    assert.equal(secondPage.nextBeforeId, null);
  } finally { await db.close(); }
});

test("history routes and UI expose provider GET collection plus ledger storage, never dispute business actions", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(routeSource, /export async function (?:POST|PUT|PATCH|DELETE)\b/);
  assert.match(syncRouteSource, /export async function POST\(request: Request\)/);
  assert.match(historyComponentSource, /최신 내역 가져와 저장/);
  for (const source of [routeSource, syncRouteSource, historyComponentSource]) {
    assert.doesNotMatch(source, /acceptPaymentDispute|contestPaymentDispute|issueRefund|appealCaseDecision|closeCase/);
  }
});

test("history clients reject valid-shaped responses for a different account or resource", async () => {
  await assert.rejects(readEbayCaseDisputeHistoryUiResponse({
    credentialId: credential, resourceKind: "resolution_case",
    authenticatedFetch: async () => Response.json({
      contract: "sellerpilot-ebay-case-dispute-history/2",
      credentialId: "50000000-0000-4000-8000-000000000002",
      resourceKind: "resolution_case", events: [], nextBeforeObservedAt: null, nextBeforeId: null,
    }),
  }), /계정·종류/);
  await assert.rejects(syncEbayCaseDisputeHistoryUiResponse({
    credentialId: credential, resourceKind: "payment_dispute",
    authenticatedFetch: async () => Response.json({
      contract: "sellerpilot-ebay-case-dispute-history-sync/1",
      credentialId: credential, resourceKind: "resolution_case", state: "complete", availability: "readable",
      httpStatus: 200, pages: 1, completedPages: 1, total: 0, observedCount: 0, insertedCount: 0,
      resumeOffset: null, partialPageMayExist: false, interruptionReason: null,
    }),
  }), /계정·종류/);
  assert.equal(ebayCaseDisputeHistoryQuerySchema.safeParse({ credentialId: credential, limit: "51" }).success, false);
});
