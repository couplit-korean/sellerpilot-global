import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  classifyAiGatewayFailure,
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

test("product research and Studio use the common gateway classifier", async () => {
  const [research, studio] = await Promise.all([
    readFile(new URL("../lib/server-product-research.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-product-studio.ts", import.meta.url), "utf8"),
  ]);
  assert.match(research, /classifyAiGatewayFailure\(error, \{ signalAborted \}\)/);
  assert.match(studio, /classifyAiGatewayFailure\(error, \{[\s\S]*?signalAborted: input\.signal\.aborted/);
  assert.doesNotMatch(studio, /function modelFailureReason/);
});
