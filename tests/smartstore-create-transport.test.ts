import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSmartstoreCreateTransport,
  buildSmartstoreCreateTransport,
  smartstoreCreateTransportStageContract,
} from "../lib/channels/smartstore-create-transport";

const jobId = "11111111-1111-4111-8111-111111111111";

function body() {
  return {
    originProduct: {
      name: "전송 바이트 고정",
      salePrice: 10_000,
      stockQuantity: 2,
      detailAttribute: {
        optionInfo: {
          optionCombinations: [{ id: 101, stockQuantity: 2, price: 0 }],
        },
      },
    },
    smartstoreChannelProduct: { channelProductName: "전송 바이트 고정" },
  };
}

test("one serialization binds the staged digest and exact HTTP body bytes", () => {
  const expectedBody = body();
  const transport = buildSmartstoreCreateTransport(expectedBody);
  const verified = assertSmartstoreCreateTransport({
    body: expectedBody,
    transport,
    expectedJobId: jobId,
    stage: {
      contract: smartstoreCreateTransportStageContract,
      jobId,
      bodySha256: transport.bodySha256,
      bodyByteLength: transport.bodyByteLength,
      staged: true,
    },
  });
  assert.equal(verified.bodyText, JSON.stringify(expectedBody));
  assert.equal(Buffer.byteLength(verified.bodyText, "utf8"), transport.bodyByteLength);
});

test("body or durable-stage drift is rejected before provider CREATE", () => {
  const expectedBody = body();
  const transport = buildSmartstoreCreateTransport(expectedBody);
  const changed = body();
  changed.originProduct.salePrice = 990_000;
  assert.throws(() => assertSmartstoreCreateTransport({
    body: changed,
    transport,
  }), /SMARTSTORE_CREATE_TRANSPORT_MISMATCH/u);
  assert.throws(() => assertSmartstoreCreateTransport({
    body: expectedBody,
    transport,
    expectedJobId: jobId,
    stage: {
      contract: smartstoreCreateTransportStageContract,
      jobId,
      bodySha256: "0".repeat(64),
      bodyByteLength: transport.bodyByteLength,
      staged: true,
    },
  }), /SMARTSTORE_CREATE_TRANSPORT_STAGE_MISMATCH/u);
});
