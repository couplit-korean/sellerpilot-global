import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const node = process.execPath;
const script = new URL("../scripts/cs-elevenst-product-qna-get-only.mjs", import.meta.url);

function run(args) {
  return spawnSync(node, ["--import", "tsx", script.pathname, ...args], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
}

test("11st Q&A live probe defaults to a fixed-seller dry run with three status reads", () => {
  const result = run([
    "--seller-id=couplit",
    "--seller-name=커플릿",
    "--start=20260902",
    "--end=20260908",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.mode, "dry-run");
  assert.deepEqual(body.scope.statuses, ["00", "01", "02"]);
  assert.equal(body.providerRequestsPlanned, 3);
  assert.equal(body.providerRequestsPerformed, 0);
  assert.equal(body.providerMutationPerformed, false);
  assert.doesNotMatch(result.stdout, /api_key|openapikey|service_role/u);
});

test("11st Q&A live probe rejects a seller mismatch or a window over seven days before vault access", () => {
  for (const args of [
    ["--seller-id=someone-else", "--seller-name=커플릿", "--start=20260902", "--end=20260908"],
    ["--seller-id=couplit", "--seller-name=커플릿", "--start=20260901", "--end=20260908"],
  ]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ELEVENST_EXACT_SELLER_REQUIRED|ELEVENST_QNA_SEVEN_DAY_SCOPE_REQUIRED/u);
    assert.doesNotMatch(result.stdout + result.stderr, /[A-Za-z0-9]{32}/u);
  }
});

test("11st Q&A probe source cannot print raw customer rows or perform provider writes", () => {
  const source = execFileSync("sed", ["-n", "1,420p", script.pathname], { encoding: "utf8" });
  assert.match(source, /operation:\s*"inquiries\.list"/u);
  assert.doesNotMatch(source, /operation:\s*["']inquiries\.reply["']|method:\s*["']PUT["']/u);
  assert.match(source, /customerContentLogged:\s*false/u);
  assert.match(source, /providerMutationPerformed:\s*false/u);
  assert.doesNotMatch(source, /console\.log\([^)]*(?:payload|apiKey|serviceRole)/u);
});
