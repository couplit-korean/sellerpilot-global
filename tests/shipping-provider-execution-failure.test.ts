import assert from "node:assert/strict";
import test from "node:test";
import {
  providerExecutionFailureDetail,
  providerExecutionFailureError,
  safeProviderFailureMessage,
} from "../lib/channels/provider-execution-failure.ts";
import { executeShippingProviderJob } from "../lib/shipping/provider.ts";
import { processShippingGatewayJob } from "../scripts/shipping-gateway-job.mjs";

const jobId = "71000000-0000-4000-8000-000000000001";
const claimToken = "74000000-0000-4000-8000-000000000001";
const wrapper = "SHIPPING_PROVIDER_EXECUTION_FAILED";

function temuShipmentJob(argumentsValue: Record<string, unknown>) {
  return {
    id: jobId,
    claim_token: claimToken,
    channel: "temu",
    operation: "orders.list",
    environment: "production",
    credential: {
      app_key: "temu-app-key",
      app_secret: "temu-app-secret",
      access_token: "temu-access-token",
    },
    request: { arguments: argumentsValue },
  };
}

function shippingDependencies(executeProvider: (input: unknown) => Promise<unknown>) {
  const completions: Array<{ path: string; payload: Record<string, unknown> }> = [];
  return {
    completions,
    dependencies: {
      createGatewayHeartbeat: () => ({
        start: async () => {},
        assertHealthy: async () => {},
        stop: async () => {},
      }),
      persistWorkerCompletion: async (path: string, payload: Record<string, unknown>) => {
        completions.push({ path, payload });
      },
      reserveProviderRequest: async () => {},
      executeProvider,
    },
  };
}

test("a Temu provider code and message survive into the recorded shipping error", () => {
  const thrown = Object.assign(new Error("TEMU_PROVIDER_REJECTED"), {
    providerResponse: {
      success: false,
      error_code: 3000000,
      error_msg: "updateAtStart type error, updateAtEnd type error",
    },
  });
  const recorded = providerExecutionFailureError(wrapper, thrown);
  assert.equal(
    recorded,
    `${wrapper}:3000000:updateAtStart type error, updateAtEnd type error`,
  );
  // The wrapper code stays matchable for existing consumers.
  assert.ok(recorded.startsWith(wrapper));
  assert.ok(recorded.includes("3000000"));
});

test("a Temu provider rejection is visible in the recorded job error end to end", async () => {
  const thrown = Object.assign(new Error("TEMU_PROVIDER_REJECTED"), {
    providerResponse: {
      success: false,
      errorCode: "5000003",
      errorMsg: "NOT_IN_IP_WHITE_LIST",
    },
  });
  const harness = shippingDependencies(async () => {
    throw thrown;
  });
  await processShippingGatewayJob(
    temuShipmentJob({ pageNumber: 1, pageSize: 100 }),
    harness.dependencies as never,
  );
  const completion = harness.completions.at(-1);
  assert.equal(completion?.path, "/api/channel-gateway/worker/complete");
  assert.equal(completion?.payload.status, "failed");
  assert.equal(
    completion?.payload.error,
    `${wrapper}:5000003:NOT_IN_IP_WHITE_LIST`,
  );
});

test("a token bearing provider message never reaches the recorded shipping error", async () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzZWxsZXJwaWxvdCJ9.c2lnbmF0dXJl";
  const secretMessage = [
    "access_token=tk_live_9f8e7d6c5b4a3210",
    `Authorization: Bearer ${jwt}`,
    "sign=1A2B3C4D5E6F708192A3B4C5D6E7F809",
    "app_secret: s3cr3t-value-8f7e6d5c",
  ].join(" ");
  const thrown = Object.assign(new Error("TEMU_SIGNATURE_REJECTED"), {
    providerResponse: { error_code: 3000001, error_msg: secretMessage },
  });
  const recorded = providerExecutionFailureError(wrapper, thrown);
  assert.equal(recorded, `${wrapper}:3000001`);
  for (const secret of [
    "tk_live_9f8e7d6c5b4a3210",
    jwt,
    "1A2B3C4D5E6F708192A3B4C5D6E7F809",
    "s3cr3t-value-8f7e6d5c",
    "Bearer",
    "access_token",
    "app_secret",
  ]) {
    assert.equal(recorded.includes(secret), false, `leaked ${secret}`);
  }
  const harness = shippingDependencies(async () => {
    throw thrown;
  });
  await processShippingGatewayJob(
    temuShipmentJob({ pageNumber: 1, pageSize: 100 }),
    harness.dependencies as never,
  );
  assert.equal(harness.completions.at(-1)?.payload.error, `${wrapper}:3000001`);
});

test("a credentialed URL is collapsed and private runtime paths are dropped", () => {
  assert.equal(
    safeProviderFailureMessage(
      "Temu rejected https://openapi-b-global.temu.com/openapi/router?access_token=abc123 signature mismatch",
    ),
    "Temu rejected [URL] signature mismatch",
  );
  assert.equal(
    providerExecutionFailureError(
      wrapper,
      new Error("failed at /Users/kimchangheemac/dev/sellerpilot/lib/x.ts:12:9"),
    ),
    wrapper,
  );
});

test("a thrown code only error keeps the code and bounds the recorded detail", () => {
  assert.equal(
    providerExecutionFailureError(wrapper, new Error("TEMU_CREDENTIALS_MISSING")),
    `${wrapper}:TEMU_CREDENTIALS_MISSING`,
  );
  const long = "Temu rejected the request because ".repeat(40);
  const detail = providerExecutionFailureDetail(new Error(long));
  assert.ok(detail.length <= 240);
  assert.equal(providerExecutionFailureError(wrapper, new Error("   ")), wrapper);
  const transport = new TypeError("fetch failed", {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND openapi-b-global.temu.com"), {
      code: "ENOTFOUND",
    }),
  });
  assert.equal(
    providerExecutionFailureError(wrapper, transport),
    `${wrapper}:ENOTFOUND:getaddrinfo ENOTFOUND openapi-b-global.temu.com`,
  );
  assert.equal(
    providerExecutionFailureError(wrapper, new Error("원격 오류 3000000 · updateAtStart type error")),
    `${wrapper}:3000000:updateAtStart type error`,
  );
});

test("a real Temu order rejection stays visible in the recorded job error", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: unknown, init?: { body?: string }) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        success: false,
        error_code: 3000000,
        error_msg: "updateAtStart type error, updateAtEnd type error",
        request_id: "temu-request-id",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const harness = shippingDependencies((input) =>
      executeShippingProviderJob(input as never),
    );
    await processShippingGatewayJob(
      temuShipmentJob({
        pageNumber: 1,
        pageSize: 100,
        updateAtStart: 1_762_000_000,
        updateAtEnd: 1_763_000_000,
        sortby: "updateTime",
      }),
      harness.dependencies as never,
    );
    const completion = harness.completions.at(-1);
    assert.equal(completion?.payload.status, "failed");
    const error = String(completion?.payload.error ?? "");
    assert.ok(error.includes("3000000"), error);
    assert.ok(error.includes("updateAtStart type error"), error);
    assert.equal(bodies.length, 1);
    // The signed request body must never be echoed into the job record.
    assert.equal(error.includes("temu-app-secret"), false);
    assert.equal(error.includes("temu-access-token"), false);
    assert.equal(error.includes("sign"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
