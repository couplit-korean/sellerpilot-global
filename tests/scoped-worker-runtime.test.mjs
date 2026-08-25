import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeCardUrl = new URL("../app/ai-cli-runtime-card.tsx", import.meta.url);
const tokenRouteUrl = new URL("../app/api/admin/ai-worker-token/route.ts", import.meta.url);
const maintenanceRouteUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);
const installerUrl = new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url);

const scopes = [
  ["ai", "SellerPilot AI Worker", "--rotate-ai-token"],
  ["gateway", "SellerPilot Gateway Worker", "--rotate-gateway-token"],
  ["scheduler", "SellerPilot Scheduler Worker", "--rotate-scheduler-token"],
];

test("runtime UI issues one pending three-scope worker token set", async () => {
  const [runtimeCard, tokenRoute, maintenanceRoute] = await Promise.all([
    readFile(runtimeCardUrl, "utf8"),
    readFile(tokenRouteUrl, "utf8"),
    readFile(maintenanceRouteUrl, "utf8"),
  ]);

  assert.match(runtimeCard, /type WorkerScope = "ai" \| "gateway" \| "scheduler"/);
  assert.match(runtimeCard, /status\.workers\[scope\]/);
  assert.match(runtimeCard, /status\.workers\.legacy_combined/);
  assert.match(runtimeCard, /scope === "ai" \? status\.worker : null/);
  assert.match(runtimeCard, /JSON\.stringify\(\{ label: "SellerPilot Mac Worker", expiresInDays \}\)/);
  assert.match(runtimeCard, /payload\.tokens\?\.\[definition\.scope\]\?\.token\.startsWith\("spw_"\)/);
  assert.match(runtimeCard, /--rotate-token --token-set \$\{issued\.tokenSetId\}/);
  assert.match(runtimeCard, /issued\.tokens\[definition\.scope\]\.token/);
  assert.match(runtimeCard, /aria-label="CLI 작업자 권한 선택"/);
  assert.match(runtimeCard, /aria-pressed=\{selectedScope === definition\.scope\}/);

  for (const [scope, service, rotateFlag] of scopes) {
    assert.match(runtimeCard, new RegExp(`scope: "${scope}"`));
    assert.match(runtimeCard, new RegExp(`keychainService: "${service}"`));
    assert.match(runtimeCard, new RegExp(`rotateFlag: "${rotateFlag}"`));
  }

  assert.match(tokenRoute, /sellerpilot_issue_pending_worker_token_set/);
  assert.match(tokenRoute, /p_token_metadata:/);
  assert.match(tokenRoute, /export async function PATCH/);
  assert.match(tokenRoute, /sellerpilot_service_activate_worker_token_set/);
  assert.match(tokenRoute, /export async function DELETE/);
  assert.match(tokenRoute, /sellerpilot_service_abort_worker_token_set/);
  assert.match(tokenRoute, /const tokenSetAbortSchema = z\.object\(\{[\s\S]*tokens: tokenSetTokensSchema,/);
  assert.doesNotMatch(tokenRoute, /sellerpilot_issue_ai_worker_token/);
  assert.match(maintenanceRoute, /sellerpilot_service_expire_pending_worker_token_sets/);
});

test("macOS installer atomically activates the pending set only after staged launch succeeds", async () => {
  const installer = await readFile(installerUrl, "utf8");

  for (const [scope, service, rotateFlag] of scopes) {
    assert.match(installer, new RegExp(`scope: "${scope}"`));
    assert.match(installer, new RegExp(`service: "${service}"`));
    assert.match(installer, new RegExp(`rotateFlag: "${rotateFlag}"`));
  }

  assert.match(installer, /workerTokenScopes\.map\(\(definition\) => \(\{/);
  assert.match(installer, /tokenStatuses\.some\(\(token\) => !token\.present\)/);
  assert.match(installer, /for \(const definition of workerTokenScopes\)/);
  assert.match(installer, /process\.argv\.includes\(definition\.rotateFlag\)/);
  assert.match(installer, /commandLineValue\("--token-set"\)/);
  assert.match(installer, /tokenSetProof\(tokenSetId, tokenChanges\)/);
  assert.match(installer, /workerTokenSetRequest\("PATCH", proof\)/);
  assert.match(installer, /workerTokenSetRequest\("DELETE", proof\)/);
  assert.match(installer, /abortPendingTokenSet\(proof\)/);
  assert.match(installer, /TokenSetStateUnknownError/);
  assert.match(installer, /"add-generic-password", "-U"/);
  assert.match(installer, /with hidden answer/);
  assert.match(installer, /mkdtemp\(join\(runtimeParent, "\.worker-runtime-staging-"\)\)/);
  assert.match(installer, /validateStagedRuntime\(stagedRuntimeRoot\)/);
  assert.match(installer, /rename\(stagedRuntimeRoot, runtimeRoot\)/);
  assert.match(installer, /restoreRuntime\(activation\)/);
  assert.match(installer, /const rollbackErrors = \[\]/);
  assert.match(installer, /throw new AggregateError\(\[error, \.\.\.rollbackErrors\]/);
  assert.match(installer, /change\.previousToken/);
  assert.ok(
    installer.indexOf("stagedRuntimeRoot = await stageRuntime()")
      < installer.indexOf("storeKeychainToken(change.service, change.token)"),
    "runtime must install and validate before Keychain tokens change",
  );
  assert.ok(
    installer.indexOf("await assertLaunchAgentRunning()")
      < installer.indexOf("const outcome = await activateOrAbortPendingTokenSet(proof)"),
    "pending tokens must activate only after the staged LaunchAgent is running",
  );
  assert.ok(
    installer.indexOf("const abortStatus = await abortPendingTokenSet(proof)")
      < installer.indexOf("try { await restoreRuntime(activation);"),
    "a failed installation must abort its pending set before restoring old local state",
  );
  const stageBody = installer.match(/async function stageRuntime\(\)[\s\S]*?\n}\n\nasync function activateStagedRuntime/)?.[0] ?? "";
  assert.doesNotMatch(stageBody, /rm\(runtimeRoot/);

  const plistStart = installer.indexOf("const plist =");
  const plistEnd = installer.indexOf("previousPlist = await readFile", plistStart);
  assert.ok(plistStart >= 0 && plistEnd > plistStart, "LaunchAgent plist template must be present");
  const plistSource = installer.slice(plistStart, plistEnd);
  assert.doesNotMatch(plistSource, /SELLERPILOT_(?:AI|GATEWAY|SCHEDULER)_WORKER_TOKEN/);
  assert.doesNotMatch(plistSource, /spw_/);
  assert.doesNotMatch(installer, /writeFile\([^\n]*(?:token|spw_)/i);
  assert.doesNotMatch(installer, /console\.log\([^\n]*(?:\$\{token\}|,\s*token\b)/);
});
