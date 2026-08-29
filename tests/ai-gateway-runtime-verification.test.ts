import assert from "node:assert/strict";
import test from "node:test";
import {
  aiGatewayRuntimeVerificationCookieName,
  aiGatewayRuntimeVerificationFailureTtlMs,
  aiGatewayRuntimeVerificationSuccessTtlMs,
  readAiGatewayRuntimeVerification,
  sealAiGatewayRuntimeVerification,
} from "../lib/ai-gateway-runtime-verification";
import { isStudioExecutionReady, type StudioWorkerReadiness } from "../lib/studio-worker-readiness";

const secret = "spw_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const context = "release-1|admin-user-1|oidc|worker-fingerprint";
const nowMs = Date.parse("2026-08-29T01:00:00.000Z");

function cookie(value: string) {
  return `unrelated=kept; ${aiGatewayRuntimeVerificationCookieName}=${value}; theme=dark`;
}

test("a successful manual Gateway smoke is signed, short-lived, and context bound", () => {
  const sealed = sealAiGatewayRuntimeVerification({ ok: true }, { secret, context, nowMs });
  assert.ok(sealed);
  assert.equal(sealed.maxAgeSeconds, aiGatewayRuntimeVerificationSuccessTtlMs / 1_000);

  const verified = readAiGatewayRuntimeVerification(cookie(sealed.value), { secret, context, nowMs });
  assert.deepEqual(verified, {
    status: "verified",
    code: null,
    checkedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + aiGatewayRuntimeVerificationSuccessTtlMs).toISOString(),
  });
  assert.equal(readAiGatewayRuntimeVerification(cookie(sealed.value), {
    secret,
    context: "release-1|admin-user-2|oidc|worker-fingerprint",
    nowMs,
  }).status, "unverified");
  assert.equal(readAiGatewayRuntimeVerification(cookie(sealed.value), {
    secret,
    context: "release-2|admin-user-1|oidc|worker-fingerprint",
    nowMs,
  }).status, "unverified");
  assert.equal(readAiGatewayRuntimeVerification(cookie(`${sealed.value.slice(0, -1)}x`), {
    secret,
    context,
    nowMs,
  }).status, "unverified");
  assert.equal(readAiGatewayRuntimeVerification(cookie(sealed.value), {
    secret,
    context,
    nowMs: nowMs + aiGatewayRuntimeVerificationSuccessTtlMs,
  }).status, "unverified");
});

test("a failed smoke persists only an allowlisted safe code for two minutes", () => {
  const exact = sealAiGatewayRuntimeVerification({
    ok: false,
    code: "customer_verification_required",
  }, { secret, context, nowMs });
  assert.ok(exact);
  assert.equal(exact.maxAgeSeconds, aiGatewayRuntimeVerificationFailureTtlMs / 1_000);
  assert.deepEqual(readAiGatewayRuntimeVerification(cookie(exact.value), { secret, context, nowMs }), {
    status: "failed",
    code: "customer_verification_required",
    checkedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + aiGatewayRuntimeVerificationFailureTtlMs).toISOString(),
  });

  const unknown = sealAiGatewayRuntimeVerification({
    ok: false,
    code: "raw-provider-secret-must-not-persist",
  }, { secret, context, nowMs });
  assert.ok(unknown);
  assert.equal(
    readAiGatewayRuntimeVerification(cookie(unknown.value), { secret, context, nowMs }).code,
    "unknown",
  );
  assert.doesNotMatch(unknown.value, /raw-provider-secret/);
});

test("Studio execution requires valid server configuration and blocks only an explicit Gateway failure", () => {
  const expiresAt = new Date(nowMs + 60_000).toISOString();
  const ready: StudioWorkerReadiness = {
    available: true,
    reason: "ready",
    message: "verified",
    checkedAt: new Date(nowMs).toISOString(),
    configurationReady: true,
    gatewayVerification: {
      status: "verified",
      code: null,
      checkedAt: new Date(nowMs).toISOString(),
      expiresAt,
    },
  };
  assert.equal(isStudioExecutionReady(ready, nowMs), true);
  assert.equal(isStudioExecutionReady({ ...ready, configurationReady: false }, nowMs), false);
  assert.equal(isStudioExecutionReady({ ...ready, gatewayVerification: undefined }, nowMs), false);
  assert.equal(isStudioExecutionReady({
    ...ready,
    gatewayVerification: { status: "unverified", code: null, checkedAt: null, expiresAt: null },
  }, Date.parse(expiresAt)), true);
  assert.equal(isStudioExecutionReady({
    ...ready,
    gatewayVerification: {
      status: "failed",
      code: "authentication_error",
      checkedAt: new Date(nowMs).toISOString(),
      expiresAt,
    },
  }, nowMs), false);
});
