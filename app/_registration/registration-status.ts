import type { OperationsSnapshot } from "../use-operations-snapshot";

export type RegistrationActivity = OperationsSnapshot["registrationActivities"][number];
export type RegistrationStatus = RegistrationActivity["status"];
export type RegistrationActivityState = OperationsSnapshot["registrationActivityState"];
export type RegistrationActivityFilter = "all" | "active" | "ready" | "completed" | "attention";

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

export function registrationChannelStatusLabel(status: string) {
  if (status === "published") return "완료";
  if (status === "failed") return "오류";
  if (status === "blocked") return "권한";
  if (status === "paused") return "중지";
  if (status === "scope_excluded") return "제외";
  return "진행";
}

export function registrationActivityStatusMap(activities: RegistrationActivity[]) {
  return new Map(activities.map((activity) => [activity.id, activity.status]));
}

export function registrationActivityNotifications(
  previousStatuses: ReadonlyMap<string, RegistrationStatus> | null,
  activities: RegistrationActivity[],
) {
  if (!previousStatuses) return [];
  return activities.flatMap((activity) => {
    const previous = previousStatuses.get(activity.id);
    if (previous === activity.status) return [];
    return [`${activity.productName}: ${registrationStatusMeta[activity.status].label}`];
  });
}

export function registrationActivityNotificationTransition(
  previousStatuses: Map<string, RegistrationStatus> | null,
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
