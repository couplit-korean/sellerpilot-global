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
  assert.match(source, /const repairSuffix = repairPass === 0 \? "" : repairPass === 1 \? "-repair" : "-repair-2"/);
  assert.match(source, /stage: `studio-localized\$\{repairSuffix\}:\$\{chunkIndex \+ 1\}`/);
  assert.match(source, /SELLERPILOT_STUDIO_MASTER_TIMEOUT_MS \?\? 35 \* 60_000/);
  assert.match(source, /SELLERPILOT_STUDIO_LOCALIZED_TIMEOUT_MS \?\? 12 \* 60_000/);
});

test("master detail image roles get one bounded repair before any localized generation", async () => {
  const source = await readFile(workerUrl, "utf8");
  const generationStart = source.indexOf("async function generateSegmentedStudioResult(");
  const localizedStart = source.indexOf("const invokeLocalized =", generationStart);
  const earlyFence = source.slice(generationStart, localizedStart);

  assert.match(earlyFence, /const initialMasterImageRoleIssue = studioMasterDetailImageRoleIssue\(masterOutput\)/);
  assert.match(earlyFence, /if \(initialMasterImageRoleIssue\)/);
  assert.match(earlyFence, /segmentId: "studio-master-image-role-repair"/);
  assert.match(earlyFence, /stage: "studio-master-image-role-repair"/);
  assert.match(earlyFence, /const repairedMasterImageRoleIssue = studioMasterDetailImageRoleIssue\(masterOutput\)/);
  assert.match(earlyFence, /if \(repairedMasterImageRoleIssue\)[\s\S]*throw new Error/);
  assert.equal((earlyFence.match(/segmentId: "studio-master-image-role-repair"/g) ?? []).length, 1);
  assert.doesNotMatch(earlyFence, /while\s*\(|for\s*\(/);

  assert.equal((source.match(/segmentId: "studio-master-image-role-repair"/g) ?? []).length, 1);
  assert.equal((source.match(/segmentId: "studio-master-repair"/g) ?? []).length, 1);
  assert.equal((source.match(/segmentId: "studio-master-repair-2"/g) ?? []).length, 1);
});

test("master generation uses a compact brief and one medium-to-low timeout fallback", async () => {
  const source = await readFile(workerUrl, "utf8");
  const invokeStart = source.indexOf("async function invokeStudioSegment(");
  const invokeEnd = source.indexOf("\nfunction withReferenceWarnings", invokeStart);
  const invocation = source.slice(invokeStart, invokeEnd);
  const generationStart = source.indexOf("async function generateSegmentedStudioResult(");
  const localizedStart = source.indexOf("const invokeLocalized =", generationStart);
  const earlyMaster = source.slice(generationStart, localizedStart);
  const localizedEnd = source.indexOf("let localizedOutputs =", localizedStart);
  const localizedInvocation = source.slice(localizedStart, localizedEnd);

  assert.match(source, /buildMarketplaceMasterStyleBrief\(/);
  assert.doesNotMatch(source, /buildMarketplaceStyleLearningBrief\(/);
  assert.match(source, /reasoningEffort: "medium"/);
  assert.match(source, /timeoutRetryReasoningEffort: "low"/);
  assert.match(source, /studioMasterTimeoutMs = Math\.min\(\s*35 \* 60_000,\s*Math\.max\(12 \* 60_000/);
  assert.match(source, /createStudioMasterInvocationBudget\(\s*studioMasterTimeoutMs,\s*codexTerminationGraceMs/);
  assert.match(invocation, /maximumAttempts = masterInvocationBudget[\s\S]*masterInvocationBudget\.remainingLaunches/);
  assert.match(invocation, /attemptReasoningEffort = useTimeoutRetryReasoning[\s\S]*timeoutRetryReasoningEffort[\s\S]*reasoningEffort/);
  assert.match(invocation, /model_reasoning_effort="\$\{attemptReasoningEffort\}"/);
  assert.match(invocation, /error\.message === "Codex CLI 실행 제한시간을 초과했습니다\."/);
  assert.match(invocation, /attempt < maximumAttempts/);
  assert.match(invocation, /onDequeued: \(queueWaitMs\) => masterInvocationBudget\?\.excludeQueueWait\(allocation, queueWaitMs\)/);
  assert.match(invocation, /try \{[\s\S]*await runCodex\([\s\S]*finally \{[\s\S]*masterInvocationBudget\.settle\(allocation\)/);
  assert.doesNotMatch(invocation, /retryRunError:[\s\S]*JobCancelledError/);
  assert.ok((earlyMaster.match(/masterInvocationBudget,/g) ?? []).length >= 2);
  assert.equal((source.match(/\.\.\.studioMasterInvocationPolicy,\s*masterInvocationBudget,/g) ?? []).length, 4);
  assert.doesNotMatch(localizedInvocation, /studioMasterInvocationPolicy/);
  assert.match(localizedInvocation, /timeoutMs: studioLocalizedTimeoutMs/);
  assert.match(source, /단순 상품은 서로 다른 근거가 있는 질문 16개를 기본/);
  assert.match(source, /최소 160자를 유지하되 보통 160~360자/);
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

test("one finite residual repair uses isolated second-pass artifacts and settles every localized sibling", async () => {
  const source = await readFile(workerUrl, "utf8");
  const residualStart = source.indexOf("const residualIssues = parsed.error.issues");
  const terminalFailure = source.indexOf("AI 분할 결과 검증 실패", residualStart);
  const residual = source.slice(residualStart, terminalFailure);

  assert.ok(residualStart > 0);
  assert.match(residual, /const residualRepairPlan = studioSegmentRepairPlan\(residualIssues, chunks\)/);
  assert.match(residual, /if \(residualRepairPlan\.repairMaster\)/);
  assert.match(residual, /segmentId: "studio-master-repair-2"/);
  assert.match(residual, /stage: "studio-master-repair-2"/);
  assert.match(residual, /chunks\.forEach\(\(_, index\) => residualRepairPlan\.localizedChunkIndexes\.add\(index\)\)/);
  assert.match(residual, /await settleStudioSegmentBatch\(/);
  assert.match(residual, /draft: localizedOutputs\[chunkIndex\]/);
  assert.match(residual, /repairPass: 2/);
  assert.match(residual, /parsed = parseMergedStudioSegments\(masterOutput, localizedOutputs\)/);
  assert.equal((residual.match(/repairPass: 2/g) ?? []).length, 1, "the residual localized pass must be finite");
  assert.equal((residual.match(/studio-master-repair-2/g) ?? []).length, 2, "the residual master pass has one segment and one stage");
});

test("studio result normalization applies general-food safety before structural repairs", async () => {
  const [source, contract] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(new URL("../lib/ai-cli-contract.ts", import.meta.url), "utf8"),
  ]);
  const helperStart = contract.indexOf("export function normalizeStudioSectionCount(value: unknown)");
  const helperEnd = contract.indexOf("\nfunction boundedTitleKeyword", helperStart);
  const helper = contract.slice(helperStart, helperEnd);
  const terminalHelperStart = contract.indexOf("export function normalizeStudioResultForTerminalValidation(value: unknown)");
  const terminalHelperEnd = contract.indexOf("\nexport const requiredLocalizedMarkets", terminalHelperStart);
  const terminalHelper = contract.slice(terminalHelperStart, terminalHelperEnd);

  assert.match(helper, /sections\.length < 16 \|\| sections\.length > 20/);
  assert.match(helper, /targetSectionCount: sections\.length/);
  assert.match(terminalHelper, /normalizeStudioLocalizedKeywordCoverage\(normalizeStudioWarningLimits\(/);
  assert.match(
    terminalHelper,
    /normalizeStudioSectionCount\(normalizeStudioGeneralFoodSafety\([\s\S]*normalizeStudioLocalizedEvidenceLanguage\(value\)/,
  );
  assert.match(source, /normalizeStudioResultForTerminalValidation\(merged\)/);
  assert.match(source, /normalizeStudioResultForTerminalValidation\(job\.request\?\.sourceResult\)/);
  assert.equal((source.match(/normalizeStudioResultForTerminalValidation\(/g) ?? []).length, 2);
});

test("repair prompts fail closed on unsupported general-food intake and efficacy claims", async () => {
  const source = await readFile(workerUrl, "utf8");
  assert.match(source, /title·shortDescription·description에는 처방형 섭취 수치·횟수·기간을 항상 생략하세요/);
  assert.match(source, /같은 section\.evidence에 대상 locale로 완전히 번역/);
  assert.match(source, /oneLine·targetCustomer·features와 design의 heroCopy·heroSubcopy에는 처방형 섭취 수치/);
  assert.match(source, /면역·혈당·체중감량·체지방·소화 개선/);
  assert.match(source, /해당 주장 자체를 삭제하세요/);
  assert.match(source, /targetSectionCount는 수정 후 design\.sections의 실제 개수와 정확히 같아야 합니다/);
  assert.match(source, /한국어 근거 문장을 그대로 복사하지 마세요/);
});
