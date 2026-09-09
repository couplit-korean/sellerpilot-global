import {
  assertShopeeShopProfileTarget,
  readProviderAccountIdentity,
} from "../../channels/provider-account-identity";
import { channelMarket } from "../../channels/markets";
import { shopeeShopTargetIds, type ChannelTargetRecord } from "../../channels/target-records";

type JsonRecord = Record<string, unknown>;

export type CredentialBoundShopeeTarget = ChannelTargetRecord & {
  credentialId: string;
};

export type ShopeeCredentialSnapshot = {
  credentialId: string;
  version: number;
  secretPayload: JsonRecord;
};

export type ExactShopeeCachedTargetResult =
  | { status: "ready"; target: CredentialBoundShopeeTarget }
  | {
    status: "blocked";
    reason:
      | "SHOPEE_TARGET_CACHE_INPUT_INVALID"
      | "SHOPEE_TARGET_NOT_AUTHORIZED"
      | "SHOPEE_TARGET_CACHE_CREDENTIAL_UNBOUND"
      | "SHOPEE_TARGET_CACHE_CREDENTIAL_MISMATCH"
      | "SHOPEE_TARGET_CACHE_VERSION_UNBOUND"
      | "SHOPEE_TARGET_CACHE_VERSION_MISMATCH"
      | "SHOPEE_TARGET_CACHE_ACCESS_NOT_FRESH"
      | "SHOPEE_TARGET_CACHE_AMBIGUOUS"
      | "SHOPEE_TARGET_CACHE_INCOMPLETE";
  };

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function numericId(value: unknown) {
  const id = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(id) ? id : "";
}

function credentialId(value: unknown) {
  const id = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
    ? id
    : "";
}

function completeTarget(target: CredentialBoundShopeeTarget) {
  return Boolean(
    target.targetId.trim()
    && target.displayName.trim()
    && target.marketCode.trim()
    && target.locale.trim()
    && target.language.trim()
    && target.currency.trim(),
  );
}

export function exactShopeeCachedTargetForActiveCredential(input: {
  cachedTargets: Array<ChannelTargetRecord & { credentialId?: string; credentialVersion?: number }>;
  activeCredentialId: string;
  activeCredentialVersion: number;
  activeCredentialSecret: unknown;
  targetId: string;
  marketCode: string;
  nowMs?: number;
  accessBufferMs?: number;
}): ExactShopeeCachedTargetResult {
  const activeCredentialId = credentialId(input.activeCredentialId);
  const activeCredentialVersion = input.activeCredentialVersion;
  const targetId = numericId(input.targetId);
  const market = channelMarket("shopee", input.marketCode);
  const nowMs = input.nowMs ?? Date.now();
  const accessBufferMs = Math.max(0, input.accessBufferMs ?? 10 * 60_000);
  if (!activeCredentialId || !Number.isSafeInteger(activeCredentialVersion) || activeCredentialVersion < 1
      || !targetId || !market || !Number.isFinite(nowMs) || !Number.isFinite(accessBufferMs)) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_INPUT_INVALID" };
  }
  if (!shopeeShopTargetIds(input.activeCredentialSecret).includes(targetId)) {
    return { status: "blocked", reason: "SHOPEE_TARGET_NOT_AUTHORIZED" };
  }

  const matchingTarget = input.cachedTargets.filter((target) => (
    target.targetId.trim() === targetId
    && target.marketCode.trim().toUpperCase() === market.code
  ));
  if (matchingTarget.some((target) => !credentialId(target.credentialId))) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_CREDENTIAL_UNBOUND" };
  }
  const bound = matchingTarget.filter((target) => credentialId(target.credentialId) === activeCredentialId);
  if (!bound.length && matchingTarget.length) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_CREDENTIAL_MISMATCH" };
  }
  if (bound.some((target) => !Number.isSafeInteger(target.credentialVersion) || Number(target.credentialVersion) < 1)) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_VERSION_UNBOUND" };
  }
  const versionBound = bound.filter((target) => target.credentialVersion === activeCredentialVersion);
  if (!versionBound.length && bound.length) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_VERSION_MISMATCH" };
  }
  if (versionBound.length !== 1) {
    return { status: "blocked", reason: versionBound.length > 1
      ? "SHOPEE_TARGET_CACHE_AMBIGUOUS"
      : "SHOPEE_TARGET_CACHE_INCOMPLETE" };
  }
  const accessExpiresAt = targetAccessExpiry(input.activeCredentialSecret, targetId);
  if (!Number.isFinite(accessExpiresAt) || accessExpiresAt <= nowMs + accessBufferMs) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_ACCESS_NOT_FRESH" };
  }
  const target = { ...versionBound[0], credentialId: activeCredentialId };
  if (!completeTarget(target)
      || target.locale !== market.locale
      || target.language !== market.language
      || target.currency !== market.currency) {
    return { status: "blocked", reason: "SHOPEE_TARGET_CACHE_INCOMPLETE" };
  }
  return { status: "ready", target };
}

function profileValue(payload: unknown, ...keys: string[]) {
  const root = record(payload);
  const rows = [
    root,
    record(root?.response),
    record(root?.data),
    record(record(root?.data)?.response),
  ].filter((value): value is JsonRecord => value !== null);
  for (const row of rows) {
    for (const key of keys) {
      const value = text(row[key]);
      if (value) return value;
    }
  }
  return "";
}

export function shopeeShopDiscoveryEvidenceFromGatewayResult(input: {
  result: unknown;
  requestedTargetId: string;
}): {
  providerProfile: JsonRecord;
  providerReadSucceeded: true;
  signedRequestBoundToTarget: true;
} {
  const root = record(input.result);
  const steps = Array.isArray(root?.steps) ? root.steps : [];
  const step = record(steps[0]);
  const profile = record(step?.data);
  const status = step?.status;
  if (root?.ok !== true
      || root.channel !== "shopee"
      || root.operation !== "shops.get"
      || steps.length !== 1
      || step?.name !== "shop-info"
      || step.ok !== true
      || typeof status !== "number"
      || !Number.isInteger(status)
      || status < 200
      || status >= 300
      || !profile
      || text(profile.error)) {
    throw new Error("SHOPEE_TARGET_STORE_PROVIDER_READ_FAILED");
  }
  // Both gateway executors sign get_shop_info with the exact request.shopId
  // and assert the echoed identity (when present) before completing the job.
  assertShopeeShopProfileTarget(profile, input.requestedTargetId, {
    acceptSignedRequestBinding: true,
  });
  return {
    providerProfile: profile,
    providerReadSucceeded: true,
    signedRequestBoundToTarget: true,
  };
}

function targetAccessExpiry(secretPayload: unknown, targetId: string) {
  const root = record(secretPayload);
  const targets = Array.isArray(root?.shopee_targets) ? root.shopee_targets : [];
  const matches = targets.map(record).filter((target): target is JsonRecord => Boolean(
    target && target.type === "shop" && text(target.id) === targetId,
  ));
  if (matches.length !== 1) return Number.NaN;
  return Date.parse(text(matches[0].access_token_expires_at));
}

function providerSubject(snapshot: ShopeeCredentialSnapshot) {
  const identity = readProviderAccountIdentity(snapshot.secretPayload, "shopee");
  if (!identity) throw new Error("SHOPEE_TARGET_STORE_IDENTITY_MISSING");
  return identity.subject;
}

export function exactShopeeTargetStoreBinding(input: {
  requestedCredentialId: string;
  requestedTargetId: string;
  requestedMarketCode: string;
  before: ShopeeCredentialSnapshot;
  after: ShopeeCredentialSnapshot;
  providerProfile: unknown;
  providerReadSucceeded: boolean;
  signedRequestBoundToTarget: boolean;
  observedAt: string;
  nowMs?: number;
  accessBufferMs?: number;
}): {
  credentialId: string;
  rotated: boolean;
  target: CredentialBoundShopeeTarget;
} {
  const requestedCredentialId = credentialId(input.requestedCredentialId);
  const beforeCredentialId = credentialId(input.before.credentialId);
  const afterCredentialId = credentialId(input.after.credentialId);
  const targetId = numericId(input.requestedTargetId);
  const market = channelMarket("shopee", input.requestedMarketCode);
  const observedAt = Date.parse(input.observedAt);
  if (!requestedCredentialId || !beforeCredentialId || !afterCredentialId || !targetId
      || !market || !Number.isFinite(observedAt)
      || !Number.isSafeInteger(input.before.version) || input.before.version < 1
      || !Number.isSafeInteger(input.after.version) || input.after.version < input.before.version) {
    throw new Error("SHOPEE_TARGET_STORE_INPUT_INVALID");
  }
  if (requestedCredentialId !== beforeCredentialId) {
    throw new Error("SHOPEE_TARGET_STORE_CREDENTIAL_CHANGED_BEFORE_DISCOVERY");
  }
  if (afterCredentialId !== beforeCredentialId && input.after.version <= input.before.version) {
    throw new Error("SHOPEE_TARGET_STORE_CREDENTIAL_ROTATION_INVALID");
  }
  if (!shopeeShopTargetIds(input.before.secretPayload).includes(targetId)
      || !shopeeShopTargetIds(input.after.secretPayload).includes(targetId)) {
    throw new Error("SHOPEE_TARGET_STORE_TARGET_NOT_AUTHORIZED");
  }
  if (providerSubject(input.before) !== providerSubject(input.after)) {
    throw new Error("SHOPEE_TARGET_STORE_IDENTITY_CHANGED");
  }
  if (!input.providerReadSucceeded) {
    throw new Error("SHOPEE_TARGET_STORE_PROVIDER_READ_FAILED");
  }
  assertShopeeShopProfileTarget(input.providerProfile as JsonRecord, targetId, {
    acceptSignedRequestBinding: input.signedRequestBoundToTarget,
  });
  const remoteMarketCode = profileValue(input.providerProfile, "region", "country", "market").toUpperCase();
  if (remoteMarketCode !== market.code) {
    throw new Error("SHOPEE_TARGET_STORE_MARKET_MISMATCH");
  }
  const displayName = profileValue(input.providerProfile, "shop_name", "shopName", "name");
  if (!displayName) throw new Error("SHOPEE_TARGET_STORE_PROFILE_INCOMPLETE");

  const nowMs = input.nowMs ?? Date.now();
  const accessBufferMs = Math.max(0, input.accessBufferMs ?? 10 * 60_000);
  if (!Number.isFinite(nowMs) || !Number.isFinite(accessBufferMs)) {
    throw new Error("SHOPEE_TARGET_STORE_CLOCK_INVALID");
  }
  const accessExpiresAt = targetAccessExpiry(input.after.secretPayload, targetId);
  if (!Number.isFinite(accessExpiresAt) || accessExpiresAt <= nowMs + accessBufferMs) {
    throw new Error("SHOPEE_TARGET_STORE_ACCESS_NOT_FRESH");
  }

  return {
    credentialId: afterCredentialId,
    rotated: afterCredentialId !== beforeCredentialId || input.after.version > input.before.version,
    target: {
      credentialId: afterCredentialId,
      targetId,
      displayName,
      marketCode: market.code,
      locale: market.locale,
      language: market.language,
      currency: market.currency,
      status: profileValue(input.providerProfile, "status", "shop_status"),
      verifiedAt: new Date(observedAt).toISOString(),
    },
  };
}
