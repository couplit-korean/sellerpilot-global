import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  immutableProductImageHistory,
  PRODUCT_IMAGE_BATCH_SIZE,
  runDeterministicProductImageBatches,
  type ProductImageHistory,
} from "../lib/product-image-batch-coordinator";
import { createConcurrencyGate } from "../scripts/worker-concurrency-gate.mjs";

const emptyHistory = (): ProductImageHistory => ({
  shots: [],
  backgroundShots: [],
  backgroundProps: [],
});

function fingerprint(assetId: string, seed = assetId, digest = seed) {
  return {
    assetId,
    digest,
    visualHash: new Uint8Array(createHash("sha256").update(seed).digest()),
  };
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("product image batches are capped at three and commit in stable spec order", async () => {
  assert.equal(PRODUCT_IMAGE_BATCH_SIZE, 3);
  const specs = Array.from({ length: 8 }, (_, index) => ({ id: `asset-${index}` }));
  let active = 0;
  let peak = 0;
  const started: string[] = [];
  const committed: string[] = [];
  const history = emptyHistory();

  await runDeterministicProductImageBatches({
    specs,
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, specIndex }) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(spec.id);
      await wait((3 - (specIndex % 3)) * 2);
      active -= 1;
      return { status: "accepted", fingerprint: fingerprint(spec.id), value: spec.id };
    },
    commitCandidate: async ({ candidate }) => {
      assert.equal(Object.isFrozen(candidate), true);
      assert.equal(Object.isFrozen(candidate.fingerprint), true);
      committed.push(candidate.assetId);
      history.shots.push(candidate.fingerprint);
    },
  });

  assert.equal(peak, 3);
  assert.deepEqual(started.slice(0, 3), ["asset-0", "asset-1", "asset-2"]);
  assert.deepEqual(committed, specs.map((spec) => spec.id));
});

test("candidate histories are isolated immutable snapshots", async () => {
  const original = fingerprint("existing");
  const history: ProductImageHistory = {
    shots: [original],
    backgroundShots: [],
    backgroundProps: [],
  };
  const immutable = immutableProductImageHistory(history);
  assert.equal(Object.isFrozen(immutable.shots), true);
  assert.equal(Object.isFrozen(immutable.shots[0]), true);

  await runDeterministicProductImageBatches({
    specs: [{ id: "next" }],
    getCommittedHistory: () => history,
    generateCandidate: async ({ history: snapshot }) => {
      assert.equal(Object.isFrozen(snapshot.shots), true);
      assert.throws(() => snapshot.shots.push(fingerprint("forbidden")), TypeError);
      snapshot.shots[0].visualHash[0] ^= 255;
      return { status: "accepted", fingerprint: fingerprint("next"), value: "next" };
    },
    commitCandidate: async ({ candidate }) => {
      history.shots.push(candidate.fingerprint);
    },
  });

  assert.deepEqual(original.visualHash, fingerprint("existing").visualHash);
});

test("same-wave exact and near duplicates lose deterministically and only losers retry", async () => {
  const specs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const history = emptyHistory();
  const attempts = new Map<string, number>();
  const rejections: string[] = [];
  const commits: string[] = [];
  const a = fingerprint("a", "winner-a", "exact-digest");

  await runDeterministicProductImageBatches({
    specs,
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, attempt }) => {
      attempts.set(spec.id, attempt);
      if (spec.id === "a") {
        await wait(15);
        return { status: "accepted", fingerprint: a, value: spec.id };
      }
      if (spec.id === "b" && attempt === 1) {
        return {
          status: "accepted",
          fingerprint: { ...a, assetId: "b", visualHash: a.visualHash.slice() },
          value: spec.id,
        };
      }
      return { status: "accepted", fingerprint: fingerprint(spec.id, `${spec.id}-${attempt}`), value: spec.id };
    },
    onBarrierRejected: ({ spec, conflict }) => {
      rejections.push(`${spec.id}:${conflict.kind}:${conflict.assetId}`);
    },
    commitCandidate: async ({ candidate }) => {
      commits.push(candidate.assetId);
      history.shots.push(candidate.fingerprint);
    },
  });

  assert.deepEqual(Object.fromEntries(attempts), { a: 1, b: 2, c: 1 });
  assert.deepEqual(rejections, ["b:shot:a"]);
  assert.deepEqual(commits, ["a", "b", "c"]);

  const nearHistory = emptyHistory();
  const nearAttempts: number[] = [];
  await runDeterministicProductImageBatches({
    specs: [{ id: "near-a" }, { id: "near-b" }],
    getCommittedHistory: () => nearHistory,
    generateCandidate: async ({ spec, attempt }) => {
      nearAttempts.push(attempt);
      const base = fingerprint("near-a", "near-visual", "near-a");
      return spec.id === "near-b" && attempt === 1
        ? { status: "accepted", fingerprint: { ...base, assetId: spec.id, digest: "near-b" }, value: spec.id }
        : { status: "accepted", fingerprint: spec.id === "near-a" ? base : fingerprint(spec.id, "far-visual"), value: spec.id };
    },
    commitCandidate: async ({ candidate }) => { nearHistory.shots.push(candidate.fingerprint); },
  });
  assert.deepEqual(nearAttempts, [1, 1, 2]);
});

test("background and prop collisions retry only the later spec", async () => {
  const specs = [{ id: "portrait" }, { id: "wide" }, { id: "context" }];
  const history = emptyHistory();
  const attempts = new Map<string, number>();
  const conflicts: string[] = [];
  const sharedBackground = fingerprint("background:portrait", "same-background", "background-a");

  await runDeterministicProductImageBatches({
    specs,
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, attempt }) => {
      attempts.set(spec.id, attempt);
      const backgroundShot = spec.id === "wide" && attempt === 1
        ? { ...sharedBackground, assetId: "background:wide", digest: "background-b" }
        : spec.id === "portrait"
          ? sharedBackground
          : fingerprint(`background:${spec.id}`, `${spec.id}-background-${attempt}`);
      const propKey = spec.id === "context" && attempt === 1 ? "portrait-prop-1" : `${spec.id}-prop-${attempt}`;
      return {
        status: "accepted",
        fingerprint: fingerprint(spec.id, `${spec.id}-output-${attempt}`),
        backgroundShot,
        backgroundProps: { assetId: spec.id, propKeys: [propKey] },
        value: spec.id,
      };
    },
    onBarrierRejected: ({ spec, conflict }) => { conflicts.push(`${spec.id}:${conflict.kind}`); },
    commitCandidate: async ({ candidate }) => {
      history.shots.push(candidate.fingerprint);
      if (candidate.backgroundShot) history.backgroundShots.push(candidate.backgroundShot);
      if (candidate.backgroundProps) history.backgroundProps.push(candidate.backgroundProps);
    },
  });

  assert.equal(attempts.get("portrait"), 1);
  assert.equal(attempts.get("wide"), 2);
  assert.equal(attempts.get("context"), 2);
  assert.deepEqual(conflicts, ["wide:background", "context:prop"]);

  const propHistory: ProductImageHistory = {
    shots: [],
    backgroundShots: [],
    backgroundProps: [{ assetId: "existing", propKeys: ["same-prop"] }],
  };
  let propAttempt = 0;
  await runDeterministicProductImageBatches({
    specs: [{ id: "prop-candidate" }],
    getCommittedHistory: () => propHistory,
    generateCandidate: async ({ spec, attempt }) => {
      propAttempt = attempt;
      return {
        status: "accepted",
        fingerprint: fingerprint(spec.id, `${spec.id}-${attempt}`),
        backgroundProps: { assetId: spec.id, propKeys: [attempt === 1 ? "same-prop" : "new-prop"] },
        value: spec.id,
      };
    },
    commitCandidate: async () => {},
  });
  assert.equal(propAttempt, 2);
});

test("semantic barrier runs in spec order, retries only the loser, and uploads nothing before approval", async () => {
  const specs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const history = emptyHistory();
  const attempts = new Map<string, number>();
  const semanticChecks: string[] = [];
  const semanticRejections: string[] = [];
  const uploads: string[] = [];

  await runDeterministicProductImageBatches({
    specs,
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, attempt, specIndex }) => {
      attempts.set(spec.id, attempt);
      await wait((3 - specIndex) * 2);
      return {
        status: "accepted",
        fingerprint: fingerprint(spec.id, `${spec.id}-output-${attempt}`),
        backgroundShot: fingerprint(`background:${spec.id}`, `${spec.id}-background-${attempt}`),
        backgroundProps: { assetId: spec.id, propKeys: [`${spec.id}-prop-${attempt}`] },
        value: spec.id,
      };
    },
    findPostGenerationConflict: async ({ spec, attempt, acceptedCandidates }) => {
      assert.equal(uploads.length, 0, "semantic barrier must finish before any upload/commit");
      assert.equal(history.shots.length, 0, "semantic barrier must not mutate committed history");
      assert.equal(Object.isFrozen(acceptedCandidates), true);
      semanticChecks.push(`${spec.id}:${attempt}:${acceptedCandidates.map((candidate) => candidate.assetId).join(",")}`);
      if (spec.id === "b" && attempt === 1) {
        return {
          kind: "semantic",
          assetId: "a",
          conflictingAssetIds: ["a"],
          retryAuditFeedback: {
            failedDimensions: ["location", "time-light", "surface", "palette", "spatial-depth", "camera"],
            hardNegativeLocationKeys: ["same-room"],
          },
          safeForRetryComparison: true,
        };
      }
      return null;
    },
    onBarrierRejected: ({ spec, conflict }) => {
      semanticRejections.push(`${spec.id}:${conflict.kind}:${conflict.assetId}`);
    },
    commitCandidate: async ({ candidate }) => {
      uploads.push(candidate.assetId);
      history.shots.push(candidate.fingerprint);
      if (candidate.backgroundShot) history.backgroundShots.push(candidate.backgroundShot);
      if (candidate.backgroundProps) history.backgroundProps.push(candidate.backgroundProps);
    },
  });

  assert.deepEqual(Object.fromEntries(attempts), { a: 1, b: 2, c: 1 });
  assert.deepEqual(semanticChecks, ["a:1:", "b:1:a", "c:1:a", "b:2:a,c"]);
  assert.deepEqual(semanticRejections, ["b:semantic:a"]);
  assert.deepEqual(uploads, ["a", "b", "c"]);
});

test("semantic barrier exhaustion keeps uploads and committed history empty", async () => {
  const history = emptyHistory();
  let attempts = 0;
  let uploads = 0;
  await assert.rejects(runDeterministicProductImageBatches({
    specs: [{ id: "candidate" }],
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, attempt }) => {
      attempts = attempt;
      return {
        status: "accepted",
        fingerprint: fingerprint(spec.id, `candidate-${attempt}`),
        value: spec.id,
      };
    },
    findPostGenerationConflict: async () => ({
      kind: "semantic",
      assetId: "accepted-scene",
      conflictingAssetIds: ["accepted-scene"],
      retryAuditFeedback: { failedDimensions: ["location", "camera"] },
      safeForRetryComparison: true,
    }),
    commitCandidate: async () => { uploads += 1; },
  }), /semantic:accepted-scene/);
  assert.equal(attempts, 4);
  assert.equal(uploads, 0);
  assert.equal(history.shots.length, 0);
});

test("three products can use three candidates each while the shared global gate stays at nine", async () => {
  const globalGate = createConcurrencyGate(9);
  let globalPeak = 0;
  const perProductActive = new Map<string, number>();
  const perProductPeak = new Map<string, number>();
  let releaseAll: (() => void) | undefined;
  const release = new Promise<void>((resolve) => { releaseAll = resolve; });

  const runs = ["p1", "p2", "p3"].map((productId) => runDeterministicProductImageBatches({
    specs: [0, 1, 2].map((index) => ({ id: `${productId}-${index}` })),
    getCommittedHistory: emptyHistory,
    generateCandidate: ({ spec }) => globalGate.run(async () => {
      const active = (perProductActive.get(productId) ?? 0) + 1;
      perProductActive.set(productId, active);
      perProductPeak.set(productId, Math.max(perProductPeak.get(productId) ?? 0, active));
      globalPeak = Math.max(globalPeak, globalGate.activeCount);
      await release;
      perProductActive.set(productId, active - 1);
      return { status: "accepted", fingerprint: fingerprint(spec.id), value: spec.id } as const;
    }),
    commitCandidate: async () => {},
  }));

  for (let index = 0; index < 50 && globalGate.activeCount < 9; index += 1) await wait(1);
  await wait(0);
  assert.equal(globalGate.activeCount, 9);
  assert.equal(globalPeak, 9);
  assert.deepEqual(Object.fromEntries(perProductPeak), { p1: 3, p2: 3, p3: 3 });
  releaseAll?.();
  await Promise.all(runs);
});

test("the four-attempt budget is shared across waves", async () => {
  let calls = 0;
  let commits = 0;
  await assert.rejects(runDeterministicProductImageBatches({
    specs: [{ id: "never" }],
    getCommittedHistory: emptyHistory,
    generateCandidate: async () => {
      calls += 1;
      return { status: "retry", reason: "still invalid" };
    },
    commitCandidate: async () => { commits += 1; },
  }), /4회 시도/);
  assert.equal(calls, 4);
  assert.equal(commits, 0);
});

test("internal retries consume the same four-attempt role budget before a barrier retry", async () => {
  const existing = fingerprint("existing", "existing-visual", "existing-digest");
  const history: ProductImageHistory = {
    shots: [existing],
    backgroundShots: [],
    backgroundProps: [],
  };
  const startingAttempts: number[] = [];
  await runDeterministicProductImageBatches({
    specs: [{ id: "candidate" }],
    getCommittedHistory: () => history,
    generateCandidate: async ({ spec, attempt }) => {
      startingAttempts.push(attempt);
      return attempt === 1
        ? {
            status: "accepted",
            attemptsUsed: 3,
            fingerprint: { ...existing, assetId: spec.id },
            value: spec.id,
          }
        : {
            status: "accepted",
            fingerprint: fingerprint(spec.id, "unique-fourth-attempt"),
            value: spec.id,
          };
    },
    commitCandidate: async ({ candidate }) => { history.shots.push(candidate.fingerprint); },
  });
  assert.deepEqual(startingAttempts, [1, 4]);
  assert.equal(history.shots.at(-1)?.assetId, "candidate");
});

test("lease abort settles the wave without committing or uploading an unapproved candidate", async () => {
  const controller = new AbortController();
  let commits = 0;
  let started = 0;
  const run = runDeterministicProductImageBatches({
    specs: [{ id: "one" }, { id: "two" }, { id: "three" }],
    signal: controller.signal,
    getCommittedHistory: emptyHistory,
    generateCandidate: ({ signal }) => new Promise((resolve, reject) => {
      started += 1;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      void resolve;
    }),
    commitCandidate: async () => { commits += 1; },
  });
  while (started < 3) await wait(1);
  const leaseError = new Error("lease lost");
  controller.abort(leaseError);
  await assert.rejects(run, (error) => error === leaseError);
  assert.equal(commits, 0);
});
