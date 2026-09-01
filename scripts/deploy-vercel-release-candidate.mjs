import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;
const EXPECTED_PROJECT = Object.freeze({
  orgId: "team_Y4vAMBqZlfQ4gXvkGieFh5aG",
  projectId: "prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA",
  projectName: "sellerpilot-global",
});
const VERCEL_VERSION = "59.10.0";

function fail(message) {
  throw new Error(message);
}

export function candidateDeployArguments(release) {
  if (!RELEASE_PATTERN.test(release)) fail("release SHA must be exactly 40 lowercase hex characters");
  return [
    "dlx",
    `vercel@${VERCEL_VERSION}`,
    "deploy",
    "--prod",
    "--skip-domain",
    "--yes",
    "--force",
    "--format=json",
    "--env",
    `SELLERPILOT_RELEASE_SHA=${release}`,
    "--build-env",
    `SELLERPILOT_RELEASE_SHA=${release}`,
    "--meta",
    `sellerpilotReleaseSha=${release}`,
  ];
}

export function candidateCanaryArguments(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail("candidate canary origin is invalid");
  }
  if (parsed.protocol !== "https:"
      || !/^sellerpilot-global-[a-z0-9]+-project-e59d\.vercel\.app$/u.test(parsed.hostname)
      || parsed.host !== parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash) {
    fail("candidate canary origin must be the exact generated SellerPilot deployment URL");
  }
  return [
    "dlx",
    `vercel@${VERCEL_VERSION}`,
    "curl",
    "/api/admin/serverless-runtime-release",
    "--deployment",
    parsed.origin,
    "-X",
    "POST",
    "-H",
    "content-type: application/json",
    "--data",
    '{"action":"candidate_canary"}',
  ];
}

export function assertLinkedProject(project) {
  for (const [key, expected] of Object.entries(EXPECTED_PROJECT)) {
    if (project?.[key] !== expected) fail(`linked Vercel ${key} does not identify SellerPilot production`);
  }
}

export function assertCandidateDeployment(deployment, release) {
  if (deployment?.readyState !== "READY") fail("candidate deployment is not READY");
  if (deployment?.target !== "production") fail("candidate deployment does not use the production environment");
  if (deployment?.source !== "cli") fail("candidate deployment is not a CLI source deployment");
  if (deployment?.meta?.gitCommitSha !== release) fail("candidate Git metadata does not match the checkout HEAD");
  if (deployment?.meta?.sellerpilotReleaseSha !== release) fail("candidate release metadata does not match the checkout HEAD");
  if (typeof deployment?.url !== "string" || !/^sellerpilot-global-[a-z0-9]+-project-e59d\.vercel\.app$/u.test(deployment.url)) {
    fail("candidate deployment URL is outside the exact SellerPilot Vercel project");
  }
  return `https://${deployment.url}`;
}

export function deploymentIdFromPayload(payload) {
  const deploymentId = payload?.deployment?.id ?? payload?.id ?? payload?.deploymentId;
  if (typeof deploymentId !== "string" || !/^dpl_[A-Za-z0-9]+$/u.test(deploymentId)) {
    fail("Vercel candidate deployment did not return a deployment ID");
  }
  return deploymentId;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
  }).trim();
}

function exactHead() {
  const release = run("git", ["rev-parse", "HEAD"]);
  if (!RELEASE_PATTERN.test(release)) fail("current Git HEAD is not a full commit SHA");
  const dirty = run("git", ["status", "--porcelain"]);
  if (dirty) fail("candidate deploy requires a clean Git worktree");
  return release;
}

function linkedProject() {
  try {
    return JSON.parse(readFileSync(".vercel/project.json", "utf8"));
  } catch {
    fail(".vercel/project.json is required; link the exact SellerPilot Vercel project first");
  }
}

function deployCandidate(release) {
  const result = spawnSync("pnpm", candidateDeployArguments(release), {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Vercel candidate deployment failed (${result.status ?? "unknown"})`);
  const payload = JSON.parse(result.stdout);
  return deploymentIdFromPayload(payload);
}

function inspectCandidate(deploymentId) {
  return JSON.parse(run("pnpm", [
    "dlx",
    `vercel@${VERCEL_VERSION}`,
    "api",
    `/v13/deployments/${deploymentId}`,
  ]));
}

async function main() {
  const allowed = new Set(["--dry-run"]);
  if (process.argv.slice(2).some((argument) => !allowed.has(argument))) {
    fail("usage: node scripts/deploy-vercel-release-candidate.mjs [--dry-run]");
  }
  assertLinkedProject(linkedProject());
  const release = exactHead();
  const args = candidateDeployArguments(release);
  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify({ release, command: ["pnpm", ...args], productionPromotionPerformed: false })}\n`);
    return;
  }

  const deploymentId = deployCandidate(release);
  const deployment = inspectCandidate(deploymentId);
  const origin = assertCandidateDeployment(deployment, release);
  const canaryArguments = candidateCanaryArguments(origin);
  process.stdout.write(`${JSON.stringify({
    deploymentId,
    origin,
    release,
    sourceProof: "accepted",
    runtimeProof: "required",
    productionPromotionPerformed: false,
    canaryCommand: ["pnpm", ...canaryArguments],
  })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "candidate deploy failed"}\n`);
    process.exitCode = 1;
  });
}
