import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);

test("product studio generation is segmented before any generated image work", async () => {
  const source = await readFile(workerUrl, "utf8");
  const segmentStart = source.indexOf("async function generateSegmentedStudioResult(");
  const processStart = source.indexOf("async function processJob(job)");
  const segmentedCall = source.indexOf("const result = await generateSegmentedStudioResult({", processStart);
  const imageStart = source.indexOf("const identityCutouts = await prepareIdentityCutoutsForJob(", segmentedCall);

  assert.ok(segmentStart > 0);
  assert.ok(segmentedCall > processStart);
  assert.ok(imageStart > segmentedCall, "generated image preparation must wait for the validated segmented result");
  assert.match(source, /const chunks = planStudioLocalizedChunks\(4\)/);
  assert.match(source, /const localizedGate = createConcurrencyGate\(2\)/);
  assert.match(source, /settleStudioSegmentBatch\([\s\S]{0,120}chunks\.map\(\(_, chunkIndex\) => invokeLocalized\(chunkIndex\)\)/);
  assert.match(source, /mergeStudioSegmentOutputs\(masterOutput, localizedOutputs\)/);
  assert.match(source, /cliStudioResultSchema\.safeParse/);
});

test("parallel segment batches settle every sibling before surfacing a failure", async () => {
  const source = await readFile(workerUrl, "utf8");
  const helperStart = source.indexOf("async function settleStudioSegmentBatch(tasks)");
  const helperEnd = source.indexOf("\nasync function generateSegmentedStudioResult", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /await Promise\.allSettled\(tasks\)/);
  assert.match(helper, /settled\.find\(\(entry\) => entry\.status === "rejected"\)/);
  assert.match(helper, /if \(firstFailure\) throw firstFailure\.reason/);
  assert.doesNotMatch(helper, /Promise\.all\(/);
  assert.ok((source.match(/await settleStudioSegmentBatch\(/g) ?? []).length >= 3);
});

test("master and localized phases use derived schemas, isolated invocation, and restricted stages", async () => {
  const source = await readFile(workerUrl, "utf8");
  const invokeStart = source.indexOf("async function invokeStudioSegment(");
  const invokeEnd = source.indexOf("\nfunction withReferenceWarnings", invokeStart);
  const invocation = source.slice(invokeStart, invokeEnd);

  assert.match(source, /createStudioMasterOutputSchema\(fullSchema\)/);
  assert.match(source, /createStudioLocalizedChunkOutputSchema\(fullSchema, targets\)/);
  assert.match(invocation, /await runCodexJsonArtifact\(\{/);
  assert.match(invocation, /"--output-last-message", candidatePath/);
  assert.match(invocation, /heartbeatOwnedExternally: true/);
  assert.doesNotMatch(invocation, /JSON\.parse\(await readFile\(resultFile/);
  assert.match(source, /stage\.startsWith\("studio-"\)/);
  assert.match(source, /stage: "studio-master"/);
  assert.match(source, /stage: `studio-localized\$\{repair \? "-repair" : ""\}:\$\{chunkIndex \+ 1\}`/);
  assert.match(source, /SELLERPILOT_STUDIO_MASTER_TIMEOUT_MS \?\? 25 \* 60_000/);
  assert.match(source, /SELLERPILOT_STUDIO_LOCALIZED_TIMEOUT_MS \?\? 12 \* 60_000/);
});

test("semantic repair is limited to the master or affected localized chunks", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /function studioSegmentRepairPlan\(issues, chunks\)/);
  assert.match(source, /issue\.path\[0\] !== "localizedListings"/);
  assert.match(source, /localizedChunkIndexForListingIndex\(chunks, issue\.path\[1\]\)/);
  assert.match(source, /repairPlan\.localizedChunkIndexes/);
  assert.match(source, /if \(repairPlan\.repairMaster\)/);
  assert.match(source, /chunks\.forEach\(\(_, index\) => repairPlan\.localizedChunkIndexes\.add\(index\)\)/);
  assert.match(source, /AI 분할 결과 검증 실패/);
});
