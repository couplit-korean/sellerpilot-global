import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  readShopeeBuyerChatPushAddress,
  ShopeeBuyerChatPushError,
  verifyAndNormalizeShopeeBuyerChatPush,
  verifyShopeePushAuthorization,
} from "../lib/channels/cs/shopee/buyer-chat-push";

const callbackUrl = "https://sellerpilot.example/api/webhooks/shopee-buyer-chat";
const partnerKey = "fixture-partner-key-never-production";
const shopId = "947042923";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    msg_id: "",
    data: {
      type: "message",
      region: "ID",
      content: {
        message_id: "2302748948493123953",
        shop_id: 165103149,
        request_id: "35f9478b-7482-46eb-a268-8f828fedb673",
        from_id: 165105353,
        to_id: 947151379,
        from_user_name: "buyer-fixture",
        to_user_name: "seller-fixture",
        message_type: "text",
        content: { text: "  Where is my order?  " },
        conversation_id: "709122092476686867",
        created_timestamp: 1726044721,
        region: "ID",
        is_in_chatbot_session: false,
        source_content: { order_sn: "ORDER_20260909" },
        quoted_msg: { message_id: "" },
        sub_account_id: 0,
        sub_account_name: 0,
        business_type: 0,
        to_shop_id: Number(shopId),
        from_shop_id: 0,
        status: "normal",
      },
    },
    shop_id: Number(shopId),
    code: 10,
    timestamp: 1726044722,
    ...overrides,
  };
}

function signed(rawBody: string, url = callbackUrl) {
  return createHmac("sha256", partnerKey).update(`${url}|${rawBody}`).digest("hex");
}

function verify(rawBody: string, url = callbackUrl) {
  return verifyAndNormalizeShopeeBuyerChatPush({
    callbackUrl: url,
    rawBody,
    partnerKey,
    authorization: signed(rawBody, url),
    expectedShopId: shopId,
    receivedAt: "2026-09-09T22:15:00.000Z",
  });
}

test("official code 10 text push becomes one server-owned canonical buyer page", () => {
  const rawBody = JSON.stringify(payload());
  assert.deepEqual(readShopeeBuyerChatPushAddress(rawBody), { shopId, code: 10 });
  const result = verify(rawBody);
  assert.equal(result.contract, "sellerpilot-shopee-buyer-chat-verified-push/1");
  assert.equal(result.shopId, shopId);
  assert.equal(result.conversationId, "709122092476686867");
  assert.equal(result.messageId, "2302748948493123953");
  assert.equal(result.requestId, "35f9478b-7482-46eb-a268-8f828fedb673");
  assert.equal(result.page.messages[0].senderRole, "buyer");
  assert.equal(result.page.messages[0].body, "Where is my order?");
  assert.equal(result.page.messages[0].orderSn, "ORDER_20260909");
  assert.equal(result.page.messages[0].sentAt, "2024-09-11T08:52:01.000Z");
  assert.equal(result.page.inputCursor, null);
  assert.equal(result.page.nextCursor, null);
});

test("authorization covers the exact callback URL and untouched raw bytes", () => {
  const rawBody = JSON.stringify(payload());
  verifyShopeePushAuthorization({ callbackUrl, rawBody, partnerKey,
    authorization: signed(rawBody) });
  for (const input of [
    { callbackUrl: `${callbackUrl}/`, rawBody, authorization: signed(rawBody) },
    { callbackUrl, rawBody: `${rawBody}\n`, authorization: signed(rawBody) },
    { callbackUrl, rawBody, authorization: "0".repeat(64) },
    { callbackUrl: "http://sellerpilot.example/callback", rawBody,
      authorization: signed(rawBody) },
  ]) {
    assert.throws(() => verifyShopeePushAuthorization({ ...input, partnerKey }), error =>
      error instanceof ShopeeBuyerChatPushError && error.code === "SIGNATURE_INVALID");
  }
});

test("shop, region and supported buyer-seller scope fail closed after valid signature", () => {
  const base = payload();
  const content = (base.data as { content: Record<string, unknown> }).content;
  const invalid = [
    { ...base, shop_id: 947042924 },
    { ...base, data: { ...base.data, region: "VN" } },
    { ...base, data: { ...base.data, content: { ...content, to_shop_id: 947042924 } } },
    { ...base, data: { ...base.data, content: {
      ...content, to_shop_id: undefined, from_shop_id: undefined,
    } } },
    { ...base, data: { ...base.data, content: {
      ...content, to_shop_id: undefined, from_shop_id: Number(shopId),
    } } },
  ];
  for (const value of invalid) {
    const rawBody = JSON.stringify(value);
    assert.throws(() => verify(rawBody), error => error instanceof ShopeeBuyerChatPushError
      && error.code === "SCOPE_MISMATCH");
  }
  const affiliate = JSON.stringify({ ...base,
    data: { ...base.data, content: { ...content, business_type: 11 } } });
  assert.throws(() => verify(affiliate), error => error instanceof ShopeeBuyerChatPushError
    && error.code === "MESSAGE_UNSUPPORTED");
  const seller = JSON.stringify({ ...base, data: { ...base.data, content: {
    ...content, to_shop_id: 0, from_shop_id: Number(shopId),
  } } });
  assert.equal(verify(seller).page.messages[0].senderRole, "seller");
});

test("official image, video and item fields become lossless canonical media", () => {
  const base = payload();
  const content = (base.data as { content: Record<string, unknown> }).content;
  const cases = [{
    type: "image",
    value: { url: "https://cf.shopee.vn/file/09591ecdc9f1dc7bd507817797d826fe_dynamic",
      thumb_url: "b9591ecdc9f1dc7bd507817797d826fe_dynamic_tn",
      thumb_height: 711, thumb_width: 400, file_server_id: 0 },
    source: {}, body: "Shopee 이미지 첨부",
  }, {
    type: "video",
    value: { video_url: "cf03c9e1fe2c0992cdb51c3cb6eab2bd",
      thumb_url: "6c710d7679c9f3a9a7287250421d17d3_dynamic_tn",
      thumb_width: 399, thumb_height: 713, duration_seconds: 15 },
    source: {}, body: "Shopee 동영상 첨부",
  }, {
    type: "item",
    value: { shop_id: 109157255, item_id: 9112503530 },
    source: { item_id: 4112503530 }, body: "Shopee 상품 정보",
  }] as const;
  for (const testCase of cases) {
    const rawBody = JSON.stringify({ ...base, data: { ...base.data, content: {
      ...content, message_type: testCase.type, content: testCase.value,
      source_content: testCase.source,
    } } });
    const result = verify(rawBody);
    assert.equal(result.media?.type, testCase.type);
    assert.equal(result.page.messages[0].body, testCase.body);
    assert.equal(result.page.messages[0].attachmentCount, 1);
    assert.match(result.media?.descriptorDigest ?? "", /^[a-f0-9]{64}$/u);
  }
  const itemRaw = JSON.stringify({ ...base, data: { ...base.data, content: {
    ...content, message_type: "item", content: cases[2].value,
    source_content: cases[2].source,
  } } });
  const item = verify(itemRaw);
  assert.equal(item.page.messages[0].itemId, "9112503530");
  assert.equal(item.media?.type === "item" ? item.media.sourceItemId : null, "4112503530");
});

test("notification, malicious media URL and malformed payloads are not acknowledged", () => {
  const notification = JSON.stringify({
    data: { type: "notification", region: "PH", content: {
      user_id: 12252079, conversation_id: "4670954831706433",
      type: "mark_as_replied", timestamp: 1719883961, msg_id: 0, biz_id: 0,
    } },
    shop_id: Number(shopId), code: 10, timestamp: 1719883961,
  });
  assert.throws(() => verify(notification), error => error instanceof ShopeeBuyerChatPushError
    && error.code === "MESSAGE_UNSUPPORTED");
  const base = payload();
  const content = (base.data as { content: Record<string, unknown> }).content;
  const invalidMedia = [{ message_type: "image", content: {
    url: "https://attacker.invalid/file/payload", thumb_url: "safe_thumb",
    thumb_height: 100, thumb_width: 100, file_server_id: 0,
  } }, { message_type: "video", content: {
    video_url: "javascript:alert(1)", thumb_url: "safe_thumb",
    thumb_height: 100, thumb_width: 100, duration_seconds: 1,
  } }, { message_type: "item", content: { shop_id: 109157255, item_id: 9112503530 },
    source_content: {} }];
  for (const media of invalidMedia) {
    const rawBody = JSON.stringify({ ...base, data: { ...base.data, content: {
      ...content, ...media,
    } } });
    assert.throws(() => verify(rawBody), error => error instanceof ShopeeBuyerChatPushError
      && error.code === "REQUEST_INVALID");
  }
  assert.throws(() => readShopeeBuyerChatPushAddress("not-json"), error =>
    error instanceof ShopeeBuyerChatPushError && error.code === "REQUEST_INVALID");
  assert.throws(() => readShopeeBuyerChatPushAddress(" ".repeat(65_537)), error =>
    error instanceof ShopeeBuyerChatPushError && error.code === "REQUEST_INVALID");
});
