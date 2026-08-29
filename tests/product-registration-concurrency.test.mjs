import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one queued product does not serialize another product or channel write", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(studio, /readActiveStudioJobs\(\)/);
  assert.match(studio, /for \(const activeJob of activeJobs\)/);
  assert.match(studio, /void finishStudioJob\(activeJob, accessToken, true\)/);
  assert.match(studio, /shouldDisplayStudioJob\(\{/);
  assert.match(studio, /jobMonitors\.abortAll\(\)/);
  assert.match(studio, /처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다/);
  assert.match(page, /다른 상품 등록/);
  assert.match(workbench, /Promise\.all\(readyChannels\.map/);
});

test("the same product form cannot enqueue a duplicate while its own job is active", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(studio, /if \(generating \|\| generateInFlightRef\.current\) return/);
  assert.match(studio, /if \(queuedOwnJobId \|\| queuedOwnJobIdRef\.current\)[\s\S]{0,300}onRunningChange\(false\)/);
  assert.match(studio, /setQueuedOwnJobId\(queued\.jobId\)/);
  assert.match(studio, /const studioExecutionReady = isStudioExecutionReady\(workerReadiness\)/);
  assert.match(studio, /const submissionAvailable = submissionMode === "manual_mvp" \|\| studioExecutionReady/);
  assert.match(studio, /disabled=\{!mainPhoto \|\| !submissionAvailable \|\| generating \|\| Boolean\(queuedOwnJobId\)\}/);
  assert.match(page, /automationStartInFlightRef\.current = true[\s\S]{0,420}setStudioRequestId/);
  assert.match(page, /onRunningChange=\{\(nextRunning\) => \{[\s\S]{0,180}automationStartInFlightRef\.current = nextRunning/);
});

test("studio completion reconciles only the validated intake snapshot for its exact job", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const finishStart = studio.indexOf("const finishStudioJob = useCallback");
  const finishEnd = studio.indexOf("const releaseOwnJob = useCallback", finishStart);
  const finishBlock = studio.slice(finishStart, finishEnd);
  const generateStart = studio.indexOf("const generate = useCallback");
  const generateEnd = studio.indexOf("const retryOwnJobStatus = useCallback", generateStart);
  const generateBlock = studio.slice(generateStart, generateEnd);

  assert.ok(finishStart >= 0 && finishEnd > finishStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart);
  assert.match(studio, /const maximumSubmittedIntakeSnapshots = 9/);
  assert.match(studio, /submittedIntakesByJobIdRef = useRef\(new Map<string, ProductIntakeDraft>\(\)\)/);
  assert.match(studio, /const submittedIntakes = submittedIntakesByJobIdRef\.current;[\s\S]{0,280}jobMonitors\.abortAll\(\);\s*submittedIntakes\.clear\(\)/);
  assert.match(generateBlock, /while \(submittedIntakes\.size >= maximumSubmittedIntakeSnapshots\)/);
  assert.match(generateBlock, /submittedIntakes\.set\(jobId, \{ \.\.\.validatedIntake\.data \}\)/);
  assert.match(generateBlock, /terminallyRejected = true;[\s\S]{0,180}submittedIntakesByJobIdRef\.current\.delete\(jobId\)/);
  assert.match(generateBlock, /if \(\(!enqueueStarted \|\| terminallyRejected\) && preparedJobId\)[\s\S]{0,140}delete\(preparedJobId\)/);
  assert.match(finishBlock, /const submittedIntake = submittedIntakesByJobIdRef\.current\.get\(job\.jobId\) \?\? null/);
  assert.match(finishBlock, /submittedIntakesByJobIdRef\.current\.delete\(job\.jobId\);\s*if \(canDisplay\(\)\) onResultReady\?\.\(nextResult, productId, job\.jobId, submittedIntake\)/);
  assert.match(finishBlock, /error instanceof StudioJobTerminalError[\s\S]{0,180}submittedIntakesByJobIdRef\.current\.delete\(job\.jobId\)/);
});

test("failed AI cards retry only their existing server-stored input without opening an empty studio form", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("const resumeFailedAiActivity");
  const end = page.indexOf("const editExternalActionProduct", start);
  const recovery = page.slice(start, end);
  const activityStart = page.indexOf("function RegistrationActivityPage");
  const activityEnd = page.indexOf("function PublishingPage", activityStart);
  const activityPage = page.slice(activityStart, activityEnd);

  assert.ok(start >= 0 && end > start);
  assert.ok(activityStart >= 0 && activityEnd > activityStart);
  assert.match(recovery, /authenticatedOperationsFetch\("\/api\/admin\/ai-jobs"/);
  assert.match(recovery, /JSON\.stringify\(\{ jobId, action: "retry" \}\)/);
  assert.match(recovery, /activity\.id\.startsWith\("revision:"\)/);
  assert.match(recovery, /activity\.id\.startsWith\("asset:"\)/);
  assert.match(recovery, /await refreshOperations\(\)/);
  assert.match(recovery, /서버에 저장된 입력으로/);
  assert.doesNotMatch(recovery, /sessionStorage|activeStudioJobStorageKey|studioJobRecoveryStorageValue/);
  assert.doesNotMatch(recovery, /navigate\("publishing"\)/);
  assert.match(activityPage, /서버 저장 입력으로 AI 분석 재시도/);
  assert.match(activityPage, /const studioWorkerReadiness = useStudioWorkerReadiness\(authenticatedFetch\)/);
  assert.match(activityPage, /disabled=\{Boolean\(recoveringActivityId\) \|\| !studioExecutionReady\}/);
  assert.match(activityPage, /!studioExecutionReady \? recoveryUnavailableLabel/);
  assert.doesNotMatch(recovery, /channel-operations|listing\.create|listing\.update/);
});
