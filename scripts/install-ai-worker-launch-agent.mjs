import { execFileSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const label = "chatgpt.sellerpilot.ai-worker";
const workerTokenScopes = [
  { scope: "ai", label: "AI 작업", service: "SellerPilot AI Worker", rotateFlag: "--rotate-ai-token" },
  { scope: "gateway", label: "판매채널 게이트웨이", service: "SellerPilot Gateway Worker", rotateFlag: "--rotate-gateway-token" },
  { scope: "scheduler", label: "스케줄러", service: "SellerPilot Scheduler Worker", rotateFlag: "--rotate-scheduler-token" },
];
const temuEgressService = "SellerPilot Temu Egress IPs";
const sellerpilotUrl = (process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const launchAgents = join(homedir(), "Library", "LaunchAgents");
const logDirectory = join(homedir(), "Library", "Logs", "SellerPilot");
const plistPath = join(launchAgents, `${label}.plist`);
const sourceRoot = process.cwd();
const runtimeRoot = join(homedir(), "Library", "Application Support", "SellerPilot", "worker-runtime");
const workerPath = join(runtimeRoot, "scripts", "ai-cli-worker.mjs");
const guiDomain = `gui/${process.getuid?.() ?? 0}`;

function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function keychainToken(service) {
  try {
    return command("/usr/bin/security", ["find-generic-password", "-s", service, "-a", sellerpilotUrl, "-w"]);
  } catch {
    return "";
  }
}

function keychainTemuEgressIps() {
  try {
    return command("/usr/bin/security", ["find-generic-password", "-s", temuEgressService, "-a", sellerpilotUrl, "-w"]);
  } catch {
    return "";
  }
}

function storeKeychainToken(service, token) {
  try {
    command("/usr/bin/security", [
      "add-generic-password", "-U",
      "-s", service,
      "-a", sellerpilotUrl,
      "-w", token,
    ]);
  } catch {
    throw new Error(`${service} 키체인 토큰을 저장하지 못했습니다.`);
  }
}

function deleteKeychainToken(service) {
  try {
    command("/usr/bin/security", [
      "delete-generic-password",
      "-s", service,
      "-a", sellerpilotUrl,
    ]);
  } catch {
    throw new Error(`${service} 키체인 토큰을 복구하지 못했습니다.`);
  }
}

function promptForToken(label) {
  return command("/usr/bin/osascript", [
    "-e", `display dialog "SellerPilot 웹에서 방금 발급한 ${label} 전용 spw_ 토큰을 입력하세요. 값은 macOS 키체인에만 저장됩니다." default answer "" with hidden answer buttons {"취소", "저장"} default button "저장"`,
    "-e", "text returned of result",
  ]);
}

async function findPnpm() {
  const candidates = [
    process.env.SELLERPILOT_PNPM_BIN,
    join(homedir(), "Library", "pnpm", "pnpm"),
    "/opt/homebrew/bin/pnpm",
    "/usr/local/bin/pnpm",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard pnpm installation path.
    }
  }
  throw new Error("pnpm 실행 파일을 찾지 못했습니다. SELLERPILOT_PNPM_BIN을 지정해 주세요.");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateStagedRuntime(stagedRuntimeRoot) {
  command(process.execPath, ["--check", join(stagedRuntimeRoot, "scripts", "ai-cli-worker.mjs")]);
  command(process.execPath, [
    "--import", "tsx",
    "--input-type=module",
    "--eval", "await import('sharp'); await import('./lib/channels/marketplace-images.ts');",
  ], {
    cwd: stagedRuntimeRoot,
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}` },
  });
}

async function stageRuntime() {
  const pnpm = await findPnpm();
  const runtimeParent = dirname(runtimeRoot);
  await mkdir(runtimeParent, { recursive: true, mode: 0o700 });
  const stagedRuntimeRoot = await mkdtemp(join(runtimeParent, ".worker-runtime-staging-"));
  try {
    for (const entry of ["lib", "scripts", "package.json", "pnpm-lock.yaml", "tsconfig.json"]) {
      await cp(join(sourceRoot, entry), join(stagedRuntimeRoot, entry), { recursive: true });
    }
    command(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: stagedRuntimeRoot,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
    await validateStagedRuntime(stagedRuntimeRoot);
    return stagedRuntimeRoot;
  } catch (error) {
    await rm(stagedRuntimeRoot, { recursive: true, force: true });
    throw error;
  }
}

async function activateStagedRuntime(stagedRuntimeRoot) {
  const runtimeParent = dirname(runtimeRoot);
  const backupContainer = await mkdtemp(join(runtimeParent, ".worker-runtime-backup-"));
  const backupRoot = join(backupContainer, "worker-runtime");
  const hadRuntime = await pathExists(runtimeRoot);
  let movedPreviousRuntime = false;
  try {
    if (hadRuntime) {
      await rename(runtimeRoot, backupRoot);
      movedPreviousRuntime = true;
    }
    await rename(stagedRuntimeRoot, runtimeRoot);
    return { backupContainer, backupRoot, hadRuntime };
  } catch (error) {
    try {
      if (movedPreviousRuntime && !(await pathExists(runtimeRoot)) && await pathExists(backupRoot)) {
        await rename(backupRoot, runtimeRoot);
      }
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "작업자 런타임 교체와 즉시 복구가 모두 실패했습니다.");
    }
    await rm(backupContainer, { recursive: true, force: true });
    throw error;
  }
}

async function restoreRuntime(activation) {
  const failedRuntime = join(activation.backupContainer, "failed-runtime");
  let movedFailedRuntime = false;
  if (await pathExists(runtimeRoot)) {
    await rename(runtimeRoot, failedRuntime);
    movedFailedRuntime = true;
  }
  try {
    if (activation.hadRuntime && await pathExists(activation.backupRoot)) {
      await rename(activation.backupRoot, runtimeRoot);
    }
  } catch (error) {
    if (movedFailedRuntime && !(await pathExists(runtimeRoot)) && await pathExists(failedRuntime)) {
      await rename(failedRuntime, runtimeRoot);
    }
    throw error;
  }
  await rm(activation.backupContainer, { recursive: true, force: true });
}

async function writeAtomicFile(path, contents) {
  const stagedPath = `${path}.staging-${process.pid}`;
  await writeFile(stagedPath, contents, { encoding: "utf8", mode: 0o600 });
  await readFile(stagedPath, "utf8");
  return stagedPath;
}

async function restorePlist(previousPlist) {
  if (previousPlist === null) {
    await rm(plistPath, { force: true });
    return;
  }
  const recoveryPath = await writeAtomicFile(`${plistPath}.recovery`, previousPlist);
  await rename(recoveryPath, plistPath);
}

function commandLineValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return "";
  const value = process.argv[index + 1]?.trim() ?? "";
  if (!value || value.startsWith("--")) throw new Error(`${flag} 값을 확인해 주세요.`);
  return value;
}

function tokenSetProof(tokenSetId, tokenChanges) {
  return {
    tokenSetId,
    tokens: Object.fromEntries(tokenChanges.map((change) => [change.scope, change.token])),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class TokenSetStateUnknownError extends Error {
  constructor(causes) {
    super("서버의 새 작업자 토큰 활성화 상태를 확정하지 못했습니다. 새 런타임과 Keychain을 보존했으므로 기존 토큰으로 되돌리지 말고 운영 상태를 확인해 주세요.");
    this.name = "TokenSetStateUnknownError";
    this.causes = causes;
  }
}

async function workerTokenSetRequest(method, proof) {
  const response = await fetch(`${sellerpilotUrl}/api/admin/ai-worker-token`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  const status = typeof payload.status === "string" ? payload.status : "";
  if (["activated", "active", "aborted", "expired"].includes(status)) return status;
  throw new Error(`작업자 토큰 세트 ${method === "PATCH" ? "활성화" : "폐기"} 응답을 확인하지 못했습니다.`);
}

async function activateOrAbortPendingTokenSet(proof) {
  const errors = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const status = await workerTokenSetRequest("PATCH", proof);
      if (status === "activated" || status === "active") return "activated";
      if (status === "aborted" || status === "expired") return "aborted";
    } catch (error) {
      errors.push(error);
      if (attempt < 2) await wait(500 * (attempt + 1));
    }
  }
  try {
    const status = await workerTokenSetRequest("DELETE", proof);
    if (status === "active" || status === "activated") return "activated";
    if (status === "aborted" || status === "expired") return "aborted";
  } catch (error) {
    errors.push(error);
  }
  throw new TokenSetStateUnknownError(errors);
}

async function abortPendingTokenSet(proof) {
  const errors = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await workerTokenSetRequest("DELETE", proof);
    } catch (error) {
      errors.push(error);
      if (attempt < 2) await wait(500 * (attempt + 1));
    }
  }
  throw new AggregateError(errors, "대기 중인 작업자 토큰 세트 폐기를 확인하지 못했습니다.");
}

async function assertLaunchAgentRunning() {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const status = command("/bin/launchctl", ["print", `${guiDomain}/${label}`]);
      if (status.includes("state = running")) return;
      lastError = new Error("LaunchAgent가 아직 실행 상태가 아닙니다.");
    } catch (error) {
      lastError = error;
    }
    if (attempt < 9) await wait(500);
  }
  throw new AggregateError(lastError ? [lastError] : [], "새 작업자 LaunchAgent 기동을 확인하지 못했습니다.");
}

if (process.platform !== "darwin") throw new Error("이 설치기는 macOS LaunchAgent 전용입니다.");

if (process.argv.includes("--status")) {
  const tokenStatuses = workerTokenScopes.map((definition) => ({
    ...definition,
    present: keychainToken(definition.service).startsWith("spw_"),
  }));
  let launchStatus = "미설치";
  try {
    launchStatus = command("/bin/launchctl", ["print", `${guiDomain}/${label}`]).includes("state = running") ? "실행 중" : "설치됨 · 대기";
  } catch {
    // launchctl returns non-zero when the agent has not been bootstrapped.
  }
  console.log(`SellerPilot AI 작업자: ${launchStatus}`);
  for (const token of tokenStatuses) console.log(`${token.label} 키체인 토큰: ${token.present ? "저장됨" : "없음"}`);
  console.log(`Temu 작업자 허용 IP: ${keychainTemuEgressIps() ? "설정됨" : "없음"}`);
  console.log(`서버: ${sellerpilotUrl}`);
  process.exit(launchStatus === "미설치" || tokenStatuses.some((token) => !token.present) ? 1 : 0);
}

async function install() {
  const tokenSetId = commandLineValue("--token-set");
  const rotateAll = process.argv.includes("--rotate-token");
  const rotatesOne = workerTokenScopes.some((definition) => process.argv.includes(definition.rotateFlag));
  if ((rotateAll || rotatesOne) && !tokenSetId) {
    throw new Error("토큰 교체에는 웹에서 발급한 3개 범위의 --token-set ID가 필요합니다.");
  }
  if ((tokenSetId && (!rotateAll || rotatesOne))
      || (tokenSetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tokenSetId))) {
    throw new Error("토큰 세트는 --rotate-token --token-set <UUID> 형식으로 세 범위를 함께 교체해야 합니다.");
  }

  const tokenChanges = [];
  let proof = tokenSetId ? { tokenSetId } : null;
  let stagedRuntimeRoot = null;
  let stagedPlistPath = null;
  let activation = null;
  let newAgentBootstrapped = false;
  let tokenSetActivated = false;
  let activationRequested = false;
  const appliedTokenChanges = [];
  let previousPlist = null;
  let wasInstalled = false;

  try {
    for (const definition of workerTokenScopes) {
      const previousToken = keychainToken(definition.service);
      const token = rotateAll || !previousToken.startsWith("spw_")
        ? promptForToken(definition.label)
        : previousToken;
      if (!token.startsWith("spw_") || token.length < 24) {
        throw new Error(`${definition.label}에 spw_로 시작하는 올바른 전용 토큰이 필요합니다.`);
      }
      tokenChanges.push({ ...definition, previousToken, token });
    }
    if (tokenSetId) proof = tokenSetProof(tokenSetId, tokenChanges);

    await mkdir(launchAgents, { recursive: true, mode: 0o700 });
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>--import</string><string>tsx</string><string>${xml(workerPath)}</string></array>
  <key>WorkingDirectory</key><string>${xml(runtimeRoot)}</string>
  <key>EnvironmentVariables</key><dict><key>SELLERPILOT_URL</key><string>${xml(sellerpilotUrl)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logDirectory, "ai-worker.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDirectory, "ai-worker-error.log"))}</string>
</dict></plist>`;

    previousPlist = await readFile(plistPath, "utf8").catch(() => null);
    try {
      command("/bin/launchctl", ["print", `${guiDomain}/${label}`]);
      wasInstalled = true;
    } catch {
      // First installation.
    }

    stagedRuntimeRoot = await stageRuntime();
    stagedPlistPath = await writeAtomicFile(plistPath, plist);
    command("/usr/bin/plutil", ["-lint", stagedPlistPath]);
    activation = await activateStagedRuntime(stagedRuntimeRoot);
    stagedRuntimeRoot = null;
    for (const change of tokenChanges) {
      appliedTokenChanges.push(change);
      storeKeychainToken(change.service, change.token);
    }
    await rename(stagedPlistPath, plistPath);
    stagedPlistPath = null;
    try { command("/bin/launchctl", ["bootout", guiDomain, plistPath]); } catch { /* first install */ }
    command("/bin/launchctl", ["bootstrap", guiDomain, plistPath]);
    newAgentBootstrapped = true;
    command("/bin/launchctl", ["kickstart", "-k", `${guiDomain}/${label}`]);
    await assertLaunchAgentRunning();

    if (proof) {
      activationRequested = true;
      const outcome = await activateOrAbortPendingTokenSet(proof);
      if (outcome !== "activated") {
        throw new Error("새 작업자 토큰 세트가 활성화 전에 폐기됐습니다. 기존 작업자를 복구합니다.");
      }
      tokenSetActivated = true;
    }

    const completedActivation = activation;
    activation = null;
    await rm(completedActivation.backupContainer, { recursive: true, force: true }).catch(() => undefined);
  } catch (error) {
    if (error instanceof TokenSetStateUnknownError && activationRequested) {
      throw error;
    }

    const rollbackErrors = [];
    if (proof && !tokenSetActivated) {
      try {
        const abortStatus = await abortPendingTokenSet(proof);
        if (abortStatus === "active" || abortStatus === "activated") tokenSetActivated = true;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (tokenSetActivated) {
      if (activation) {
        await rm(activation.backupContainer, { recursive: true, force: true }).catch(() => undefined);
        activation = null;
      }
      return;
    }

    try { command("/bin/launchctl", ["bootout", guiDomain, plistPath]); } catch (rollbackError) {
      if (newAgentBootstrapped) rollbackErrors.push(rollbackError);
    }
    if (activation) {
      try { await restoreRuntime(activation); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const change of appliedTokenChanges.reverse()) {
      if (change.previousToken) {
        try { storeKeychainToken(change.service, change.previousToken); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      } else {
        try { deleteKeychainToken(change.service); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
    }
    try { await restorePlist(previousPlist); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (wasInstalled && previousPlist !== null) {
      try {
        command("/bin/launchctl", ["bootstrap", guiDomain, plistPath]);
        command("/bin/launchctl", ["kickstart", "-k", `${guiDomain}/${label}`]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (stagedRuntimeRoot) {
      try { await rm(stagedRuntimeRoot, { recursive: true, force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (stagedPlistPath) {
      try { await rm(stagedPlistPath, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], "작업자 설치에 실패했고 이전 상태 복구도 완전히 끝나지 않았습니다.");
    }
    throw error;
  }
}

await install();

console.log("SellerPilot AI 작업자를 설치하고 시작했습니다.");
console.log(`상태 확인: npm run ai:worker:status`);
console.log(`로그: ${join(logDirectory, "ai-worker.log")}`);
