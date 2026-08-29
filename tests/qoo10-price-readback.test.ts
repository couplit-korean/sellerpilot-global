import assert from "node:assert/strict";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import { executeChannelOperation } from "../lib/channels/operations";

const input = {
  channel: "qoo10" as const,
  operation: "price.update" as const,
  payload: { api_key: "qoo10-test-key" },
  arguments: {
    currency: "JPY",
    params: { ItemCode: "1234567890", ItemPrice: "4980", ItemQty: "9999" },
  },
  environment: "production" as const,
};

function qoo10Result(resultObject: Record<string, unknown>) {
  return Response.json({ ResultCode: 0, ResultMsg: "OK", ResultObject: resultObject });
}

test("Qoo10 price update preserves readback quantity and uses current Price/Qty parameter names", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    const method = url.searchParams.get("method") ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ method, body });
    if (method === "ItemsOrder.SetGoodsPriceQty") {
      return Response.json({ ResultCode: 0, ResultMsg: "OK" });
    }
    const afterWrite = calls.some((call) => call.method === "ItemsOrder.SetGoodsPriceQty");
    return qoo10Result({
      ItemCode: "1234567890",
      ItemPrice: afterWrite ? "4980" : "4200",
      ItemQty: "17",
      CurrencyCode: "JPY",
    });
  };
  try {
    const result = await executeChannelOperation(input);
    assert.equal(result.ok, true);
    assert.equal(result.remoteId, "1234567890");
    assert.deepEqual(calls.map((call) => call.method), [
      "ItemsLookup.GetItemDetailInfo",
      "ItemsOrder.SetGoodsPriceQty",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.deepEqual(calls[1].body, {
      returnType: "json",
      ItemCode: "1234567890",
      Price: "4980",
      Qty: "17",
    });
    assert.equal("ItemPrice" in calls[1].body, false);
    assert.equal("ItemQty" in calls[1].body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 price update does not write when the pre-read ItemCode differs", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return qoo10Result({ ItemCode: "9999999999", ItemPrice: "4200", ItemQty: "17" });
  };
  try {
    const result = await executeChannelOperation(input);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "QOO10_PRICE_PREWRITE_SNAPSHOT_MISMATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 price update does not write when the current readback omits currency", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return qoo10Result({ ItemCode: "1234567890", ItemPrice: "4200", ItemQty: "17" });
  };
  try {
    const result = await executeChannelOperation(input);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(result.steps[0]?.data.actualCurrency, null);
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "QOO10_PRICE_PREWRITE_SNAPSHOT_MISMATCH");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 price update fails closed after a write when price or explicit currency readback is missing", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request) => {
    calls += 1;
    const method = new URL(String(request)).searchParams.get("method");
    if (method === "ItemsOrder.SetGoodsPriceQty") {
      return Response.json({ ResultCode: 0, ResultMsg: "OK" });
    }
    return qoo10Result({
      ItemCode: "1234567890",
      ItemPrice: calls === 1 ? "4200" : "4979",
      ItemQty: "17",
      ...(calls === 1 ? { CurrencyCode: "JPY" } : {}),
      // GetItemDetailInfo's current published output omits currency entirely.
    });
  };
  try {
    const result = await executeChannelOperation(input);
    assert.equal(result.ok, false);
    assert.equal(calls, 3);
    assert.deepEqual(result.steps[2]?.data.sellerpilotMismatchFields, ["ItemPrice", "Currency"]);
    assert.equal(result.steps[2]?.data.sellerpilotReconciliationRequired, true);
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 price update rejects a non-JPY request before a provider call", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ ResultCode: 0 });
  };
  try {
    await assert.rejects(
      executeChannelOperation({
        ...input,
        arguments: { ...input.arguments, currency: "KRW" },
      }),
      /CHANNEL_ARGUMENT_INVALID:currency/,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
