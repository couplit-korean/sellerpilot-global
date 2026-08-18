import { isIP } from "node:net";

export const temuEgressErrorCodes = {
  notConfigured: "TEMU_EGRESS_IP_NOT_CONFIGURED",
  checkFailed: "TEMU_EGRESS_IP_CHECK_FAILED",
  changed: "TEMU_EGRESS_IP_CHANGED",
} as const;

export function parseTemuEgressAllowlist(value: string | undefined | null) {
  return [...new Set(String(value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => isIP(entry) !== 0))];
}

export function evaluateTemuEgressIp(allowlisted: readonly string[], currentIp: string | undefined | null) {
  if (!allowlisted.length) {
    return {
      ok: false as const,
      code: temuEgressErrorCodes.notConfigured,
      message: "Temu 허용 IP가 작업자에 설정되지 않아 Temu 작업을 중지했습니다.",
    };
  }
  const current = String(currentIp ?? "").trim();
  if (isIP(current) === 0) {
    return {
      ok: false as const,
      code: temuEgressErrorCodes.checkFailed,
      message: "Temu 작업자의 공인 IP를 확인하지 못해 Temu 작업을 중지했습니다.",
    };
  }
  if (!allowlisted.includes(current)) {
    return {
      ok: false as const,
      code: temuEgressErrorCodes.changed,
      message: "Temu 작업자의 공인 IP가 등록값과 달라 Temu 작업을 중지했습니다. 관리자에게 Temu 허용 IP 갱신을 요청하세요.",
    };
  }
  return { ok: true as const, currentIp: current };
}
