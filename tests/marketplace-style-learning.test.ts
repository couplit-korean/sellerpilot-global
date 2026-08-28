import assert from "node:assert/strict";
import test from "node:test";
import {
  STYLE_LEARNING_VERSION,
  buildMarketplaceMasterStyleBrief,
  buildMarketplaceStyleLearningBrief,
  categoryStyleProfiles,
  channelStyleProfiles,
  learnedProductExamples,
  styleLearningSummary,
  styleTargetMarkets,
} from "../lib/marketplace-style-learning";

test("style registry contains 6 categories and 1,200 unique coverage records", () => {
  assert.equal(categoryStyleProfiles.length, 6);
  assert.equal(channelStyleProfiles.length, 8);
  assert.equal(styleTargetMarkets.length, 34);
  assert.equal(learnedProductExamples.length, 1_200);
  assert.equal(styleLearningSummary.settingShotGroups, 9);
  assert.equal(styleLearningSummary.promptProfiles, 204);
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

test("eBay style coverage exposes all 15 supported country locales", () => {
  assert.deepEqual(
    styleTargetMarkets
      .filter((item) => item.channel === "ebay")
      .map((item) => `${item.market}:${item.locale}`),
    [
      "US:en-US", "GB:en-GB", "DE:de-DE", "AU:en-AU", "CA:en-CA",
      "FR:fr-FR", "IT:it-IT", "ES:es-ES", "AT:de-AT", "BE:nl-BE",
      "CH:de-CH", "HK:zh-HK", "IE:en-IE", "NL:nl-NL", "PL:pl-PL",
    ],
  );
});

test("continental eBay coverage uses native search dictionaries instead of en-US fallback queries", () => {
  const nativeSignals: ReadonlyArray<readonly [string, RegExp]> = [
    ["de-DE", /(?:Feuchtigkeits|Gesichts|Herren|Spielzeug|Präparat|Reis|Pinsel)/u],
    ["de-AT", /(?:Feuchtigkeits|Gesichts|Herren|Spielzeug|Präparat|Reis|Pinsel)/u],
    ["de-CH", /(?:Feuchtigkeits|Gesichts|Herren|Spielzeug|Präparat|Reis|Pinsel)/u],
    ["fr-FR", /(?:crème|visage|homme|jouet|complément|riz|pinceau)/u],
    ["it-IT", /(?:crema|viso|uomo|giocattolo|integratore|riso|pennello)/u],
    ["nl-BE", /(?:crème|gezicht|heren|speelgoed|rijst|kwast|vitamine)/u],
    ["nl-NL", /(?:crème|gezicht|heren|speelgoed|rijst|kwast|vitamine)/u],
    ["pl-PL", /(?:krem|twarzy|męsk|zabawk|suplement|ryż|pędzel)/u],
  ];
  for (const [locale, nativeSignal] of nativeSignals) {
    const item = learnedProductExamples.find((example) => example.channel === "ebay" && example.locale === locale);
    assert.ok(item, locale);
    assert.match(item.localSearchQuery, nativeSignal, `${item.id}:${locale}`);
    assert.doesNotMatch(
      item.localSearchQuery,
      /\b(?:single item|bundle set|travel size|large size|beginner|professional|gift pack|minimal packaging)\b/iu,
      `${item.id}:${locale}`,
    );
  }
});

test("prompt brief pins the learning version, category coverage and all channel rules", () => {
  const brief = buildMarketplaceStyleLearningBrief("남성 후드 티셔츠");
  assert.match(brief, new RegExp(STYLE_LEARNING_VERSION.replaceAll(".", "\\.")));
  assert.match(brief, /패션 · 남성 상의/);
  assert.match(brief, /20개 × 제작 변형 10개 = 200개/);
  assert.match(brief, /ebay:PL=pl-PL\(Polski\)/);
  for (const channel of channelStyleProfiles) assert.match(brief, new RegExp(`\\[${channel.channel}\\]`));
});

test("master style brief preserves category evidence and every channel fence without repeated full profiles", () => {
  const fullBrief = buildMarketplaceStyleLearningBrief("남성 후드 티셔츠");
  const masterBrief = buildMarketplaceMasterStyleBrief("남성 후드 티셔츠");

  assert.match(masterBrief, new RegExp(STYLE_LEARNING_VERSION.replaceAll(".", "\\.")));
  assert.match(masterBrief, /패션 · 남성 상의/);
  assert.match(masterBrief, /20개 × 제작 변형 10개 = 200개/);
  assert.match(masterBrief, /카테고리 상세 배치/);
  assert.match(masterBrief, /카테고리 촬영/);
  assert.match(masterBrief, /필수 사실/);
  for (const channel of channelStyleProfiles) assert.match(masterBrief, new RegExp(`\\[${channel.channel}\\]`));
  assert.ok(Buffer.byteLength(masterBrief) < Buffer.byteLength(fullBrief) * 0.55);
  assert.doesNotMatch(masterBrief, /국가·언어 매핑/);
});

test("official and observed sources are labeled and use secure links", () => {
  for (const profile of channelStyleProfiles) {
    assert.ok(profile.evidence.some((item) => item.type === "official"), profile.label);
    for (const item of profile.evidence) assert.equal(new URL(item.url).protocol, "https:");
  }
});
