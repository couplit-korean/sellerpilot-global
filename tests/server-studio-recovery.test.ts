import assert from "node:assert/strict";
import test from "node:test";
import type { AiGatewayFailureDiagnostic } from "../lib/ai-gateway-failure";
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
