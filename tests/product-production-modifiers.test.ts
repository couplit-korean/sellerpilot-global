import assert from "node:assert/strict";
import test from "node:test";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { buildAssetImagePrompt } from "../lib/ai-image-planning";
import {
  formatProductProductionModifiers,
  PRODUCT_PRODUCTION_MODIFIER_SIGNAL_COUNT,
  PRODUCT_PRODUCTION_MODIFIER_VERSION,
  resolveProductProductionModifiers,
} from "../lib/product-production-modifiers";
import type { ProductStudioResult } from "../app/product-studio-types";

const baseResult = {
  mode: "cli",
  product: {
    name: "테스트 상품",
    category: "일반 상품",
    features: [],
    cautions: [],
    classification: { isHealthFunctionalFood: false },
    oneLine: "확인된 실제 상품",
  },
  design: {
    themeName: "source faithful",
    palette: { surface: "#f4f1ed", accent: "#49433f" },
    creativeStrategy: {
      differentiationKey: "실제 외관",
      artDirection: "원본 중심",
      purchaseDecision: "형태와 구성 확인",
    },
    sections: [],
  },
  localizedListings: [],
} as unknown as ProductStudioResult;

test("composable production layer covers at least sixty package, geometry, material, mechanism and state signals", () => {
  assert.ok(PRODUCT_PRODUCTION_MODIFIER_SIGNAL_COUNT >= 60, String(PRODUCT_PRODUCTION_MODIFIER_SIGNAL_COUNT));
  const resolution = resolveProductProductionModifiers({
    name: "유리 펌프 보틀 세럼",
    category: "화장품 > 세럼",
    features: ["스포이드가 아닌 잠금 펌프형", "액상 제형"],
  });
  const axes = new Set(resolution.modifiers.map((modifier) => modifier.axis));
  assert.deepEqual([...axes].sort(), ["material", "package"]);
  assert.ok(resolution.modifiers.some((modifier) => modifier.id === "bottle"));
  assert.ok(resolution.modifiers.some((modifier) => modifier.id === "pump-dispenser"));
  assert.ok(resolution.modifiers.some((modifier) => modifier.id === "clear-glass"));
  assert.ok(resolution.modifiers.some((modifier) => modifier.id === "liquid-gel"));
});

test("a long-tail product receives physical shot direction even when no fixed scene subtype is available", () => {
  const resolution = resolveProductProductionModifiers({
    name: "스테인리스 자석 체결식 플렉시블 호스",
    category: "산업용 부품",
    features: ["양 끝 커넥터", "길고 유연한 구조"],
  }, ["main", "left", "right", "label"], "detail-feature");
  const ids = resolution.modifiers.map((modifier) => modifier.id);
  assert.ok(ids.includes("long-flexible"));
  assert.ok(ids.includes("stainless-metal"));
  assert.ok(ids.includes("magnetic-attachment"));
  assert.ok(ids.includes("connector-port"));
  assert.match(resolution.slotDirective, /스테인리스·금속/);
  assert.match(resolution.sourceEvidence, /측면 원본/);
  assert.match(resolution.sourceEvidence, /후면·라벨 원본/);
});

test("source-role routing distinguishes hero, side, evidence, barcode and opened-content photographs", () => {
  const brief = formatProductProductionModifiers(
    { name: "스틱형 분말 상품", category: "식품" },
    ["main", "left", "back", "barcode", "contents"],
    "detail-package",
  );
  assert.match(brief, new RegExp(PRODUCT_PRODUCTION_MODIFIER_VERSION));
  assert.match(brief, /main\/front 원본은 대표 외관/);
  assert.match(brief, /측면 원본은 두께·깊이/);
  assert.match(brief, /후면·라벨 원본은 원재료·성분/);
  assert.match(brief, /바코드 원본은 구매 식별 보조 증거/);
  assert.match(brief, /실제 내용물·개봉 원본은 사용 상태/);
});

test("food prompt combines cup geometry, opening state and cooking state without allowing an empty background result", () => {
  const result = {
    ...baseResult,
    product: {
      ...baseResult.product,
      name: "농심 신라면컵 65g",
      category: "식품 > 컵라면",
      features: ["끓는 물 조리", "밀봉 뚜껑"],
      cautions: ["뜨거운 물 주의"],
    },
  };
  const asset = aiGeneratedAssetSpecs.find(({ id }) => id === "detail-use")!;
  const prompt = buildAssetImagePrompt(result, "/tmp/cup.png", asset, ["main", "front", "back"], "", "prepared-food");
  assert.match(prompt, /Physical package and prepared-state contract/);
  assert.match(prompt, /package\/lidded-cup\(뚜껑형 컵\)/);
  assert.match(prompt, /state\/heated-cooked-state\(가열·조리 상태\)/);
  assert.match(prompt, /밀봉 뚜껑에서 김이 나거나 다른 그릇으로 바꾸지 않는다/);
  assert.match(prompt, /no empty-background result/i);
});

test("identity-background mode uses physical geometry only for support and still forbids a generated stand-in", () => {
  const result = {
    ...baseResult,
    product: {
      ...baseResult.product,
      name: "스테인리스 손잡이 텀블러",
      category: "주방용품 > 텀블러",
      features: ["나사식 뚜껑", "휴대용"],
    },
  };
  const asset = aiGeneratedAssetSpecs.find(({ id }) => id === "portrait")!;
  const prompt = buildAssetImagePrompt(result, "/tmp/background.png", asset, ["main", "left"], "", "identity-background");
  assert.match(prompt, /Later-composited product geometry contract/);
  assert.match(prompt, /stainless-metal\(스테인리스·금속\)/);
  assert.match(prompt, /threaded-cap\(나사식 마개\)/);
  assert.match(prompt, /plate must still contain no product or product-shaped stand-in/i);
  assert.match(prompt, /HARD IDENTITY FIREWALL/);
});

test("unknown products fail closed instead of inventing an opening, material or use action", () => {
  const resolution = resolveProductProductionModifiers({ name: "상품 A", category: "기타" }, ["main"], "detail-use");
  assert.equal(resolution.modifiers.length, 0);
  assert.match(resolution.slotDirective, /형태 단서가 부족/);
  assert.match(resolution.sourceEvidence, /별도 원본이 없으므로 생성 근거로 간주하지 않는다/);
});

test("an accessory strap does not redefine a tumbler as a long flexible product", () => {
  const resolution = resolveProductProductionModifiers({
    name: "락앤락 메트로 더블 텀블러",
    category: "주방용품 > 텀블러",
    features: ["핸디 스트랩", "스테인리스 스틸 304"],
  });
  assert.equal(resolution.modifiers.some((modifier) => modifier.id === "long-flexible"), false);
  assert.equal(resolution.modifiers.some((modifier) => modifier.id === "stainless-metal"), true);
});
