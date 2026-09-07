import assert from "node:assert/strict";
import test from "node:test";
import { activeChannelKeys, type ActiveChannelKey } from "../lib/channels/catalog";
import {
  assessCompetitorMatch,
  type CompetitorCandidateIdentity,
  type CompetitorProductIdentity,
} from "../lib/competitor-price-model";
import {
  calculateChannelMargins,
  createPaymentFeeOverrides,
  createPlatformFeeOverrides,
  marginChannelProfiles,
  type ChannelMarginCosts,
  type MarginFormBase,
} from "../lib/pricing/channel-margin";
import { calculateMargin } from "../lib/pricing/margin-engine";

type ProductScenario = {
  name: string;
  reference: CompetitorProductIdentity;
  exactTitle: string;
  exactIdentity: CompetitorCandidateIdentity;
  probableTitle: string;
  rejectedTitle: string;
  rejectedIdentity: CompetitorCandidateIdentity;
  form: MarginFormBase;
  shippingScale: number;
};

const products: ProductScenario[] = [
  {
    name: "라면 한 박스",
    reference: { productName: "농심 신라면", brand: "농심", gtins: ["8801043014830"], specification: { value: 120, unit: "g" }, itemCount: 20, totalQuantity: { value: 2400, unit: "g" }, packageType: "bundle", options: { flavor: "spicy" } },
    exactTitle: "농심 신라면 120g 20봉 한박스 매운맛",
    exactIdentity: { productName: "농심 신라면", brand: "농심", gtins: ["8801043014830"], specification: { value: 120, unit: "g" }, itemCount: 20, totalQuantity: { value: 2400, unit: "g" }, packageType: "bundle", options: { flavor: "spicy" } },
    probableTitle: "농심 신라면 정품",
    rejectedTitle: "농심 신라면 120g 10봉 소포장 매운맛",
    rejectedIdentity: { brand: "농심", gtins: ["8801043014830"], specification: { value: 120, unit: "g" }, itemCount: 10, totalQuantity: { value: 1200, unit: "g" }, packageType: "bundle", options: { flavor: "spicy" } },
    form: { sellingPrice: 42_900, marketReferencePrice: 41_500, purchaseCost: 21_000, taxRate: 1, adRate: 2, reserveRate: 1, targetMargin: 20 },
    shippingScale: 1.4,
  },
  {
    name: "건강기능식품 한 박스",
    reference: { productName: "정관장 홍삼정 에브리타임", brand: "정관장", gtins: ["8809312151040"], specification: { value: 10, unit: "ml" }, itemCount: 30, totalQuantity: { value: 300, unit: "ml" }, packageType: "bundle", options: { option: "original" } },
    exactTitle: "정관장 홍삼정 에브리타임 10ml 30포 오리지널",
    exactIdentity: { productName: "정관장 홍삼정 에브리타임", brand: "정관장", gtins: ["8809312151040"], specification: { value: 10, unit: "ml" }, itemCount: 30, totalQuantity: { value: 300, unit: "ml" }, packageType: "bundle", options: { option: "original" } },
    probableTitle: "정관장 홍삼정 에브리타임 정품",
    rejectedTitle: "정관장 홍삼정 에브리타임 10ml 20포",
    rejectedIdentity: { brand: "정관장", gtins: ["8809312151040"], specification: { value: 10, unit: "ml" }, itemCount: 20, totalQuantity: { value: 200, unit: "ml" }, packageType: "bundle", options: { option: "original" } },
    form: { sellingPrice: 98_000, marketReferencePrice: 95_000, purchaseCost: 54_000, taxRate: 1.5, adRate: 3, reserveRate: 1, targetMargin: 22 },
    shippingScale: 1,
  },
  {
    name: "의류 세 벌",
    reference: { productName: "Couplit Basic T-Shirt", brand: "Couplit", gtins: ["8800000000003"], itemCount: 3, packageType: "bundle", condition: "new", options: { color: "black", size: "M" } },
    exactTitle: "Couplit Basic T-Shirt Black Size M 3 Pack",
    exactIdentity: { productName: "Couplit Basic T-Shirt", brand: "Couplit", gtins: ["8800000000003"], itemCount: 3, packageType: "bundle", condition: "new", options: { color: "black", size: "M" } },
    probableTitle: "Couplit Basic T-Shirt",
    rejectedTitle: "Couplit Basic T-Shirt White Size L 3 Pack",
    rejectedIdentity: { brand: "Couplit", gtins: ["8800000000003"], itemCount: 3, packageType: "bundle", condition: "new", options: { color: "white", size: "L" } },
    form: { sellingPrice: 59_000, marketReferencePrice: 55_000, purchaseCost: 24_000, taxRate: 1, adRate: 4, reserveRate: 3, targetMargin: 25 },
    shippingScale: 1.1,
  },
  {
    name: "스킨케어 두 병",
    reference: { productName: "COSRX Low pH Cleanser", brand: "COSRX", gtins: ["8809416470511"], specification: { value: 150, unit: "ml" }, itemCount: 2, totalQuantity: { value: 300, unit: "ml" }, packageType: "bundle", contentType: "main", options: { option: "cleanser" } },
    exactTitle: "COSRX Low pH Cleanser 150ml 2 Bottles",
    exactIdentity: { productName: "COSRX Low pH Cleanser", brand: "COSRX", gtins: ["8809416470511"], specification: { value: 150, unit: "ml" }, itemCount: 2, totalQuantity: { value: 300, unit: "ml" }, packageType: "bundle", contentType: "main", options: { option: "cleanser" } },
    probableTitle: "COSRX Low pH Cleanser genuine",
    rejectedTitle: "COSRX Low pH Cleanser Refill 150ml 2 Pack",
    rejectedIdentity: { brand: "COSRX", gtins: ["8809416470511"], specification: { value: 150, unit: "ml" }, itemCount: 2, totalQuantity: { value: 300, unit: "ml" }, packageType: "bundle", contentType: "refill", options: { option: "cleanser" } },
    form: { sellingPrice: 38_000, marketReferencePrice: 36_500, purchaseCost: 15_000, taxRate: 1, adRate: 3, reserveRate: 2, targetMargin: 24 },
    shippingScale: 0.8,
  },
  {
    name: "드립커피 한 박스",
    reference: { productName: "Maxim Drip Coffee Original", brand: "Maxim", gtins: ["8801037008128"], specification: { value: 10, unit: "g" }, itemCount: 20, totalQuantity: { value: 200, unit: "g" }, packageType: "bundle", options: { flavor: "original" } },
    exactTitle: "Maxim Drip Coffee Original 10g 20 Bags",
    exactIdentity: { productName: "Maxim Drip Coffee Original", brand: "Maxim", gtins: ["8801037008128"], specification: { value: 10, unit: "g" }, itemCount: 20, totalQuantity: { value: 200, unit: "g" }, packageType: "bundle", options: { flavor: "original" } },
    probableTitle: "Maxim Drip Coffee Original",
    rejectedTitle: "Maxim Drip Coffee Mocha 10g 20 Bags",
    rejectedIdentity: { brand: "Maxim", gtins: ["8801037008128"], specification: { value: 10, unit: "g" }, itemCount: 20, totalQuantity: { value: 200, unit: "g" }, packageType: "bundle", options: { flavor: "mocha" } },
    form: { sellingPrice: 31_000, marketReferencePrice: 29_900, purchaseCost: 12_000, taxRate: 1, adRate: 2, reserveRate: 1, targetMargin: 23 },
    shippingScale: 0.7,
  },
  {
    name: "반려동물 사료 한 포대",
    reference: { productName: "Acme Salmon Cat Food", brand: "Acme", gtins: ["8800000000006"], specification: { value: 2, unit: "kg" }, itemCount: 1, totalQuantity: { value: 2, unit: "kg" }, packageType: "single", options: { flavor: "salmon" } },
    exactTitle: "Acme Salmon Cat Food 2kg 1 Bag",
    exactIdentity: { productName: "Acme Salmon Cat Food", brand: "Acme", gtins: ["8800000000006"], specification: { value: 2, unit: "kg" }, itemCount: 1, totalQuantity: { value: 2, unit: "kg" }, packageType: "single", options: { flavor: "salmon" } },
    probableTitle: "Acme Salmon Cat Food",
    rejectedTitle: "Acme Chicken Cat Food 2kg 1 Bag",
    rejectedIdentity: { brand: "Acme", gtins: ["8800000000006"], specification: { value: 2, unit: "kg" }, itemCount: 1, totalQuantity: { value: 2, unit: "kg" }, packageType: "single", options: { flavor: "chicken" } },
    form: { sellingPrice: 44_000, marketReferencePrice: 42_000, purchaseCost: 19_000, taxRate: 1, adRate: 2, reserveRate: 2, targetMargin: 22 },
    shippingScale: 1.3,
  },
  {
    name: "휴대폰 케이스 두 개",
    reference: { productName: "Couplit Clear Phone Case", brand: "Couplit", gtins: ["8800000000007"], itemCount: 2, packageType: "bundle", condition: "new", options: { color: "clear", compatibleModel: "iPhone 16" } },
    exactTitle: "Couplit Clear Phone Case iPhone 16 2 Pack",
    exactIdentity: { productName: "Couplit Clear Phone Case", brand: "Couplit", gtins: ["8800000000007"], itemCount: 2, packageType: "bundle", condition: "new", options: { color: "clear", compatibleModel: "iPhone 16" } },
    probableTitle: "Couplit Clear Phone Case",
    rejectedTitle: "Couplit Clear Phone Case iPhone 15 2 Pack",
    rejectedIdentity: { brand: "Couplit", gtins: ["8800000000007"], itemCount: 2, packageType: "bundle", condition: "new", options: { color: "clear", compatibleModel: "iPhone 15" } },
    form: { sellingPrice: 25_000, marketReferencePrice: 23_000, purchaseCost: 6_000, taxRate: 1, adRate: 3, reserveRate: 2, targetMargin: 28 },
    shippingScale: 0.4,
  },
  {
    name: "텀블러 두 개 세트",
    reference: { productName: "Couplit Steel Tumbler", brand: "Couplit", gtins: ["8800000000008"], specification: { value: 500, unit: "ml" }, itemCount: 2, totalQuantity: { value: 1000, unit: "ml" }, packageType: "bundle", options: { color: "silver" } },
    exactTitle: "Couplit Steel Tumbler Silver 500ml 2 Set",
    exactIdentity: { productName: "Couplit Steel Tumbler", brand: "Couplit", gtins: ["8800000000008"], specification: { value: 500, unit: "ml" }, itemCount: 2, totalQuantity: { value: 1000, unit: "ml" }, packageType: "bundle", options: { color: "silver" } },
    probableTitle: "Couplit Steel Tumbler",
    rejectedTitle: "Couplit Steel Tumbler Black 350ml 2 Set",
    rejectedIdentity: { brand: "Couplit", gtins: ["8800000000008"], specification: { value: 350, unit: "ml" }, itemCount: 2, totalQuantity: { value: 700, unit: "ml" }, packageType: "bundle", options: { color: "black" } },
    form: { sellingPrice: 49_000, marketReferencePrice: 46_000, purchaseCost: 19_000, taxRate: 1, adRate: 3, reserveRate: 2, targetMargin: 25 },
    shippingScale: 1.2,
  },
  {
    name: "젤펜 열두 자루",
    reference: { productName: "Monami Gel Pen 0.5", brand: "Monami", gtins: ["8800000000009"], itemCount: 12, packageType: "bundle", options: { color: "black", option: "0.5mm" } },
    exactTitle: "Monami Gel Pen 0.5mm Black 12 pcs",
    exactIdentity: { productName: "Monami Gel Pen 0.5", brand: "Monami", gtins: ["8800000000009"], itemCount: 12, packageType: "bundle", options: { color: "black", option: "0.5mm" } },
    probableTitle: "Monami Gel Pen",
    rejectedTitle: "Monami Gel Pen 0.7mm Blue 12 pcs",
    rejectedIdentity: { brand: "Monami", gtins: ["8800000000009"], itemCount: 12, packageType: "bundle", options: { color: "blue", option: "0.7mm" } },
    form: { sellingPrice: 19_000, marketReferencePrice: 18_000, purchaseCost: 5_500, taxRate: 1, adRate: 2, reserveRate: 1, targetMargin: 25 },
    shippingScale: 0.5,
  },
  {
    name: "양말 다섯 켤레",
    reference: { productName: "Couplit Cotton Socks", brand: "Couplit", gtins: ["8800000000010"], itemCount: 5, packageType: "bundle", condition: "new", options: { color: "black", size: "260" } },
    exactTitle: "Couplit Cotton Socks Black Size 260 5 Pack",
    exactIdentity: { productName: "Couplit Cotton Socks", brand: "Couplit", gtins: ["8800000000010"], itemCount: 5, packageType: "bundle", condition: "new", options: { color: "black", size: "260" } },
    probableTitle: "Couplit Cotton Socks",
    rejectedTitle: "Couplit Cotton Socks White Size 240 5 Pack",
    rejectedIdentity: { brand: "Couplit", gtins: ["8800000000010"], itemCount: 5, packageType: "bundle", condition: "new", options: { color: "white", size: "240" } },
    form: { sellingPrice: 27_000, marketReferencePrice: 25_000, purchaseCost: 8_500, taxRate: 1, adRate: 3, reserveRate: 2, targetMargin: 26 },
    shippingScale: 0.6,
  },
];

const referenceRates = { JPY: 9.2, SGD: 1_100, MYR: 320, USD: 1_380 } as const;

function cost(amount: number, fulfillment: number, fixedCost: number, internationalShipping = 0): ChannelMarginCosts {
  return { internationalShipping, localShipping: amount, fulfillmentCost: fulfillment, fixedCost };
}

function productChannelCosts(scale: number): Record<ActiveChannelKey, ChannelMarginCosts> {
  const scaled = (value: number) => Math.round(value * scale / 100) * 100;
  return {
    qoo10: cost(scaled(1_800), scaled(1_200), scaled(900), scaled(8_500)),
    shopee: cost(scaled(2_500), scaled(1_400), scaled(1_300), scaled(12_000)),
    lazada: cost(scaled(2_300), scaled(1_400), scaled(1_500), scaled(11_000)),
    coupang: cost(scaled(3_500), scaled(900), scaled(200)),
    elevenst: cost(scaled(3_200), scaled(800), scaled(200)),
    smartstore: cost(scaled(3_000), scaled(700), scaled(200)),
    ebay: cost(scaled(3_500), scaled(1_500), scaled(2_000), scaled(15_000)),
    temu: cost(scaled(3_500), scaled(1_000), scaled(500)),
  };
}

function calculationProfiles(rateMultiplier = 1) {
  return marginChannelProfiles.map((profile) => ({
    ...profile,
    rateToKrw: profile.currency === "KRW" ? 1 : referenceRates[profile.currency] * rateMultiplier,
  }));
}

function confirmedFees() {
  return { ...createPlatformFeeOverrides(), elevenst: 12, temu: 8 };
}

test("ten representative products separate exact, probable and rejected competitor candidates", () => {
  assert.equal(products.length, 10);
  for (const product of products) {
    const exact = assessCompetitorMatch(product.reference, { title: product.exactTitle, identity: product.exactIdentity });
    const probable = assessCompetitorMatch(product.reference, { title: product.probableTitle });
    const rejected = assessCompetitorMatch(product.reference, { title: product.rejectedTitle, identity: product.rejectedIdentity });
    assert.equal(exact.matchTier, "exact", `${product.name}: exact`);
    assert.equal(probable.matchTier, "probable", `${product.name}: probable`);
    assert.equal(rejected.matchTier, "rejected", `${product.name}: rejected`);
    assert.ok(rejected.mismatchEvidence.length > 0, `${product.name}: rejected reason`);
  }
});

test("ten products calculate all eight channels with channel-specific shipping and local-currency settlement", () => {
  let calculationCount = 0;
  for (const product of products) {
    const costs = productChannelCosts(product.shippingScale);
    const results = calculateChannelMargins(
      product.form,
      confirmedFees(),
      createPaymentFeeOverrides(),
      costs,
      calculationProfiles(),
    );
    assert.deepEqual(results.map((result) => result.key), [...activeChannelKeys], product.name);
    for (const result of results) {
      calculationCount += 1;
      assert.equal(result.calculationReady, true, `${product.name}/${result.key}: ready`);
      assert.ok(result.localSellingPrice !== null, `${product.name}/${result.key}: local sale price`);
      assert.ok(result.effectiveSellingPriceKrw !== null, `${product.name}/${result.key}: KRW settlement`);
      const expectedFixed = product.form.purchaseCost
        + costs[result.key].internationalShipping
        + costs[result.key].localShipping
        + costs[result.key].fulfillmentCost
        + costs[result.key].fixedCost;
      assert.equal(result.fixedCosts, expectedFixed, `${product.name}/${result.key}: shipping and fixed costs`);
      const expectedProfit = (result.effectiveSellingPriceKrw ?? 0)
        - expectedFixed
        - (result.effectiveSellingPriceKrw ?? 0) * ((result.variableRate ?? 0) / 100);
      assert.ok(Math.abs((result.profit ?? 0) - expectedProfit) < 0.01, `${product.name}/${result.key}: profit formula`);

      assert.ok(result.localRecommendedPrice !== null, `${product.name}/${result.key}: local target price`);
      assert.ok(result.effectiveRecommendedPriceKrw !== null, `${product.name}/${result.key}: KRW target price`);
      const targetCheck = calculateMargin({
        ...result.engineInput,
        sellingPrice: result.effectiveRecommendedPriceKrw ?? 0,
      });
      assert.ok((targetCheck.margin ?? Number.NEGATIVE_INFINITY) + 1e-9 >= product.form.targetMargin, `${product.name}/${result.key}: target survives local rounding`);
    }
    assert.ok(costs.ebay.internationalShipping > costs.smartstore.internationalShipping, `${product.name}: overseas shipping differs from domestic`);
  }
  assert.equal(calculationCount, 80);
});

test("foreign channels change their local price when the exchange-rate snapshot changes", () => {
  const product = products[0];
  const costs = productChannelCosts(product.shippingScale);
  const base = calculateChannelMargins(product.form, confirmedFees(), createPaymentFeeOverrides(), costs, calculationProfiles());
  const strongerKrwPerForeignUnit = calculateChannelMargins(product.form, confirmedFees(), createPaymentFeeOverrides(), costs, calculationProfiles(1.1));

  for (const key of ["qoo10", "shopee", "lazada", "ebay"] as const) {
    const before = base.find((result) => result.key === key)!;
    const after = strongerKrwPerForeignUnit.find((result) => result.key === key)!;
    assert.ok((after.localSellingPrice ?? Number.POSITIVE_INFINITY) < (before.localSellingPrice ?? 0), `${key}: local amount responds to FX`);
    assert.ok((after.effectiveSellingPriceKrw ?? 0) >= product.form.sellingPrice, `${key}: upward rounding does not undercut KRW plan`);
    assert.ok((after.effectiveSellingPriceKrw ?? 0) - product.form.sellingPrice < after.localPriceIncrement * (after.rateToKrw ?? 0) + 0.01, `${key}: rounding stays within one tick`);
  }
});

test("missing exchange rates lock only foreign-channel calculations", () => {
  const product = products[0];
  const results = calculateChannelMargins(
    product.form,
    confirmedFees(),
    createPaymentFeeOverrides(),
    productChannelCosts(product.shippingScale),
    marginChannelProfiles,
  );
  const locked = results.filter((result) => !result.calculationReady).map((result) => result.key);
  assert.deepEqual(locked, ["qoo10", "shopee", "lazada", "ebay"]);
  assert.equal(results.filter((result) => result.currency === "KRW").every((result) => result.calculationReady), true);
});

test("adding seller-paid shipping raises the target price instead of being ignored", () => {
  const product = products[6];
  const costs = productChannelCosts(product.shippingScale);
  const baseline = calculateChannelMargins(product.form, confirmedFees(), createPaymentFeeOverrides(), costs, calculationProfiles())
    .find((result) => result.key === "ebay")!;
  const increasedCosts = structuredClone(costs);
  increasedCosts.ebay.internationalShipping += 5_000;
  const increased = calculateChannelMargins(product.form, confirmedFees(), createPaymentFeeOverrides(), increasedCosts, calculationProfiles())
    .find((result) => result.key === "ebay")!;
  assert.equal(increased.fixedCosts - baseline.fixedCosts, 5_000);
  assert.ok((increased.effectiveRecommendedPriceKrw ?? 0) > (baseline.effectiveRecommendedPriceKrw ?? 0));
  assert.ok((increased.profit ?? 0) < (baseline.profit ?? 0));
});
