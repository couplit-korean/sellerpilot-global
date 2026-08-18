import { execFileSync } from "node:child_process";
import { isIP } from "node:net";
import { parseTemuEgressAllowlist } from "../lib/channels/temu-egress-policy.ts";

const sellerpilotUrl = (process.env.SELLERPILOT_URL ?? "https://sellerpilot-global.vercel.app").replace(/\/$/, "");
const service = "SellerPilot Temu Egress IPs";

function command(program, args) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function keychainValue() {
  if (process.platform !== "darwin") return "";
  try {
    return command("/usr/bin/security", ["find-generic-password", "-s", service, "-a", sellerpilotUrl, "-w"]);
  } catch {
    return "";
  }
}

async function currentPublicIp() {
  for (const url of ["https://api.ipify.org", "https://checkip.amazonaws.com"]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const value = (await response.text()).trim();
      if (response.ok && isIP(value) !== 0) return value;
    } catch {
      // Try the next independent public-IP service.
    }
  }
  throw new Error("현재 작업자의 공인 IP를 확인하지 못했습니다.");
}

if (process.platform !== "darwin") throw new Error("현재 Temu IP 설정 도구는 macOS 작업자 전용입니다.");

const detected = await currentPublicIp();
const requested = parseTemuEgressAllowlist(process.env.SELLERPILOT_TEMU_EGRESS_IPS || detected);
if (!requested.length) throw new Error("저장할 올바른 Temu 공인 IP가 없습니다.");

if (process.argv.includes("--status")) {
  const configured = parseTemuEgressAllowlist(keychainValue());
  const matches = configured.includes(detected);
  console.log(`Temu 작업자 허용 IP: ${configured.length ? "설정됨" : "없음"}`);
  console.log(`현재 공인 IP 일치: ${matches ? "예" : "아니요"}`);
  process.exit(matches ? 0 : 1);
}

command("/usr/bin/security", [
  "add-generic-password", "-U",
  "-s", service,
  "-a", sellerpilotUrl,
  "-w", requested.join(","),
]);
console.log(`Temu 작업자 허용 IP ${requested.length}개를 macOS 키체인에 저장했습니다.`);
console.log("모바일·웹 사용자는 SellerPilot을 호출하며, Temu API는 이 작업자에서만 실행됩니다.");
