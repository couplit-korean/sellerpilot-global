import assert from "node:assert/strict";
import test from "node:test";
import { inspectAiGatewayFailure, type AiGatewayFailureDiagnostic } from "../lib/ai-gateway-failure";
import {
  createServerStudioLocalizedRepairBudget,
  serverStudioContractRepairGuidance,
} from "../lib/server-studio-contract-recovery";
import {
  createServerStudioGatewayCooldown,
  SERVER_STUDIO_MAX_GATEWAY_COOLDOWN_MS,
} from "../lib/server-studio-gateway-cooldown";

const retryable: AiGatewayFailureDiagnostic = {
  reason: "gateway_rate_limited",
  httpStatus: 429,
  limitKind: "concurrency_limit",
  upstreamProviderAttempted: false,
  retryAfterMs: 20,
};

test("terminal repair paths address indexes inside the affected chunk", () => {
  assert.equal(serverStudioContractRepairGuidance([
    { path: ["localizedListings", 33, "title"], message: "Missing expected locale script." },
  ], 32), "localizedListings.1.title: Missing expected locale script.");
});

test("contract repairs share a three-chunk budget and do not consume partial rejected allocations", () => {
  const budget = createServerStudioLocalizedRepairBudget();
  assert.equal(budget.take([1]), true);
  assert.equal(budget.take([1, 2]), false);
  assert.equal(budget.take([2, 3, 4]), false);
  assert.equal(budget.take([2, 3]), true);
  assert.equal(budget.take([4]), false);
});

test("only an explicit short pre-provider 429 can reserve one cooldown per claim", () => {
  const rejected: Array<AiGatewayFailureDiagnostic | undefined> = [
    undefined,
    { ...retryable, upstreamProviderAttempted: undefined },
    { ...retryable, upstreamProviderAttempted: true },
    { ...retryable, retryAfterMs: undefined },
    { ...retryable, retryAfterMs: -1 },
    { ...retryable, retryAfterMs: Infinity },
    { ...retryable, retryAfterMs: SERVER_STUDIO_MAX_GATEWAY_COOLDOWN_MS + 1 },
    { ...retryable, limitKind: "free_tier_limit" },
    { ...retryable, limitKind: "account_or_credit_limit" },
    { ...retryable, limitKind: "provider_image_rate_limit" },
    { ...retryable, httpStatus: 503 },
    { ...retryable, reason: "gateway_timeout" },
  ];
  for (const diagnostic of rejected) {
    assert.equal(createServerStudioGatewayCooldown().reserve(diagnostic), false);
  }
  const cooldown = createServerStudioGatewayCooldown();
  assert.equal(cooldown.reserve(retryable), true);
  assert.equal(cooldown.reserve(retryable), false);
});

function rateLimitWithRouting(routing: Record<string, unknown>) {
  return {
    statusCode: 429,
    responseHeaders: { "retry-after-ms": "1" },
    providerMetadata: { gateway: { routing } },
  };
}

test("Gateway inspection cannot promote partial or truncated per-model zeros to retry authorization", () => {
  const cases: Array<[string, Record<string, unknown>, boolean | undefined]> = [
    ["reported P1 partial route", { modelAttempts: [{ providerAttemptCount: 0 }, {}] }, undefined],
    ["one zero model without global total", { modelAttempts: [{ providerAttemptCount: 0 }] }, undefined],
    ["all listed models zero without global total", { modelAttempts: [{ providerAttemptCount: 0 }, { providerAttemptCount: 0 }] }, undefined],
    ["no routing count", {}, undefined],
    ["explicit zero global total", { totalProviderAttemptCount: 0 }, false],
    ["explicit zero with matching model total", { totalProviderAttemptCount: 0, modelAttempts: [{ providerAttemptCount: 0, providerAttempts: [] }] }, false],
    ["positive global total", { totalProviderAttemptCount: 1 }, true],
    ["positive model overrides global zero", { totalProviderAttemptCount: 0, modelAttempts: [{ providerAttemptCount: 1 }] }, true],
    ["provider attempt overrides all zero counts", { totalProviderAttemptCount: 0, modelAttempts: [{ providerAttemptCount: 0, providerAttempts: [{ success: false }] }] }, true],
    ["positive model without global total", { modelAttempts: [{ providerAttemptCount: 1 }] }, true],
    ["truncated model list cannot certify global zero", { totalProviderAttemptCount: 0, modelAttempts: [...Array.from({ length: 20 }, () => ({ providerAttemptCount: 0 })), { providerAttemptCount: 1 }] }, undefined],
  ];
  for (const [label, routing, expected] of cases) {
    const diagnostic = inspectAiGatewayFailure(rateLimitWithRouting(routing));
    assert.equal(diagnostic.upstreamProviderAttempted, expected, label);
    assert.equal(createServerStudioGatewayCooldown().reserve(diagnostic), expected === false, label);
  }
});

test("global zero does not override conflicting or omitted linked-route evidence", () => {
  const globalZero = rateLimitWithRouting({ totalProviderAttemptCount: 0 });
  for (const [cause, expected] of [
    [rateLimitWithRouting({ totalProviderAttemptCount: 1 }), true],
    [rateLimitWithRouting({ modelAttempts: [{ providerAttemptCount: 0 }, {}] }), undefined],
  ] as const) {
    const diagnostic = inspectAiGatewayFailure({ ...globalZero, cause });
    assert.equal(diagnostic.upstreamProviderAttempted, expected);
    assert.equal(createServerStudioGatewayCooldown().reserve(diagnostic), false);
  }
  const truncated = inspectAiGatewayFailure({
    ...globalZero,
    errors: [
      rateLimitWithRouting({ totalProviderAttemptCount: 1 }),
      {}, {}, {},
    ],
  });
  assert.equal(truncated.upstreamProviderAttempted, undefined);
  assert.equal(createServerStudioGatewayCooldown().reserve(truncated), false);

  let cause: Record<string, unknown> = rateLimitWithRouting({ totalProviderAttemptCount: 1 });
  for (let index = 0; index < 15; index += 1) cause = { cause };
  const capped = inspectAiGatewayFailure({ ...globalZero, cause });
  assert.equal(capped.upstreamProviderAttempted, undefined);
  assert.equal(createServerStudioGatewayCooldown().reserve(capped), false);
});

test("every new lane observes the same Retry-After deadline", async () => {
  const cooldown = createServerStudioGatewayCooldown();
  const startedAt = performance.now();
  assert.equal(cooldown.reserve(retryable), true);
  const controller = new AbortController();
  const elapsed = await Promise.all(Array.from({ length: 3 }, async () => {
    await cooldown.wait(controller.signal);
    return performance.now() - startedAt;
  }));
  assert.ok(elapsed.every((milliseconds) => milliseconds >= 20));
});

test("cooldown cancellation preserves the authoritative claim or image circuit error", async () => {
  const cooldown = createServerStudioGatewayCooldown();
  cooldown.reserve({ ...retryable, retryAfterMs: 1_000 });
  const controller = new AbortController();
  const failure = new Error("authoritative_image_failure");
  const pending = cooldown.wait(controller.signal);
  controller.abort(failure);
  await assert.rejects(pending, (error) => error === failure);
});
