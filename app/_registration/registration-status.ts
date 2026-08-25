import type { OperationsSnapshot } from "../use-operations-snapshot";

export type RegistrationActivity = OperationsSnapshot["registrationActivities"][number];
export type RegistrationStatus = RegistrationActivity["status"];
export type RegistrationActivityState = OperationsSnapshot["registrationActivityState"];
export type RegistrationActivityFilter = "all" | "active" | "ready" | "completed" | "attention";
const registrationChannelStatuses = Symbol("registrationChannelStatuses");
export type RegistrationActivityEventState = Map<string, RegistrationStatus> & {
  [registrationChannelStatuses]?: ReadonlyMap<string, string>;
};

const runningRegistrationStatuses = new Set<RegistrationStatus>(["analyzing", "publishing"]);

export const registrationStatusMeta: Record<RegistrationStatus, { label: string; detail: string }> = {
  analyzing: { label: "AI 분석 중", detail: "사진과 상품 사실정보를 분석하고 있습니다." },
  ready: { label: "채널 등록 준비", detail: "분석이 끝나 카테고리·채널 확인을 기다립니다." },
  publishing: { label: "채널 등록 중", detail: "선택한 채널에 상품을 동시에 전송하고 있습니다." },
  completed: { label: "등록 완료", detail: "선택 채널의 등록 처리가 완료되었습니다." },
  failed: { label: "재시도 필요", detail: "채널 응답을 확인한 뒤 다시 실행할 수 있습니다." },
  blocked: { label: "외부 권한 대기", detail: "판매자센터 권한 또는 필수값 보완이 필요합니다." },
};

export function isRegistrationActivityRunning(status: RegistrationStatus) {
  return runningRegistrationStatuses.has(status);
}

export function registrationActivityMatchesFilter(activity: RegistrationActivity, filter: RegistrationActivityFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isRegistrationActivityRunning(activity.status);
  if (filter === "ready") return activity.status === "ready";
  if (filter === "completed") return activity.status === "completed";
  return activity.status === "failed" || activity.status === "blocked";
}

export function registrationActivityDisplayElapsedSeconds(activity: RegistrationActivity) {
  if (isRegistrationActivityRunning(activity.status) || activity.completedAt) return activity.elapsedSeconds;
  const startedAt = Date.parse(activity.startedAt);
  const updatedAt = Date.parse(activity.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) return activity.elapsedSeconds;
  return Math.max(0, Math.floor((updatedAt - startedAt) / 1_000));
}

export function registrationActivityProgress(activity: RegistrationActivity) {
  if (activity.status === "completed") {
    return { percent: 100, label: "모든 선택 채널의 처리가 끝났습니다." } as const;
  }
  if (activity.channelCount <= 0) {
    return {
      percent: null,
      label: activity.status === "analyzing"
        ? "AI 분석 단계입니다. 채널 대상이 확정되면 실제 완료 비율을 표시합니다."
        : "채널 대상 확정을 기다리고 있어 비율을 추정하지 않습니다.",
    } as const;
  }
  const terminalCount = Math.min(
    activity.channelCount,
    Math.max(0, activity.publishedCount + activity.failedCount + activity.blockedCount),
  );
  return {
    percent: Math.round((terminalCount / activity.channelCount) * 100),
    label: `${activity.channelCount}개 채널 중 ${terminalCount}개 처리 결과를 확인했습니다.`,
  } as const;
}

export function registrationChannelStatusLabel(status: string) {
  if (status === "published") return "완료";
  if (status === "failed") return "오류";
  if (status === "blocked") return "권한";
  if (status === "paused") return "중지";
  if (status === "scope_excluded") return "제외";
  if (status === "draft") return "준비";
  return "진행";
}

export function registrationActivityStatusMap(activities: RegistrationActivity[]) {
  const statuses: RegistrationActivityEventState = new Map(
    activities.map((activity) => [activity.id, activity.status]),
  );
  const channelStatuses = new Map<string, string>();
  for (const activity of activities) {
    for (const channel of activity.channels) {
      channelStatuses.set(`${activity.id}:${channel.channel}:${channel.market}`, channel.status);
    }
  }
  statuses[registrationChannelStatuses] = channelStatuses;
  return statuses;
}

export function registrationActivityNotifications(
  previousStatuses: ReadonlyMap<string, RegistrationStatus> | null,
  activities: RegistrationActivity[],
) {
  if (!previousStatuses) return [];
  const previousChannelStatuses = (previousStatuses as RegistrationActivityEventState)[registrationChannelStatuses];
  return activities.flatMap((activity) => {
    const previous = previousStatuses.get(activity.id);
    const messages: string[] = [];
    if (previous !== activity.status) {
      messages.push(`${activity.productName}: ${registrationStatusMeta[activity.status].label}`);
    }
    if (previous === undefined || !previousChannelStatuses) return messages;
    for (const channel of activity.channels) {
      const channelKey = `${activity.id}:${channel.channel}:${channel.market}`;
      if (previousChannelStatuses.get(channelKey) === channel.status) continue;
      const destination = [channel.channelName || channel.channel, channel.market].filter(Boolean).join(" · ");
      messages.push(`${activity.productName} · ${destination}: ${registrationChannelStatusLabel(channel.status)}`);
    }
    return messages;
  });
}

export function registrationActivityNotificationTransition(
  previousStatuses: RegistrationActivityEventState | null,
  activities: RegistrationActivity[],
  state: RegistrationActivityState,
) {
  if (state === "unavailable") {
    return { messages: [] as string[], statuses: previousStatuses };
  }
  return {
    messages: registrationActivityNotifications(previousStatuses, activities),
    statuses: registrationActivityStatusMap(activities),
  };
}
