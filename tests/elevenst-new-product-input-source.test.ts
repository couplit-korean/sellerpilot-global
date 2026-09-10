import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  elevenstNewProductInputContract,
  elevenstProviderAvailabilityReceiptContract,
  elevenstSellerIdentityReceiptContract,
  type ElevenstNoticeInput,
} from "../lib/channels/elevenst-new-product-input";
import { elevenstProcessedFoodNotificationFields } from "../lib/channels/elevenst-listing";
import {
  elevenstNewProductInputExecutionReceiptContract,
  elevenstNewProductInputReceiptArgument,
} from "../lib/product-registration/elevenst/new-product-input-execution";
import {
  buildElevenstNewProductArgumentsFromServerSources,
  elevenstNewProductAvailabilitySourceContract,
  elevenstNewProductCredentialSourceContract,
  elevenstNewProductNoticeSourceContract,
  elevenstNewProductPolicySourceContract,
  elevenstNewProductSellerSourceContract,
  elevenstNewProductServerSourceContract,
  elevenstNewProductSourceDigest,
  gateElevenstNewProductCreateBeforeClaim,
  type ElevenstNewProductSourceDependencies,
} from "../lib/product-registration/elevenst/new-product-input-source";

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherOwnerId = "10000000-0000-4000-8000-000000000002";
const productId = "20000000-0000-4000-8000-000000000001";
const otherProductId = "20000000-0000-4000-8000-000000000002";
const credentialId = "30000000-0000-4000-8000-000000000001";
const credentialVersion = 4;
const now = new Date("2026-09-10T03:30:00+09:00");
const productName = "서버 승인 가공식품 테스트";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function serverProduct() {
  return {
    selMthdCd: "01",
    dispCtgrNo: "1346631",
    prdTypCd: "01",
    prdNm: productName,
    brand: "SellerPilot",
    rmaterialTypCd: "04",
    orgnTypCd: "03",
    orgnNmVal: "대한민국",
    sellerPrdCd: "SERVER-FOOD-009",
    suplDtyfrPrdClfCd: "01",
    forAbrdBuyClf: "01",
    prdStatCd: "01",
    minorSelCnYn: "Y",
    ProductCertGroup: [
      { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
      { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
    ],
    selPrdClfCd: "3y:110",
    aplBgnDy: "2026/09/10",
    aplEndDy: "2029/09/09",
    selPrc: "3190",
    prdSelQty: "1",
    dlvCnAreaCd: "01",
    dlvWyCd: "01",
  };
}

function notice(code: string, value: string): ElevenstNoticeInput {
  const sourceSha256 = sha256(`source:${code}`);
  return {
    code,
    required: true,
    value,
    source: {
      kind: "product_label",
      productId,
      revision: 7,
      sourceSha256,
      capturedAt: "2026-09-10T03:20:00+09:00",
    },
    approval: {
      productId,
      categoryId: "1346631",
      fieldCode: code,
      revision: 8,
      sourceSha256,
      valueSha256: sha256(value),
      approvedAt: "2026-09-10T03:21:00+09:00",
    },
  };
}

function serverNotices() {
  return elevenstProcessedFoodNotificationFields
    .filter(({ code }) => code !== "176317774")
    .map(({ code }) => notice(code, `서버 승인값 ${code}`));
}

function policySource() {
  const productImageUrls = Array.from({ length: 4 }, (_, index) => `https://cdn.example.test/product-${index + 1}.jpg`);
  const detailImageUrls = Array.from({ length: 8 }, (_, index) => `https://cdn.example.test/detail-${index + 1}.jpg`);
  const htmlDetail = `<section>${detailImageUrls.map((url) => `<img src="${url}">`).join("")}</section>`;
  return {
    contract: elevenstNewProductPolicySourceContract,
    current: true as const,
    ownerId,
    productId,
    categoryId: "1346631" as const,
    productRevision: 11,
    sourceRevision: 12,
    approvalRevision: 13,
    approvedAt: "2026-09-10T03:22:00+09:00",
    shipping: {
      shippingFeeKrw: 3_000,
      deliveryCostBasisCode: "02" as const,
      paymentTypeCode: "03" as const,
      bundleDeliveryCode: "Y" as const,
      outboundAddressId: "1234",
      returnAddressId: "5678",
    },
    returns: {
      returnFeeKrw: 3_000,
      exchangeFeeKrw: 6_000,
      asDetail: "11번가 판매자 문의 이용",
      returnExchangeDetail: "승인된 반품지로 반송",
    },
    content: {
      htmlDetail,
      htmlDetailSha256: sha256(htmlDetail),
      productImageUrls,
      detailImageUrls,
      imageUrlsSha256: elevenstNewProductSourceDigest({ productImageUrls, detailImageUrls }),
    },
  };
}

type Fixture = {
  product: Record<string, unknown> | null;
  credential: Record<string, unknown> | null;
  notices: Record<string, unknown> | null;
  seller: Record<string, unknown> | null;
  availability: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
};

function fixture(): Fixture {
  const providerProduct = serverProduct();
  return {
    product: {
      contract: elevenstNewProductServerSourceContract,
      current: true,
      ownerId,
      productId,
      categoryId: "1346631",
      revision: 11,
      approvalRevision: 10,
      providerProduct,
      providerProductSha256: elevenstNewProductSourceDigest(providerProduct),
    },
    credential: {
      contract: elevenstNewProductCredentialSourceContract,
      current: true,
      ownerId,
      credentialId,
      credentialVersion,
      channel: "elevenst",
      environment: "production",
      status: "active",
    },
    notices: {
      contract: elevenstNewProductNoticeSourceContract,
      current: true,
      ownerId,
      productId,
      categoryId: "1346631",
      productRevision: 11,
      notices: serverNotices(),
    },
    seller: {
      contract: elevenstNewProductSellerSourceContract,
      current: true,
      ownerId,
      productId,
      credentialId,
      credentialVersion,
      receipt: {
        contract: elevenstSellerIdentityReceiptContract,
        credentialId,
        credentialVersion,
        environment: "production",
        sellerIdSha256: "a".repeat(64),
        sellerOfficeAccountSha256: "a".repeat(64),
        ownershipRevision: 9,
        verifiedAt: "2026-09-10T03:25:00+09:00",
      },
    },
    availability: {
      contract: elevenstNewProductAvailabilitySourceContract,
      current: true,
      ownerId,
      productId,
      credentialId,
      credentialVersion,
      receipt: {
        contract: elevenstProviderAvailabilityReceiptContract,
        state: "available",
        observedAt: "2026-09-10T03:25:00+09:00",
      },
    },
    policy: policySource(),
  };
}

function dependencies(value: Fixture, reads: Array<{ name: string; key: unknown }> = []): ElevenstNewProductSourceDependencies {
  const read = (name: keyof Fixture) => async (key: unknown) => {
    reads.push({ name, key: structuredClone(key) });
    return structuredClone(value[name]);
  };
  return {
    readProductSource: read("product"),
    readCredentialSource: read("credential"),
    readNoticeSource: read("notices"),
    readSellerSource: read("seller"),
    readAvailabilitySource: read("availability"),
    readPolicySource: read("policy"),
  };
}

function input(argumentsValue: Record<string, unknown> = {}) {
  return {
    ownerId,
    productId,
    categoryId: "1346631" as const,
    credentialId,
    credentialVersion,
    environment: "production" as const,
    arguments: argumentsValue,
    now,
  };
}

test("server sources replace browser Product and discard browser receipt/ProductNotification", async () => {
  const reads: Array<{ name: string; key: unknown }> = [];
  const forgedReceipt = { contract: elevenstNewProductInputExecutionReceiptContract, status: "verified", browser: true };
  const result = await buildElevenstNewProductArgumentsFromServerSources(input({
    product: {
      prdNm: "브라우저 상품명",
      sellerPrdCd: "BROWSER-SKU",
      ProductNotification: { type: "891031", item: [{ code: "176317774", name: "브라우저 고시" }] },
    },
    [elevenstNewProductInputReceiptArgument]: forgedReceipt,
  }), dependencies(fixture(), reads));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(reads.length, 6);
  assert.ok(reads.every(({ key }) => JSON.stringify(key) === JSON.stringify({
    ownerId,
    productId,
    categoryId: "1346631",
    credentialId,
    credentialVersion,
    environment: "production",
  })));
  const product = result.arguments.product as Record<string, unknown>;
  assert.equal(product.prdNm, productName);
  assert.equal(product.sellerPrdCd, "SERVER-FOOD-009");
  assert.equal(product.dlvCstInstBasiCd, "02");
  assert.equal(product.dlvCst1, "3000");
  assert.equal(product.prdSelQty, "1");
  assert.equal((product.ProductNotification as { item: unknown[] }).item.length, 11);
  assert.equal(
    (product.ProductNotification as { item: Array<{ name: string }> }).item.some(({ name }) => name.includes("브라우저")),
    false,
  );
  const receipt = result.arguments[elevenstNewProductInputReceiptArgument] as Record<string, unknown>;
  assert.equal(receipt.contract, elevenstNewProductInputExecutionReceiptContract);
  assert.equal(Object.hasOwn(receipt, "browser"), false);
});

test("invalid request metadata stops before source reads or claim", async () => {
  let claimCalls = 0;
  const reads: Array<{ name: string; key: unknown }> = [];
  const outcome = await gateElevenstNewProductCreateBeforeClaim({
    ...input({ product: { ProductNotification: { forged: true } }, [elevenstNewProductInputReceiptArgument]: { forged: true } }),
    ownerId: "wrong-owner",
  }, dependencies(fixture(), reads), async () => {
    claimCalls += 1;
    return { claimed: true };
  });
  assert.equal("ok" in outcome && outcome.ok, false);
  assert.equal(reads.length, 0);
  assert.equal(claimCalls, 0);
  if (!("ok" in outcome) || outcome.ok) return;
  assert.equal(Object.hasOwn(outcome.sanitizedArguments, elevenstNewProductInputReceiptArgument), false);
  assert.equal(Object.hasOwn(outcome.sanitizedArguments.product as object, "ProductNotification"), false);
});

test("missing, stale, cross-product, cross-owner, cross-credential and incomplete sources make claim/provider calls zero", async () => {
  const mutations: Array<(value: Fixture) => void> = [
    (value) => { value.product = null; },
    (value) => { value.product = { ...value.product!, ownerId: otherOwnerId }; },
    (value) => { value.credential = { ...value.credential!, current: false }; },
    (value) => { value.credential = { ...value.credential!, credentialVersion: credentialVersion + 1 }; },
    (value) => { value.notices = { ...value.notices!, productId: otherProductId }; },
    (value) => { value.notices = { ...value.notices!, notices: serverNotices().slice(0, 2) }; },
    (value) => { value.seller = { ...value.seller!, credentialVersion: credentialVersion + 1 }; },
    (value) => { value.availability = { ...value.availability!, credentialId: "30000000-0000-4000-8000-000000000002" }; },
    (value) => { value.policy = { ...value.policy!, productRevision: 10 }; },
    (value) => {
      const policy = structuredClone(value.policy!);
      (policy.content as Record<string, unknown>).detailImageUrls = ["https://cdn.example.test/only-one.jpg"];
      value.policy = policy;
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    let claimCalls = 0;
    let providerCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    };
    try {
      const outcome = await gateElevenstNewProductCreateBeforeClaim(input({}), dependencies(value), async () => {
        claimCalls += 1;
        await fetch("https://provider.example.test");
        return { claimed: true };
      });
      assert.equal("ok" in outcome && outcome.ok, false);
      assert.equal(claimCalls, 0);
      assert.equal(providerCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("source read failure is fail-closed before claim/provider", async () => {
  let claimCalls = 0;
  const sourceDependencies = dependencies(fixture());
  sourceDependencies.readPolicySource = async () => { throw new Error("private DB error"); };
  const outcome = await gateElevenstNewProductCreateBeforeClaim(input({}), sourceDependencies, async () => {
    claimCalls += 1;
    return { claimed: true };
  });
  assert.equal("ok" in outcome && outcome.ok, false);
  assert.equal(claimCalls, 0);
  assert.equal(JSON.stringify(outcome).includes("private DB error"), false);
});

test("02:00-06:00 maintenance receipt never becomes an automatic pass", async () => {
  const value = fixture();
  value.availability = {
    ...value.availability!,
    receipt: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "scheduled_maintenance",
      observedAt: "2026-09-10T03:25:00+09:00",
      maintenance: {
        startsAt: "2026-09-10T02:00:00+09:00",
        endsAt: "2026-09-10T06:00:00+09:00",
      },
    },
  };
  let claimCalls = 0;
  const active = await gateElevenstNewProductCreateBeforeClaim(input({}), dependencies(value), async () => {
    claimCalls += 1;
    return { claimed: true };
  });
  assert.equal("ok" in active && active.ok, false);
  assert.equal(claimCalls, 0);
  assert.match(JSON.stringify(active), /ELEVENST_PROVIDER_MAINTENANCE_WINDOW_ACTIVE/u);

  const after = await buildElevenstNewProductArgumentsFromServerSources({
    ...input({}),
    now: new Date("2026-09-10T06:01:00+09:00"),
  }, dependencies(value));
  assert.equal(after.ok, false);
  assert.match(JSON.stringify(after), /ELEVENST_PROVIDER_AVAILABILITY_FRESH_READ_REQUIRED/u);
});

test("claim callback receives only the rebuilt server arguments and runs once", async () => {
  let claimCalls = 0;
  const outcome = await gateElevenstNewProductCreateBeforeClaim(input({
    product: { prdNm: "browser" },
    [elevenstNewProductInputReceiptArgument]: { forged: true },
  }), dependencies(fixture()), async (argumentsValue) => {
    claimCalls += 1;
    const product = argumentsValue.product as Record<string, unknown>;
    assert.equal(product.prdNm, productName);
    assert.equal((argumentsValue[elevenstNewProductInputReceiptArgument] as Record<string, unknown>).contract, elevenstNewProductInputExecutionReceiptContract);
    return { claimed: true, argumentsValue };
  });
  assert.equal(claimCalls, 1);
  assert.deepEqual("claimed" in outcome ? outcome.claimed : false, true);
});

test("fixture input contract remains the 007 resolver contract", () => {
  assert.equal(elevenstNewProductInputContract, "sellerpilot_elevenst_new_product_input_v1");
});
