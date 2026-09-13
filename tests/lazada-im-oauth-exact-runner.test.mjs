import assert from "node:assert/strict";
import test from "node:test";
import { runLazadaImExactSession } from "../scripts/lazada-im-oauth-exact-once.mjs";

const sessionId = "11111111-1111-4111-8111-111111111111";
const releaseSha = "a".repeat(40);
const egressIpSha256 = "b".repeat(64);
const workerVersion = `sellerpilot-cli-worker/1.61+${releaseSha}.${egressIpSha256.slice(0, 11)}`;
const attestation = { releaseSha, egressIpSha256, workerVersion };

test("one-shot runner waits, claims once, and reports only the verified country count", async () => {
  const actions = [];
  let claims = 0;
  let runs = 0;
  const result = await runLazadaImExactSession({
    sessionId,
    ...attestation,
    now: (() => { let value = 0; return () => ++value; })(),
    sleep: async () => {},
    call: async (body) => {
      actions.push(body);
      if (body.action === "pulse") return { status: "armed" };
      claims++;
      return claims === 1 ? { status: "waiting" } : { status: "claimed", job: { id: "fixture" } };
    },
    runJob: async () => { runs++; return { status: "completed" }; },
  });
  assert.deepEqual(result, { status: "completed", countries: 5 });
  assert.equal(claims, 2);
  assert.equal(runs, 1);
  assert.deepEqual(actions, [
    { action: "pulse", sessionId, payload: attestation },
    { action: "claim", sessionId },
    { action: "pulse", sessionId, payload: attestation },
    { action: "claim", sessionId },
  ]);
});

test("malformed or missing attestation is rejected before the first call", async () => {
  const invalid = [
    { ...attestation, releaseSha: undefined },
    { ...attestation, releaseSha: "A".repeat(40) },
    { ...attestation, egressIpSha256: "b".repeat(63) },
    { ...attestation, workerVersion: `${workerVersion}-mismatch` },
  ];
  for (const candidate of invalid) {
    let calls = 0;
    await assert.rejects(runLazadaImExactSession({
      sessionId,
      ...candidate,
      call: async () => { calls++; return { status: "armed" }; },
    }), /LAZADA_IM_EXACT_ATTESTATION_REQUIRED/u);
    assert.equal(calls, 0);
  }
});

test("pulse must arm the exact attestation before claim", async () => {
  const actions = [];
  await assert.rejects(runLazadaImExactSession({
    sessionId,
    ...attestation,
    call: async (body) => { actions.push(body); return { status: "waiting" }; },
  }), /LAZADA_IM_EXACT_PULSE_NOT_ARMED/u);
  assert.deepEqual(actions, [{ action: "pulse", sessionId, payload: attestation }]);
});

test("a failed exchange is never reclaimed or retried by the runner", async () => {
  let claims = 0;
  let runs = 0;
  await assert.rejects(runLazadaImExactSession({
    sessionId,
    ...attestation,
    call: async (body) => {
      if (body.action === "pulse") return { status: "armed" };
      claims++;
      return { status: "claimed", job: { id: "fixture" } };
    },
    runJob: async () => { runs++; throw new Error("uncertain-provider-result"); },
  }), /uncertain-provider-result/u);
  assert.equal(claims, 1);
  assert.equal(runs, 1);
});

test("runner rejects any non-completed terminal status without another claim", async () => {
  let claims = 0;
  await assert.rejects(runLazadaImExactSession({
    sessionId,
    ...attestation,
    call: async (body) => {
      if (body.action === "pulse") return { status: "armed" };
      claims++;
      return { status: "claimed", job: { id: "fixture" } };
    },
    runJob: async () => ({ status: "review" }),
  }), /LAZADA_IM_EXACT_NOT_COMPLETE/u);
  assert.equal(claims, 1);
});
