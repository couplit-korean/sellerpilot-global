import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const label = "chatgpt.sellerpilot.ai-worker";
const service = "SellerPilot AI Worker";
const sellerpilotUrl = (process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const launchAgents = join(homedir(), "Library", "LaunchAgents");
const logDirectory = join(homedir(), "Library", "Logs", "SellerPilot");
const plistPath = join(launchAgents, `${label}.plist`);
const workerPath = resolve("scripts/ai-cli-worker.mjs");
const guiDomain = `gui/${process.getuid?.() ?? 0}`;

function command(program, args, options = {}) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function keychainToken() {
  try {
    return command("/usr/bin/security", ["find-generic-password", "-s", service, "-a", sellerpilotUrl, "-w"]);
  } catch {
    return "";
  }
}

function promptForToken() {
  return command("/usr/bin/osascript", [
    "-e", 'display dialog "SellerPilot 웹에서 방금 발급한 spw_ 토큰을 입력하세요. 값은 macOS 키체인에만 저장됩니다." default answer "" with hidden answer buttons {"취소", "저장"} default button "저장"',
    "-e", "text returned of result",
  ]);
}

if (process.platform !== "darwin") throw new Error("이 설치기는 macOS LaunchAgent 전용입니다.");

if (process.argv.includes("--status")) {
  const token = keychainToken();
  let launchStatus = "미설치";
  try {
    launchStatus = command("/bin/launchctl", ["print", `${guiDomain}/${label}`]).includes("state = running") ? "실행 중" : "설치됨 · 대기";
  } catch {
    // launchctl returns non-zero when the agent has not been bootstrapped.
  }
  console.log(`SellerPilot AI 작업자: ${launchStatus}`);
  console.log(`키체인 토큰: ${token.startsWith("spw_") ? "저장됨" : "없음"}`);
  console.log(`서버: ${sellerpilotUrl}`);
  process.exit(launchStatus === "미설치" || !token.startsWith("spw_") ? 1 : 0);
}

let token = keychainToken();
if (!token.startsWith("spw_") || process.argv.includes("--rotate-token")) token = promptForToken();
if (!token.startsWith("spw_") || token.length < 24) throw new Error("spw_로 시작하는 올바른 CLI 작업자 토큰이 필요합니다.");

command("/usr/bin/security", [
  "add-generic-password", "-U",
  "-s", service,
  "-a", sellerpilotUrl,
  "-w", token,
]);

await mkdir(launchAgents, { recursive: true, mode: 0o700 });
await mkdir(logDirectory, { recursive: true, mode: 0o700 });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>--import</string><string>tsx</string><string>${xml(workerPath)}</string></array>
  <key>WorkingDirectory</key><string>${xml(process.cwd())}</string>
  <key>EnvironmentVariables</key><dict><key>SELLERPILOT_URL</key><string>${xml(sellerpilotUrl)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logDirectory, "ai-worker.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDirectory, "ai-worker-error.log"))}</string>
</dict></plist>`;

await writeFile(plistPath, plist, { encoding: "utf8", mode: 0o600 });
await readFile(plistPath, "utf8");
try { command("/bin/launchctl", ["bootout", guiDomain, plistPath]); } catch { /* first install */ }
command("/bin/launchctl", ["bootstrap", guiDomain, plistPath]);
command("/bin/launchctl", ["kickstart", "-k", `${guiDomain}/${label}`]);

console.log("SellerPilot AI 작업자를 설치하고 시작했습니다.");
console.log(`상태 확인: npm run ai:worker:status`);
console.log(`로그: ${join(logDirectory, "ai-worker.log")}`);
