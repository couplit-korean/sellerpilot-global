import assert from "node:assert/strict";
import test from "node:test";
import {
  projectShopeeReturnDetail,
  shopeeReturnDetailRevision,
} from "../lib/channels/cs/shopee/return-detail";
import {
  planShopeeReturnHistory,
  planShopeeReviewHistory,
  SHOPEE_RETURN_MAX_WINDOW_SECONDS,
} from "../lib/channels/cs/shopee/history-plan";

const shops = [
  { country: "SG", shopId: "1719148844" },
  { country: "TW", shopId: "1758392145" },
];

test("Shopee return projection preserves operational evidence and drops all contact/address branches", () => {
  const projection = projectShopeeReturnDetail({ response: {
    return_sn: "RETURN1",
    order_sn: "ORDER1",
    reason: "NOT_RECEIPT",
    text_reason: "fixture reason",
    reassessed_request_reason: "ITEM_MISSING",
    refund_amount: 13.97,
    currency: "sgd",
    status: "REQUESTED",
    dispute_reason: ["REASON1"],
    dispute_text_reason: ["fixture dispute"],
    create_time: 1_788_000_000,
    update_time: 1_788_000_100,
    due_date: 1_788_050_000,
    return_seller_due_date: 1_788_050_001,
    return_ship_due_date: 1_788_040_000,
    image: ["https://example.test/return.jpg"],
    buyer_videos: [{
      thumbnail_url: "https://example.test/thumb.jpg",
      video_url: "https://example.test/evidence.mp4",
    }],
    negotiation: {
      negotiation_status: "PENDING_RESPOND",
      latest_solution: "RETURN_REFUND",
      latest_offer_amount: 12.34,
      latest_offer_creator: "SELLER",
      counter_limit: 2,
      offer_due_date: 1_788_050_002,
    },
    seller_proof: { seller_proof_status: "PENDING", seller_evidence_deadline: 1_788_050_003 },
    seller_compensation: {
      seller_compensation_status: "PENDING_REQUEST",
      seller_compensation_due_date: 1_788_050_004,
      compensation_amount: 10,
    },
    logistics_status: "LEGACY_STATUS",
    reverse_logistics_status: "RETURN_IN_TRANSIT",
    return_refund_type: "RRAOC",
    return_solution: 0,
    return_refund_request_type: 1,
    validation_type: "warehouse_validation",
    is_arrived_at_warehouse: 3,
    is_seller_arrange: true,
    is_shipping_proof_mandatory: true,
    has_uploaded_shipping_proof: false,
    is_reverse_logistics_channel_integrated: false,
    reverse_logistics_channel_name: "fixture carrier",
    is_partial_quantity_return: true,
    is_refund_amount_adjusted: true,
    follow_up_action_list: [{
      item_id: 100,
      model_id: 200,
      qty: 2,
      current_status: 2,
      related_order_sn_list: ["ORDER2"],
      resell_failed_next_step: "RETURN_TO_SELLER",
    }],
    user: { username: "fixture-user", email: "contact@example.test" },
    return_pickup_address: { address: "private-address", phone: "01000000000", name: "private-name" },
    virtual_contact_number: "0999999999",
    package_query_number: "private-query",
    return_address: { whs_id: "PRIVATE-WHS" },
  } }, "RETURN1");

  assert.equal(projection.originalReason, "NOT_RECEIPT");
  assert.equal(projection.reassessedReason, "ITEM_MISSING");
  assert.equal(projection.negotiation.offerDueDate, 1_788_050_002);
  assert.equal(projection.sellerProof.evidenceDeadline, 1_788_050_003);
  assert.equal(projection.logistics.reverseStatus, "RETURN_IN_TRANSIT");
  assert.equal(projection.media.sourceExpiryKnown, false);
  assert.equal(projection.followUpActions[0]?.itemId, "100");
  assert.match(shopeeReturnDetailRevision(projection), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(projection), /contact@example|private-address|01000000000|private-name|0999999999|private-query|PRIVATE-WHS|fixture-user/);
});

test("Shopee return projection revision changes when the reassessed reason or media changes", () => {
  const base = { return_sn: "RETURN1", reason: "NOT_RECEIPT", image: [], buyer_videos: [] };
  const first = projectShopeeReturnDetail(base);
  const second = projectShopeeReturnDetail({ ...base, reassessed_request_reason: "ITEM_MISSING" });
  const third = projectShopeeReturnDetail({ ...base, image: ["https://example.test/new.jpg"] });
  assert.notEqual(shopeeReturnDetailRevision(first), shopeeReturnDetailRevision(second));
  assert.notEqual(shopeeReturnDetailRevision(first), shopeeReturnDetailRevision(third));
});

test("Shopee review history is one independent cursor corpus per actual shop", () => {
  const plan = planShopeeReviewHistory(shops);
  assert.equal(plan.length, 2);
  assert.equal(new Set(plan.map((scope) => scope.scopeKey)).size, 2);
  assert.deepEqual(plan.map((scope) => scope.arguments.shopId), ["1719148844", "1758392145"]);
  assert.ok(plan.every((scope) => scope.coverage === "provider_cursor_corpus"));
  assert.ok(plan.every((scope) => !("createTimeFrom" in scope.arguments)));
});

test("Shopee Returns history uses bounded progressing windows with a real one-second overlap", () => {
  const from = 1_780_000_000;
  const to = from + 31 * 86_400;
  const plan = planShopeeReturnHistory(shops, { from, to });
  const sg = plan.filter((scope) => scope.shopId === shops[0].shopId)
    .sort((left, right) => left.arguments.createTimeFrom - right.arguments.createTimeFrom);
  assert.equal(plan.length, sg.length * shops.length);
  assert.ok(sg.length >= 3);
  assert.equal(sg[0]?.arguments.createTimeFrom, from);
  assert.equal(sg.at(-1)?.arguments.createTimeTo, to);
  for (let index = 0; index < sg.length; index += 1) {
    const scope = sg[index];
    assert.ok(scope.arguments.createTimeTo - scope.arguments.createTimeFrom <= SHOPEE_RETURN_MAX_WINDOW_SECONDS);
    if (index > 0) {
      const older = sg[index - 1];
      const newer = scope;
      assert.equal(newer.arguments.createTimeFrom, older.arguments.createTimeTo - 1);
      assert.ok(newer.arguments.createTimeTo > older.arguments.createTimeTo);
      const strictProviderIncludes = (timestamp: number, candidate: typeof scope) =>
        timestamp > candidate.arguments.createTimeFrom && timestamp < candidate.arguments.createTimeTo;
      assert.ok(strictProviderIncludes(newer.arguments.createTimeFrom, older));
      assert.ok(strictProviderIncludes(older.arguments.createTimeTo, newer));
    }
  }
  assert.equal(new Set(plan.map((scope) => scope.scopeKey)).size, plan.length);
});

test("Shopee Returns 15-day-plus-one-second edge neither exceeds the cap nor strands a boundary second", () => {
  const from = 1_780_000_000;
  const to = from + SHOPEE_RETURN_MAX_WINDOW_SECONDS + 1;
  const scopes = planShopeeReturnHistory([shops[0]], { from, to })
    .sort((left, right) => left.arguments.createTimeFrom - right.arguments.createTimeFrom);
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0]?.arguments.createTimeFrom, from);
  assert.equal(scopes[1]?.arguments.createTimeTo, to);
  assert.ok(scopes.every((scope) =>
    scope.arguments.createTimeTo - scope.arguments.createTimeFrom <= SHOPEE_RETURN_MAX_WINDOW_SECONDS));
  assert.equal(scopes[1]?.arguments.createTimeFrom, scopes[0]?.arguments.createTimeTo - 1);
  const boundarySecond = scopes[1]!.arguments.createTimeFrom;
  assert.ok(boundarySecond > scopes[0]!.arguments.createTimeFrom
    && boundarySecond < scopes[0]!.arguments.createTimeTo);
});

test("Shopee history planning rejects duplicate, invalid and more-than-eight shop scopes", () => {
  assert.throws(() => planShopeeReviewHistory([shops[0], shops[0]]), /SHOPEE_HISTORY_SHOPS_INVALID/);
  assert.throws(() => planShopeeReviewHistory([{ country: "SG", shopId: "0" }]), /SHOPEE_HISTORY_SHOPS_INVALID/);
  assert.throws(() => planShopeeReviewHistory(Array.from({ length: 9 }, (_, index) => ({
    country: `C${index}`,
    shopId: String(1_000 + index),
  }))), /SHOPEE_HISTORY_SHOPS_INVALID/);
  assert.throws(() => planShopeeReturnHistory(shops, { from: 10, to: 10 }), /SHOPEE_HISTORY_RANGE_INVALID/);
});
