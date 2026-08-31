import assert from "node:assert/strict";
import test from "node:test";
import {
  competitorDisplayItemWithReviewOverride,
  competitorHumanReviewOverrideAfterSave,
  competitorHumanReviewOverrideApplies,
  deduplicatedV3CompetitorDisplayItems,
  isEligibleCompetitorObservation,
  type CompetitorDisplayItem,
  type CompetitorHumanReview,
} from "../app/_publishing/competitor-price-v3-ui";
import { COMPETITOR_MATCHER_VERSION } from "../lib/competitor-price-model";

const fingerprint = "a".repeat(64);
const observedAt = new Date().toISOString();

function humanReview(
  decision: CompetitorHumanReview["decision"],
  sourceObservationFingerprint = fingerprint,
  id = "40000000-0000-4000-8000-000000000001",
): CompetitorHumanReview {
  return {
    id,
    decision,
    reasonCodes: decision === "revoked" ? ["review_withdrawn"] : decision === "rejected" ? ["source_opened", "identity_mismatch"] : [
      "source_opened", "brand_model_match", "quantity_pack_match", "variant_condition_match", "not_accessory_refill",
    ],
    note: "원본 상품 페이지에서 직접 확인했습니다.",
    sourceObservationFingerprint,
    sourceCheckedAt: observedAt,
    sourceCurrent: true,
    createdAt: observedAt,
  };
}

function probable(review: CompetitorHumanReview | null): CompetitorDisplayItem {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    observationId: "30000000-0000-4000-8000-000000000001",
    observationFingerprint: fingerprint,
    sourceProvider: "naver_shopping",
    automatedMatchTier: "probable",
    effectiveMatchTier: review?.decision === "confirmed_exact" ? "exact" : review?.decision === "rejected" ? "rejected" : "probable",
    latestHumanReview: review,
    provider: "naver_shopping",
    marketplace: "smartstore",
    externalId: "listing-1",
    title: "사람 검토 후보",
    url: "https://smartstore.naver.com/example/products/1",
    imageUrl: null,
    mallName: "테스트몰",
    price: 10_000,
    currency: "KRW",
    checkedAt: observedAt,
    matcherVersion: COMPETITOR_MATCHER_VERSION,
    matchTier: "probable",
    matchScore: 75,
    matchEvidence: [{ code: "brand_exact", attribute: "brand", expected: "A", actual: "A" }],
    mismatchEvidence: [],
    priceComponents: {
      itemPrice: { status: "known", amount: 10_000, currency: "KRW", krwAmount: 10_000 },
      requiredOptionSurcharge: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      shipping: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      taxAndDuty: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
      discount: { status: "known", amount: 0, currency: "KRW", krwAmount: 0 },
    },
    totalPurchasePrice: { amount: 10_000, currency: "KRW", krwAmount: 10_000 },
    exchangeRate: null,
    unitPrice: null,
    canonicalUrl: "https://smartstore.naver.com/example/products/1",
    provenance: [{ provider: "naver_shopping", marketplace: "smartstore", externalId: "listing-1", url: "https://smartstore.naver.com/example/products/1", collectedAt: observedAt }],
    observedAt,
    inventoryStatus: "in_stock",
  };
}

test("a current confirmed review overlays probable as exact without changing the automatic tier", () => {
  const source = probable(humanReview("confirmed_exact"));
  const [effective] = deduplicatedV3CompetitorDisplayItems([source]);
  assert.equal(source.matchTier, "probable");
  assert.equal(source.automatedMatchTier, "probable");
  assert.equal(effective.matchTier, "exact");
  assert.equal(effective.automatedMatchTier, "probable");
  assert.equal(isEligibleCompetitorObservation(source), true);
});

test("rejected and revoked review events remain overlays, never source rewrites", () => {
  const rejected = probable(humanReview("rejected"));
  const revoked = probable(humanReview("revoked"));
  assert.equal(deduplicatedV3CompetitorDisplayItems([rejected])[0].matchTier, "rejected");
  assert.equal(deduplicatedV3CompetitorDisplayItems([revoked])[0].matchTier, "probable");
  assert.equal(rejected.matchTier, "probable");
  assert.equal(revoked.matchTier, "probable");
});

test("fingerprint mismatch makes a prior approval ineffective immediately", () => {
  const source = probable(humanReview("confirmed_exact", "b".repeat(64)));
  const [effective] = deduplicatedV3CompetitorDisplayItems([source]);
  assert.equal(effective.matchTier, "probable");
  assert.equal(isEligibleCompetitorObservation(source), false);
});

test("another admin's same-fingerprint event wins over a stale local exact override", () => {
  const adminAReview = humanReview("confirmed_exact");
  const adminAOverride = { review: adminAReview, baseLatestReviewId: null };
  assert.equal(competitorDisplayItemWithReviewOverride(probable(null), adminAOverride).matchTier, "exact");

  const newerServerReviews = [
    [humanReview("revoked", fingerprint, "40000000-0000-4000-8000-000000000002"), "probable"],
    [humanReview("rejected", fingerprint, "40000000-0000-4000-8000-000000000003"), "rejected"],
  ] as const;
  for (const [newerReview, expectedTier] of newerServerReviews) {
    const serverLatest = probable(newerReview);
    const effective = competitorDisplayItemWithReviewOverride(serverLatest, adminAOverride);
    assert.equal(effective.latestHumanReview?.id, newerReview.id);
    assert.equal(deduplicatedV3CompetitorDisplayItems([effective])[0].matchTier, expectedTier);
    assert.equal(isEligibleCompetitorObservation(effective), false);
    assert.equal(competitorHumanReviewOverrideApplies(serverLatest, adminAOverride), false);
  }

  const adminBReview = newerServerReviews[1][0];
  const serverLatest = probable(adminBReview);

  const adminCReview = humanReview(
    "confirmed_exact",
    fingerprint,
    "40000000-0000-4000-8000-000000000004",
  );
  const adminCOverride = competitorHumanReviewOverrideAfterSave(
    adminCReview,
    competitorHumanReviewOverrideApplies(serverLatest, adminAOverride) ? adminAOverride : undefined,
    adminBReview.id,
  );
  assert.equal(adminCOverride.baseLatestReviewId, adminBReview.id);
});

test("exact then revoke before props catch up preserves the original server base fence", () => {
  const rawProps = probable(null);
  const exactReview = humanReview("confirmed_exact");
  const exactOverride = competitorHumanReviewOverrideAfterSave(exactReview, undefined, null);
  const localExact = competitorDisplayItemWithReviewOverride(rawProps, exactOverride);
  assert.equal(localExact.matchTier, "exact");
  assert.equal(localExact.latestHumanReview?.id, exactReview.id);

  const revokeReview = humanReview(
    "revoked",
    fingerprint,
    "40000000-0000-4000-8000-000000000003",
  );
  const revokeOverride = competitorHumanReviewOverrideAfterSave(
    revokeReview,
    exactOverride,
    localExact.latestHumanReview?.id ?? null,
  );
  assert.equal(revokeOverride.baseLatestReviewId, null);
  const localRevoked = competitorDisplayItemWithReviewOverride(rawProps, revokeOverride);
  assert.equal(localRevoked.matchTier, "probable");
  assert.equal(localRevoked.latestHumanReview?.id, revokeReview.id);
});

test("human exact approval never bypasses stock, freshness, total, or KRW eligibility gates", () => {
  const approved = probable(humanReview("confirmed_exact"));
  const staleAt = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();
  const cases: Array<[string, CompetitorDisplayItem]> = [
    ["inventory unknown", { ...approved, inventoryStatus: "unknown" }],
    ["out of stock", { ...approved, inventoryStatus: "out_of_stock" }],
    ["older than 24 hours", { ...approved, observedAt: staleAt, checkedAt: staleAt }],
    ["total unavailable", { ...approved, totalPurchasePrice: null }],
    ["KRW conversion unavailable", {
      ...approved,
      totalPurchasePrice: { amount: 10_000, currency: "KRW", krwAmount: null },
    }],
  ];
  for (const [label, observation] of cases) {
    assert.equal(isEligibleCompetitorObservation(observation), false, label);
  }
});
