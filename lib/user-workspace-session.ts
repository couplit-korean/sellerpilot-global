export const sellerPilotWorkspaceViews = [
  "overview",
  "products",
  "product-detail",
  "publishing",
  "registration-activity",
  "remediation",
  "style-learning",
  "margin",
  "orders",
  "cs",
  "connections",
  "platform-usage",
  "templates",
  "notifications",
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "temu",
  "smartstore",
  "ebay",
  "alibaba",
  "one688",
  "acceptance",
  "storyboard",
] as const;

export type SellerPilotWorkspaceView = (typeof sellerPilotWorkspaceViews)[number];

export const defaultWorkspaceIdleTimeoutMs = 30 * 60_000;
export const minimumWorkspaceIdleTimeoutMs = 5 * 60_000;
export const maximumWorkspaceIdleTimeoutMs = 12 * 60 * 60_000;
export const userWorkspaceStorageKeyPrefix = "sellerpilot:last-workspace:v1";

const workspaceViewSet = new Set<string>(sellerPilotWorkspaceViews);
const maximumStoredWorkspaceLength = 4_096;
const maximumUserScopeLength = 1_024;

export type UserWorkspaceRecord = {
  version: 1;
  userScope: string;
  view: SellerPilotWorkspaceView;
  lastActivityAt: number;
};

export type WorkspaceIdleState = {
  idleTimeoutMs: number;
  expiresAt: number;
  remainingMs: number;
  expired: boolean;
};

export type UserWorkspaceRestoreResult =
  | {
      status: "ready" | "expired";
      record: UserWorkspaceRecord;
      idle: WorkspaceIdleState;
    }
  | {
      status: "missing" | "invalid";
      record: null;
      idle: null;
    };

function userScope(userId: string) {
  const normalized = userId.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || hasControlCharacter) return null;
  try {
    const encoded = encodeURIComponent(normalized);
    return encoded.length <= maximumUserScopeLength ? encoded : null;
  } catch {
    return null;
  }
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseSellerPilotWorkspaceView(value: unknown): SellerPilotWorkspaceView | null {
  return typeof value === "string" && workspaceViewSet.has(value)
    ? value as SellerPilotWorkspaceView
    : null;
}

export function clampWorkspaceIdleTimeoutMs(value: unknown = defaultWorkspaceIdleTimeoutMs) {
  if (typeof value !== "number" || !Number.isFinite(value)) return defaultWorkspaceIdleTimeoutMs;
  return Math.min(
    maximumWorkspaceIdleTimeoutMs,
    Math.max(minimumWorkspaceIdleTimeoutMs, Math.trunc(value)),
  );
}

export function userWorkspaceStorageKey(userId: string) {
  const scope = userScope(userId);
  return scope ? `${userWorkspaceStorageKeyPrefix}:${scope}` : null;
}

export function calculateWorkspaceIdleState(
  lastActivityAt: number,
  now: number,
  configuredTimeoutMs: unknown = defaultWorkspaceIdleTimeoutMs,
): WorkspaceIdleState | null {
  if (!validTimestamp(lastActivityAt) || !validTimestamp(now) || lastActivityAt > now) return null;
  const idleTimeoutMs = clampWorkspaceIdleTimeoutMs(configuredTimeoutMs);
  const expiresAt = Math.min(Number.MAX_SAFE_INTEGER, lastActivityAt + idleTimeoutMs);
  const remainingMs = Math.max(0, expiresAt - now);
  return { idleTimeoutMs, expiresAt, remainingMs, expired: now >= expiresAt };
}

export function createUserWorkspaceRecord({
  userId,
  view,
  now,
}: {
  userId: string;
  view: unknown;
  now: number;
}): UserWorkspaceRecord | null {
  const scope = userScope(userId);
  const parsedView = parseSellerPilotWorkspaceView(view);
  if (!scope || !parsedView || !validTimestamp(now)) return null;
  return { version: 1, userScope: scope, view: parsedView, lastActivityAt: now };
}

export function serializeUserWorkspaceRecord(record: UserWorkspaceRecord) {
  return JSON.stringify(record);
}

export function parseUserWorkspaceRecord({
  raw,
  userId,
  now,
  idleTimeoutMs = defaultWorkspaceIdleTimeoutMs,
}: {
  raw: string | null | undefined;
  userId: string;
  now: number;
  idleTimeoutMs?: unknown;
}): UserWorkspaceRestoreResult {
  if (raw == null || raw === "") return { status: "missing", record: null, idle: null };
  if (raw.length > maximumStoredWorkspaceLength) return { status: "invalid", record: null, idle: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", record: null, idle: null };
  }
  const value = recordValue(parsed);
  const expectedScope = userScope(userId);
  const view = parseSellerPilotWorkspaceView(value?.view);
  if (
    !value
    || value.version !== 1
    || !expectedScope
    || value.userScope !== expectedScope
    || !view
    || !validTimestamp(value.lastActivityAt)
  ) {
    return { status: "invalid", record: null, idle: null };
  }
  const idle = calculateWorkspaceIdleState(value.lastActivityAt, now, idleTimeoutMs);
  if (!idle) return { status: "invalid", record: null, idle: null };
  const record: UserWorkspaceRecord = {
    version: 1,
    userScope: expectedScope,
    view,
    lastActivityAt: value.lastActivityAt,
  };
  return { status: idle.expired ? "expired" : "ready", record, idle };
}

export function recordUserWorkspaceActivity(
  record: UserWorkspaceRecord,
  now: number,
  idleTimeoutMs: unknown = defaultWorkspaceIdleTimeoutMs,
) {
  const currentIdle = calculateWorkspaceIdleState(record.lastActivityAt, now, idleTimeoutMs);
  if (!currentIdle || currentIdle.expired) return null;
  return { ...record, lastActivityAt: now } satisfies UserWorkspaceRecord;
}
