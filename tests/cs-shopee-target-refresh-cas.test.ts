import assert from "node:assert/strict";
import test from "node:test";
import { mergeShopeeTargetRefreshCandidate } from "../lib/channels/cs/shopee/target-refresh-cas";

const target = (id: string, revision: string) => ({
  type: "shop" as const,
  id,
  access_token: `access-${id}-${revision}`,
  refresh_token: `refresh-${id}-${revision}`,
  access_token_expires_at: `2099-01-${revision.padStart(2, "0")}T00:00:00.000Z`,
  refresh_token_expires_at: `2099-02-${revision.padStart(2, "0")}T00:00:00.000Z`,
});
const ids = ["1719148844", "1758392145", "1758392144", "1758392135",
  "1758392139", "1758392137", "1758392161", "1758392178"];
const payload = (revisions: Record<string, string>) => ({
  partner_id: "2031489",
  partner_key: "synthetic-partner-key",
  main_account_id: "4940266",
  provider_account_subject: "shopee:main:4940266",
  provider_account_identity_version: "v1",
  shopee_targets: ids.map((id) => target(id, revisions[id] ?? "1")),
});
const replaceTarget = (source: ReturnType<typeof payload>, id: string, revision: string) => ({
  ...source,
  shopee_targets: source.shopee_targets.map((item) => item.id === id ? target(id, revision) : item),
});

test("Shopee target refresh merges into the latest payload and preserves the other seven shops", () => {
  const base = payload({});
  const latest = replaceTarget(base, ids[1], "2");
  const candidate = replaceTarget(base, ids[0], "3");
  const merged = mergeShopeeTargetRefreshCandidate({
    targetId: ids[0], baseVersion: 7, latestVersion: 8,
    basePayload: base, latestPayload: latest, candidatePayload: candidate,
  });
  assert.equal(merged.status, "merged");
  assert.equal(merged.nextVersion, 9);
  assert.equal(merged.nonTargetBeforeDigest, merged.nonTargetAfterDigest);
  const targets = merged.payload.shopee_targets as Array<{ id: string; access_token: string }>;
  assert.match(targets.find((item) => item.id === ids[0])!.access_token, /-3$/u);
  assert.match(targets.find((item) => item.id === ids[1])!.access_token, /-2$/u);
  assert.equal(targets.filter((item) => ![ids[0], ids[1]].includes(item.id))
    .every((item) => item.access_token.endsWith("-1")), true);
});

test("same-target stale refresh is rejected before it can overwrite a newer rotation", () => {
  const base = payload({});
  const latest = replaceTarget(base, ids[0], "2");
  const staleCandidate = replaceTarget(base, ids[0], "3");
  assert.throws(() => mergeShopeeTargetRefreshCandidate({
    targetId: ids[0], baseVersion: 7, latestVersion: 8,
    basePayload: base, latestPayload: latest, candidatePayload: staleCandidate,
  }), /SHOPEE_TARGET_REFRESH_STALE/u);
});

test("an already-applied target rotation is idempotent and creates no next version", () => {
  const base = payload({});
  const candidate = replaceTarget(base, ids[0], "2");
  const merged = mergeShopeeTargetRefreshCandidate({
    targetId: ids[0], baseVersion: 7, latestVersion: 8,
    basePayload: base, latestPayload: candidate, candidatePayload: candidate,
  });
  assert.equal(merged.status, "already_applied");
  assert.equal(merged.nextVersion, 8);
});

test("a candidate that changes any non-target shop is rejected", () => {
  const base = payload({});
  const widened = replaceTarget(replaceTarget(base, ids[0], "2"), ids[7], "9");
  assert.throws(() => mergeShopeeTargetRefreshCandidate({
    targetId: ids[0], baseVersion: 7, latestVersion: 7,
    basePayload: base, latestPayload: base, candidatePayload: widened,
  }), /SHOPEE_TARGET_REFRESH_CANDIDATE_WIDENED/u);
});
