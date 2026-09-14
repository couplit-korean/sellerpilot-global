import assert from "node:assert/strict";
import test from "node:test";
import {
  STYLE_LEARNING_VERSION,
  buildMarketplaceStyleLearningBrief,
  categoryStyleProfiles,
  channelStyleProfiles,
  learnedProductExamples,
  styleLearningSummary,
  styleTargetMarkets,
} from "../lib/marketplace-style-learning";

test("style registry contains 6 categories and 1,200 unique coverage records", () => {
  assert.equal(categoryStyleProfiles.length, 6);
  assert.equal(channelStyleProfiles.length, 7);
  assert.equal(styleTargetMarkets.length, 19);
  assert.equal(learnedProductExamples.length, 1_200);
  assert.equal(styleLearningSummary.promptProfiles, 114);
  for (const category of categoryStyleProfiles) {
    const examples = learnedProductExamples.filter((item) => item.categoryId === category.id);
    assert.equal(examples.length, 200, category.label);
    assert.equal(category.families.length, 20, category.label);
    assert.equal(new Set(examples.map((item) => item.product)).size, 200, category.label);
    assert.equal(new Set(examples.map((item) => item.localSearchQuery)).size, 200, category.label);
    assert.equal(new Set(examples.map((item) => item.sourceUrl)).size, 200, category.label);
    const original = new Set(examples.slice(0, 100).map((item) => item.product));
    assert.equal(examples.slice(100).filter((item) => original.has(item.product)).length, 0, category.label);
  }
});

test("every category covers every channel-market profile with local search evidence", () => {
  const requiredTargets = new Set(styleTargetMarkets.map((item) => `${item.channel}:${item.market}:${item.locale}`));
  for (const category of categoryStyleProfiles) {
    const examples = learnedProductExamples.filter((item) => item.categoryId === category.id);
    const categoryTargets = new Set(examples.map((item) => `${item.channel}:${item.market}:${item.locale}`));
    assert.deepEqual(categoryTargets, requiredTargets, category.label);
    for (const item of examples) {
      assert.equal(item.evidenceLevel, "coverage-search");
      assert.ok(item.localSearchQuery.length >= 4, item.id);
      assert.doesNotMatch(item.sourceUrl, /undefined/);
      assert.doesNotThrow(() => new URL(item.sourceUrl));
      assert.equal(new URL(item.sourceUrl).protocol, "https:");
    }
  }
});

test("prompt brief pins the learning version, category coverage and all channel rules", () => {
  const brief = buildMarketplaceStyleLearningBrief("남성 후드 티셔츠");
  assert.match(brief, new RegExp(STYLE_LEARNING_VERSION.replaceAll(".", "\\.")));
  assert.match(brief, /패션 · 남성 상의/);
  assert.match(brief, /20개 × 제작 변형 10개 = 200개/);
  for (const channel of channelStyleProfiles) assert.match(brief, new RegExp(`\\[${channel.channel}\\]`));
});

test("official and observed sources are labeled and use secure links", () => {
  for (const profile of channelStyleProfiles) {
    assert.ok(profile.evidence.some((item) => item.type === "official"), profile.label);
    for (const item of profile.evidence) assert.equal(new URL(item.url).protocol, "https:");
  }
});
