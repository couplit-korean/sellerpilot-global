import assert from "node:assert/strict";
import test from "node:test";
import { csCapabilityInventory } from "../../lib/cs/capability-inventory";

const keys = (channel: keyof typeof csCapabilityInventory) => new Set(csCapabilityInventory[channel].map(surface => surface.key));

test("eight-channel CS inventory keeps provider surfaces separate", () => {
  for (const key of ["product_qna", "call_center", "claims"]) assert.ok(keys("coupang").has(key));
  for (const key of ["product_qna", "customer_inquiry"]) assert.ok(keys("smartstore").has(key));
  for (const key of ["product_qna", "urgent_inquiry", "urgent_notice"]) assert.ok(keys("elevenst").has(key));
  for (const key of ["qna", "after_sales", "seller_chat"]) assert.ok(keys("qoo10").has(key));
  for (const key of ["product_review", "return_refund", "buyer_chat_history", "buyer_chat_reply"]) assert.ok(keys("shopee").has(key));
  for (const key of ["im", "product_review"]) assert.ok(keys("lazada").has(key));
  for (const key of ["asq", "member_message", "system_message"]) assert.ok(keys("ebay").has(key));
  for (const key of ["after_sales", "buyer_chat"]) assert.ok(keys("temu").has(key));
});

test("Temu after-sales stays read-only and Buyer Chat stays blocked", () => {
  const afterSales = csCapabilityInventory.temu.find(surface => surface.key === "after_sales");
  const buyerChat = csCapabilityInventory.temu.find(surface => surface.key === "buyer_chat");
  assert.deepEqual({ receive: afterSales?.receive, reply: afterSales?.reply, history: afterSales?.history }, { receive: true, reply: false, history: true });
  assert.deepEqual({ state: buyerChat?.state, receive: buyerChat?.receive, reply: buyerChat?.reply }, { state: "permission_pending", receive: false, reply: false });
});

test("system notices are not represented as replyable buyer conversations", () => {
  const elevenstSystem = csCapabilityInventory.elevenst.find(surface => surface.key === "urgent_notice");
  const ebaySystem = csCapabilityInventory.ebay.find(surface => surface.key === "system_message");
  assert.equal(elevenstSystem?.reply, false);
  assert.equal(ebaySystem?.reply, false);
  assert.match(elevenstSystem?.note ?? "", /시스템 발신/u);
  assert.match(ebaySystem?.note ?? "", /고객 대화 건수와 합치지 않음/u);
});
