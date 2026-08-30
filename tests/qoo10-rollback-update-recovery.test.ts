import assert from "node:assert/strict";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";

const remoteId = "1234567890";
const fingerprint = "a".repeat(64);
const categoryCode = "320002604";
const retailPriceJpy = 1871;
const sellPriceJpy = 1600;
const quantity = 1;
const shippingNo = "0";
const biContentsNo = 8461402963;
const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/detail-${index + 1}.jpg`,
);
const detailHtml = `<section lang="ja-JP"><p>日本語の商品詳細です。</p>${detailImageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const expectedState = {
  categoryCode,
  retailPriceJpy,
  sellPriceJpy,
  quantity,
  shippingNo,
  biContentsNo,
} as const;
const recoveryBinding = {
  status: "allowed",
  contract: qoo10RollbackUpdateRecoveryContract,
  listingId: "11111111-1111-4111-8111-111111111111",
  remoteId,
  providerStatus: "S1",
  sourceJobId: "22222222-2222-4222-8222-222222222222",
  expectedState,
} as const;

function operationArguments(marker: unknown = recoveryBinding) {
  return {
    [qoo10RollbackUpdateRecoveryArgument]: marker,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: remoteId,
      SecondSubCat: categoryCode,
      ItemTitle: "日本語の商品名",
      RetailPrice: String(retailPriceJpy),
      ShippingNo: shippingNo,
      AvailableDateType: "0",
      AvailableDateValue: "3",
      ItemDescription: detailHtml,
    },
  };
}

function qoo10BiImage(contentId = biContentsNo) {
  const value = String(contentId);
  return `https://gd.image-qoo10.jp/li/${value.slice(-3)}/${value.slice(-6, -3)}/${value}.g.jpg`;
}

function readback(status: "S1" | "S2", overrides: Record<string, unknown> = {}) {
  return {
    ItemNo: remoteId,
    ItemStatus: status,
    SecondSubCatCd: categoryCode,
    RetailPrice: String(retailPriceJpy),
    SellPrice: String(sellPriceJpy),
    ItemQty: String(quantity),
    ShippingNo: shippingNo,
    ItemTitle: "日本語の商品名",
    ItemDetail: detailHtml,
    ImageUrl: qoo10BiImage(),
    ...overrides,
  };
}

function nestedTitleDecoyReadback(status: "S1" | "S2") {
  const { ItemTitle, ...exactItemWithoutDirectTitle } = readback(status);
  return {
    ...exactItemWithoutDirectTitle,
    nestedDecoy: { ItemTitle },
  };
}

function qooMethod(input: RequestInfo | URL) {
  return decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
}

function operation() {
  return executeChannelOperation({
    channel: "qoo10",
    operation: "listing.update",
    payload: { api_key: "test-key" },
    arguments: operationArguments(),
    environment: "production",
  });
}

async function withoutOperationDelays<T>(run: () => Promise<T>) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("rollback-confirmed Qoo10 update accepts exact GdNo and strictly verifies official S1/S2 fields", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, string> }> = [];
  let readbackCount = 0;
  globalThis.fetch = async (input, init) => {
    const method = qooMethod(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    calls.push({ method, body });
    if (method === "ItemsBasic.UpdateGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: remoteId } });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      return Response.json({
        ResultCode: 0,
        ResultObject: readback(readbackCount === 1 ? "S1" : "S2"),
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };

  try {
    const result = await operation();
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, remoteId);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteState?.providerStatus, "S2");
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.version, "qoo10_get_item_detail_rollback_recovery_v1");
    assert.equal(result.remoteState?.resources.qoo10MainImageContentId, String(biContentsNo));
    assert.deepEqual(result.steps.map((step) => step.name), [
      "UpdateGoods",
      "EditGoodsContents",
      "qoo10-rollback-pre-activation-readback",
      "qoo10-rollback-recovery-activate",
      "qoo10-rollback-post-activation-readback",
    ]);
    assert.deepEqual(calls.map((call) => call.method), [
      "ItemsBasic.UpdateGoods",
      "ItemsContents.EditGoodsContents",
      "ItemsLookup.GetItemDetailInfo",
      "ItemsBasic.EditGoodsStatus",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(calls[0]?.body.ItemCode, remoteId);
    assert.equal(Object.hasOwn(calls[0]?.body ?? {}, "StandardImage"), false);
    assert.equal(calls[3]?.body.ItemCode, remoteId);
    assert.equal(calls[3]?.body.Status, "2");
    const checks = result.steps.at(-1)?.data.sellerpilotPublicationChecks as Record<string, boolean>;
    for (const field of [
      "categoryVerified",
      "retailPriceVerified",
      "sellPriceVerified",
      "quantityVerified",
      "shippingVerified",
      "confirmedBiCdnImageVerified",
      "detailImageUrlsVerified",
    ]) assert.equal(checks[field], true, field);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery keeps expected remote ID when UpdateGoods response omits identity aliases", async () => {
  const originalFetch = globalThis.fetch;
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      return Response.json({ ResultCode: 0, ResultObject: readback(readbackCount === 1 ? "S1" : "S2") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, remoteId);
    assert.equal(result.remoteState?.providerStatus, "S2");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery accepts each exact object response identity alias", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const alias of ["GdNo", "ItemCode", "itemCode"] as const) {
      let readbackCount = 0;
      globalThis.fetch = async (input) => {
        const method = qooMethod(input);
        if (method === "ItemsBasic.UpdateGoods") {
          return Response.json({ ResultCode: 0, ResultObject: { [alias]: remoteId } });
        }
        if (method === "ItemsLookup.GetItemDetailInfo") {
          readbackCount += 1;
          return Response.json({ ResultCode: 0, ResultObject: readback(readbackCount === 1 ? "S1" : "S2") });
        }
        return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
      };
      const result = await operation();
      assert.equal(result.ok, true, alias);
      assert.equal(result.remoteId, remoteId, alias);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery stops on every mismatched or contradictory UpdateGoods identity alias", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { GdNo: "9999999999" },
    { ItemCode: "9999999999" },
    { itemCode: "9999999999" },
    { GdNo: remoteId, ItemCode: "9999999999", itemCode: remoteId },
  ];
  try {
    for (const resultObject of cases) {
      const methods: string[] = [];
      globalThis.fetch = async (input) => {
        methods.push(qooMethod(input));
        return Response.json({ ResultCode: 0, ResultObject: resultObject });
      };
      const result = await operation();
      assert.equal(result.ok, false);
      assert.equal(result.remoteId, remoteId);
      assert.deepEqual(methods, ["ItemsBasic.UpdateGoods"]);
      assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-update-response-identity-mismatch");
      assert.equal(result.steps.at(-1)?.data.sellerpilotExpectedRemoteId, remoteId);
      assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
      assert.equal(
        gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
        "reconciliation_required",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("plain scalar UpdateGoods ResultObject is not treated as an official response identity", async () => {
  const originalFetch = globalThis.fetch;
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    if (method === "ItemsBasic.UpdateGoods") return Response.json({ ResultCode: 0, ResultObject: "9999999999" });
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      return Response.json({ ResultCode: 0, ResultObject: readback(readbackCount === 1 ? "S1" : "S2") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, remoteId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit HTTP 2xx UpdateGoods rejection performs only a strict S1 readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsBasic.UpdateGoods") {
      return Response.json({ ResultCode: -99, ResultMsg: "UPDATE_REJECTED" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    }
    return Response.json({ ResultCode: -9999, ResultMsg: "UNEXPECTED_TEST_CALL" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.equal(result.remoteId, remoteId);
    assert.deepEqual(methods, ["ItemsBasic.UpdateGoods", "ItemsLookup.GetItemDetailInfo"]);
    const rejectionReadback = result.steps.at(-1);
    assert.equal(rejectionReadback?.name, "qoo10-rollback-update-rejection-s1-readback");
    assert.equal(rejectionReadback?.ok, true);
    assert.equal(rejectionReadback?.data.providerStatus, "S1");
    assert.equal(
      rejectionReadback?.data.sellerpilotVerification,
      "QOO10_ROLLBACK_UPDATE_REJECTION_S1_VERIFIED",
    );
    const checks = rejectionReadback?.data.sellerpilotPublicationChecks as Record<string, boolean>;
    assert.equal(Object.values(checks).every(Boolean), true);
    assert.equal(methods.includes("ItemsContents.EditGoodsContents"), false);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit UpdateGoods rejection requires reconciliation when strict S1 cannot be reconfirmed", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsBasic.UpdateGoods") {
      return Response.json({ ResultCode: -99, ResultMsg: "UPDATE_REJECTED" });
    }
    return Response.json({
      ResultCode: 0,
      ResultObject: readback("S1", { RetailPrice: String(retailPriceJpy + 1) }),
    });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 4);
    assert.equal(methods.includes("ItemsContents.EditGoodsContents"), false);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-update-rejection-s1-readback");
    assert.equal(result.steps.at(-1)?.ok, false);
    assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery never activates when EditGoodsContents fails", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsContents.EditGoodsContents") {
      return Response.json({ ResultCode: -99, ResultMsg: "DETAIL_REJECTED" });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.deepEqual(methods, ["ItemsBasic.UpdateGoods", "ItemsContents.EditGoodsContents"]);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery activation rejection remains reconciliation-required without post-activation readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    }
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: -99, ResultMsg: "ACTIVATION_REJECTED" });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.deepEqual(methods, [
      "ItemsBasic.UpdateGoods",
      "ItemsContents.EditGoodsContents",
      "ItemsLookup.GetItemDetailInfo",
      "ItemsBasic.EditGoodsStatus",
    ]);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-recovery-activate");
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 recovery does not report success until post-activation readback reaches S2", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(result.remoteState, undefined);
    assert.equal(methods.filter((method) => method === "ItemsBasic.EditGoodsStatus").length, 1);
    assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 5);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-post-activation-readback");
    assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const strictFieldMutations = [
  ["category", "categoryVerified", { SecondSubCatCd: "999999999" }],
  ["retail", "retailPriceVerified", { RetailPrice: String(retailPriceJpy + 1) }],
  ["sell", "sellPriceVerified", { SellPrice: String(sellPriceJpy + 1) }],
  ["quantity", "quantityVerified", { ItemQty: String(quantity + 1) }],
  ["shipping", "shippingVerified", { ShippingNo: "42" }],
  ["BI CDN", "confirmedBiCdnImageVerified", { ImageUrl: qoo10BiImage(biContentsNo + 1) }],
  [
    "detail URLs",
    "detailImageUrlsVerified",
    { ItemDetail: detailHtml.replace(detailImageUrls[7], "https://cdn.example.test/drifted.jpg") },
  ],
] as const;

test("every strict commerce/image field blocks activation when S1 is mutated", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withoutOperationDelays(async () => {
      for (const [name, checkName, mutation] of strictFieldMutations) {
        const methods: string[] = [];
        globalThis.fetch = async (input) => {
          const method = qooMethod(input);
          methods.push(method);
          if (method === "ItemsLookup.GetItemDetailInfo") {
            return Response.json({ ResultCode: 0, ResultObject: readback("S1", mutation) });
          }
          return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
        };
        const result = await operation();
        assert.equal(result.ok, false, name);
        assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 4, name);
        assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false, name);
        assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-pre-activation-readback", name);
        const checks = result.steps.at(-1)?.data.sellerpilotPublicationChecks as Record<string, boolean>;
        assert.equal(checks[checkName], false, name);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("every strict commerce/image field prevents completion when S2 is mutated", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withoutOperationDelays(async () => {
      for (const [name, checkName, mutation] of strictFieldMutations) {
        const methods: string[] = [];
        let readbackCount = 0;
        globalThis.fetch = async (input) => {
          const method = qooMethod(input);
          methods.push(method);
          if (method === "ItemsLookup.GetItemDetailInfo") {
            readbackCount += 1;
            return Response.json({
              ResultCode: 0,
              ResultObject: readback(readbackCount === 1 ? "S1" : "S2", readbackCount === 1 ? {} : mutation),
            });
          }
          return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
        };
        const result = await operation();
        assert.equal(result.ok, false, name);
        assert.equal(methods.filter((method) => method === "ItemsBasic.EditGoodsStatus").length, 1, name);
        assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 5, name);
        assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-post-activation-readback", name);
        const checks = result.steps.at(-1)?.data.sellerpilotPublicationChecks as Record<string, boolean>;
        assert.equal(checks[checkName], false, name);
        assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true, name);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mixed-record readback cannot borrow mutable fields from an unrelated item", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({
        ResultCode: 0,
        ResultObject: [
          { ...readback("S1"), ItemNo: "9999999999", ItemTitle: "日本語の商品名" },
          { ...readback("S1"), ItemTitle: "別の商品名", RetailPrice: String(retailPriceJpy + 1) },
        ],
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-pre-activation-readback");
    assert.deepEqual(result.steps.at(-1)?.data.sellerpilotMismatchPaths, ["ItemTitle"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mixed-record post-activation readback is reconciliation-required", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      if (readbackCount === 1) return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
      return Response.json({
        ResultCode: 0,
        ResultObject: [
          { ...readback("S2"), ItemNo: "9999999999", ItemTitle: "日本語の商品名" },
          { ...readback("S2"), ItemTitle: "別の商品名", RetailPrice: String(retailPriceJpy + 1) },
        ],
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(methods.filter((method) => method === "ItemsBasic.EditGoodsStatus").length, 1);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-post-activation-readback");
    assert.deepEqual(result.steps.at(-1)?.data.sellerpilotMismatchPaths, ["ItemTitle"]);
    assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("S1 recovery readback cannot borrow a title from an identity-less nested decoy", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: nestedTitleDecoyReadback("S1") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 4);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-pre-activation-readback");
    assert.deepEqual(result.steps.at(-1)?.data.sellerpilotMismatchPaths, ["ItemTitle"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("S2 recovery readback with an identity-less nested title decoy remains reconciliation-required", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      return Response.json({
        ResultCode: 0,
        ResultObject: readbackCount === 1 ? readback("S1") : nestedTitleDecoyReadback("S2"),
      });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(operation);
    assert.equal(result.ok, false);
    assert.equal(methods.filter((method) => method === "ItemsBasic.EditGoodsStatus").length, 1);
    assert.equal(methods.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length, 5);
    assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-post-activation-readback");
    assert.deepEqual(result.steps.at(-1)?.data.sellerpilotMismatchPaths, ["ItemTitle"]);
    assert.equal(result.steps.at(-1)?.data.sellerpilotReconciliationRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zero or two exact Qoo10 readback records fail the recovery mutable projection closed", async () => {
  const originalFetch = globalThis.fetch;
  const resultObjects = [
    [{ ...readback("S1"), ItemNo: "9999999999" }],
    [readback("S1"), readback("S1")],
  ];
  try {
    await withoutOperationDelays(async () => {
      for (const resultObject of resultObjects) {
        const methods: string[] = [];
        globalThis.fetch = async (input) => {
          const method = qooMethod(input);
          methods.push(method);
          if (method === "ItemsLookup.GetItemDetailInfo") {
            return Response.json({ ResultCode: 0, ResultObject: resultObject });
          }
          return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
        };
        const result = await operation();
        assert.equal(result.ok, false);
        assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
        assert.equal(result.steps.at(-1)?.name, "qoo10-rollback-pre-activation-readback");
        const mismatches = result.steps.at(-1)?.data.sellerpilotMismatchPaths as string[];
        assert.equal(mismatches.includes("ItemTitle"), true);
        assert.equal(mismatches.includes("ItemDescription"), true);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed client recovery marker is rejected before every Qoo10 provider request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "test-key" },
      arguments: operationArguments({ ...recoveryBinding, forged: true }),
      environment: "production",
    });
    assert.equal(fetchCount, 0);
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.name, "qoo10-rollback-recovery-prewrite-fence");
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "QOO10_PREWRITE_REJECTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
