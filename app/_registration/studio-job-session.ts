const studioJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const activeStudioJobStorageKey = "sellerpilot:product-studio:active-job:v1";
export const studioJobMaximumAgeMs = 2 * 60 * 60_000;

export type ActiveStudioJob = {
  jobId: string;
  startedAt: number;
  ownerSessionId: string | null;
};

export function normalizeActiveStudioJobs(value: unknown, now: number, maximumAgeMs: number): ActiveStudioJob[] {
  const candidates = Array.isArray(value) ? value : [value];
  const jobs = new Map<string, ActiveStudioJob>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const job = candidate as Partial<ActiveStudioJob>;
    if (typeof job.jobId !== "string" || !studioJobIdPattern.test(job.jobId)) continue;
    if (typeof job.startedAt !== "number" || !Number.isFinite(job.startedAt)) continue;
    if (job.startedAt > now || now - job.startedAt > maximumAgeMs) continue;
    const ownerSessionId = typeof job.ownerSessionId === "string" && studioJobIdPattern.test(job.ownerSessionId)
      ? job.ownerSessionId
      : null;
    const normalized = { jobId: job.jobId, startedAt: job.startedAt, ownerSessionId };
    const existing = jobs.get(job.jobId);
    if (!existing || existing.startedAt <= normalized.startedAt) jobs.set(job.jobId, normalized);
  }
  return [...jobs.values()].sort((left, right) => left.startedAt - right.startedAt);
}

export function upsertActiveStudioJob(jobs: ActiveStudioJob[], job: ActiveStudioJob): ActiveStudioJob[] {
  return [...jobs.filter((candidate) => candidate.jobId !== job.jobId), job]
    .sort((left, right) => left.startedAt - right.startedAt);
}

export function removeActiveStudioJob(jobs: ActiveStudioJob[], jobId: string): ActiveStudioJob[] {
  return jobs.filter((job) => job.jobId !== jobId);
}

export function studioJobRecoveryStorageValue(rawValue: string | null, jobId: string, now: number) {
  let storedValue: unknown = [];
  try {
    storedValue = rawValue ? JSON.parse(rawValue) : [];
  } catch {
    storedValue = [];
  }
  const currentJobs = normalizeActiveStudioJobs(storedValue, now, studioJobMaximumAgeMs);
  const [recoveryJob] = normalizeActiveStudioJobs(
    { jobId, startedAt: now, ownerSessionId: null },
    now,
    studioJobMaximumAgeMs,
  );
  if (!recoveryJob) return null;
  return JSON.stringify(upsertActiveStudioJob(currentJobs, recoveryJob));
}

export function shouldDisplayStudioJob(input: {
  job: ActiveStudioJob;
  mounted: boolean;
  currentSessionId: string;
  displayJobId: string;
}) {
  return input.mounted
    && input.job.ownerSessionId === input.currentSessionId
    && input.job.jobId === input.displayJobId;
}

export type StudioJobMonitorRegistry = ReturnType<typeof createStudioJobMonitorRegistry>;

export function createStudioJobMonitorRegistry() {
  const controllers = new Map<string, AbortController>();
  return {
    begin(jobId: string) {
      if (controllers.has(jobId)) return null;
      const controller = new AbortController();
      controllers.set(jobId, controller);
      return controller;
    },
    end(jobId: string, controller: AbortController) {
      if (controllers.get(jobId) === controller) controllers.delete(jobId);
    },
    abortAll(reason: unknown = new DOMException("상품 등록 화면이 닫혀 상태 확인을 중단했습니다.", "AbortError")) {
      for (const controller of controllers.values()) controller.abort(reason);
      controllers.clear();
    },
    get size() {
      return controllers.size;
    },
  };
}

export function studioJobAbortError() {
  return new DOMException("상품 등록 화면이 닫혀 상태 확인을 중단했습니다.", "AbortError");
}

export function isStudioJobAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
