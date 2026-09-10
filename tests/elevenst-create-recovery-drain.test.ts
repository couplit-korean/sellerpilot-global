import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  assertOfficialRecoveryObservation,
  drainElevenstCreateRecovery,
  elevenstCreateRecoveryWorkerRpc,
  parseElevenstCreateRecoveryClaim,
} from "../lib/channels/elevenst-create-recovery-drain";
import type { ElevenstCreateRecoveryObservation } from "../lib/product-registration/elevenst/create-recovery";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");

const apiKey = "A".repeat(32);
const jobId = "10000000-0000-4000-8000-000000000011";
const recoveryToken = "20000000-0000-4000-8000-000000000012";
const credentialId = "30000000-0000-4000-8000-000000000013";
const vaultSecretId = "40000000-0000-4000-8000-000000000014";
const sellerProductCode = "ELEVENST-RECOVERY-DRAIN-001";

function recoveryClaim(): Record<string, unknown> {
  return {
    contract: "sellerpilot_elevenst_create_recovery_claim_v1",
    jobId,
    recoveryToken,
    credentialId,
    credentialVersion: 3,
    credentialFingerprint: "ABCDEF123456",
    vaultSecretId,
    expectedApiKeySha256: createHash("sha256").update(apiKey).digest("hex"),
    expectedProduct: { sellerPrdCd: sellerProductCode, prdSelQty: "7" },
    credential: { api_key: apiKey },
  };
}

function xmlResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function emptyObservation(): ElevenstCreateRecoveryObservation {
  return {
    contract: "sellerpilot_elevenst_create_get_only_recovery_v2",
    outcome: "absent",
    sellerProductCode,
    productNo: null,
    fullOfficialReadback: false,
    productMismatches: [],
    stockMismatches: [],
    providerReadbackUnavailableFields: [],
    providerMutationPerformed: false,
    credentialEvidence: {
      credentialId,
      credentialVersion: 3,
      credentialFingerprint: "ABCDEF123456",
      vaultSecretId,
      apiKeySha256: createHash("sha256").update(apiKey).digest("hex"),
    },
    authoritativeSnapshot: {
      categoryId: "",
      priceKrw: Number.NaN,
      stockQuantity: Number.NaN,
      titleSha256: createHash("sha256").update("", "utf8").digest("hex"),
      productImagesSha256: createHash("sha256").update("\n\n\n", "utf8").digest("hex"),
      detailHtmlSha256: createHash("sha256").update("", "utf8").digest("hex"),
    },
    providerReads: [],
    observedAt: new Date().toISOString(),
  };
}

test("recovery claim requires the live api key and rejects a hash-only payload", () => {
  const parsed = parseElevenstCreateRecoveryClaim(recoveryClaim());
  assert.equal(parsed?.payload.api_key, apiKey);
  assert.equal(parseElevenstCreateRecoveryClaim({
    ...recoveryClaim(),
    credential: {},
  }), null);
});

test("synthetic fullOfficialReadback without official GET hashes cannot complete", () => {
  const observation = emptyObservation();
  observation.outcome = "unique";
  observation.fullOfficialReadback = true;
  observation.productNo = "1234567890";
  assert.throws(
    () => assertOfficialRecoveryObservation(observation),
    /ELEVENST_CREATE_RECOVERY_SYNTHETIC_OBSERVATION/u,
  );
});

test("serverless drain finishes recovery with owned v2 GET evidence and never POSTs", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const rpcNames: string[] = [];
  let finishObservation: ElevenstCreateRecoveryObservation | null = null;
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    return xmlResponse(
      `<?xml version="1.0"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`,
    );
  };
  try {
    const response = await runOneServerlessCsGatewayJob({
      rpc: async (name, arguments_ = {}) => {
        rpcNames.push(name);
        if (name === "sellerpilot_service_claim_elevenst_create_recovery") {
          return { data: recoveryClaim(), error: null };
        }
        if (name === "sellerpilot_service_finish_elevenst_create_recovery") {
          finishObservation = arguments_.p_observation as ElevenstCreateRecoveryObservation;
          return {
            data: {
              status: "reconciliation_required",
              jobId,
              remoteId: null,
              automaticRetryAllowed: false,
              providerMutationPerformed: false,
            },
            error: null,
          };
        }
        return { data: null, error: { code: "unexpected_rpc" } };
      },
    }, "a".repeat(64));
    const body = await response.json() as { status: string; claimed: number };
    assert.equal(response.status, 200);
    assert.equal(body.status, "reconciliation_required");
    assert.equal(body.claimed, 1);
    assert.deepEqual(methods, ["GET"]);
    assert.equal(methods.includes("POST"), false);
    assert.deepEqual(rpcNames, [
      "sellerpilot_service_claim_elevenst_create_recovery",
      "sellerpilot_service_finish_elevenst_create_recovery",
    ]);
    assert.equal(finishObservation?.contract, "sellerpilot_elevenst_create_get_only_recovery_v2");
    assert.equal(finishObservation?.outcome, "absent");
    assert.equal(finishObservation?.fullOfficialReadback, false);
    assert.equal(finishObservation?.providerMutationPerformed, false);
    assert.equal(finishObservation?.providerReads[0]?.method, "GET");
    assert.match(finishObservation?.providerReads[0]?.requestBytesSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(finishObservation?.providerReads[0]?.responseBodySha256 ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serverless drain does not complete recovery from a synthetic observation", async () => {
  const originalFetch = globalThis.fetch;
  const rpcNames: string[] = [];
  globalThis.fetch = async () => {
    throw new Error("provider must not be called for an invalid claim");
  };
  try {
    const response = await runOneServerlessCsGatewayJob({
      rpc: async (name) => {
        rpcNames.push(name);
        if (name === "sellerpilot_service_claim_elevenst_create_recovery") {
          return {
            data: {
              contract: "sellerpilot_elevenst_create_get_only_recovery_v1",
              jobId,
              recoveryToken,
            },
            error: null,
          };
        }
        return { data: { id: jobId }, error: null };
      },
    }, "a".repeat(64));
    assert.equal(response.status, 503);
    assert.deepEqual(rpcNames, ["sellerpilot_service_claim_elevenst_create_recovery"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing recovery claim falls through without inventing a completed observation", async () => {
  const rpcNames: string[] = [];
  const response = await runOneServerlessCsGatewayJob({
    rpc: async (name) => {
      rpcNames.push(name);
      if (name === "sellerpilot_service_claim_elevenst_create_recovery") {
        return { data: null, error: { code: "unexpected_rpc" } };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        return { data: null, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  }, "a".repeat(64));
  const body = await response.json() as { status: string; claimed: number };
  assert.equal(response.status, 200);
  assert.equal(body.status, "idle");
  assert.equal(body.claimed, 0);
  assert.equal(rpcNames.includes("sellerpilot_service_finish_elevenst_create_recovery"), false);
});

test("local worker drain finishes recovery with owned v2 GET evidence and never POSTs", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const rpcNames: string[] = [];
  let finishObservation: ElevenstCreateRecoveryObservation | null = null;
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    return xmlResponse(
      `<?xml version="1.0"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`,
    );
  };
  try {
    const drained = await drainElevenstCreateRecovery({
      tokenHash: "a".repeat(64),
      rpc: async (name, arguments_ = {}) => {
        rpcNames.push(name);
        if (name === "sellerpilot_service_claim_elevenst_create_recovery") {
          return { data: recoveryClaim(), error: null };
        }
        if (name === "sellerpilot_service_finish_elevenst_create_recovery") {
          finishObservation = arguments_.p_observation as ElevenstCreateRecoveryObservation;
          return {
            data: {
              status: "reconciliation_required",
              jobId,
              remoteId: null,
              automaticRetryAllowed: false,
              providerMutationPerformed: false,
            },
            error: null,
          };
        }
        return { data: null, error: { code: "unexpected_rpc" } };
      },
    });
    assert.equal(drained.kind, "finished");
    if (drained.kind !== "finished") return;
    assert.equal(drained.status, "reconciliation_required");
    assert.deepEqual(methods, ["GET"]);
    assert.equal(methods.includes("POST"), false);
    assert.deepEqual(rpcNames, [
      "sellerpilot_service_claim_elevenst_create_recovery",
      "sellerpilot_service_finish_elevenst_create_recovery",
    ]);
    assert.equal(finishObservation?.contract, "sellerpilot_elevenst_create_get_only_recovery_v2");
    assert.equal(finishObservation?.fullOfficialReadback, false);
    assert.equal(finishObservation?.providerMutationPerformed, false);
    assert.equal(finishObservation?.providerReads[0]?.method, "GET");
    assert.match(finishObservation?.providerReads[0]?.requestBytesSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(finishObservation?.providerReads[0]?.responseBodySha256 ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local worker drain does not complete recovery from a synthetic observation", async () => {
  const originalFetch = globalThis.fetch;
  const rpcNames: string[] = [];
  globalThis.fetch = async () => {
    throw new Error("provider must not be called for an invalid claim");
  };
  try {
    const drained = await drainElevenstCreateRecovery({
      tokenHash: "a".repeat(64),
      rpc: async (name) => {
        rpcNames.push(name);
        if (name === "sellerpilot_service_claim_elevenst_create_recovery") {
          return {
            data: {
              contract: "sellerpilot_elevenst_create_get_only_recovery_v1",
              jobId,
              recoveryToken,
            },
            error: null,
          };
        }
        return { data: { status: "completed" }, error: null };
      },
    });
    assert.equal(drained.kind, "invalid");
    assert.deepEqual(rpcNames, ["sellerpilot_service_claim_elevenst_create_recovery"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("commerce-gateway-job worker HTTP drain claims and finishes without inventing completed", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const actions: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(String(init?.method ?? "GET"));
    return xmlResponse(
      `<?xml version="1.0"?><ns2:products xmlns:ns2="http://skt.tmall.business.openapi.spring.service.client.domain"></ns2:products>`,
    );
  };
  try {
    const { processElevenstCreateRecoveryDrain } = await import(
      "../scripts/commerce-gateway-job.mjs"
    );
    const drained = await processElevenstCreateRecoveryDrain({
      request: async (_path, body) => {
        actions.push(String(body.action ?? ""));
        if (body.action === "claim") {
          return Response.json({ status: "claimed", claim: recoveryClaim() });
        }
        if (body.action === "finish") {
          assert.equal(
            (body.observation as ElevenstCreateRecoveryObservation).contract,
            "sellerpilot_elevenst_create_get_only_recovery_v2",
          );
          assert.equal(
            (body.observation as ElevenstCreateRecoveryObservation).providerMutationPerformed,
            false,
          );
          return Response.json({
            status: "reconciliation_required",
            jobId,
            providerMutationPerformed: false,
          });
        }
        return Response.json({ status: "completed" }, { status: 500 });
      },
    });
    assert.equal(drained.kind, "finished");
    if (drained.kind !== "finished") return;
    assert.equal(drained.status, "reconciliation_required");
    assert.deepEqual(actions, ["claim", "finish"]);
    assert.deepEqual(methods, ["GET"]);
    const idle = await processElevenstCreateRecoveryDrain({
      request: async () => Response.json({ status: "idle", claimed: 0 }),
    });
    assert.equal(idle.kind, "idle");
    const rpc = elevenstCreateRecoveryWorkerRpc(async () => (
      Response.json({ status: "idle", claimed: 0 })
    ));
    const claimed = await rpc("sellerpilot_service_claim_elevenst_create_recovery", {});
    assert.equal(claimed.data, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
