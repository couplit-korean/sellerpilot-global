// Single source of truth for the channel integration labels shown in the UI.
//
// The operations snapshot already returns `credentialStatus`,
// `credentialLastCheckStatus`, and `credentialLastCheckedAt`. Rendering
// "읽기 진단 통과" from a stored check without its age tells the operator that a
// channel is connected *now*, even when the last real read happened weeks ago.
// Every indicator must state the credential state, the last recorded check, and
// how old that check is.

export const CREDENTIAL_CHECK_FRESH_HOURS = 24;
export const CREDENTIAL_CHECK_STALE_HOURS = 24 * 7;

export type ChannelIntegrationTone = "ok" | "stale" | "pending" | "failed" | "missing";

export type ChannelIntegrationInput = {
  credentialStatus?: string | null;
  credentialLastCheckStatus?: string | null;
  credentialLastCheckedAt?: string | null;
  now?: Date;
};

export type ChannelIntegrationStatus = {
  credential: "missing" | "unverified" | "active";
  lastCheckStatus: string | null;
  lastCheckedAt: string | null;
  ageHours: number | null;
  ageText: string | null;
  tone: ChannelIntegrationTone;
  /** Compact cell value, e.g. "통과", "재확인 필요", "진단 필요", "키 필요". */
  short: string;
  /** Full sentence for a title tooltip or a list row. */
  label: string;
  /** 0-100, for the progress bars that used to hardcode 100/55/0. */
  progress: number;
};

function elapsedHours(value: string | null | undefined, now: Date) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !Number.isFinite(now.getTime())) return null;
  return Math.max(0, (now.getTime() - parsed) / 3_600_000);
}

export function integrationAgeText(hours: number | null) {
  if (hours === null) return null;
  if (hours < 1) return "방금 전";
  if (hours < 24) return `${Math.round(hours)}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function channelIntegrationStatus(input: ChannelIntegrationInput | null | undefined): ChannelIntegrationStatus {
  const source = input ?? {};
  const now = source.now ?? new Date();
  const credential = source.credentialStatus === "active"
    ? "active"
    : source.credentialStatus === "unverified"
      ? "unverified"
      : "missing";
  const lastCheckStatus = typeof source.credentialLastCheckStatus === "string" && source.credentialLastCheckStatus.trim()
    ? source.credentialLastCheckStatus.trim()
    : null;
  const lastCheckedAt = typeof source.credentialLastCheckedAt === "string" && source.credentialLastCheckedAt.trim()
    ? source.credentialLastCheckedAt.trim()
    : null;
  const ageHours = elapsedHours(lastCheckedAt, now);
  const ageText = integrationAgeText(ageHours);

  if (credential === "missing") {
    return {
      credential, lastCheckStatus, lastCheckedAt, ageHours, ageText,
      tone: "missing", short: "키 필요", label: "운영 API 키 등록 필요", progress: 0,
    };
  }

  if (lastCheckStatus !== "passed") {
    const failed = lastCheckStatus === "failed";
    return {
      credential, lastCheckStatus, lastCheckedAt, ageHours, ageText,
      tone: failed ? "failed" : "pending",
      short: failed ? "진단 실패" : "진단 필요",
      label: failed
        ? `읽기 진단 실패${ageText ? ` · ${ageText}` : ""} · 재시도 필요`
        : `키 등록됨 · 읽기 진단 필요`,
      progress: failed ? 25 : 55,
    };
  }

  if (ageHours === null) {
    return {
      credential, lastCheckStatus, lastCheckedAt, ageHours, ageText,
      tone: "stale", short: "재확인 필요",
      label: "읽기 진단 통과 기록은 있으나 확인 시각이 없습니다 · 재확인 필요",
      progress: 80,
    };
  }
  if (ageHours > CREDENTIAL_CHECK_STALE_HOURS) {
    return {
      credential, lastCheckStatus, lastCheckedAt, ageHours, ageText,
      tone: "stale", short: "재확인 필요",
      label: `마지막 읽기 진단 통과 · ${ageText} · 지금 상태를 다시 확인해야 합니다`,
      progress: 80,
    };
  }
  return {
    credential, lastCheckStatus, lastCheckedAt, ageHours, ageText,
    tone: "ok", short: "통과",
    label: ageHours <= CREDENTIAL_CHECK_FRESH_HOURS
      ? `읽기 진단 통과 · ${ageText}`
      : `읽기 진단 통과 · ${ageText} · 곧 재확인 필요`,
    progress: 100,
  };
}

export type ChannelIntegrationSummary = {
  total: number;
  ok: number;
  stale: number;
  pending: number;
  failed: number;
  missing: number;
};

export function summarizeChannelIntegrations(
  metrics: readonly ChannelIntegrationInput[] | null | undefined,
): ChannelIntegrationSummary {
  const summary: ChannelIntegrationSummary = { total: 0, ok: 0, stale: 0, pending: 0, failed: 0, missing: 0 };
  for (const metric of metrics ?? []) {
    summary.total += 1;
    summary[channelIntegrationStatus(metric).tone] += 1;
  }
  return summary;
}

/** "8/8 · 재확인 필요 3" honest form of the old "읽기 진단 8 / 8". */
export function integrationRailText(summary: ChannelIntegrationSummary, total: number) {
  const base = `읽기 진단 ${summary.ok + summary.stale} / ${total}`;
  const notes: string[] = [];
  if (summary.stale) notes.push(`재확인 필요 ${summary.stale}`);
  if (summary.pending) notes.push(`진단 필요 ${summary.pending}`);
  if (summary.failed) notes.push(`진단 실패 ${summary.failed}`);
  if (summary.missing) notes.push(`키 필요 ${summary.missing}`);
  return notes.length ? `${base} · ${notes.join(" · ")}` : base;
}
