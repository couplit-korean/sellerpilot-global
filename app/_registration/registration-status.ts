import type { OperationsSnapshot } from "../use-operations-snapshot";

export type RegistrationActivity = OperationsSnapshot["registrationActivities"][number];
export type RegistrationStatus = RegistrationActivity["status"];
export type RegistrationActivityState = OperationsSnapshot["registrationActivityState"];
export type RegistrationActivityFilter = "all" | "active" | "ready" | "completed" | "failed" | "blocked";
const registrationChannelStatuses = Symbol("registrationChannelStatuses");
export type RegistrationActivityEventState = Map<string, RegistrationStatus> & {
  [registrationChannelStatuses]?: ReadonlyMap<string, string>;
};

const runningRegistrationStatuses = new Set<RegistrationStatus>(["analyzing", "publishing"]);
const studioJobActivityIdPattern = /^job:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const controllableAiActivityIdPattern = /^(?:job|revision|asset):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const registrationStatusMeta: Record<RegistrationStatus, { label: string; detail: string }> = {
  analyzing: { label: "AI 분석 중", detail: "사진과 상품 사실정보를 분석하고 있습니다." },
  ready: { label: "채널 등록 준비", detail: "분석이 끝나 카테고리·채널 확인을 기다립니다." },
  publishing: { label: "채널 등록 중", detail: "선택한 채널에 상품을 동시에 전송하고 있습니다." },
  completed: { label: "등록 완료", detail: "선택 채널의 등록 처리가 완료되었습니다." },
  failed: { label: "재시도 필요", detail: "채널 응답을 확인한 뒤 다시 실행할 수 있습니다." },
  blocked: { label: "등록 확인 필요", detail: "채널별 오류·필수값·승인 또는 권한을 확인해 주세요." },
};

export function isRegistrationActivityRunning(status: RegistrationStatus) {
  return runningRegistrationStatuses.has(status);
}

export function isRegistrationImageActivity(activity: Pick<RegistrationActivity, "id">) {
  return activity.id.startsWith("revision:") || activity.id.startsWith("asset:");
}

export function isCancelledRegistrationActivity(activity: Pick<RegistrationActivity, "status" | "message">) {
  return activity.status === "failed" && activity.message.trim() === "관리자가 작업을 취소했습니다.";
}

export function registrationActivityDisplayStatusLabel(activity: RegistrationActivity) {
  if (isCancelledRegistrationActivity(activity)) return "작업 중지됨";
  if (activity.status === "completed" && activity.channelCount > 0 && activity.publishedCount < activity.channelCount) return "일부 등록 · 확인 필요";
  if (activity.status === "failed") {
    if (activity.id.startsWith("asset:")) return "이미지 재제작 실패";
    if (activity.id.startsWith("revision:")) return "상품 수정 작업 실패";
  }
  return registrationStatusMeta[activity.status].label;
}

export function recoverableRegistrationActivityJobId(activity: RegistrationActivity) {
  if (activity.status !== "failed" || activity.productId !== null) return null;
  return activity.id.match(studioJobActivityIdPattern)?.[1] ?? null;
}

export function retryableRegistrationActivityJobId(activity: RegistrationActivity) {
  if (activity.status !== "failed") return null;
  return activity.id.match(controllableAiActivityIdPattern)?.[1] ?? null;
}

export function controllableRegistrationActivityJobId(activity: RegistrationActivity) {
  if (activity.status !== "analyzing") return null;
  return activity.id.match(controllableAiActivityIdPattern)?.[1] ?? null;
}

export function registrationActivityMatchesFilter(activity: RegistrationActivity, filter: RegistrationActivityFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isRegistrationActivityRunning(activity.status);
  if (filter === "ready") return activity.status === "ready";
  if (filter === "completed") return activity.status === "completed";
  return activity.status === filter;
}

export function registrationActivityFilterFromValue(value: unknown): RegistrationActivityFilter {
  if (value === "active" || value === "ready" || value === "completed" || value === "failed" || value === "blocked") return value;
  return "all";
}

export function registrationActivityDisplayElapsedSeconds(activity: RegistrationActivity) {
  if (isRegistrationActivityRunning(activity.status) || activity.completedAt) return activity.elapsedSeconds;
  const startedAt = Date.parse(activity.startedAt);
  const updatedAt = Date.parse(activity.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) return activity.elapsedSeconds;
  return Math.max(0, Math.floor((updatedAt - startedAt) / 1_000));
}

export function registrationActivityProgress(activity: RegistrationActivity) {
  if (activity.channelCount > 0) {
    const total = activity.channelCount;
    const published = Math.min(total, Math.max(0, activity.publishedCount));
    const processed = Math.min(total, Math.max(published,
      published + Math.max(0, activity.failedCount) + Math.max(0, activity.blockedCount)));
    return {
      percent: Math.round((published / total) * 100),
      label: `등록 성공 ${published}/${total}개 · 처리 결과 ${processed}/${total}개 (${Math.round((processed / total) * 100)}%). 실패·확인 필요는 등록 성공에 포함하지 않습니다.`,
    } as const;
  }
  if (activity.status === "completed") {
    return {
      percent: 100,
      label: activity.channelCount > 0
        ? "모든 선택 채널의 처리가 끝났습니다."
        : "해당 AI 이미지 작업이 완료됐습니다.",
    } as const;
  }
  if (activity.channelCount <= 0) {
    const isImageOperation = isRegistrationImageActivity(activity);
    if (activity.status === "ready") {
      return {
        percent: 100,
        label: "AI 분석이 완료되었습니다. 채널 등록 대상과 필수 정보를 확인해 주세요.",
      } as const;
    }
    if (activity.status === "failed") {
      if (isCancelledRegistrationActivity(activity)) {
        return {
          percent: 0,
          label: "관리자가 AI 작업을 중지했습니다. 외부 채널 전송은 시작하지 않았으며 기존 입력으로 다시 실행할 수 있습니다.",
        } as const;
      }
      return {
        percent: 0,
        label: isImageOperation
          ? "AI 이미지 작업을 완료하지 못했습니다. 기존 상품 이미지는 유지됩니다."
          : "AI 분석을 완료하지 못했습니다. 오류를 확인한 뒤 기존 입력으로 다시 시작해 주세요.",
      } as const;
    }
    if (activity.status === "blocked") {
      return {
        percent: 0,
        label: "오류·필수값·승인 또는 권한 확인이 필요해 작업이 중단되었습니다.",
      } as const;
    }
    if (activity.status !== "analyzing") {
      return {
        percent: 0,
        label: "채널 등록 대상이 없어 진행률을 표시하지 않습니다.",
      } as const;
    }
    return {
      percent: null,
      label: isImageOperation
        ? "AI 이미지 작업 진행 중 · 외부 판매채널 자동 게시 없음"
        : "AI 분석 단계입니다. 채널 대상이 확정되면 실제 완료 비율을 표시합니다.",
    } as const;
  }
  return { percent: 0, label: "채널 등록 대상이 없어 진행률을 표시하지 않습니다." } as const;
}

export function registrationChannelStatusLabel(status: string) {
  if (status === "published") return "완료";
  if (status === "failed") return "오류";
  if (status === "blocked") return "확인";
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
      messages.push(`${activity.productName}: ${registrationActivityDisplayStatusLabel(activity)}`);
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
