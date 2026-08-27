import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeCardUrl = new URL("../app/ai-cli-runtime-card.tsx", import.meta.url);
const operationsCssUrl = new URL("../app/operations-system.css", import.meta.url);
const tokenRouteUrl = new URL("../app/api/admin/ai-worker-token/route.ts", import.meta.url);
const maintenanceRouteUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);
const installerUrl = new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url);

const scopes = [
  ["ai", "SellerPilot AI Worker", "--rotate-ai-token"],
  ["gateway", "SellerPilot Gateway Worker", "--rotate-gateway-token"],
  ["scheduler", "SellerPilot Scheduler Worker", "--rotate-scheduler-token"],
];

test("runtime UI issues one pending three-scope worker token set", async () => {
  const [runtimeCard, operationsCss, tokenRoute, maintenanceRoute] = await Promise.all([
    readFile(runtimeCardUrl, "utf8"),
    readFile(operationsCssUrl, "utf8"),
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

  const issueTokenStart = runtimeCard.indexOf("const issueToken = async");
  const issueTokenEnd = runtimeCard.indexOf("const requestTokenIssue", issueTokenStart);
  assert.ok(issueTokenStart >= 0 && issueTokenEnd > issueTokenStart, "worker token issue function must be present");
  assert.doesNotMatch(runtimeCard.slice(issueTokenStart, issueTokenEnd), /window\.confirm/);
  assert.match(runtimeCard, /const requestTokenIssue = \(\) => \{[\s\S]*?if \(!status\?\.worker\) \{[\s\S]*?void issueToken\(\);[\s\S]*?return;[\s\S]*?setTokenRotationConfirming\(true\);/);
  assert.match(runtimeCard, /const confirmTokenRotation = \(\) => \{[\s\S]*?setTokenRotationConfirming\(false\);[\s\S]*?void issueToken\(\);/);
  assert.match(runtimeCard, /<dialog[\s\S]*?role="alertdialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="cli-token-confirm-title"[\s\S]*?aria-describedby="cli-token-confirm-description"/);
  assert.match(runtimeCard, /AI·게이트웨이·스케줄러 토큰 세트를 새로 발급할까요\? 기존 작업자는 새 런타임 설치가 성공할 때까지 계속 동작합니다\./);
  assert.match(runtimeCard, /onClick=\{requestTokenIssue\}/);
  assert.match(runtimeCard, /onClick=\{confirmTokenRotation\}>확인 후 새로 발급<\/button>/);
  assert.match(runtimeCard, /dialog\.showModal\(\)/);
  assert.match(runtimeCard, /tokenRotationConfirmButtonRef\.current\?\.focus\(\)/);
  assert.match(runtimeCard, /onCancel=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?closeTokenRotationConfirmation\(\);/);
  assert.match(operationsCss, /\.cli-token-confirm-dialog::backdrop/);
  assert.match(operationsCss, /\.cli-token-confirm-actions button \{[^}]*min-height: 44px;/);

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
  assert.match(installer, /tokenStatuses\.some\(\(token\) => !token\.present && \(!restrictedRuntime \|\| token\.scope === "ai"\)\)/);
  assert.match(installer, /const runtimeOnly = process\.argv\.includes\("--runtime-only"\)/);
  assert.match(installer, /const aiOnlyRuntimeRequested = process\.argv\.includes\("--ai-only-runtime"\)/);
  assert.match(installer, /const productOnlyRuntimeRequested = process\.argv\.includes\("--product-only-runtime"\)/);
  assert.match(installer, /if \(plist\.includes\("<string>--product-only<\/string>"\)\) return "product-only"/);
  assert.match(installer, /if \(plist\.includes\("<string>--ai-only<\/string>"\)\) return "ai-only"/);
  assert.match(installer, /const installedRuntimeMode = workerRuntimeModeFromPlist\(installedPlist\)/);
  assert.match(installer, /const runtimeMode = runtimeOnly \? installedRuntimeMode : requestedRuntimeMode/);
  assert.match(installer, /if \(\(runtimeOnly && restrictedRuntimeRequested\)/);
  assert.match(installer, /\^spw_\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(installer, /if \(runtimeOnly && \(tokenSetId \|\| rotateAll \|\| rotatesOne\)\)/);
  assert.match(installer, /const missingScopes = requiredTokenScopes[\s\S]*?!isWorkerTokenConfigured\(keychainToken\(definition\.service\)\)/);
  assert.match(installer, /if \(runtimeOnly\) \{[\s\S]*?런타임 업그레이드 전에 전용 작업자 토큰을 모두 설치/);
  assert.match(installer, /if \(!tokenSetId\) \{[\s\S]*?최초 설치는 웹에서 발급된 전체 명령/);
  assert.match(installer, /if \(!runtimeOnly && !restrictedRuntime\) \{[\s\S]*?for \(const definition of workerTokenScopes\)/);
  assert.match(installer, /requiredTokenScopes = restrictedRuntime[\s\S]*?definition\.scope === "ai"/);
  assert.match(installer, /runtimeMode === "product-only"[\s\S]*?"--product-only"[\s\S]*?runtimeMode === "ai-only"[\s\S]*?"--ai-only"/);
  assert.match(installer, /workerRuntimeArgument \? `<string>\$\{xml\(workerRuntimeArgument\)\}<\/string>` : ""/);
  assert.match(installer, /workerRuntimeModeLabel\(runtimeMode\)/);
  assert.match(installer, /for \(const definition of workerTokenScopes\)/);
  assert.match(installer, /process\.argv\.includes\(definition\.rotateFlag\)/);
  assert.match(installer, /commandLineValue\("--token-set"\)/);
  assert.match(installer, /tokenSetProof\(tokenSetId, tokenChanges\)/);
  assert.match(installer, /workerTokenSetRequest\("PATCH", proof\)/);
  assert.match(installer, /workerTokenSetRequest\("DELETE", proof\)/);
  assert.match(installer, /abortPendingTokenSet\(proof\)/);
  assert.match(installer, /TokenSetStateUnknownError/);
  assert.match(installer, /"add-generic-password", "-U"/);
  assert.match(installer, /"-w",\s*\], \{\s*input: `\$\{token\}\\n\$\{token\}\\n`,\s*stdio: \["pipe", "pipe", "pipe"\]/);
  assert.doesNotMatch(installer, /"-w",\s*token\b/);
  assert.match(installer, /with hidden answer/);
  assert.match(installer, /mkdtemp\(join\(runtimeParent, "\.worker-runtime-staging-"\)\)/);
  assert.match(installer, /validateStagedRuntime\(stagedRuntimeRoot\)/);
  assert.match(installer, /"\/usr\/bin\/swiftc"[\s\S]*"-typecheck"[\s\S]*"source-product-cutout\.swift"/);
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
  const activationConfirmed = installer.indexOf("tokenSetActivated = true");
  const postActivationKickstart = installer.indexOf(
    'command("/bin/launchctl", ["kickstart", "-k", `${guiDomain}/${label}`])',
    activationConfirmed,
  );
  const postActivationRunningCheck = installer.indexOf("await assertLaunchAgentRunning()", postActivationKickstart);
  assert.ok(
    activationConfirmed >= 0
      && postActivationKickstart > activationConfirmed
      && postActivationRunningCheck > postActivationKickstart,
    "an activated token set must restart and recheck the worker to clear pending-token auth backoff",
  );
  assert.ok(
    installer.indexOf("const abortStatus = await abortPendingTokenSet(proof)")
      < installer.indexOf("try { await restoreRuntime(activation);"),
    "a failed installation must abort its pending set before restoring old local state",
  );
  const activatedFailureBranch = installer.match(/if \(tokenSetActivated\) \{[\s\S]*?\n {4}\}\n\n {4}try \{ command\("\/bin\/launchctl", \["bootout"/)?.[0] ?? "";
  assert.match(activatedFailureBranch, /throw new AggregateError/);
  assert.match(activatedFailureBranch, /새 런타임과 Keychain은 보존/);
  assert.doesNotMatch(activatedFailureBranch, /\breturn\b/);
  assert.doesNotMatch(activatedFailureBranch, /restoreRuntime|restorePlist|storeKeychainToken|deleteKeychainToken/);
  assert.ok(
    installer.indexOf("await install();")
      < installer.indexOf('console.log("SellerPilot AI 작업자를 설치하고 시작했습니다.")'),
    "a rejected post-activation restart must exit before the installer prints success",
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
