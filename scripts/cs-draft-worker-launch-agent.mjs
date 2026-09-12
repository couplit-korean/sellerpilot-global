#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalWorkspace } from "./workspace-paths.mjs";

export const CS_DRAFT_WORKER_LABEL = "com.sellerpilot.cs-draft-worker";
const sourceRoot = process.cwd();
const runtimeRoot = join(homedir(), "Library", "Application Support", "SellerPilot", "worker-runtime");
const launchAgents = join(homedir(), "Library", "LaunchAgents");
const logDirectory = join(homedir(), "Library", "Logs", "SellerPilot");
const plistPath = join(launchAgents, `${CS_DRAFT_WORKER_LABEL}.plist`);
const guiDomain = `gui/${process.getuid?.() ?? 0}`;

function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function parseLaunchAgentState(output) {
  if (typeof output !== "string" || output.length === 0) return { loaded: false, state: "not-loaded", pid: null };
  return {
    loaded: true,
    state: output.match(/\bstate = ([^\n]+)/u)?.[1]?.trim() ?? "unknown",
    pid: Number(output.match(/\bpid = (\d+)/u)?.[1] ?? 0) || null,
  };
}

export function decideCsDraftLaunchAgentInstall({ previousPlist, nextPlist, launchState }) {
  if (previousPlist === nextPlist && launchState.loaded) return { action: "noop", reason: "unchanged-loaded" };
  if (launchState.loaded) return { action: "defer", reason: launchState.pid ? "running" : "loaded-state-unknown" };
  return { action: "install", reason: previousPlist === null ? "first-install" : "confirmed-unloaded" };
}

export async function applyCsDraftLaunchAgentTransition({ decision, commandRunner, domain, targetPlistPath, replacePlist }) {
  if (decision.action === "noop") return false;
  if (decision.action !== "install") throw new Error(`CS draft worker install deferred: ${decision.reason}.`);
  // A loaded label can start between observations. The decision only permits
  // an absent label, so there is no bootout and no running worker to kill.
  await replacePlist();
  commandRunner("/bin/launchctl", ["bootstrap", domain, targetPlistPath]);
  commandRunner("/bin/launchctl", ["kickstart", `${domain}/${CS_DRAFT_WORKER_LABEL}`]);
  return true;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function normalizeSellerpilotUrl(value) {
  const url = new URL(value || "https://sellerpilot-global.vercel.app");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("CS draft worker requires a secure SellerPilot URL.");
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export function buildCsDraftLaunchAgentPlist({
  nodePath,
  installedRuntimeRoot,
  sellerpilotUrl,
  logsRoot,
}) {
  const workerPath = join(installedRuntimeRoot, "scripts", "cs-draft-worker.mjs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${CS_DRAFT_WORKER_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>--import</string><string>tsx</string><string>${xml(workerPath)}</string></array>
  <key>WorkingDirectory</key><string>${xml(installedRuntimeRoot)}</string>
  <key>EnvironmentVariables</key><dict><key>SELLERPILOT_URL</key><string>${xml(sellerpilotUrl)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(join(logsRoot, "cs-draft-worker.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logsRoot, "cs-draft-worker-error.log"))}</string>
</dict></plist>`;
}

function hasScopedIdentity(sellerpilotUrl) {
  try {
    const token = command("/usr/bin/security", ["find-generic-password", "-s", "SellerPilot AI Worker", "-a", sellerpilotUrl, "-w"]);
    return /^spw_[A-Za-z0-9_-]{20,}$/u.test(token);
  } catch {
    return false;
  }
}

async function assertInstalledRuntime() {
  for (const relative of ["scripts/cs-draft-worker.mjs", "scripts/ai-support-reply-output.schema.json", "lib/cs/draft-contract.ts", "node_modules/tsx/package.json"]) {
    await access(join(runtimeRoot, relative)).catch(() => { throw new Error(`CS draft runtime file is missing: ${relative}`); });
  }
}

function printStatus() {
  try {
    const state = command("/bin/launchctl", ["print", `${guiDomain}/${CS_DRAFT_WORKER_LABEL}`]);
    const pid = state.match(/\bpid = (\d+)/u)?.[1] ?? "none";
    const status = state.match(/\bstate = ([^\n]+)/u)?.[1]?.trim() ?? "unknown";
    console.log(`CS draft worker: ${status} · pid=${pid}`);
  } catch {
    console.log("CS draft worker: not installed");
  }
}

function currentLaunchAgentState() {
  try {
    return parseLaunchAgentState(command("/bin/launchctl", ["print", `${guiDomain}/${CS_DRAFT_WORKER_LABEL}`]));
  } catch {
    return parseLaunchAgentState("");
  }
}

async function install() {
  assertLocalWorkspace(sourceRoot);
  if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error("CS draft worker installer requires Node 22.");
  await assertInstalledRuntime();
  const sellerpilotUrl = normalizeSellerpilotUrl(process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app");
  if (!hasScopedIdentity(sellerpilotUrl)) throw new Error("CS draft worker requires the existing scoped AI worker identity in Keychain.");
  await mkdir(launchAgents, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const plist = buildCsDraftLaunchAgentPlist({ nodePath: process.execPath, installedRuntimeRoot: runtimeRoot, sellerpilotUrl, logsRoot: logDirectory });
  const stagedPath = `${plistPath}.staged-${process.pid}`;
  const previous = await readFile(plistPath, "utf8").catch(() => null);
  const decision = decideCsDraftLaunchAgentInstall({ previousPlist: previous, nextPlist: plist, launchState: currentLaunchAgentState() });
  if (decision.action === "noop") {
    console.log("SellerPilot CS draft worker install is unchanged; existing process was not restarted.");
    printStatus();
    return;
  }
  if (decision.action === "defer") throw new Error(`CS draft worker install deferred: ${decision.reason}; existing process was not interrupted.`);
  await writeFile(stagedPath, plist, { encoding: "utf8", mode: 0o600 });
  let transitionStarted = false;
  try {
    command("/usr/bin/plutil", ["-lint", stagedPath]);
    // Recheck immediately before changing the plist. A newly loaded label is
    // unknown/possibly active and must be left untouched.
    const rechecked = decideCsDraftLaunchAgentInstall({ previousPlist: previous, nextPlist: plist, launchState: currentLaunchAgentState() });
    await applyCsDraftLaunchAgentTransition({
      decision: rechecked,
      commandRunner: command,
      domain: guiDomain,
      targetPlistPath: plistPath,
      replacePlist: async () => { await rename(stagedPath, plistPath); transitionStarted = true; },
    });
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const state = command("/bin/launchctl", ["print", `${guiDomain}/${CS_DRAFT_WORKER_LABEL}`]);
    if (!/\bstate = running\b/u.test(state)) throw new Error("CS draft worker did not stay running.");
  } catch (error) {
    if (transitionStarted) {
      try { command("/bin/launchctl", ["bootout", guiDomain, plistPath]); } catch { /* Nothing active. */ }
      if (previous === null) {
        await rm(plistPath, { force: true }).catch(() => undefined);
      } else {
        await writeFile(plistPath, previous, { encoding: "utf8", mode: 0o600 });
        try { command("/bin/launchctl", ["bootstrap", guiDomain, plistPath]); } catch { /* Report original failure. */ }
      }
    }
    await rm(stagedPath, { force: true }).catch(() => undefined);
    throw error;
  }
  console.log("SellerPilot CS draft worker installed without replacing the shared AI runtime.");
  printStatus();
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  if (process.argv.includes("--status")) printStatus();
  else install().catch(error => { console.error(error instanceof Error ? error.message : "CS draft worker installation failed."); process.exitCode = 1; });
}
