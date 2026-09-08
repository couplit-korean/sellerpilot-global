import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as identity from "../lib/channels/provider-account-identity";
import * as pages from "../lib/channels/ebay-message-pages";
import {
  ebayCaseDisputeAccountsSchema,
  ebayCaseDisputeQuerySchema,
  ebayPaymentDisputePageResponseSchema,
  ebayResolutionCasePageResponseSchema,
  readEbayCaseDisputeUiResponse,
} from "../lib/cs/channels/ebay/cases-disputes";

const adminSource = await readFile(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/admin/cs/channels/ebay/cases-disputes/route.ts", import.meta.url), "utf8");
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const compiledAdmin = ts.transpileModule(adminSource, { compilerOptions }).outputText;
const compiledRoute = ts.transpileModule(routeSource, { compilerOptions }).outputText;

const ownerId = "11111111-1111-4111-8111-111111111111";
const credentialId = "22222222-2222-4222-8222-222222222222";
const otherCredentialId = "33333333-3333-4333-8333-333333333333";
const subject = "ebay:eias:synthetic-route-account";
const sellerKey = crypto.createHash("sha256").update(["ebay", "production", subject].join("\u001f")).digest("hex");
const account = {
  id: credentialId,
  environment: "production",
  version: 7,
  seller_account_key: sellerKey,
  seller_account_key_source: "provider_certified_v1",
};
const payload = {
  access_token: "fixture-access-token",
  marketplace_id: "EBAY_US",
  provider_account_identity_version: "v1",
  provider_account_subject: subject,
  ebay_user_id: "synthetic-seller",
};

class TestResponse extends Response {
  static json(body: unknown, init: ResponseInit = {}) {
    return new TestResponse(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    });
  }
}

type Options = {
  authError?: unknown;
  adminData?: unknown;
  adminError?: unknown;
  accounts?: unknown[];
  decrypted?: Record<string, unknown>;
  decryptError?: unknown;
  paymentPage?: Record<string, unknown>;
  resolutionPage?: Record<string, unknown>;
};

function loadRoute(options: Options = {}) {
  const trace: string[] = [];
  let serviceClients = 0;
  const userClient = {
    auth: {
      getUser: async (token: string) => {
        trace.push("auth.getUser");
        assert.equal(token, "fixture-admin-session");
        return options.authError
          ? { data: { user: null }, error: options.authError }
          : { data: { user: { id: ownerId } }, error: null };
      },
    },
    rpc: async (name: string) => {
      trace.push(`user.rpc:${name}`);
      if (name === "sellerpilot_is_admin") {
        return { data: options.adminData ?? true, error: options.adminError ?? null, status: 200 };
      }
      if (name === "sellerpilot_list_owned_ebay_message_accounts") {
        return { data: options.accounts ?? [account], error: null, status: 200 };
      }
      throw new Error(`unexpected user RPC ${name}`);
    },
  };
  const serviceClient = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      trace.push(`service.rpc:${name}`);
      assert.equal(name, "sellerpilot_decrypt_credential");
      assert.equal(args.p_credential_id, credentialId);
      return { data: options.decrypted ?? payload, error: options.decryptError ?? null };
    },
  };
  const adminSandbox = vm.createContext({
    exports: {}, Request, Response: TestResponse, setTimeout, clearTimeout, Date,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-service-key" } },
    require(name: string) {
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name === "./supabase/config") {
        return { supabaseUrl: "https://fixture.supabase.co", supabasePublishableKey: "fixture-public-key" };
      }
      if (name === "@supabase/supabase-js") return {
        createClient(_url: string, key: string) {
          trace.push(`createClient:${key}`);
          if (key === "fixture-public-key") return userClient;
          if (key === "fixture-service-key") { serviceClients += 1; return serviceClient; }
          throw new Error("unexpected Supabase key");
        },
      };
      throw new Error(`unexpected admin import ${name}`);
    },
  });
  vm.runInContext(compiledAdmin, adminSandbox);

  const provider = {
    readEbayPaymentDisputesPage: async () => {
      trace.push("provider:payment-disputes");
      return options.paymentPage ?? {
        availability: "not_available_or_not_found",
        httpStatus: 404,
        entries: [], total: null, offset: 0, nextOffset: null,
      };
    },
    readEbayResolutionCasesPage: async (input: Record<string, unknown>) => {
      trace.push("provider:resolution-cases");
      return options.resolutionPage ?? {
        availability: "authorization_required",
        httpStatus: 403,
        entries: [], total: null,
        offset: input.offset, nextOffset: null,
        startTime: input.startTime, endTime: input.endTime,
      };
    },
  };
  const routeSandbox = vm.createContext({
    exports: {}, Request, Response: TestResponse, URL, Object, Error,
    require(name: string) {
      if (name === "node:crypto") return crypto;
      if (name === "next/server") return { NextResponse: TestResponse };
      if (name.endsWith("/admin-api")) return adminSandbox.exports;
      if (name.endsWith("/channels/cs/ebay/cases-disputes")) return provider;
      if (name.endsWith("/channels/ebay-message-pages")) {
        return { ebayVerifiedMessageAccountIdentifiers: pages.ebayVerifiedMessageAccountIdentifiers };
      }
      if (name.endsWith("/channels/provider-account-identity")) return identity;
      if (name.endsWith("/cs/channels/ebay/cases-disputes")) {
        return {
          ebayCaseDisputePageSize: 25,
          ebayCaseDisputeQuerySchema,
        };
      }
      throw new Error(`unexpected route import ${name}`);
    },
  });
  vm.runInContext(compiledRoute, routeSandbox);
  return {
    GET: routeSandbox.exports.GET as (request: Request) => Promise<Response>,
    trace,
    serviceClientCount: () => serviceClients,
  };
}

function request(path: string, authorization = "Bearer fixture-admin-session") {
  return new Request(`https://fixture.test${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

test("actual GET route runs real authenticateAdminRequest for anonymous and expired sessions", async () => {
  const anonymous = loadRoute();
  const anonymousResponse = await anonymous.GET(request("/api/admin/cs/channels/ebay/cases-disputes?view=accounts", ""));
  assert.equal(anonymousResponse.status, 401);
  assert.equal((await anonymousResponse.json()).code, "ADMIN_SESSION_INVALID");
  assert.deepEqual(anonymous.trace, []);
  assert.equal(anonymous.serviceClientCount(), 0);

  const expired = loadRoute({ authError: { status: 400, code: "session_expired" } });
  const expiredResponse = await expired.GET(request("/api/admin/cs/channels/ebay/cases-disputes?view=accounts"));
  assert.equal(expiredResponse.status, 401);
  assert.equal((await expiredResponse.json()).code, "ADMIN_SESSION_INVALID");
  assert.equal(expired.trace.includes("auth.getUser"), true);
  assert.equal(expired.trace.some(value => value.includes("list_owned")), false);
  assert.equal(expired.serviceClientCount(), 0);
});

test("actual GET route excludes another owner's credential and uncertified or mismatched sellers before provider access", async () => {
  const otherOwner = loadRoute({ accounts: [{ ...account, id: otherCredentialId }] });
  const otherResponse = await otherOwner.GET(request(`/api/admin/cs/channels/ebay/cases-disputes?view=payment_disputes&credentialId=${credentialId}&offset=0`));
  assert.equal(otherResponse.status, 404);
  assert.equal(otherOwner.trace.some(value => value.startsWith("service.rpc:")), false);
  assert.equal(otherOwner.trace.some(value => value.startsWith("provider:")), false);

  const uncertified = loadRoute({ accounts: [{ ...account, seller_account_key_source: "legacy_unattested" }] });
  const uncertifiedResponse = await uncertified.GET(request(`/api/admin/cs/channels/ebay/cases-disputes?view=payment_disputes&credentialId=${credentialId}&offset=0`));
  assert.equal(uncertifiedResponse.status, 409);
  assert.equal((await uncertifiedResponse.json()).code, "ACCOUNT_UNVERIFIED");
  assert.equal(uncertified.trace.some(value => value.startsWith("service.rpc:")), false);

  const mismatch = loadRoute({ accounts: [{ ...account, seller_account_key: "f".repeat(64) }] });
  const mismatchResponse = await mismatch.GET(request(`/api/admin/cs/channels/ebay/cases-disputes?view=payment_disputes&credentialId=${credentialId}&offset=0`));
  assert.equal(mismatchResponse.status, 409);
  assert.equal(mismatch.trace.includes("provider:payment-disputes"), false);
});

test("isolated UI client calls the actual authenticated GET route and preserves payment-dispute 404 as unknown", async () => {
  const route = loadRoute();
  const authenticatedFetch = (path: string, init?: RequestInit) => route.GET(new Request(`https://fixture.test${path}`, {
    headers: { authorization: "Bearer fixture-admin-session" },
    signal: init?.signal,
  }));
  const accountsResult = await readEbayCaseDisputeUiResponse({ authenticatedFetch, view: "accounts" });
  const accounts = ebayCaseDisputeAccountsSchema.parse(accountsResult).accounts;
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, credentialId);

  const page = ebayPaymentDisputePageResponseSchema.parse(await readEbayCaseDisputeUiResponse({
    authenticatedFetch, view: "payment_disputes", credentialId, offset: 0,
  }));
  assert.equal(page.availability, "not_available_or_not_found");
  assert.equal(page.httpStatus, 404);
  assert.equal(page.total, null);
  assert.equal(page.entries.length, 0);
  assert.equal(route.trace.includes("provider:payment-disputes"), true);
  assert.doesNotMatch(JSON.stringify(page), /fixture-access-token|synthetic-route-account/);
});

test("isolated UI client keeps a provider 403 blocked and never converts it to an empty readable page", async () => {
  const route = loadRoute();
  const authenticatedFetch = (path: string, init?: RequestInit) => route.GET(new Request(`https://fixture.test${path}`, {
    headers: { authorization: "Bearer fixture-admin-session" },
    signal: init?.signal,
  }));
  const page = ebayResolutionCasePageResponseSchema.parse(await readEbayCaseDisputeUiResponse({
    authenticatedFetch,
    view: "resolution_cases",
    credentialId,
    offset: 0,
    startTime: "2026-09-01T00:00:00.000Z",
    endTime: "2026-09-08T00:00:00.000Z",
  }));
  assert.equal(page.availability, "authorization_required");
  assert.equal(page.httpStatus, 403);
  assert.equal(page.total, null);
  assert.equal(page.entries.length, 0);
  assert.equal(page.nextOffset, null);
  assert.equal(route.trace.includes("provider:resolution-cases"), true);
});
