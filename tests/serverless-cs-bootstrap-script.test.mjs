import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bootstrapScript = fileURLToPath(
  new URL("../scripts/bootstrap-serverless-cs-runtime.mjs", import.meta.url),
);

function runBootstrap(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bootstrapScript, ...arguments_], {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("serverless CS bootstrap is project-bound, secret-safe, and canary-gated", async () => {
  const source = await readFile(
    new URL("../scripts/bootstrap-serverless-cs-runtime.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /sqaoqucxakebqkiygdxb\.supabase\.co/);
  assert.match(source, /https:\/\/sellerpilot-global\.vercel\.app/);
  assert.match(source, /SELLERPILOT_RUNTIME_ORIGIN/);
  assert.match(source, /SELLERPILOT_EXPECTED_RELEASE/);
  assert.match(source, /sellerpilot-global-\[a-z0-9\]/);
  assert.match(source, /--candidate-canary/);
  assert.match(source, /sellerpilot:channel-gateway-drain:wake:v1/);
  assert.match(source, /sellerpilot:channel-gateway-drain:gateway:v1/);
  assert.match(source, /sellerpilot:channel-gateway-drain:scheduler:v1/);
  assert.match(source, /x-sellerpilot-drain-mode/);
  assert.match(source, /canary-v1/);
  assert.match(source, /gatewayPayload\.status === "canary"/);
  assert.match(source, /gatewayPayload\.claimed === 0/);
  assert.match(source, /gatewayPayload\.processed === 0/);
  assert.match(source, /\/api\/internal\/product-research/);
  assert.match(source, /\/api\/internal\/channel-sync/);
  assert.match(source, /\/api\/internal\/competitor-prices/);
  assert.match(source, /\/api\/internal\/kakao-notifications/);
  assert.match(source, /\/api\/internal\/maintenance/);
  assert.match(source, /payload\.executed === false/);
  assert.match(source, /payload\.release === release/);
  assert.match(source, /scheduler activation requires all production canaries in the same process/);
  assert.match(source, /sellerpilot_service_bootstrap_ebay_asq_serverless_runtime/);
  assert.match(source, /sellerpilot_service_set_serverless_cs_wakeup_active/);
  assert.match(source, /p_active: false/);
  assert.match(source, /sellerpilot_service_begin_serverless_runtime_canary/);
  assert.match(source, /sellerpilot_service_complete_serverless_runtime_canary/);
  assert.match(source, /sellerpilot_service_activate_serverless_runtime/);
  assert.match(source, /p_canary_receipt_id: canaryReceiptId/);
  assert.match(source, /p_release_id: release/);
  assert.match(source, /unsafePendingMutations/);
  assert.match(source, /internalSchedules/);
  assert.match(source, /safeCode/);
  assert.doesNotMatch(source, /error\??\.message/);
  assert.doesNotMatch(source, /console\.log\([^)]*(?:cronSecret|wakeBearer|rawToken|serviceKey)/);
  assert.doesNotMatch(source, /writeFile|appendFile|["']\.env(?:\.local)?["']/);
});

test("status and deactivation do not require CRON_SECRET while secret-bearing modes stay fail-closed", async () => {
  for (const arguments_ of [["--status"], ["--deactivate", "--status"]]) {
    const result = await runBootstrap(arguments_);
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /exact SellerPilot Supabase project is not configured/);
    assert.doesNotMatch(result.stderr, /server runtime secrets are not available/);
    assert.equal(result.stdout, "");
  }

  for (const arguments_ of [["--candidate-canary"], ["--bootstrap"], ["--canary"]]) {
    const result = await runBootstrap(arguments_);
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /server runtime secrets are not available/);
    assert.equal(result.stdout, "");
  }
});
