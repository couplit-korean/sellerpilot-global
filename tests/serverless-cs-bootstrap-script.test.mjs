import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("serverless CS bootstrap is project-bound, secret-safe, and canary-gated", async () => {
  const source = await readFile(
    new URL("../scripts/bootstrap-serverless-cs-runtime.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /sqaoqucxakebqkiygdxb\.supabase\.co/);
  assert.match(source, /https:\/\/sellerpilot-global\.vercel\.app/);
  assert.match(source, /sellerpilot:channel-gateway-drain:wake:v1/);
  assert.match(source, /sellerpilot:channel-gateway-drain:gateway:v1/);
  assert.match(source, /sellerpilot:channel-gateway-drain:scheduler:v1/);
  assert.match(source, /x-sellerpilot-drain-mode/);
  assert.match(source, /canary-v1/);
  assert.match(source, /payload\.status === "canary"/);
  assert.match(source, /payload\.claimed === 0/);
  assert.match(source, /payload\.processed === 0/);
  assert.match(source, /scheduler activation requires a successful canary in the same process/);
  assert.match(source, /sellerpilot_service_bootstrap_ebay_asq_serverless_runtime/);
  assert.match(source, /sellerpilot_service_set_serverless_cs_wakeup_active/);
  assert.doesNotMatch(source, /console\.log\([^)]*(?:cronSecret|wakeBearer|rawToken|serviceKey)/);
  assert.doesNotMatch(source, /writeFile|appendFile|["']\.env(?:\.local)?["']/);
});
