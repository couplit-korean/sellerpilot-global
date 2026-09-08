import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const node = "/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node";
const script = new URL("../scripts/cs-elevenst-alimi-get-only.mjs", import.meta.url);

test("11st Alimi live probe defaults to a fixed-seller 30-day-safe dry run", () => {
  const output = execFileSync(node, [script.pathname,
    "--start=20260810", "--end=20260908", "--seller-id=couplit", "--seller-name=커플릿",
  ], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  assert.equal(parsed.mode, "dry-run");
  assert.equal(parsed.providerRequestsPlanned, 1);
  assert.equal(parsed.providerRequestsPerformed, 0);
  assert.equal(parsed.providerMutationPerformed, false);
});

test("11st Alimi probe rejects seller mismatch and windows over 30 days before vault access", () => {
  for (const args of [
    ["--start=20260810", "--end=20260908", "--seller-id=other", "--seller-name=커플릿"],
    ["--start=20260809", "--end=20260908", "--seller-id=couplit", "--seller-name=커플릿"],
  ]) {
    const result = spawnSync(node, [script.pathname, ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
  }
});

test("11st Alimi probe is provider GET-only and never logs raw rows", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /rest\/alimi\/getalimilist/u);
  assert.match(source, /openapikey:\s*apiKey/u);
  assert.doesNotMatch(source, /rest\/alimi\/alimianswer/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:xml|rows|decrypted)/u);
  assert.match(source, /providerMutationPerformed:\s*false/u);
  assert.match(source, /customerContentLogged:\s*false/u);
});
