import assert from "node:assert/strict";
import test from "node:test";
import {
  createStudioJobMonitorRegistry,
  isStudioJobAbort,
  normalizeActiveStudioJobs,
  removeActiveStudioJob,
  shouldDisplayStudioJob,
  upsertActiveStudioJob,
  type ActiveStudioJob,
} from "../app/_registration/studio-job-session";

const currentSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const previousSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const currentJobId = "11111111-1111-4111-8111-111111111111";
const previousJobId = "22222222-2222-4222-8222-222222222222";
const now = 1_800_000_000_000;

test("normalizes persisted concurrent jobs without assigning legacy work to the current form", () => {
  const jobs = normalizeActiveStudioJobs([
    { jobId: previousJobId, startedAt: now - 4_000 },
    { jobId: currentJobId, startedAt: now - 3_000, ownerSessionId: previousSessionId },
    { jobId: currentJobId, startedAt: now - 2_000, ownerSessionId: currentSessionId },
    { jobId: "not-a-job", startedAt: now - 1_000, ownerSessionId: currentSessionId },
    { jobId: "33333333-3333-4333-8333-333333333333", startedAt: now + 1, ownerSessionId: currentSessionId },
    { jobId: "44444444-4444-4444-8444-444444444444", startedAt: now - 20_001, ownerSessionId: currentSessionId },
  ], now, 20_000);

  assert.deepEqual(jobs, [
    { jobId: previousJobId, startedAt: now - 4_000, ownerSessionId: null },
    { jobId: currentJobId, startedAt: now - 2_000, ownerSessionId: currentSessionId },
  ]);
});

test("only the mounted form session that queued a displayed job may receive its result", () => {
  const currentJob: ActiveStudioJob = { jobId: currentJobId, startedAt: now, ownerSessionId: currentSessionId };
  const previousJob: ActiveStudioJob = { jobId: previousJobId, startedAt: now - 1, ownerSessionId: previousSessionId };

  assert.equal(shouldDisplayStudioJob({ job: currentJob, mounted: true, currentSessionId, displayJobId: currentJobId }), true);
  assert.equal(shouldDisplayStudioJob({ job: previousJob, mounted: true, currentSessionId, displayJobId: previousJobId }), false);
  assert.equal(shouldDisplayStudioJob({ job: currentJob, mounted: true, currentSessionId, displayJobId: previousJobId }), false);
  assert.equal(shouldDisplayStudioJob({ job: currentJob, mounted: false, currentSessionId, displayJobId: currentJobId }), false);
});

test("keeps multiple products in history while independently upserting and clearing one job", () => {
  const previousJob: ActiveStudioJob = { jobId: previousJobId, startedAt: now - 1, ownerSessionId: previousSessionId };
  const currentJob: ActiveStudioJob = { jobId: currentJobId, startedAt: now, ownerSessionId: currentSessionId };
  const jobs = upsertActiveStudioJob([previousJob], currentJob);

  assert.deepEqual(jobs, [previousJob, currentJob]);
  assert.deepEqual(removeActiveStudioJob(jobs, currentJobId), [previousJob]);
});

test("aborts every in-flight poller on unmount and safely permits a later recovery monitor", () => {
  const monitors = createStudioJobMonitorRegistry();
  const first = monitors.begin(currentJobId);
  const previous = monitors.begin(previousJobId);
  assert.ok(first);
  assert.ok(previous);
  assert.equal(monitors.begin(currentJobId), null);
  assert.equal(monitors.size, 2);

  monitors.abortAll();
  assert.equal(first.signal.aborted, true);
  assert.equal(previous.signal.aborted, true);
  assert.equal(isStudioJobAbort(first.signal.reason), true);
  assert.equal(monitors.size, 0);

  const recovered = monitors.begin(currentJobId);
  assert.ok(recovered);
  monitors.end(currentJobId, first);
  assert.equal(monitors.size, 1);
  monitors.end(currentJobId, recovered);
  assert.equal(monitors.size, 0);
});
