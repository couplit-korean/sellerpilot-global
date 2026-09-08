import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

type ShopeeTarget = JsonRecord & {
  type: "shop" | "merchant";
  id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
};

export type ShopeeTargetRefreshMerge = {
  contract: "sellerpilot-shopee-target-refresh-merge/1";
  status: "merged" | "already_applied";
  targetId: string;
  baseVersion: number;
  latestVersion: number;
  nextVersion: number;
  targetBeforeDigest: string;
  targetAfterDigest: string;
  nonTargetBeforeDigest: string;
  nonTargetAfterDigest: string;
  payload: JsonRecord;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const digest = (value: unknown) => createHash("sha256").update(stable(value), "utf8").digest("hex");

function targets(payload: JsonRecord): ShopeeTarget[] {
  const value = payload.shopee_targets;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error("SHOPEE_TARGET_REFRESH_TARGETS_INVALID");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("SHOPEE_TARGET_REFRESH_TARGETS_INVALID");
    }
    const target = item as JsonRecord;
    const key = `${String(target.type)}:${String(target.id)}`;
    if ((target.type !== "shop" && target.type !== "merchant")
        || !/^[1-9]\d{0,31}$/u.test(String(target.id ?? ""))
        || seen.has(key)
        || ![target.access_token, target.refresh_token, target.access_token_expires_at,
          target.refresh_token_expires_at].every((field) => typeof field === "string" && field.length > 0)) {
      throw new Error("SHOPEE_TARGET_REFRESH_TARGETS_INVALID");
    }
    seen.add(key);
    return target as ShopeeTarget;
  });
}

function byKey(items: ShopeeTarget[]) {
  return new Map(items.map((item) => [`${item.type}:${item.id}`, item]));
}

function targetKeys(items: ShopeeTarget[]) {
  return items.map((item) => `${item.type}:${item.id}`).sort();
}

function nonTargets(items: ShopeeTarget[], targetKey: string) {
  return items.filter((item) => `${item.type}:${item.id}` !== targetKey)
    .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

function mergeProviderIdentity(latest: JsonRecord, candidate: JsonRecord) {
  const output = { ...latest };
  for (const key of ["provider_account_subject", "provider_account_identity_version"] as const) {
    const current = latest[key];
    const next = candidate[key];
    if (current !== undefined && next !== undefined && current !== next) {
      throw new Error("SHOPEE_TARGET_REFRESH_IDENTITY_MISMATCH");
    }
    if (current === undefined && next !== undefined) output[key] = next;
  }
  return output;
}

export function mergeShopeeTargetRefreshCandidate(input: {
  targetId: string;
  baseVersion: number;
  latestVersion: number;
  basePayload: JsonRecord;
  latestPayload: JsonRecord;
  candidatePayload: JsonRecord;
}): ShopeeTargetRefreshMerge {
  if (!/^[1-9]\d{0,31}$/u.test(input.targetId)
      || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1
      || !Number.isSafeInteger(input.latestVersion) || input.latestVersion < input.baseVersion) {
    throw new Error("SHOPEE_TARGET_REFRESH_INPUT_INVALID");
  }
  const baseTargets = targets(input.basePayload);
  const latestTargets = targets(input.latestPayload);
  const candidateTargets = targets(input.candidatePayload);
  if (stable(targetKeys(baseTargets)) !== stable(targetKeys(latestTargets))
      || stable(targetKeys(baseTargets)) !== stable(targetKeys(candidateTargets))) {
    throw new Error("SHOPEE_TARGET_REFRESH_SCOPE_MISMATCH");
  }
  const targetKey = `shop:${input.targetId}`;
  const base = byKey(baseTargets).get(targetKey);
  const latest = byKey(latestTargets).get(targetKey);
  const candidate = byKey(candidateTargets).get(targetKey);
  if (!base || !latest || !candidate) throw new Error("SHOPEE_TARGET_REFRESH_SCOPE_MISMATCH");
  for (const other of nonTargets(candidateTargets, targetKey)) {
    const baseline = byKey(baseTargets).get(`${other.type}:${other.id}`);
    if (!baseline || stable(baseline) !== stable(other)) {
      throw new Error("SHOPEE_TARGET_REFRESH_CANDIDATE_WIDENED");
    }
  }
  const targetBeforeDigest = digest(latest);
  const targetAfterDigest = digest(candidate);
  const nonTargetBeforeDigest = digest(nonTargets(latestTargets, targetKey));
  const baseTargetDigest = digest(base);
  if (targetBeforeDigest !== baseTargetDigest && targetBeforeDigest !== targetAfterDigest) {
    throw new Error("SHOPEE_TARGET_REFRESH_STALE");
  }
  const status = targetBeforeDigest === targetAfterDigest ? "already_applied" as const : "merged" as const;
  const mergedTargets = latestTargets.map((item) =>
    `${item.type}:${item.id}` === targetKey ? candidate : item);
  const withIdentity = mergeProviderIdentity(input.latestPayload, input.candidatePayload);
  const payload = {
    ...withIdentity,
    shopee_targets: mergedTargets,
    shop_id: candidate.id,
    access_token: candidate.access_token,
    refresh_token: candidate.refresh_token,
    access_token_expires_at: candidate.access_token_expires_at,
    refresh_token_expires_at: candidate.refresh_token_expires_at,
  };
  delete payload.merchant_id;
  const nonTargetAfterDigest = digest(nonTargets(targets(payload), targetKey));
  if (nonTargetBeforeDigest !== nonTargetAfterDigest) {
    throw new Error("SHOPEE_TARGET_REFRESH_NON_TARGET_CHANGED");
  }
  return {
    contract: "sellerpilot-shopee-target-refresh-merge/1",
    status,
    targetId: input.targetId,
    baseVersion: input.baseVersion,
    latestVersion: input.latestVersion,
    nextVersion: status === "already_applied" ? input.latestVersion : input.latestVersion + 1,
    targetBeforeDigest,
    targetAfterDigest,
    nonTargetBeforeDigest,
    nonTargetAfterDigest,
    payload,
  };
}
