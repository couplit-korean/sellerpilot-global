import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeCardUrl = new URL("../app/ai-cli-runtime-card.tsx", import.meta.url);
const operationsCssUrl = new URL("../app/operations-system.css", import.meta.url);
const tokenRouteUrl = new URL("../app/api/admin/ai-worker-token/route.ts", import.meta.url);
const maintenanceRouteUrl = new URL("../app/api/internal/maintenance/route.ts", import.meta.url);
const installerUrl = new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);
const channelGatewayDocUrl = new URL("../docs/channel-gateway-worker.md", import.meta.url);

const scopes = [
  ["ai", "Vercel sensitive env · SELLERPILOT_AI_WORKER_TOKEN", "SellerPilot AI Worker", "--rotate-ai-token"],
  ["gateway", "SellerPilot Gateway Worker", "SellerPilot Gateway Worker", "--rotate-gateway-token"],
  ["scheduler", "SellerPilot Scheduler Worker", "SellerPilot Scheduler Worker", "--rotate-scheduler-token"],
];

test("production runtime UI is read-only and reports the Vercel server AI path", async () => {
  const [runtimeCard, operationsCss, tokenRoute, maintenanceRoute] = await Promise.all([
    readFile(runtimeCardUrl, "utf8"),
    readFile(operationsCssUrl, "utf8"),
    readFile(tokenRouteUrl, "utf8"),
    readFile(maintenanceRouteUrl, "utf8"),
  ]);

  assert.match(runtimeCard, /authenticatedFetch\("\/api\/ai\/product-studio"\)/);
  assert.match(runtimeCard, /const serverReady = readiness\?\.available === true/);
  assert.match(runtimeCard, /const queueReady = serverReady && Boolean\(serverWorker\)/);
  assert.match(runtimeCard, /className=\{queueReady \? "online" : "missing"\}/);
  assert.match(runtimeCard, /SERVER-ONLY VERCEL AI/);
  assert.match(runtimeCard, /Vercel Node \+ OIDC/);
  assert.match(runtimeCard, /Supabase 비공개 큐/);
  assert.match(runtimeCard, /운영 복구 게이트/);
  assert.match(runtimeCard, /운영에 Mac 또는 로컬 상품 작업자는 필요하지 않습니다/);
  assert.match(runtimeCard, /이 화면은 토큰을 발급·노출·복사하지 않으며 로컬 설치 명령도 제공하지 않습니다/);
  assert.match(runtimeCard, /aria-label="서버 AI 실행 경로"/);
  assert.match(runtimeCard, /type ServerAiRuntimeState =.*"token_mismatch".*"token_missing_or_expired".*"status_unavailable".*"configuration_missing";/s);
  assert.match(runtimeCard, /if \(readiness\.reason === "token_mismatch"\) return "token_mismatch"/);
  assert.match(runtimeCard, /if \(readiness\.reason === "token_missing_or_expired"\) return "token_missing_or_expired"/);
  assert.match(runtimeCard, /if \(readiness\.reason === "configuration_missing"\) return "configuration_missing"/);
  assert.doesNotMatch(runtimeCard, /readiness\.message\.includes/);
  assert.match(runtimeCard, /서버 토큰 불일치/);
  assert.match(runtimeCard, /원문을 꺼내지 말고 마지막 정상 배포를 복원하세요/);
  assert.match(runtimeCard, /활성 AI 토큰 없음·만료/);
  assert.match(runtimeCard, /조회 실패를 만료로 간주해 교체하지 마세요/);
  assert.match(runtimeCard, /CLI 표준입력/);
  assert.match(runtimeCard, /Supabase에는 해시와 지문만 등록합니다/);
  assert.match(runtimeCard, /토큰 불일치·만료는 자동 복구하지 않음/);
  assert.match(runtimeCard, /role="status" aria-live="polite"/);
  assert.match(operationsCss, /\.cli-server-runtime-flow \{[^}]*grid-template-columns: repeat\(3/);
  assert.match(operationsCss, /\.cli-server-runtime-flow article small \{[^}]*overflow-wrap: anywhere/);
  assert.doesNotMatch(runtimeCard, /npm run ai:worker:install/);
  assert.doesNotMatch(runtimeCard, /IssuedTokenSet|issueToken|requestTokenIssue|confirmTokenRotation/);
  assert.doesNotMatch(runtimeCard, /process\.env|\bspw_|navigator\.clipboard|useModalInteraction|tokenRotationDialog/);
  assert.doesNotMatch(runtimeCard, /authenticatedFetch\("\/api\/admin\/ai-worker-token",\s*\{\s*method: "POST"/);

  // The legacy token lifecycle remains isolated for development/compatibility;
  // removing it is outside this production UI change and would require a
  // separately reviewed credential migration.
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
  const [installer, packageSource] = await Promise.all([
    readFile(installerUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  for (const [scope, , installerService, rotateFlag] of scopes) {
    assert.match(installer, new RegExp(`scope: "${scope}"`));
    assert.match(installer, new RegExp(`service: "${installerService}"`));
    assert.match(installer, new RegExp(`rotateFlag: "${rotateFlag}"`));
  }

  assert.match(installer, /workerTokenScopes\.map\(\(definition\) => \(\{/);
  assert.match(installer, /tokenStatuses\.some\(\(token\) => !token\.present && \(!restrictedRuntime \|\| token\.scope === "ai"\)\)/);
  assert.match(installer, /const runtimeOnly = process\.argv\.includes\("--runtime-only"\)/);
  assert.match(installer, /const aiOnlyRuntimeRequested = process\.argv\.includes\("--ai-only-runtime"\)/);
  assert.match(installer, /const productOnlyRuntimeRequested = process\.argv\.includes\("--product-only-runtime"\)/);
  assert.match(installer, /const localDevAllScopesRequested = process\.argv\.includes\("--allow-local-dev-all-scopes"\)/);
  assert.match(installer, /if \(plist\.includes\("<string>--product-only<\/string>"\)\) return "product-only"/);
  assert.match(installer, /if \(plist\.includes\("<string>--ai-only<\/string>"\)\) return "ai-only"/);
  assert.match(installer, /const installedRuntimeMode = workerRuntimeModeFromPlist\(installedPlist\)/);
  assert.match(installer, /const runtimeMode = runtimeOnly \? installedRuntimeMode : requestedRuntimeMode/);
  assert.match(installer, /if \(runtimeOnly && restrictedRuntimeRequested\)/);
  assert.match(installer, /if \(runtimeMode === "all-scopes" && !localDevAllScopesRequested\)/);
  assert.match(installer, /운영 설치는 --ai-only-runtime을 사용하고, 격리된 로컬 개발에서만 --allow-local-dev-all-scopes를 명시/);
  assert.equal(
    packageJson.scripts["ai:worker:install"],
    "node scripts/install-ai-worker-launch-agent.mjs --ai-only-runtime",
  );
  assert.match(installer, /\^spw_\[A-Za-z0-9_-\]\{43\}\$/);
  assert.match(installer, /if \(runtimeOnly && \(tokenSetId \|\| rotateAll \|\| rotatesOne\)\)/);
  assert.match(installer, /const missingScopes = requiredTokenScopes[\s\S]*?!isWorkerTokenConfigured\(keychainToken\(definition\.service\)\)/);
  assert.match(installer, /if \(runtimeOnly\) \{[\s\S]*?런타임 업그레이드 전에 전용 작업자 토큰을 모두 설치/);
  assert.match(installer, /if \(!tokenSetId\) \{[\s\S]*?최초 설치는 웹에서 발급된 전체 명령/);
  assert.match(installer, /if \(!runtimeOnly && \(!restrictedRuntime \|\| Boolean\(tokenSetId\)\)\) \{[\s\S]*?for \(const definition of workerTokenScopes\)/);
  assert.match(installer, /requiredTokenScopes = tokenSetId \|\| rotateAll[\s\S]*?workerTokenScopes[\s\S]*?definition\.scope === "ai"/);
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

test("production channel gateway documentation keeps the Vercel-only runtime boundary", async () => {
  const documentation = await readFile(channelGatewayDocUrl, "utf8");

  assert.match(documentation, /운영 판매채널 작업은 로컬 Mac의 장기 실행 worker가 아니라 Vercel Function과/);
  assert.match(documentation, /POST \/api\/internal\/channel-gateway-drain/);
  assert.match(documentation, /pnpm gateway:serverless:configure -- --canary --activate --status/);
  assert.match(documentation, /`--ai-only` 모드/);
  assert.match(documentation, /production fallback이 아니다/);
  assert.match(documentation, /STATIC_EGRESS_REQUIRED/);
  assert.doesNotMatch(documentation, /it is not the daemon host/i);
  assert.doesNotMatch(documentation, /Keep at least one replica running continuously/i);
});
