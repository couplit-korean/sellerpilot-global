import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sellerpilot-cont09.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export {};" }
      : nextResolve(specifier, context);
  },
});

const { POST: rotate } = await import("../app/api/admin/channel-credentials/rotate/route");
const { POST: testCredential } = await import("../app/api/admin/channel-credentials/test/route");
const { POST: activate } = await import("../app/api/admin/channel-credentials/elevenst/activate/route");
const { POST: claimPending } = await import("../app/api/channel-gateway/worker/elevenst-pending-diagnostic/claim/route");
const { POST: completePending } = await import("../app/api/channel-gateway/worker/elevenst-pending-diagnostic/complete/route");
const { executeServerlessGatewayProviderJob } = await import("../lib/channels/serverless-gateway-provider");
const { processElevenstPendingDiagnosticJob } = await import("../scripts/elevenst-pending-diagnostic-job.mjs");
const { ElevenstCredentialAccounts } = await import("../app/elevenst-credential-accounts");
serverOnlyHook.deregister();

const adminId = "11111111-1111-4111-8111-111111111111";
const pendingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const activeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherActiveId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const createdId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const rotatedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const jobId = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const claimToken = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const workerToken = `spw_${"w".repeat(40)}`;
const secret = { api_key: "A".repeat(32), seller_id: "claimed-seller" };

type Call = { path: string; body: Record<string, unknown> };
type Scenario = "create" | "rotate" | "pending-test" | "activate-denied" | "activate" | "claim" | "complete" | "provider" | "worker-flow";

function credentialRow(id: string, status: "pending" | "active", version = 1) {
  return {
    id,
    channel: "elevenst",
    environment: "production",
    version,
    fingerprint: `SAFE${version}`,
    status,
    expires_at: null,
    rotation_interval_days: 90,
    warning_days: 30,
    grace_ends_at: null,
    last_rotated_at: "2026-09-09T00:00:00.000Z",
    last_checked_at: status === "pending" ? "2026-09-09T12:00:00.000Z" : null,
    last_check_status: status === "pending" ? "passed" : null,
    last_check_message: null,
    created_at: "2026-09-09T00:00:00.000Z",
  };
}

function scriptedFetch(scenario: Scenario) {
  const calls: Call[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    let body: Record<string, unknown> = {};
    if (request.method !== "GET") {
      body = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    }
    calls.push({ path: url.pathname, body });
    if (url.hostname === "openapi.11st.co.kr") {
      assert.equal(["provider", "worker-flow"].includes(scenario), true);
      assert.equal(url.searchParams.get("apiCode"), "ProductSearch");
      assert.equal(url.searchParams.get("key"), secret.api_key);
      return new Response("<ProductSearchResponse><Products><TotalCount>0</TotalCount></Products></ProductSearchResponse>", {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: adminId,
        aud: "authenticated",
        role: "authenticated",
        email: "admin@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-09-01T00:00:00.000Z",
      });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_is_admin") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/sellerpilot_list_credentials") {
      if (scenario === "rotate") return Response.json([credentialRow(activeId, "active"), credentialRow(otherActiveId, "active", 4)]);
      if (scenario === "pending-test") return Response.json([credentialRow(pendingId, "pending")]);
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_decrypt_credential") return Response.json(secret);
    if (url.pathname === "/rest/v1/rpc/sellerpilot_create_elevenst_credential_pending_v1") return Response.json(createdId);
    if (url.pathname === "/rest/v1/rpc/sellerpilot_rotate_elevenst_credential_v1") return Response.json(rotatedId);
    if (url.pathname === "/rest/v1/rpc/sellerpilot_enqueue_elevenst_pending_diagnostic_v1") return Response.json(jobId);
    if (url.pathname === "/rest/v1/rpc/sellerpilot_get_channel_gateway_job") {
      return Response.json({
        status: "succeeded",
        response: {
          ok: true,
          channel: "elevenst",
          operation: "diagnostic.test",
          diagnostic: { status: "passed", message: "ProductSearch access only; account ID was not returned." },
          safeMessage: "ProductSearch access only; account ID was not returned.",
          identityEvidence: "admin_claim_v1",
        },
      });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_activate_elevenst_credential_v1") {
      return scenario === "activate-denied"
        ? Response.json({ message: "ELEVENST_RECENT_EXACT_ACCESS_TEST_REQUIRED" }, { status: 400 })
        : Response.json(pendingId);
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_claim_elevenst_pending_diagnostic_v1") {
      return Response.json({
        id: jobId,
        claim_token: claimToken,
        credential_id: pendingId,
        channel: "elevenst",
        operation: "diagnostic.test",
        environment: "production",
        request: { sellerpilotPendingCredentialDiagnosticV1: true, identityEvidence: "admin_claim_v1" },
        credential: secret,
        attempt_count: 1,
      });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_complete_elevenst_pending_diagnostic_v1") {
      return Response.json({
        status: "completed",
        jobId,
        credentialId: pendingId,
        diagnosticStatus: (body.p_diagnostic as { status: string }).status,
        identityEvidence: "admin_claim_v1",
      });
    }
    throw new Error(`unexpected request: ${url.pathname}`);
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

async function withFetch<T>(scenario: Scenario, callback: (calls: Call[]) => Promise<T>) {
  const original = globalThis.fetch;
  const script = scriptedFetch(scenario);
  globalThis.fetch = script.fetcher;
  try {
    return await callback(script.calls);
  } finally {
    globalThis.fetch = original;
  }
}

function adminRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`https://sellerpilot.example${path}`, {
    method: "POST",
    headers: { authorization: "Bearer admin-session", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rotateBody(credentialId?: string) {
  return {
    ...(credentialId ? { credentialId } : {}),
    channel: "elevenst",
    environment: "production",
    secretPayload: credentialId ? { api_key: "Z".repeat(32) } : secret,
    expiresAt: null,
    rotationDays: 90,
    warningDays: 30,
    graceDays: 7,
  };
}

test("actual admin handlers use only exact pending/create/test/activate/rotate RPCs and return no credential secrets", async () => {
  await withFetch("create", async (calls) => {
    const response = await rotate(adminRequest("/api/admin/channel-credentials/rotate", rotateBody()));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual({ credentialId: body.credentialId, status: body.status, identityEvidence: body.identityEvidence }, {
      credentialId: createdId,
      status: "pending",
      identityEvidence: "admin_claim_v1",
    });
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_create_elevenst_credential_pending_v1")), true);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_rotate_credential")), false);
    assert.doesNotMatch(JSON.stringify(body), /claimed-seller|A{32}/u);
  });

  await withFetch("rotate", async (calls) => {
    const response = await rotate(adminRequest("/api/admin/channel-credentials/rotate", rotateBody(activeId)));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.credentialId, rotatedId);
    const exact = calls.find((call) => call.path.endsWith("sellerpilot_rotate_elevenst_credential_v1"));
    assert.ok(exact);
    assert.equal(exact.body.p_credential_id, activeId);
    assert.deepEqual(exact.body.p_secret_patch, { api_key: "Z".repeat(32) });
    assert.equal(JSON.stringify(calls).includes(otherActiveId), false);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_rotate_credential")), false);
  });

  await withFetch("pending-test", async (calls) => {
    const response = await testCredential(adminRequest("/api/admin/channel-credentials/test", { credentialId: pendingId, channel: "elevenst" }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "passed");
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_enqueue_elevenst_pending_diagnostic_v1")), true);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_enqueue_channel_gateway_job")), false);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_record_credential_test")), false);
  });

  await withFetch("activate-denied", async () => {
    const response = await activate(adminRequest("/api/admin/channel-credentials/elevenst/activate", { credentialId: pendingId }));
    assert.equal(response.status, 409);
  });
  await withFetch("activate", async (calls) => {
    const response = await activate(adminRequest("/api/admin/channel-credentials/elevenst/activate", { credentialId: pendingId }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.credentialId, pendingId);
    assert.equal(body.identityEvidence, "admin_claim_v1");
    assert.match(body.message, /provider 인증 신원은 아닙니다/u);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_activate_elevenst_credential_v1")), true);
  });
});

test("actual worker claim, provider diagnostic, and completion keep admin_claim_v1 boundaries", async () => {
  const claim = await withFetch("claim", async (calls) => {
    const response = await claimPending(new Request("https://sellerpilot.example/api/channel-gateway/worker/elevenst-pending-diagnostic/claim", {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ version: "cont09-local-fixture" }),
    }));
    assert.equal(response.status, 200);
    assert.equal(calls.some((call) => call.path.endsWith("sellerpilot_claim_elevenst_pending_diagnostic_v1")), true);
    assert.equal(calls.find((call) => call.path.endsWith("sellerpilot_claim_elevenst_pending_diagnostic_v1"))?.body.p_job_id, null);
    return await response.json();
  });
  assert.equal(claim.request.identityEvidence, "admin_claim_v1");

  const providerResult = await withFetch("provider", async (calls) => {
    const result = await executeServerlessGatewayProviderJob({
      job: claim,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => {},
        beginProviderMutation: async () => { throw new Error("read-only diagnostic mutated provider"); },
        beginCredentialMutation: async () => { throw new Error("read-only diagnostic mutated credential"); },
        stageCredentialRefresh: async () => { throw new Error("read-only diagnostic staged credential"); },
      },
    });
    assert.equal(calls.filter((call) => call.path === "/openapi/OpenApiService.tmall").length, 1);
    return result;
  });
  assert.equal(providerResult.operation, "diagnostic.test");
  assert.equal(providerResult.diagnostic.status, "passed");
  assert.match(providerResult.diagnostic.message, /계정 ID를 되돌려주지 않습니다/u);

  await withFetch("worker-flow", async (calls) => {
    const workerResult = await processElevenstPendingDiagnosticJob(claim, {
      complete: (completionBody: Record<string, unknown>) => completePending(new Request("https://sellerpilot.example/api/channel-gateway/worker/elevenst-pending-diagnostic/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
        body: JSON.stringify(completionBody),
      })),
    });
    assert.equal(workerResult.receipt.identityEvidence, "admin_claim_v1");
    assert.equal(workerResult.diagnostic.status, "passed");
    assert.match(workerResult.diagnostic.message, /계정 ID를 되돌려주지 않습니다/u);
    const completion = calls.find((call) => call.path.endsWith("sellerpilot_complete_elevenst_pending_diagnostic_v1"));
    assert.ok(completion);
    assert.equal(completion.body.p_job_id, jobId);
    assert.equal(completion.body.p_claim_token, claimToken);
    assert.equal((completion.body.p_diagnostic as { status: string }).status, "passed");
    assert.doesNotMatch(JSON.stringify(workerResult.receipt), /provider[_ -]?certified/u);
  });
});

test("safe 11st account UI renders only status, version, fingerprint, and explicit evidence limits", () => {
  const html = renderToStaticMarkup(React.createElement(ElevenstCredentialAccounts, {
    accounts: [
      { id: pendingId, version: 7, fingerprint: "SAFEFINGER01", status: "pending", last_check_status: "passed" },
      { id: activeId, version: 4, fingerprint: "SAFEFINGER02", status: "active", last_check_status: null },
    ],
    testingId: "",
    onTest: () => {},
    onActivate: () => {},
    onRotate: () => {},
  }));
  assert.match(html, /safe-metadata-only/u);
  assert.match(html, /v7/u);
  assert.match(html, /SAFEFINGER01/u);
  assert.match(html, /판매자 ID 비공개/u);
  assert.match(html, /provider 계정 신원 미확인/u);
  assert.doesNotMatch(html, new RegExp(`${pendingId}|${activeId}|claimed-seller|${"A".repeat(32)}`, "u"));
});

test("persistent fixed-egress worker polls the pending lane only after the ordinary gateway queue is empty", async () => {
  const worker = await readFile(new URL("../scripts/channel-gateway-worker.mjs", import.meta.url), "utf8");
  const genericClaim = worker.indexOf('api("/api/channel-gateway/worker/claim"');
  const pendingClaim = worker.indexOf('api("/api/channel-gateway/worker/elevenst-pending-diagnostic/claim"');
  const pendingExecution = worker.indexOf("processElevenstPendingDiagnosticJob(gatewayJob");
  assert.ok(genericClaim >= 0 && pendingClaim > genericClaim && pendingExecution > pendingClaim);
  assert.match(worker.slice(genericClaim, pendingClaim), /gatewayResponse\.status === 204/u);
  assert.match(worker.slice(pendingClaim, pendingExecution), /elevenstPendingDiagnostic/u);
});
