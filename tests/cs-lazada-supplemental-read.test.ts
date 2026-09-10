import assert from "node:assert/strict";
import test from "node:test";
import {
  lazadaSupplementalMaximumPageSize,
  lazadaSupplementalReadPlan,
  normalizeLazadaSupplementalRead,
} from "../lib/cs/channels/lazada/supplemental-read";

const credentialId = "00000000-0000-4000-8000-000000001201";
const observedAt = "2026-09-09T11:40:00.000Z";

test("supplemental read plans are bounded and expose no mutation", () => {
  assert.deepEqual(lazadaSupplementalReadPlan({
    sourcePath: "/review/seller/list",
    country: "my",
    pageSize: lazadaSupplementalMaximumPageSize,
    resourceId: "ITEM-100",
  }), {
    contractVersion: "sellerpilot-lazada-supplemental-read-plan/1",
    method: "GET",
    sourcePath: "/review/seller/list",
    surface: "product_review",
    country: "MY",
    pageSize: 50,
    resourceId: "ITEM-100",
    pageNumber: 1,
    parameters: { item_id: "ITEM-100", page_size: "50", current: "1" },
    readOnly: true,
    mutationAllowed: false,
  });
  assert.throws(() => lazadaSupplementalReadPlan({
    sourcePath: "/review/seller/list", country: "MY", pageSize: 51,
  }), /PAGE_SIZE_INVALID/);
  assert.throws(() => lazadaSupplementalReadPlan({
    sourcePath: "/order/reverse/return/history/list", country: "MY",
  }), /RESOURCE_ID_REQUIRED/);
  assert.equal(lazadaSupplementalReadPlan({
    sourcePath: "/reverse/getreverseordersforseller", country: "MY",
  }).resourceId, null);
});

test("official nested reviews retain parent order, product rating, follow-ups and observed replies", () => {
  const payload = { code: "0", success: "true", data: { current: "1", total: "1", page_size: "10", data: [{
    item_id: "2222222222", order_id: "1111111111", ratings: { product_rating: "5", seller_rating: "4" },
    reviews: [
      { id: "3333333333", review_type: "PRODUCT_REVIEW", create_time: "1640970071000",
        review_content: "good\nstill good", seller_reply: "thank you\nagain", item_id: "wrong-child" },
      { id: "3333333334", review_type: "FOLLOW_UP_REVIEW", create_time: "1640970072000", review_content: "still good" },
    ],
  }] } };
  const base = { credentialId, country: "MY", sourcePath: "/review/seller/list" as const, observedAt,
    resourceId: "2222222222", payload };
  const events = normalizeLazadaSupplementalRead(base);
  assert.equal(events.length, 2);
  assert.equal(events[0].occurredAt, "2021-12-31T17:01:11.000Z");
  assert.equal(events[0].externalOrderId, "1111111111");
  assert.equal(events[0].externalItemId, "2222222222");
  assert.equal(events[0].rating, 5);
  assert.equal(events[0].providerContext.sellerReply, "thank you\nagain");
  assert.equal(events[0].body, "good\nstill good");
  assert.equal(events[1].providerContext.reviewType, "FOLLOW_UP_REVIEW");
  payload.data.data[0].reviews[0].seller_reply = "updated reply";
  assert.notEqual(normalizeLazadaSupplementalRead(base)[0].eventKey, events[0].eventKey);
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, resourceId: "other-item" }), /RESOURCE_MISMATCH/);
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, payload: { ...payload, success: "false" } }), /PROVIDER_FAILURE/);
});

test("official reverse list and detail flatten all lines with parent binding", () => {
  const line = { reverse_order_line_id: "RL-1", trade_order_line_id: "ITEM-1", reverse_status: "REQUEST_INITIATE",
    return_order_line_gmt_modified: "1640970071000", reason_text: "Out of stock", buyer: { buyer_id: "private" } };
  const group = { reverse_order_id: "RO-1", trade_order_id: "ORDER-1" };
  const base = { credentialId, country: "MY", observedAt, resourceId: "RO-1" };
  for (const sourcePath of ["/reverse/getreverseordersforseller", "/order/reverse/return/detail/list"] as const) {
    const lines = [line, { ...line, reverse_order_line_id: "RL-2" }];
    const payload = sourcePath === "/reverse/getreverseordersforseller"
      ? { code: "0", result: { success: "true", total: "1", items: [{ ...group, reverse_order_lines: lines }] } }
      : { code: "0", data: { ...group, reverseOrderLineDTOList: lines } };
    const events = normalizeLazadaSupplementalRead({ ...base, sourcePath, payload });
    assert.equal(events.length, 2);
    assert.equal(events[0].resourceKey, "RO-1");
    assert.equal(events[0].externalOrderId, "ORDER-1");
    assert.equal(events[0].occurredAt, "2021-12-31T17:01:11.000Z");
    assert.notEqual(events[0].eventKey, events[1].eventKey);
    assert.doesNotMatch(JSON.stringify(events), /private|buyer_id/);
    assert.throws(() => normalizeLazadaSupplementalRead({ ...base, resourceId: "wrong", sourcePath, payload }), /RESOURCE_MISMATCH/);
  }
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, sourcePath: "/reverse/getreverseordersforseller",
    payload: { code: "0", result: { success: "false", total: "0", items: [] } } }), /PROVIDER_FAILURE/);
});

test("official history requires request line identity and never invents a return status", () => {
  const base = { credentialId, country: "MY", observedAt, sourcePath: "/order/reverse/return/history/list" as const,
    payload: { code: "0", data: { page_info: { total: "1" }, list: [{ time: "1627562669235", operator: "Private Name", picture: [] }] } } };
  assert.throws(() => normalizeLazadaSupplementalRead(base), /RESOURCE_ID_REQUIRED/);
  const [event] = normalizeLazadaSupplementalRead({ ...base, resourceId: "RL-99" });
  assert.equal(event.resourceKey, "RL-99");
  assert.equal(event.providerContext.reverseOrderLineId, "RL-99");
  assert.equal(event.providerContext.reverseOrderId, undefined);
  assert.equal(event.status, "history_observed");
  assert.equal(event.occurredAt, "2021-07-29T12:44:29.235Z");
  assert.doesNotMatch(JSON.stringify(event), /Private Name/);
  assert.deepEqual(normalizeLazadaSupplementalRead({ ...base, resourceId: "RL-99" })[0], event);
});

test("official pagination parameters match each endpoint", () => {
  const base = { country: "MY", pageNumber: 3, pageSize: 10, resourceId: "123" };
  assert.deepEqual(lazadaSupplementalReadPlan({ ...base, sourcePath: "/review/seller/list" }).parameters,
    { item_id: "123", current: "3", page_size: "10" });
  assert.deepEqual(lazadaSupplementalReadPlan({ ...base, sourcePath: "/order/reverse/return/history/list" }).parameters,
    { reverse_order_line_id: "123", page_number: "3", page_size: "10" });
  assert.deepEqual(lazadaSupplementalReadPlan({ ...base, sourcePath: "/reverse/getreverseordersforseller" }).parameters,
    { reverse_order_id: "123", page_no: "3", page_size: "10" });
  assert.deepEqual(lazadaSupplementalReadPlan({ ...base, sourcePath: "/order/reverse/return/detail/list" }).parameters,
    { reverse_order_id: "123" });
  assert.throws(() => lazadaSupplementalReadPlan({ ...base, sourcePath: "/review/seller/list", pageNumber: 0 }), /PAGE_NUMBER_INVALID/);
});

test("nested expansion stays bounded and malformed official empties fail closed", () => {
  const base = { credentialId, country: "MY", observedAt, sourcePath: "/review/seller/list" as const };
  assert.deepEqual(normalizeLazadaSupplementalRead({ ...base, payload: { data: { total: "0", data: [] } } }), []);
  for (const total of [undefined, "garbage", false, "1"]) {
    assert.throws(() => normalizeLazadaSupplementalRead({ ...base, payload: { data: { total, data: [] } } }), /EMPTY_RESULT_UNVERIFIED/);
  }
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, payload: { data: { total: "2", data:
    Array.from({ length: 2 }, () => ({ item_id: "1", order_id: "2", ratings: { product_rating: "5" },
      reviews: Array.from({ length: 60 }, () => ({ id: "3", create_time: "1640970071000" })) })) } } }), /RESPONSE_SHAPE_UNVERIFIED/);
});

test("review and reverse-order responses normalize exact resources without sensitive buyer fields", () => {
  const review = normalizeLazadaSupplementalRead({
    credentialId, country: "MY", sourcePath: "/review/seller/list", observedAt,
    payload: { total_count: 1, data: [{
      review_id: "REV-1", item_id: "ITEM-100", rating: 5,
      review_content: "포장이 좋았습니다.", review_time: "2026-09-09T08:00:00+08:00",
      buyer_id: "must-not-survive", phone: "must-not-survive",
    }] },
  });
  assert.equal(review.length, 1);
  assert.equal(review[0]?.surface, "product_review");
  assert.equal(review[0]?.resourceKey, "REV-1");
  assert.equal(review[0]?.externalItemId, "ITEM-100");
  assert.equal(review[0]?.rating, 5);
  assert.doesNotMatch(JSON.stringify(review), /buyer_id|phone|must-not-survive/);

  const history = normalizeLazadaSupplementalRead({
    credentialId, country: "MY", sourcePath: "/order/reverse/return/history/list", observedAt,
    payload: { total: 1, data: { items: [{
      reverse_order_id: "RO-900", trade_order_id: "ORDER-90",
      trade_order_line_id: "LINE-1", reverse_order_line_id: "RL-1",
      history_id: "H-2", reverse_status: "RETURN_SHIPPED",
      message: "구매자가 반품을 발송했습니다.", status_update_time: 1788912000,
      address: "must-not-survive", buyer_id: "must-not-survive",
    }] } },
  });
  assert.equal(history[0]?.surface, "reverse_order_after_sales");
  assert.equal(history[0]?.resourceKey, "RO-900");
  assert.equal(history[0]?.externalOrderId, "ORDER-90");
  assert.deepEqual(history[0]?.providerContext, {
    reverseOrderId: "RO-900", reverseOrderLineId: "RL-1", historyId: "H-2",
  });
  assert.doesNotMatch(JSON.stringify(history), /address|buyer_id|must-not-survive/);
});

test("unknown and ambiguous provider responses fail closed", () => {
  const base = { credentialId, country: "MY", sourcePath: "/review/seller/list" as const, observedAt };
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, payload: "<html>maintenance</html>" }),
    /RESPONSE_INVALID/);
  assert.throws(() => normalizeLazadaSupplementalRead({ ...base, payload: { data: [] } }),
    /EMPTY_RESULT_UNVERIFIED/);
  assert.throws(() => normalizeLazadaSupplementalRead({
    ...base, payload: { code: "AccessDenied", total_count: 0, data: [] },
  }), /PROVIDER_FAILURE/);
  assert.deepEqual(normalizeLazadaSupplementalRead({ ...base, payload: { total_count: 0, data: [] } }), []);
  assert.throws(() => normalizeLazadaSupplementalRead({
    ...base, payload: { total_count: 101, data: Array.from({ length: 101 }, () => ({})) },
  }), /RESPONSE_SHAPE_UNVERIFIED/);
});

test("rating-only review revisions have distinct event identities", () => {
  const row = {
    review_id: "R-1",
    item_id: "I-1",
    rating: 5,
    review_content: "same",
    review_time: observedAt,
  };
  const normalize = (rating: number) => normalizeLazadaSupplementalRead({
    credentialId,
    country: "MY",
    sourcePath: "/review/seller/list",
    observedAt,
    payload: { data: [{ ...row, rating }] },
  })[0];
  assert.notEqual(normalize(5).eventKey, normalize(1).eventKey);
});

test("sibling reverse-order lines have distinct event identities", () => {
  const row = {
    reverse_order_id: "RO-1",
    reverse_status: "RETURN_INIT",
    reason: "same",
    status_update_time: observedAt,
  };
  const events = normalizeLazadaSupplementalRead({
    credentialId,
    country: "MY",
    sourcePath: "/order/reverse/return/detail/list",
    observedAt,
    payload: { data: { items: [
      { ...row, reverse_order_line_id: "L-1", trade_order_line_id: "ITEM-1" },
      { ...row, reverse_order_line_id: "L-2", trade_order_line_id: "ITEM-2" },
    ] } },
  });
  assert.equal(new Set(events.map((event) => event.eventKey)).size, 2);
});
