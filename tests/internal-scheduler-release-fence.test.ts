import assert from "node:assert/strict";
import test from "node:test";
import {
  internalScheduleCanaryPayload,
  resolveRuntimeReleaseIdentity,
  runtimeStatusMatchesCurrentRelease,
} from "../lib/internal-scheduler-auth";

const RELEASE_A = "a".repeat(40);
const RELEASE_B = "b".repeat(40);

test("runtime release identity never lets a manual SHA hide Vercel artifact metadata", () => {
  assert.deepEqual(resolveRuntimeReleaseIdentity({
    sellerpilotReleaseSha: RELEASE_A.toUpperCase(),
    vercelGitCommitSha: RELEASE_A,
  }), { status: "valid", release: RELEASE_A });
  assert.deepEqual(resolveRuntimeReleaseIdentity({
    sellerpilotReleaseSha: RELEASE_A,
    vercelGitCommitSha: RELEASE_B,
  }), { status: "conflict" });
  assert.deepEqual(resolveRuntimeReleaseIdentity({
    sellerpilotReleaseSha: "candidate-branch",
    vercelGitCommitSha: RELEASE_A,
  }), { status: "invalid" });
});

test("live schedules require the exact active database release", () => {
  const input = { sellerpilotReleaseSha: RELEASE_A };
  assert.equal(runtimeStatusMatchesCurrentRelease({
    active: true,
    activeRelease: RELEASE_A.toUpperCase(),
  }, input), true);
  assert.equal(runtimeStatusMatchesCurrentRelease({
    active: true,
    activeRelease: RELEASE_B,
  }, input), false);
  assert.equal(runtimeStatusMatchesCurrentRelease({
    active: false,
    activeRelease: RELEASE_A,
  }, input), false);
  assert.equal(runtimeStatusMatchesCurrentRelease({
    active: true,
    activeRelease: RELEASE_A,
  }, {
    sellerpilotReleaseSha: RELEASE_A,
    vercelGitCommitSha: RELEASE_B,
  }), false);
});

test("canary remains no-work before activation and reports an identity conflict", () => {
  assert.deepEqual(internalScheduleCanaryPayload({ sellerpilotReleaseSha: RELEASE_A }), {
    status: "canary",
    executed: false,
    release: RELEASE_A,
  });
  assert.deepEqual(internalScheduleCanaryPayload({
    sellerpilotReleaseSha: RELEASE_A,
    vercelGitCommitSha: RELEASE_B,
  }), {
    status: "canary",
    executed: false,
    releaseError: "runtime_release_conflict",
  });
});
