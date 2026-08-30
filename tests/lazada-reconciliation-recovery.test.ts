import assert from "node:assert/strict";
import test from "node:test";
import {
  exactLazadaRecoveryJobId,
  recoverExactLazadaCredential,
  type ExactLazadaRecoveryDependencies,
} from "../lib/channels/lazada-reconciliation-recovery";
import { lazadaRequest } from "../lib/channels/protocols";
import {
  POST as exactLazadaRecoveryRoute,
} from "../app/api/channel-gateway/worker/lazada-recovery/route";

const TOKEN_HASH = "a".repeat(64);
const CLAIM_TOKEN = "29adbeac-da4b-4bc6-a6c3-fdcbfa07d950";
const CREDENTIAL_ID = "23dd21ad-ac06-47ef-ae91-33f97cb919d7";
const REPLACEMENT_JOB_ID = "1465acae-bfb7-4403-a3f2-62311348d581";
const RECOVERY_SECRET = {
  app_key: "app-key",
  app_secret: "app-secret",
  country: "my",
  access_token: "rotated-access-token",
  refresh_token: "rotated-refresh-token",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
  refresh_token_expires_at: "2099-02-01T00:00:00.000Z",
  country_user_info: [{
    country: "my",
    seller_id: "1001",
    user_id: "2001",
    short_code: "MYSHOP1",
  }],
};

function claim() {
  return {
    status: "claimed",
    id: exactLazadaRecoveryJobId,
    claim_token: CLAIM_TOKEN,
    channel: "lazada",
    operation: "orders.list",
    environment: "production",
    request: {
      periodicKey: "orders",
      arguments: { queryParams: { limit: "50" } },
    },
    credential: RECOVERY_SECRET,
  };
}

function remote(status: number, data: Record<string, unknown>) {
  return {
    response: Response.json(data, { status }),
    data,
    text: JSON.stringify(data),
  };
}

function successRead() {
  return remote(200, {
    code: "0",
    data: {
      seller_id: "1001",
      short_code: "MYSHOP1",
      status: "ACTIVE",
    },
  });
}

function scriptedDependencies(input: {
  claim?: unknown;
  claimError?: { code: string } | null;
  providerRead?: ReturnType<typeof remote>;
  providerError?: Error;
  prepare?: unknown;
  prepareError?: { code: string } | null;
  finish?: unknown;
  finishError?: { code: string } | null;
  abort?: unknown;
  abortError?: { code: string } | null;
}) {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let observedCredential: Record<string, unknown> | null = null;
  const dependencies: ExactLazadaRecoveryDependencies = {
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_claim_exact_lazada_recovery") {
        return { data: input.claim ?? claim(), error: input.claimError ?? null };
      }
      if (name === "sellerpilot_service_prepare_exact_lazada_recovery") {
        return {
          data: input.prepare ?? { status: "prepared", credentialId: CREDENTIAL_ID },
          error: input.prepareError ?? null,
        };
      }
      if (name === "sellerpilot_service_finish_exact_lazada_recovery") {
        return {
          data: input.finish ?? { status: "requeued", replacementJobId: REPLACEMENT_JOB_ID },
          error: input.finishError ?? null,
        };
      }
      if (name === "sellerpilot_service_abort_exact_lazada_recovery") {
        return { data: input.abort ?? true, error: input.abortError ?? null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
    readSeller: async (credential) => {
      observedCredential = credential;
      if (input.providerError) throw input.providerError;
      return input.providerRead ?? successRead();
    },
  };
  return {
    calls,
    dependencies,
    observedCredential: () => observedCredential,
  };
}

test("the exact recovery route is worker-authenticated and never caches refusals", async (context) => {
  await context.test("missing worker bearer token", async () => {
    const response = await exactLazadaRecoveryRoute(new Request(
      "https://sellerpilot.example/api/channel-gateway/worker/lazada-recovery",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: exactLazadaRecoveryJobId }),
      },
    ));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  });

  await context.test("authenticated worker with a different job", async () => {
    const response = await exactLazadaRecoveryRoute(new Request(
      "https://sellerpilot.example/api/channel-gateway/worker/lazada-recovery",
      {
        method: "POST",
        headers: {
          authorization: `Bearer spw_${"r".repeat(43)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      },
    ));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), { ok: false, status: "invalid_job" });
  });
});

test("exact Lazada recovery proves the preserved token and requeues one fresh read", async () => {
  const scripted = scriptedDependencies({});
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);

  assert.deepEqual(outcome, {
    httpStatus: 200,
    body: { ok: true, status: "requeued", replacementJobId: REPLACEMENT_JOB_ID },
  });
  assert.equal(scripted.observedCredential(), RECOVERY_SECRET);
  assert.deepEqual(scripted.calls.map((call) => call.name), [
    "sellerpilot_service_claim_exact_lazada_recovery",
    "sellerpilot_service_prepare_exact_lazada_recovery",
    "sellerpilot_service_finish_exact_lazada_recovery",
  ]);
  assert.deepEqual(scripted.calls[1]?.arguments_.p_provider_read, successRead().data);
  assert.equal(JSON.stringify(outcome).includes("rotated-access-token"), false);
  assert.equal(JSON.stringify(outcome).includes("rotated-refresh-token"), false);
});

test("the production transport performs only the official MY GetSeller GET", async () => {
  const scripted = scriptedDependencies({});
  delete scripted.dependencies.readSeller;
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedMethod = "";
  let observedBody: BodyInit | null | undefined;
  globalThis.fetch = async (input, init) => {
    observedUrl = String(input);
    observedMethod = init?.method ?? "";
    observedBody = init?.body;
    return Response.json(successRead().data);
  };
  try {
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "requeued");
    const url = new URL(observedUrl);
    assert.equal(url.origin, "https://api.lazada.com.my");
    assert.equal(url.pathname, "/rest/seller/get");
    assert.equal(observedMethod, "GET");
    assert.equal(observedBody, undefined);
    assert.equal(url.searchParams.get("access_token"), RECOVERY_SECRET.access_token);
    assert.equal(url.searchParams.get("app_key"), RECOVERY_SECRET.app_key);
    assert.match(url.searchParams.get("sign") ?? "", /^[A-F0-9]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the recovery read-only context blocks an accidental Lazada POST before fetch", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch must not run");
  };
  const scripted = scriptedDependencies({});
  scripted.dependencies.readSeller = (credential) => lazadaRequest({
    payload: credential,
    path: "/product/create",
    method: "POST",
  });
  try {
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(fetchCalled, false);
    assert.deepEqual(scripted.calls.map((call) => call.name), [
      "sellerpilot_service_claim_exact_lazada_recovery",
      "sellerpilot_service_abort_exact_lazada_recovery",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a different job id is rejected before any RPC or provider call", async () => {
  const scripted = scriptedDependencies({});
  const outcome = await recoverExactLazadaCredential({
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.deepEqual(outcome, {
    httpStatus: 400,
    body: { ok: false, status: "invalid_job" },
  });
  assert.equal(scripted.calls.length, 0);
  assert.equal(scripted.observedCredential(), null);
});

test("a malformed token hash is rejected before claiming the Vault snapshot", async () => {
  const scripted = scriptedDependencies({});
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: "not-a-token-hash",
  }, scripted.dependencies);
  assert.equal(outcome.httpStatus, 400);
  assert.equal(scripted.calls.length, 0);
});

test("a durable claim state mismatch does not call Lazada", async () => {
  const scripted = scriptedDependencies({ claim: { status: "state_mismatch" } });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.deepEqual(outcome, {
    httpStatus: 409,
    body: { ok: false, status: "state_mismatch" },
  });
  assert.equal(scripted.observedCredential(), null);
  assert.equal(scripted.calls.length, 1);
});

test("a malformed claim is left to its lease fence without exposing the snapshot", async () => {
  const malformed = { ...claim(), operation: "listing.update" };
  const scripted = scriptedDependencies({ claim: malformed });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.deepEqual(outcome, {
    httpStatus: 503,
    body: { ok: false, status: "recovery_unavailable" },
  });
  assert.equal(scripted.observedCredential(), null);
  assert.equal(scripted.calls.length, 1);
});

test("a transient seller read returns to reconciliation and preserves the snapshot", async () => {
  const scripted = scriptedDependencies({ providerError: new Error("network unavailable") });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.deepEqual(outcome, {
    httpStatus: 503,
    body: { ok: false, status: "provider_read_transient" },
  });
  assert.deepEqual(scripted.calls.map((call) => call.name), [
    "sellerpilot_service_claim_exact_lazada_recovery",
    "sellerpilot_service_abort_exact_lazada_recovery",
  ]);
  assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
});

test("documented Lazada transport and body failures preserve retryability", async (context) => {
  await context.test("503", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(503, { code: "15", message: "service unavailable" }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
  });

  await context.test("HTTP 200 code 15", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "15",
        type: "ISP",
        message: "Remote service error",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
    assert.equal(
      scripted.calls.some((call) => call.name === "sellerpilot_service_prepare_exact_lazada_recovery"),
      false,
    );
  });

  await context.test("HTTP 200 frequency limit", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "ApiCallLimit",
        message: "Api access frequency exceeds the limit. this ban will last 1 seconds",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
  });

  await context.test("HTTP 200 documented frequency message", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "THROTTLED",
        message: "Api access frequency exceeds the limit. this ban will last 1 seconds",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
  });

  await context.test("HTTP 200 service timeout", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "ServiceTimeout",
        message: "The provider service timed out. Try again later.",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "provider_read_transient");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "provider_read_transient");
  });

  await context.test("invalid token", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "IllegalAccessToken",
        type: "platform",
        message: "Remote service error; try again later",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.deepEqual(outcome, {
      httpStatus: 409,
      body: { ok: false, status: "snapshot_rejected" },
    });
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "snapshot_rejected");
  });

  await context.test("lookalike code is not widened to transient", async () => {
    const scripted = scriptedDependencies({
      providerRead: remote(200, {
        code: "150",
        type: "platform",
        message: "Request rejected",
      }),
    });
    const outcome = await recoverExactLazadaCredential({
      jobId: exactLazadaRecoveryJobId,
      tokenHash: TOKEN_HASH,
    }, scripted.dependencies);
    assert.equal(outcome.body.status, "snapshot_rejected");
    assert.equal(scripted.calls[1]?.arguments_.p_reason, "snapshot_rejected");
  });
});

test("provider identity mismatch preserves the Vault snapshot and never finishes", async () => {
  const scripted = scriptedDependencies({ prepare: { status: "identity_mismatch" } });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.deepEqual(outcome, {
    httpStatus: 409,
    body: { ok: false, status: "identity_mismatch" },
  });
  assert.deepEqual(scripted.calls.map((call) => call.name), [
    "sellerpilot_service_claim_exact_lazada_recovery",
    "sellerpilot_service_prepare_exact_lazada_recovery",
    "sellerpilot_service_abort_exact_lazada_recovery",
  ]);
  assert.equal(scripted.calls[2]?.arguments_.p_reason, "identity_mismatch");
});

test("an invalid provider identity is terminal even when the HTTP read succeeded", async () => {
  const scripted = scriptedDependencies({ prepare: { status: "identity_invalid" } });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.equal(outcome.body.status, "identity_mismatch");
  assert.equal(scripted.calls[2]?.arguments_.p_reason, "identity_invalid");
});

test("an uncertain prepare acknowledgement is never followed by abort or finish", async () => {
  const scripted = scriptedDependencies({ prepareError: { code: "PGRST000" } });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.equal(outcome.body.status, "recovery_unavailable");
  assert.deepEqual(scripted.calls.map((call) => call.name), [
    "sellerpilot_service_claim_exact_lazada_recovery",
    "sellerpilot_service_prepare_exact_lazada_recovery",
  ]);
});

test("an uncertain finish acknowledgement is never retried", async () => {
  const scripted = scriptedDependencies({ finishError: { code: "PGRST000" } });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.equal(outcome.body.status, "recovery_unavailable");
  assert.deepEqual(scripted.calls.map((call) => call.name), [
    "sellerpilot_service_claim_exact_lazada_recovery",
    "sellerpilot_service_prepare_exact_lazada_recovery",
    "sellerpilot_service_finish_exact_lazada_recovery",
  ]);
});

test("an abort acknowledgement failure is reported without a second state change", async () => {
  const scripted = scriptedDependencies({
    providerError: new Error("timeout"),
    abortError: { code: "PGRST000" },
  });
  const outcome = await recoverExactLazadaCredential({
    jobId: exactLazadaRecoveryJobId,
    tokenHash: TOKEN_HASH,
  }, scripted.dependencies);
  assert.equal(outcome.body.status, "recovery_unavailable");
  assert.equal(scripted.calls.length, 2);
});
