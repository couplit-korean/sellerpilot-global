import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateDeployment,
  assertLinkedProject,
  candidateCanaryArguments,
  candidateDeployArguments,
  deploymentIdFromPayload,
} from "../scripts/deploy-vercel-release-candidate.mjs";

const release = "d".repeat(40);

test("candidate deployment pins the checkout SHA without promoting the public production alias", () => {
  const args = candidateDeployArguments(release);
  assert.deepEqual(args.slice(0, 3), ["dlx", "vercel@59.10.0", "deploy"]);
  assert.ok(args.includes("--prod"));
  assert.ok(args.includes("--skip-domain"));
  assert.ok(args.includes("--force"));
  assert.ok(args.includes(`SELLERPILOT_RELEASE_SHA=${release}`));
  assert.equal(args.filter((argument) => argument === `SELLERPILOT_RELEASE_SHA=${release}`).length, 2);
  assert.ok(args.includes(`sellerpilotReleaseSha=${release}`));
  assert.throws(() => candidateDeployArguments("729d62a"), /exactly 40 lowercase hex/);
});

test("candidate canary uses Vercel's protected curl without local runtime secrets", () => {
  const origin = "https://sellerpilot-global-abc123-project-e59d.vercel.app";
  const args = candidateCanaryArguments(origin);
  assert.deepEqual(args.slice(0, 3), ["dlx", "vercel@59.10.0", "curl"]);
  assert.ok(args.includes("--deployment"));
  assert.ok(args.includes(origin));
  assert.ok(args.includes('{"action":"candidate_canary"}'));
  assert.equal(args.some((argument) => /CRON_SECRET|SELLERPILOT_RUNTIME_ORIGIN|SELLERPILOT_EXPECTED_RELEASE/u.test(argument)), false);
  assert.throws(
    () => candidateCanaryArguments("https://sellerpilot-global.vercel.app"),
    /exact generated SellerPilot deployment URL/,
  );
  assert.throws(
    () => candidateCanaryArguments("https://sellerpilot-global-abc123-project-e59d.vercel.app.evil.test"),
    /exact generated SellerPilot deployment URL/,
  );
});

test("candidate deployment accepts Vercel agent JSON output", () => {
  assert.equal(
    deploymentIdFromPayload({ status: "ok", deployment: { id: "dpl_Abc123" } }),
    "dpl_Abc123",
  );
  assert.equal(deploymentIdFromPayload({ id: "dpl_Def456" }), "dpl_Def456");
  assert.throws(() => deploymentIdFromPayload({}), /did not return a deployment ID/);
});

test("candidate source proof requires the exact SellerPilot project and identical Git metadata", () => {
  assert.doesNotThrow(() => assertLinkedProject({
    orgId: "team_Y4vAMBqZlfQ4gXvkGieFh5aG",
    projectId: "prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA",
    projectName: "sellerpilot-global",
  }));
  assert.throws(() => assertLinkedProject({}), /does not identify SellerPilot production/);

  const deployment = {
    readyState: "READY",
    target: "production",
    source: "cli",
    url: "sellerpilot-global-abc123-project-e59d.vercel.app",
    meta: { gitCommitSha: release, sellerpilotReleaseSha: release },
  };
  assert.equal(
    assertCandidateDeployment(deployment, release),
    "https://sellerpilot-global-abc123-project-e59d.vercel.app",
  );
  assert.throws(
    () => assertCandidateDeployment({ ...deployment, meta: { ...deployment.meta, gitCommitSha: "a".repeat(40) } }, release),
    /Git metadata does not match/,
  );
  assert.throws(
    () => assertCandidateDeployment({ ...deployment, url: "example.com" }, release),
    /outside the exact SellerPilot/,
  );
});
