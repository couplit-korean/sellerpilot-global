import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  classifyAiGatewayFailure,
  inspectAiGatewayFailure,
} from "../lib/ai-gateway-failure";

test("customer verification metadata wins over generic status and runtime classifications", () => {
  const error = {
    name: "GatewayForbiddenError",
    statusCode: 403,
    data: {
      error: {
        type: "customer_verification_required",
        message: "private provider diagnostic",
      },
    },
  };
  assert.equal(
    classifyAiGatewayFailure(error, { signalAborted: true }),
    "gateway_customer_verification_required",
  );
  assert.match(
    AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
    /Vercel AI Gateway 계정 확인·결제수단 확인 필요/,
  );
  assert.doesNotMatch(AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE, /private provider/i);
  assert.equal(
    classifyAiGatewayFailure({ type: "customer_verification_required", statusCode: 403 }),
    "gateway_customer_verification_required",
  );
});

test("gateway classifier preserves existing bounded AI SDK mappings", () => {
  const cases: Array<[unknown, string]> = [
    [{ statusCode: 401 }, "gateway_authentication_error"],
    [{ name: "GatewayError" }, "gateway_authentication_error"],
    [{ data: { error: { statusCode: 402 } } }, "gateway_billing_required"],
    [{ name: "GatewayForbiddenError" }, "gateway_forbidden"],
    [{ name: "GatewayModelNotFoundError" }, "gateway_model_not_found"],
    [{ lastError: { statusCode: 429 } }, "gateway_rate_limited"],
    [{ cause: { name: "GatewayTimeoutError" } }, "gateway_timeout"],
    [{ errors: [{ name: "AI_NoObjectGeneratedError" }] }, "gateway_result_invalid"],
    [new Error("private provider response"), "gateway_request_failed"],
  ];
  for (const [error, expected] of cases) {
    assert.equal(classifyAiGatewayFailure(error), expected);
  }
  assert.equal(
    classifyAiGatewayFailure(new Error("private timeout"), { signalAborted: true }),
    "runtime_timeout",
  );
});

test("gateway classifier follows only allowlisted links and remains cycle safe", () => {
  const hidden = {
    unrelated: {
      data: { error: { type: "customer_verification_required" } },
    },
    message: "customer_verification_required",
    responseBody: '{"error":{"type":"customer_verification_required"}}',
  };
  assert.equal(classifyAiGatewayFailure(hidden), "gateway_request_failed");

  const cyclic: Record<string, unknown> = { statusCode: 429 };
  cyclic.cause = cyclic;
  assert.equal(classifyAiGatewayFailure(cyclic), "gateway_rate_limited");

  assert.equal(classifyAiGatewayFailure({
    cause: {
      data: { error: { type: "customer_verification_required" } },
    },
  }), "gateway_customer_verification_required");
});

test("gateway inspection preserves only safe free-tier rate-limit evidence", () => {
  const secret = "private prompt and bearer token must never escape";
  const diagnostic = inspectAiGatewayFailure({
    name: "GatewayRateLimitError",
    type: "rate_limit_exceeded",
    statusCode: 429,
    generationId: "gen_01SAFEGATEWAY",
    message: "Free credits temporarily have rate limits in place due to abuse. Paid credits continue to have unrestricted access.",
    cause: {
      name: "AI_APICallError",
      statusCode: 429,
      responseHeaders: {
        "retry-after": "12",
        "x-request-id": "req_safe_123",
        authorization: `Bearer ${secret}`,
      },
      responseBody: JSON.stringify({ secret }),
      requestBodyValues: { prompt: secret },
      url: `https://example.invalid/${encodeURIComponent(secret)}`,
      data: {
        error: {
          type: "rate_limit_exceeded",
          message: "Free credits temporarily have rate limits in place due to abuse. Paid credits continue to have unrestricted access.",
        },
        providerMetadata: {
          gateway: {
            generationId: "gen_01SAFEGATEWAY",
            routing: {
              totalProviderAttemptCount: 0,
              modelAttempts: [{ providerAttemptCount: 0, providerAttempts: [] }],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(diagnostic, {
    reason: "gateway_rate_limited",
    httpStatus: 429,
    limitKind: "free_tier_limit",
    retryAfterMs: 12_000,
    generationId: "gen_01SAFEGATEWAY",
    requestId: "req_safe_123",
    upstreamProviderAttempted: false,
  });
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "generationId",
    "httpStatus",
    "limitKind",
    "reason",
    "requestId",
    "retryAfterMs",
    "upstreamProviderAttempted",
  ]);
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /private prompt|bearer|authorization|example\.invalid|responsebody/i);
});

test("ambiguous 429 remains unknown and Retry-After is bounded without retrying", () => {
  const diagnostic = inspectAiGatewayFailure({
    name: "GatewayRateLimitError",
    statusCode: 429,
    cause: {
      name: "AI_APICallError",
      statusCode: 429,
      responseHeaders: {
        "retry-after-ms": "999999999",
        "retry-after": "1",
      },
      data: { error: { type: "rate_limit_exceeded" } },
    },
  });
  assert.deepEqual(diagnostic, {
    reason: "gateway_rate_limited",
    httpStatus: 429,
    limitKind: "unknown_rate_limit",
    retryAfterMs: 15 * 60_000,
  });

  const rawBodyOnly = inspectAiGatewayFailure({
    name: "GatewayRateLimitError",
    statusCode: 429,
    cause: {
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { message: "Free credits temporarily have rate limits in place due to abuse." },
      }),
    },
  });
  assert.equal(rawBodyOnly.limitKind, "unknown_rate_limit", "raw response bodies are never parsed");
});

test("explicit provider attempt and rate dimension classify provider RPM", () => {
  const nowMs = Date.UTC(2027, 0, 1, 0, 0, 0);
  const diagnostic = inspectAiGatewayFailure({
    name: "GatewayRateLimitError",
    statusCode: 429,
    cause: {
      name: "AI_APICallError",
      statusCode: 429,
      responseHeaders: {
        "retry-after": new Date(nowMs + 32_000).toUTCString(),
        "x-vercel-id": "iad1::safe-request-id",
        "x-ratelimit-limit-requests": "10",
      },
      data: {
        error: { type: "rate_limit_exceeded" },
        providerMetadata: {
          gateway: {
            generationId: "gen_01PROVIDERRATE",
            routing: {
              totalProviderAttemptCount: 1,
              modelAttempts: [{
                providerAttemptCount: 1,
                providerAttempts: [{
                  success: false,
                  error: { statusCode: 429, code: "rate_limit_exceeded" },
                }],
              }],
            },
          },
        },
      },
    },
  }, { nowMs });
  assert.deepEqual(diagnostic, {
    reason: "gateway_rate_limited",
    httpStatus: 429,
    limitKind: "provider_request_rate_limit",
    retryAfterMs: 32_000,
    generationId: "gen_01PROVIDERRATE",
    requestId: "iad1::safe-request-id",
    upstreamProviderAttempted: true,
  });
});

test("only explicit codes distinguish account, concurrency, and provider dimensions", () => {
  const cases: Array<[unknown, string]> = [
    [{ statusCode: 429, data: { error: { code: "credit_balance_exhausted" } } }, "account_or_credit_limit"],
    [{ statusCode: 429, data: { error: { param: { code: "concurrency_limit" } } } }, "concurrency_limit"],
    [{ statusCode: 429, data: { error: { param: "tokens_per_minute" } } }, "provider_token_rate_limit"],
    [{ statusCode: 429, data: { error: { code: "images_per_minute" } } }, "provider_image_rate_limit"],
    [{ statusCode: 402 }, "account_or_credit_limit"],
  ];
  for (const [error, expected] of cases) {
    assert.equal(inspectAiGatewayFailure(error).limitKind, expected);
  }
});

test("provider metadata without a dimension stays generic and identifiers are sanitized", () => {
  const diagnostic = inspectAiGatewayFailure({
    name: "GatewayRateLimitError",
    statusCode: 429,
    generationId: "invalid generation id with spaces",
    requestId: "invalid request id with spaces",
    data: {
      error: { type: "rate_limit_exceeded" },
      providerMetadata: {
        gateway: {
          routing: {
            totalProviderAttemptCount: 1,
            modelAttempts: [{
              providerAttemptCount: 1,
              providerAttempts: [{ error: { statusCode: 429 } }],
            }],
          },
        },
      },
    },
  });
  assert.deepEqual(diagnostic, {
    reason: "gateway_rate_limited",
    httpStatus: 429,
    limitKind: "provider_rate_limit",
    upstreamProviderAttempted: true,
  });
});

test("product research and Studio use the common bounded gateway inspection path", async () => {
  const [research, studio] = await Promise.all([
    readFile(new URL("../lib/server-product-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-product-studio.ts", import.meta.url), "utf8"),
  ]);
  assert.match(research, /classifyAiGatewayFailure\(error, \{ signalAborted \}\)/);
  assert.match(studio, /inspectAiGatewayFailure\(error, \{[\s\S]*?signalAborted: input\.signal\.aborted/);
  assert.match(studio, /diagnostic\?\.httpStatus \?\? 500/);
  assert.doesNotMatch(studio, /function modelFailureReason/);
});
