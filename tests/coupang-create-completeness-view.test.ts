import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  coupangCreateCompletenessKeys,
  coupangCreateReadinessRequestIdentity,
  coupangCreateReadinessResponseIsCurrent,
  emptyCoupangCreateCompletenessValidation,
  mapCoupangCreateCompletenessView,
  type CoupangCreateCompletenessStatus,
  type CoupangCreateExpectedTuple,
} from "../lib/product-registration/coupang/create-completeness-view";

const expectedTuple: CoupangCreateExpectedTuple = {
  productId: "10000000-0000-4000-8000-000000000001",
  credentialId: "20000000-0000-4000-8000-000000000001",
  credentialVersion: 7,
  categoryId: "59631",
  sourceFingerprint: "source-revision-one",
};

const koreanLabels = [
  "신규 등록 계보",
  "카테고리",
  "상품명",
  "브랜드",
  "옵션",
  "판매자 SKU",
  "판매가",
  "재고",
  "판매 구성",
  "카테고리 속성",
  "상품정보제공고시",
  "인증정보",
  "출고지",
  "반품지",
  "택배사",
  "배송 및 반품 비용",
  "대표 이미지",
  "승인 상세 이미지",
  "활성 인증 revision",
];

const selectedSources = [
  "publish_context.product",
  "publish_context.confirmed_assignment",
  "seller_confirmed.body",
  "seller_confirmed.body",
  "seller_confirmed.option_rows",
  "seller_confirmed.option_rows",
  "seller_confirmed.body",
  "seller_confirmed.body",
  "seller_confirmed.body",
  "provider.category_metadata",
  "provider.category_metadata",
  "provider.category_metadata",
  "provider.outbound_shipping_places",
  "provider.return_centers",
  "provider.return_centers",
  "provider.return_centers",
  "seller_confirmed.body",
  "approved_detail_manifest",
  "server.active_credential_revision",
];

function payload(options: {
  statuses?: Partial<Record<typeof coupangCreateCompletenessKeys[number], CoupangCreateCompletenessStatus>>;
  autoFillPatches?: unknown;
  tuple?: Partial<CoupangCreateExpectedTuple>;
} = {}) {
  const fields = coupangCreateCompletenessKeys.map((key, index) => ({
    key,
    label: koreanLabels[index],
    status: options.statuses?.[key] ?? "resolved",
    fieldPaths: [`body.fixture.${index}`],
    allowedSources: [selectedSources[index]],
    selectedSource: options.statuses?.[key] && options.statuses[key] !== "resolved"
      ? null
      : selectedSources[index],
    message: options.statuses?.[key] && options.statuses[key] !== "resolved"
      ? "현재 값을 확인하거나 직접 입력해 주세요."
      : "현재 값이 확인됐습니다.",
  }));
  const blockingFieldKeys = fields
    .filter((field) => field.status !== "resolved")
    .map((field) => field.key);
  return {
    completeness: {
      contract: "sellerpilot_coupang_create_completeness_v1",
      channel: "coupang",
      operation: "listing.create",
      fields,
      blockingFieldKeys,
      canBindCreateSourceRevision: blockingFieldKeys.length === 0,
    },
    ...(options.autoFillPatches === undefined
      ? {}
      : { autoFillPatches: options.autoFillPatches }),
    observedTuple: {
      ...expectedTuple,
      ...options.tuple,
      draftFingerprint: "server-draft-one",
      requestSha256: "a".repeat(64),
      observedAt: "2026-09-10T03:00:00.000Z",
    },
  };
}

test("maps all 19 server rows into explicit Korean status, path, and source labels", () => {
  const view = mapCoupangCreateCompletenessView(payload({
    statuses: {
      title: "manual_required",
      category: "provider_read_required",
      fees: "blocked",
    },
  }), expectedTuple);
  assert.ok(view);
  assert.equal(view.rows.length, 19);
  assert.deepEqual(view.rows.map((row) => row.key), coupangCreateCompletenessKeys);
  assert.deepEqual(
    view.rows.filter((row) => row.status !== "resolved").map((row) => row.key),
    ["category", "title", "fees"],
  );
  assert.equal(view.rows.find((row) => row.key === "category")?.statusLabel,
    "쿠팡 공식 조회 필요");
  assert.equal(view.rows.find((row) => row.key === "title")?.statusLabel,
    "직접 입력 필요");
  assert.equal(view.rows.find((row) => row.key === "fees")?.statusLabel,
    "등록 차단");
  assert.equal(view.rows.find((row) => row.key === "return_center")?.selectedSourceLabel,
    "쿠팡 반품지");
  assert.equal(view.rows[0].fieldPathLabel, "body.fixture.0");
  assert.match(view.rows[0].label, /[가-힣]/u);
  assert.match(view.rows[0].message, /[가-힣]/u);
  assert.deepEqual(view.validation.blockingFieldKeys, ["category", "title", "fees"]);
  assert.equal(view.validation.canBindCreateSourceRevision, false);
  assert.deepEqual(view.validation.observedTuple, {
    ...expectedTuple,
    draftFingerprint: "server-draft-one",
    requestSha256: "a".repeat(64),
    observedAt: "2026-09-10T03:00:00.000Z",
  });
});

test("forwards only server-provided auto-fill patches and invents no defaults", () => {
  const withoutPatches = mapCoupangCreateCompletenessView(payload(), expectedTuple);
  assert.ok(withoutPatches);
  assert.deepEqual(withoutPatches.autoFillPatches, []);

  const patches = [
    { path: ["body", "outboundShippingPlaceCode"], value: 12345 },
    { path: ["body", "returnCenterCode"], value: "RETURN-1" },
  ];
  const withPatches = mapCoupangCreateCompletenessView(payload({
    autoFillPatches: patches,
  }), expectedTuple);
  assert.ok(withPatches);
  assert.deepEqual(withPatches.autoFillPatches, patches);
  assert.notStrictEqual(withPatches.autoFillPatches, patches);

  assert.equal(mapCoupangCreateCompletenessView(payload({
    autoFillPatches: [{ path: ["body", "credential"], value: { accessToken: "forbidden" } }],
  }), expectedTuple), null);
  assert.equal(mapCoupangCreateCompletenessView(payload({
    autoFillPatches: [{ path: ["body", "__proto__"], value: "forbidden" }],
  }), expectedTuple), null);
});

test("invalidates a prior response for every product input tuple change", () => {
  for (const [key, value] of [
    ["productId", "different-product"],
    ["credentialId", "different-credential"],
    ["credentialVersion", 8],
    ["categoryId", "77777"],
    ["sourceFingerprint", "different-source"],
  ] as const) {
    assert.equal(mapCoupangCreateCompletenessView(
      payload({ tuple: { [key]: value } }),
      expectedTuple,
    ), null, key);
  }

  const original = coupangCreateReadinessRequestIdentity({
    tuple: expectedTuple,
    draft: { body: { sellerProductName: "상품", items: [{ stock: 3 }] } },
  });
  const reordered = coupangCreateReadinessRequestIdentity({
    tuple: expectedTuple,
    draft: { body: { items: [{ stock: 3 }], sellerProductName: "상품" } },
  });
  assert.equal(reordered, original, "object key order must not invalidate a snapshot");
  assert.notEqual(coupangCreateReadinessRequestIdentity({
    tuple: expectedTuple,
    draft: { body: { sellerProductName: "상품", items: [{ stock: 4 }] } },
  }), original, "a draft value change must invalidate a snapshot");
});

test("a response from the prior render generation cannot apply auto-fill", () => {
  const oldIdentity = "old-render";
  const currentIdentity = "new-render";
  assert.equal(coupangCreateReadinessResponseIsCurrent({
    latestIdentity: currentIdentity,
    requestIdentity: oldIdentity,
    aborted: false,
  }), false);
  assert.equal(coupangCreateReadinessResponseIsCurrent({
    latestIdentity: currentIdentity,
    requestIdentity: currentIdentity,
    aborted: false,
  }), true);
  assert.equal(coupangCreateReadinessResponseIsCurrent({
    latestIdentity: currentIdentity,
    requestIdentity: currentIdentity,
    aborted: true,
  }), false);
});

test("rejects incomplete, reordered, inconsistent, or non-Korean completeness DTOs", () => {
  const incomplete = payload();
  incomplete.completeness.fields.pop();
  assert.equal(mapCoupangCreateCompletenessView(incomplete, expectedTuple), null);

  const reordered = payload();
  [reordered.completeness.fields[0], reordered.completeness.fields[1]] =
    [reordered.completeness.fields[1], reordered.completeness.fields[0]];
  assert.equal(mapCoupangCreateCompletenessView(reordered, expectedTuple), null);

  const inconsistent = payload({ statuses: { title: "manual_required" } });
  inconsistent.completeness.canBindCreateSourceRevision = true;
  assert.equal(mapCoupangCreateCompletenessView(inconsistent, expectedTuple), null);

  const untranslated = payload();
  untranslated.completeness.fields[0].label = "Create lineage";
  assert.equal(mapCoupangCreateCompletenessView(untranslated, expectedTuple), null);
});

test("initial validation blocks revision binding before a current server snapshot", () => {
  assert.deepEqual(emptyCoupangCreateCompletenessValidation(), {
    canBindCreateSourceRevision: false,
    blockingFieldKeys: [...coupangCreateCompletenessKeys],
    observedTuple: null,
  });
});

test("client component performs an explicit POST, applies exact patches, and stores only mapped view", async () => {
  const source = await readFile(new URL(
    "../app/_publishing/coupang/create-completeness-fields.tsx",
    import.meta.url,
  ), "utf8");
  assert.match(source, /fetch\("\/api\/admin\/coupang-create-readiness",\s*\{[\s\S]*method: "POST"/u);
  assert.match(source, /for \(const patch of view\.autoFillPatches\) onChange\(patch\.path, patch\.value\)/u);
  assert.match(source, /requestState\.identity === requestIdentity/u);
  assert.match(source, /latestIdentity\.current = requestIdentity/u);
  assert.ok(source.indexOf("latestIdentity.current = requestIdentity")
    < source.indexOf("useEffect(() =>"));
  assert.match(source, /coupangCreateReadinessResponseIsCurrent/u);
  assert.match(source, /setRequestState\(\{ state: "ready", identity: identityAtRequest, view \}\)/u);
  assert.doesNotMatch(source, /setRequestState\([^\n]*(?:payload|accessToken)/u);
});
