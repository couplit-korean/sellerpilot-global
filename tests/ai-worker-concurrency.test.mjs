import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createConcurrencyGate } from "../scripts/worker-concurrency-gate.mjs";

const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);
const installerUrl = new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url);

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("worker defaults and hard caps reserve nine AI and Codex slots with three localized slots", async () => {
  const [worker, installer] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(installerUrl, "utf8"),
  ]);

  assert.match(worker, /SELLERPILOT_AI_WORKER_CONCURRENCY \?\? 9/);
  assert.match(worker, /const maxAiConcurrency = Math\.min\(9, Math\.max\(1,/);
  assert.match(worker, /SELLERPILOT_CODEX_CONCURRENCY \?\? 9/);
  assert.match(worker, /const codexConcurrencyLimit = Math\.min\(9, Math\.max\(1,/);
  assert.match(worker, /const codexExecutionGate = createConcurrencyGate\(codexConcurrencyLimit\)/);
  assert.match(worker, /const nonProductCodexExecutionGate = createConcurrencyGate\(2\)/);
  assert.match(worker, /const localizedGate = createConcurrencyGate\(3\)/);
  assert.match(worker, /const workerVersion = "sellerpilot-cli-worker\/1\.60"/);
  assert.match(installer, /<key>SELLERPILOT_AI_WORKER_CONCURRENCY<\/key><string>9<\/string>/);
  assert.match(installer, /<key>SELLERPILOT_CODEX_CONCURRENCY<\/key><string>9<\/string>/);
});

test("support reply and other non-product Codex stages retain the two-slot execution gate", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const classifierMatch = worker.match(/function usesProductCodexConcurrency\(stage\) \{[\s\S]*?\n\}/);
  assert.ok(classifierMatch, "product Codex concurrency classifier must remain explicit");
  const classify = Function(`"use strict"; ${classifierMatch[0]}; return usesProductCodexConcurrency;`)();

  assert.equal(classify("studio-master"), true);
  assert.equal(classify("studio-localized:1"), true);
  assert.equal(classify("image:portrait"), true);
  assert.equal(classify("background-audit:portrait"), true);
  assert.equal(classify("support-reply"), false);
  assert.equal(classify("product-research"), false);
  assert.equal(classify("worker"), false);
  assert.match(
    worker,
    /return usesProductCodexConcurrency\(stage\)\s*\? execute\(\)\s*:\s*nonProductCodexExecutionGate\.run\(execute, \{ signal: leaseSignal \}\);/,
  );

  const supportReplyGate = createConcurrencyGate(2);
  let peak = 0;
  let releaseAll;
  const release = new Promise((resolve) => { releaseAll = resolve; });
  const tasks = Array.from({ length: 6 }, () => supportReplyGate.run(async () => {
    peak = Math.max(peak, supportReplyGate.activeCount);
    await release;
  }));
  for (let attempt = 0; attempt < 20 && peak < 2; attempt += 1) await nextTurn();
  assert.equal(supportReplyGate.activeCount, 2);
  assert.equal(peak, 2);
  releaseAll();
  await Promise.all(tasks);
});

test("three products can each hold three fair child slots within the global nine-slot cap", async () => {
  const globalGate = createConcurrencyGate(9);
  const productGates = new Map([
    ["product-a", createConcurrencyGate(3)],
    ["product-b", createConcurrencyGate(3)],
    ["product-c", createConcurrencyGate(3)],
  ]);
  const activeByProduct = new Map();
  const peakByProduct = new Map();
  let globalPeak = 0;
  let releaseAll;
  const release = new Promise((resolve) => { releaseAll = resolve; });

  const runChild = (productId) => productGates.get(productId).run(() => globalGate.run(async () => {
    const nextActive = (activeByProduct.get(productId) ?? 0) + 1;
    activeByProduct.set(productId, nextActive);
    peakByProduct.set(productId, Math.max(peakByProduct.get(productId) ?? 0, nextActive));
    globalPeak = Math.max(globalPeak, globalGate.activeCount);
    await release;
    activeByProduct.set(productId, nextActive - 1);
  }));

  const tasks = [];
  for (let child = 0; child < 3; child += 1) {
    for (const productId of productGates.keys()) tasks.push(runChild(productId));
  }
  for (let attempt = 0; attempt < 20 && globalGate.activeCount < 9; attempt += 1) await nextTurn();

  assert.equal(globalGate.activeCount, 9);
  assert.equal(globalPeak, 9);
  assert.deepEqual(Object.fromEntries(activeByProduct), {
    "product-a": 3,
    "product-b": 3,
    "product-c": 3,
  });
  assert.deepEqual(Object.fromEntries(peakByProduct), {
    "product-a": 3,
    "product-b": 3,
    "product-c": 3,
  });

  releaseAll();
  await Promise.all(tasks);
  assert.equal(globalGate.activeCount, 0);
});

test("a product generates at most three candidates per wave and commits approved images in spec order", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const batchStart = worker.indexOf("await runDeterministicProductImageBatches({");
  const batchEnd = worker.indexOf("if (existingShots.length !== imagePresets.length)", batchStart);
  const imageBatch = worker.slice(batchStart, batchEnd);

  assert.ok(batchStart > 0 && batchEnd > batchStart);
  assert.match(imageBatch, /generateCandidate: async \(\{ spec: preset, attempt, history, signal \}\)/);
  assert.match(imageBatch, /const generated = await generateDistinctAsset\(/);
  assert.match(imageBatch, /findPostGenerationConflict:/);
  assert.match(imageBatch, /onBarrierRejected: async/);
  assert.match(imageBatch, /commitCandidate: async/);
  assert.match(imageBatch, /existingShots\.push\(candidate\.fingerprint\)/);
  assert.ok(
    imageBatch.indexOf("onBarrierRejected: async")
      < imageBatch.indexOf("commitCandidate: async"),
  );
  assert.doesNotMatch(imageBatch, /for \(const preset of imagePresets\)/);
});
