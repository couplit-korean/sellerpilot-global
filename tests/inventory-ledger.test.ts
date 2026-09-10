import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustOnHand,
  applyInventoryLedgerEvent,
  availableStock,
  buildOrderKey,
  cancelRelease,
  cloneInventoryLedger,
  confirmSale,
  createInventoryLedger,
  inventoryLedgerSnapshot,
  receiveReturn,
  receiveStock,
  replayInventoryLedger,
  reserveStock,
  setSafetyStock,
  type InventoryLedger,
  type InventoryLedgerEvent,
  type InventoryLedgerEventInput,
} from "../lib/inventory/ledger";

const SKU = "SP-SKU-0001";

function freshLedger(): InventoryLedger {
  return createInventoryLedger(SKU);
}

function expectOk(result: ReturnType<typeof reserveStock>) {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.ok(result.ok);
  return result;
}

function expectFail(result: ReturnType<typeof reserveStock>, code: string) {
  assert.equal(result.ok, false, `expected failure ${code}, got ${JSON.stringify(result)}`);
  assert.ok(!result.ok);
  assert.equal(result.code, code);
}

function expectState(
  ledger: InventoryLedger,
  expected: { onHand: number; reserved: number; safetyStock: number; available: number },
) {
  assert.equal(ledger.onHand, expected.onHand, "onHand");
  assert.equal(ledger.reserved, expected.reserved, "reserved");
  assert.equal(ledger.safetyStock, expected.safetyStock, "safetyStock");
  assert.equal(availableStock(ledger), expected.available, "available");
}

test("입고→예약→확정: 예약은 실재고를 건드리지 않고 확정 시 차감한다", () => {
  const ledger = freshLedger();
  const receipt = expectOk(
    receiveStock(ledger, { idempotencyKey: "receipt-po-0001", quantity: 100 }),
  );
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.event.sequence, 1);
  expectState(ledger, { onHand: 100, reserved: 0, safetyStock: 0, available: 100 });

  const order = { channel: "shopee", externalOrderId: "ORD-1", orderLineKey: "LINE-1" };
  const reservation = expectOk(reserveStock(ledger, { ...order, quantity: 3 }));
  assert.equal(reservation.replayed, false);
  assert.equal(reservation.event.sequence, 2);
  expectState(ledger, { onHand: 100, reserved: 3, safetyStock: 0, available: 97 });
  assert.equal(ledger.reservations.length, 1);
  assert.equal(ledger.reservations[0].status, "pending");

  const confirmed = expectOk(confirmSale(ledger, { ...order, quantity: 3 }));
  assert.equal(confirmed.replayed, false);
  assert.equal(confirmed.event.onHandDelta, -3);
  assert.equal(confirmed.event.reservedDelta, -3);
  expectState(ledger, { onHand: 97, reserved: 0, safetyStock: 0, available: 97 });
  assert.equal(ledger.reservations[0].status, "confirmed");
  assert.ok(ledger.reservations[0].confirmedAt);
});

test("취소 해제: 예약을 풀고 실재고는 그대로 둔다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0002", quantity: 50 });
  const order = { channel: "lazada", externalOrderId: "ORD-2", orderLineKey: "LINE-1" };
  reserveStock(ledger, { ...order, quantity: 5 });
  expectState(ledger, { onHand: 50, reserved: 5, safetyStock: 0, available: 45 });

  const released = expectOk(cancelRelease(ledger, { ...order, quantity: 5 }));
  assert.equal(released.event.reservedDelta, -5);
  assert.equal(released.event.onHandDelta, 0);
  expectState(ledger, { onHand: 50, reserved: 0, safetyStock: 0, available: 50 });
  assert.equal(ledger.reservations[0].status, "released");
  assert.ok(ledger.reservations[0].releasedAt);

  // 해제된 재고는 다시 예약 가능하다(다른 주문).
  reserveStock(ledger, { channel: "qoo10", externalOrderId: "ORD-3", orderLineKey: "L-9", quantity: 5 });
  expectState(ledger, { onHand: 50, reserved: 5, safetyStock: 0, available: 45 });
});

test("반품 재입고: 검수 후 수량을 실재고로 되돌린다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0003", quantity: 20 });
  const order = { channel: "smartstore", externalOrderId: "ORD-4", orderLineKey: "LINE-2" };
  reserveStock(ledger, { ...order, quantity: 2 });
  confirmSale(ledger, { ...order, quantity: 2 });
  expectState(ledger, { onHand: 18, reserved: 0, safetyStock: 0, available: 18 });

  const returned = expectOk(
    receiveReturn(ledger, {
      idempotencyKey: "return-ret-00001",
      quantity: 1,
      channel: "smartstore",
      externalOrderId: "ORD-4",
      orderLineKey: "LINE-2",
    }),
  );
  assert.equal(returned.event.onHandDelta, 1);
  expectState(ledger, { onHand: 19, reserved: 0, safetyStock: 0, available: 19 });

  // 동일 반품 멱등키 재적용은 재입고하지 않는다.
  const replay = expectOk(
    receiveReturn(ledger, {
      idempotencyKey: "return-ret-00001", quantity: 1,
      channel: "smartstore", externalOrderId: "ORD-4", orderLineKey: "LINE-2",
    }),
  );
  assert.equal(replay.replayed, true);
  expectState(ledger, { onHand: 19, reserved: 0, safetyStock: 0, available: 19 });
});

test("중복 예약 차단: 같은 채널+주문번호+주문라인은 한 번만 차감한다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0004", quantity: 10 });
  const order = { channel: "coupang", externalOrderId: "ORD-5", orderLineKey: "LINE-1" };

  const first = expectOk(reserveStock(ledger, { ...order, quantity: 4 }));
  assert.equal(first.replayed, false);
  expectState(ledger, { onHand: 10, reserved: 4, safetyStock: 0, available: 6 });

  const duplicate = expectOk(reserveStock(ledger, { ...order, quantity: 4 }));
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.event.sequence, first.event.sequence);
  expectState(ledger, { onHand: 10, reserved: 4, safetyStock: 0, available: 6 });
  assert.equal(ledger.reservations.length, 1);

  // 확정/취소 역시 중복 재적용이 안전하다.
  expectOk(confirmSale(ledger, { ...order, quantity: 4 }));
  expectState(ledger, { onHand: 6, reserved: 0, safetyStock: 0, available: 6 });
  const dupConfirm = expectOk(confirmSale(ledger, { ...order, quantity: 4 }));
  assert.equal(dupConfirm.replayed, true);
  expectState(ledger, { onHand: 6, reserved: 0, safetyStock: 0, available: 6 });
});

test("음수 방지: 판매가능재고를 넘는 예약과 예약 이하 실사 보정을 거부한다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0005", quantity: 8 });
  reserveStock(ledger, { channel: "shopee", externalOrderId: "ORD-6", orderLineKey: "L-1", quantity: 5 });

  const over = reserveStock(ledger, {
    channel: "shopee",
    externalOrderId: "ORD-7",
    orderLineKey: "L-1",
    quantity: 4,
  });
  expectFail(over, "INSUFFICIENT_STOCK");
  expectState(ledger, { onHand: 8, reserved: 5, safetyStock: 0, available: 3 });
  assert.equal(ledger.events.length, 2, "실패한 예약은 원장에 기록되지 않는다");

  const belowReserved = adjustOnHand(ledger, {
    newOnHand: 4,
    idempotencyKey: "adjust-key-0001",
    reason: "실사",
  });
  expectFail(belowReserved, "ADJUSTMENT_BELOW_RESERVED");

  // 예약이 확정되면 그만큼 실재고가 줄었으므로 보정 가능해진다.
  confirmSale(ledger, { channel: "shopee", externalOrderId: "ORD-6", orderLineKey: "L-1", quantity: 5 });
  expectState(ledger, { onHand: 3, reserved: 0, safetyStock: 0, available: 3 });
  const adjusted = expectOk(
    adjustOnHand(ledger, { newOnHand: 1, idempotencyKey: "adjust-key-0001", reason: "실사" }),
  );
  assert.equal(adjusted.event.onHandDelta, -2);
  expectState(ledger, { onHand: 1, reserved: 0, safetyStock: 0, available: 1 });
});

test("안전재고 차감: 판매가능재고에서 안전재고를 뺀 수량만 예약 가능하다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0006", quantity: 30 });
  const safety = expectOk(setSafetyStock(ledger, { safetyStock: 10, idempotencyKey: "safety-key-0001" }));
  assert.equal(safety.event.safetyStockDelta, 10);
  assert.equal(safety.event.quantity, 10);
  expectState(ledger, { onHand: 30, reserved: 0, safetyStock: 10, available: 20 });

  // 안전재고까지 소진하는 예약은 성공, 그 이상은 거부.
  reserveStock(ledger, { channel: "temu", externalOrderId: "ORD-8", orderLineKey: "L-1", quantity: 20 });
  expectState(ledger, { onHand: 30, reserved: 20, safetyStock: 10, available: 0 });
  const over = reserveStock(ledger, {
    channel: "temu",
    externalOrderId: "ORD-9",
    orderLineKey: "L-1",
    quantity: 1,
  });
  expectFail(over, "INSUFFICIENT_STOCK");

  // 안전재고를 낮추면 다시 판매 가능해진다.
  setSafetyStock(ledger, { safetyStock: 5, idempotencyKey: "safety-key-0002" });
  expectState(ledger, { onHand: 30, reserved: 20, safetyStock: 5, available: 5 });
  reserveStock(ledger, { channel: "temu", externalOrderId: "ORD-9", orderLineKey: "L-1", quantity: 5 });
  expectState(ledger, { onHand: 30, reserved: 25, safetyStock: 5, available: 0 });
});

test("원장 재생: 이벤트 목록만으로 동일한 상태가 재도출되고 중복 적용해도 불변이다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0007", quantity: 60 });
  setSafetyStock(ledger, { safetyStock: 6, idempotencyKey: "safety-key-0003" });
  const orderA = { channel: "shopee", externalOrderId: "ORD-A", orderLineKey: "L-1" };
  reserveStock(ledger, { ...orderA, quantity: 10 });
  reserveStock(ledger, { ...orderA, quantity: 10 }); // 중복 → replay
  confirmSale(ledger, { ...orderA, quantity: 10 });
  const orderB = { channel: "lazada", externalOrderId: "ORD-B", orderLineKey: "L-2" };
  reserveStock(ledger, { ...orderB, quantity: 7 });
  cancelRelease(ledger, { ...orderB, quantity: 7 });
  receiveReturn(ledger, {
    idempotencyKey: "return-ret-00002",
    quantity: 2,
    channel: "shopee",
    externalOrderId: "ORD-A",
    orderLineKey: "L-1",
  });
  adjustOnHand(ledger, { newOnHand: 52, idempotencyKey: "adjust-key-0002", reason: "실사" });

  const original = inventoryLedgerSnapshot(ledger);
  const replayed = replayInventoryLedger(SKU, ledger.events);
  assert.equal(replayed.ok, true, `replay failed: ${JSON.stringify(replayed)}`);
  assert.ok(replayed.ok);
  expectState(replayed.ledger, {
    onHand: original.onHand,
    reserved: original.reserved,
    safetyStock: original.safetyStock,
    available: original.available,
  });
  assert.equal(replayed.ledger.events.length, original.eventCount);
  assert.equal(replayed.ledger.reservations.length, ledger.reservations.length);

  // 재생 결과로 다시 재생해도 같은 상태 (append-only idempotent replay).
  const doubleReplay = replayInventoryLedger(SKU, replayed.ledger.events);
  assert.equal(doubleReplay.ok, true);
  assert.ok(doubleReplay.ok);
  expectState(doubleReplay.ledger, {
    onHand: original.onHand,
    reserved: original.reserved,
    safetyStock: original.safetyStock,
    available: original.available,
  });
});

test("검증 실패는 상태를 전혀 변경하지 않는다 (원자성)", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0008", quantity: 5 });
  const before = inventoryLedgerSnapshot(ledger);

  expectFail(
    reserveStock(ledger, { channel: "shopee", externalOrderId: "ORD-X", orderLineKey: "L-1", quantity: 6 }),
    "INSUFFICIENT_STOCK",
  );
  expectFail(
    reserveStock(ledger, { channel: "nope", externalOrderId: "ORD-X", orderLineKey: "L-1", quantity: 1 }),
    "INVALID_CHANNEL",
  );
  expectFail(
    reserveStock(ledger, { channel: "shopee", externalOrderId: "", orderLineKey: "L-1", quantity: 1 }),
    "INVALID_ORDER_REFERENCE",
  );
  expectFail(receiveStock(ledger, { idempotencyKey: "short", quantity: 1 }), "INVALID_IDEMPOTENCY_KEY");
  expectFail(
    confirmSale(ledger, { channel: "shopee", externalOrderId: "ORD-X", orderLineKey: "L-1", quantity: 1 }),
    "RESERVATION_NOT_FOUND",
  );
  expectFail(
    cancelRelease(ledger, { channel: "shopee", externalOrderId: "ORD-X", orderLineKey: "L-1", quantity: 1 }),
    "RESERVATION_NOT_FOUND",
  );

  const after = inventoryLedgerSnapshot(ledger);
  assert.deepEqual(after, before);
});

test("예약 수량 불일치 확정/취소를 거부한다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0009", quantity: 30 });
  const order = { channel: "ebay", externalOrderId: "ORD-M", orderLineKey: "L-1" };
  reserveStock(ledger, { ...order, quantity: 4 });

  expectFail(confirmSale(ledger, { ...order, quantity: 3 }), "RESERVATION_QUANTITY_MISMATCH");
  expectFail(cancelRelease(ledger, { ...order, quantity: 5 }), "RESERVATION_QUANTITY_MISMATCH");
  expectState(ledger, { onHand: 30, reserved: 4, safetyStock: 0, available: 26 });
});

test("clone은 독립된 브랜치를 만들어 원장 불변성을 지킨다", () => {
  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "receipt-po-0010", quantity: 40 });
  const branch = cloneInventoryLedger(ledger);
  reserveStock(branch, { channel: "shopee", externalOrderId: "ORD-N", orderLineKey: "L-1", quantity: 9 });
  expectState(branch, { onHand: 40, reserved: 9, safetyStock: 0, available: 31 });
  expectState(ledger, { onHand: 40, reserved: 0, safetyStock: 0, available: 40 });
});

test("10,000건 동시 주문 시뮬레이션: 음수재고 0건, 중복 차감 0건", () => {
  const TOTAL_ORDERS = 10_000;
  const ON_HAND = 1_000;
  const SAFETY_STOCK = 50;
  const SELLABLE = ON_HAND - SAFETY_STOCK; // 950

  const ledger = freshLedger();
  receiveStock(ledger, { idempotencyKey: "bulk-receipt-00001", quantity: ON_HAND });
  setSafetyStock(ledger, { safetyStock: SAFETY_STOCK, idempotencyKey: "bulk-safety-0001" });

  // 동시 주문 10,000건을 순차 적용으로 시뮬레이션한다. 원장은 매 이벤트마다
  // 잠금 없이도 판매가능재고 이상을 예약할 수 없으므로(INSUFFICIENT_STOCK),
  // 어떤 순서로 도착해도 음수 재고가 발생할 수 없다.
  const orderKeys: string[] = [];
  let accepted = 0;
  let rejected = 0;
  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const order = {
      channel: i % 2 === 0 ? "shopee" : "lazada",
      externalOrderId: `BULK-ORD-${String(i).padStart(5, "0")}`,
      orderLineKey: "L-1",
    };
    orderKeys.push(buildOrderKey(order.channel, order.externalOrderId, order.orderLineKey));
    const result = reserveStock(ledger, { ...order, quantity: 1 });
    if (result.ok) accepted++;
    else {
      assert.equal(result.code, "INSUFFICIENT_STOCK");
      rejected++;
    }
    // 불변식: 어떤 시점에도 음수 재고 없음.
    assert.ok(ledger.onHand >= 0, "onHand 음수");
    assert.ok(ledger.reserved >= 0, "reserved 음수");
    assert.ok(availableStock(ledger) >= 0, "available 음수");
    assert.ok(ledger.reserved <= ledger.onHand, "reserved > onHand");
  }
  assert.equal(accepted, SELLABLE);
  assert.equal(rejected, TOTAL_ORDERS - SELLABLE);
  expectState(ledger, { onHand: ON_HAND, reserved: SELLABLE, safetyStock: SAFETY_STOCK, available: 0 });
  assert.equal(ledger.reservations.length, SELLABLE);
  assert.equal(ledger.events.length, 2 + SELLABLE);

  // 같은 10,000건을 24시간 뒤 재처리해도 (webhook 재전송/폴링 중복):
  // 성공했던 950건은 전부 replay, 거부됐던 9,050건은 여전히 거부 → 중복 차감 0.
  const stateBeforeReplay = inventoryLedgerSnapshot(ledger);
  let replayedCount = 0;
  let stillRejected = 0;
  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const order = {
      channel: i % 2 === 0 ? "shopee" : "lazada",
      externalOrderId: `BULK-ORD-${String(i).padStart(5, "0")}`,
      orderLineKey: "L-1",
    };
    const result = reserveStock(ledger, { ...order, quantity: 1 });
    if (result.ok) {
      assert.equal(result.replayed, true, `주문 ${i}가 재적용되었지만 replay가 아님`);
      replayedCount++;
    } else {
      assert.equal(result.code, "INSUFFICIENT_STOCK");
      stillRejected++;
    }
  }
  assert.equal(replayedCount, SELLABLE);
  assert.equal(stillRejected, TOTAL_ORDERS - SELLABLE);
  const stateAfterReplay = inventoryLedgerSnapshot(ledger);
  assert.equal(stateAfterReplay.onHand, stateBeforeReplay.onHand);
  assert.equal(stateAfterReplay.reserved, stateBeforeReplay.reserved);
  assert.equal(stateAfterReplay.available, stateBeforeReplay.available);
  assert.equal(stateAfterReplay.eventCount, stateBeforeReplay.eventCount);

  // 원장 재생으로도 동일 상태가 복원된다 (멱등성 검증).
  const restored = replayInventoryLedger(SKU, ledger.events);
  assert.equal(restored.ok, true);
  assert.ok(restored.ok);
  expectState(restored.ledger, {
    onHand: ON_HAND,
    reserved: SELLABLE,
    safetyStock: SAFETY_STOCK,
    available: 0,
  });
  assert.equal(restored.ledger.events.length, ledger.events.length);

  // 확정 흐름까지 재생하면 실재고가 정확히 줄어든다.
  let confirmed = 0;
  for (const key of orderKeys) {
    const [channel, externalOrderId, orderLineKey] = key.split(":");
    const result = confirmSale(ledger, {
      channel,
      externalOrderId,
      orderLineKey,
      quantity: 1,
    });
    if (result.ok) {
      assert.equal(result.replayed, false);
      confirmed++;
    }
  }
  assert.equal(confirmed, SELLABLE);
  expectState(ledger, {
    onHand: ON_HAND - SELLABLE,
    reserved: 0,
    safetyStock: SAFETY_STOCK,
    available: 0,
  });

  // 확정 이벤트까지 포함한 전체 재생이 같은 최종 상태를 만든다.
  const finalReplay = replayInventoryLedger(SKU, ledger.events);
  assert.equal(finalReplay.ok, true);
  assert.ok(finalReplay.ok);
  expectState(finalReplay.ledger, {
    onHand: ON_HAND - SELLABLE,
    reserved: 0,
    safetyStock: SAFETY_STOCK,
    available: 0,
  });

  // 저장된 이벤트의 after 필드가 불변식과 델타 누적을 항상 만족하는지 검증.
  let runningOnHand = 0;
  let runningReserved = 0;
  let runningSafety = 0;
  for (const event of ledger.events as InventoryLedgerEvent[]) {
    assert.equal(event.onHandAfter, runningOnHand + event.onHandDelta, `seq ${event.sequence} onHand 누적 불일치`);
    assert.equal(event.reservedAfter, runningReserved + event.reservedDelta, `seq ${event.sequence} reserved 누적 불일치`);
    assert.equal(event.safetyStockAfter, runningSafety + event.safetyStockDelta, `seq ${event.sequence} safety 누적 불일치`);
    runningOnHand = event.onHandAfter;
    runningReserved = event.reservedAfter;
    runningSafety = event.safetyStockAfter;
    assert.equal(
      event.availableAfter,
      Math.max(0, event.onHandAfter - event.reservedAfter - event.safetyStockAfter),
    );
    assert.ok(event.onHandAfter >= 0);
    assert.ok(event.reservedAfter >= 0 && event.reservedAfter <= event.onHandAfter);
    assert.ok(event.safetyStockAfter >= 0);
  }
});

const conflictOrder = { channel: "shopee", externalOrderId: "CONFLICT-ORDER", orderLineKey: "LINE-1" };
const conflictCases: { name: string; first: InventoryLedgerEventInput; conflict: InventoryLedgerEventInput }[] = [
  { name: "입고", first: { type: "RECEIPT", idempotencyKey: "conflict-receipt", quantity: 2 }, conflict: { type: "RECEIPT", idempotencyKey: "conflict-receipt", quantity: 3 } },
  ...(["SALE_PENDING", "SALE_CONFIRMED", "CANCEL_RELEASE"] as const).map((type) => ({
    name: type, first: { type, ...conflictOrder, quantity: 2 }, conflict: { type, ...conflictOrder, quantity: 3 },
  })),
  { name: "반품", first: { type: "RETURN_RECEIVED", idempotencyKey: "conflict-return", quantity: 2, ...conflictOrder }, conflict: { type: "RETURN_RECEIVED", idempotencyKey: "conflict-return", quantity: 3, ...conflictOrder } },
  { name: "실사", first: { type: "ADJUSTMENT", idempotencyKey: "conflict-adjust", newOnHand: 20, reason: "실사" }, conflict: { type: "ADJUSTMENT", idempotencyKey: "conflict-adjust", newOnHand: 30, reason: "실사" } },
  { name: "안전재고", first: { type: "SAFETY_STOCK_CHANGE", idempotencyKey: "conflict-safety", safetyStock: 2 }, conflict: { type: "SAFETY_STOCK_CHANGE", idempotencyKey: "conflict-safety", safetyStock: 3 } },
];

for (const scenario of conflictCases) {
  test(`${scenario.name}: 같은 멱등키의 다른 수량은 충돌이며 원장을 변경하지 않는다`, () => {
    const ledger = freshLedger();
    expectOk(receiveStock(ledger, { idempotencyKey: "conflict-initial", quantity: 100 }));
    if (scenario.first.type === "SALE_CONFIRMED" || scenario.first.type === "CANCEL_RELEASE") {
      expectOk(reserveStock(ledger, { ...conflictOrder, quantity: 2 }));
    }
    const first = expectOk(applyInventoryLedgerEvent(ledger, scenario.first));
    const before = structuredClone(ledger);
    expectFail(applyInventoryLedgerEvent(ledger, scenario.conflict), "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(ledger, before);
    const retry = expectOk(applyInventoryLedgerEvent(ledger, { ...scenario.first, occurredAt: "2026-09-06T00:00:00Z" }));
    assert.equal(retry.replayed, true);
    assert.equal(retry.event, first.event);
    assert.deepEqual(ledger, before);
  });
}

for (const changedReference of [
  { ...conflictOrder, externalOrderId: "OTHER-ORDER" },
  { ...conflictOrder, orderLineKey: "OTHER-LINE" },
  { ...conflictOrder, channel: "lazada" },
  {},
]) {
  test(`반품 멱등키의 주문 참조 변경/누락은 충돌: ${JSON.stringify(changedReference)}`, () => {
    const ledger = freshLedger();
    expectOk(receiveReturn(ledger, { ...conflictOrder, idempotencyKey: "return-reference-key", quantity: 2 }));
    const before = structuredClone(ledger);
    expectFail(receiveReturn(ledger, { ...changedReference, idempotencyKey: "return-reference-key", quantity: 2 }), "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(ledger, before);
  });
}

test("원장 재생도 같은 키의 상충 이벤트를 성공으로 숨기지 않는다", () => {
  const ledger = freshLedger();
  const first = expectOk(receiveStock(ledger, { idempotencyKey: "replay-conflict-key", quantity: 5 }));
  const result = replayInventoryLedger(SKU, [first.event, { ...first.event, sequence: 2, quantity: 7 }]);
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(result.ledger.onHand, 5);
  assert.equal(result.ledger.events.length, 1);
});

test("콜론 참조 및 부분 반품 참조는 원장 기록 전에 거부한다", () => {
  const ledger = freshLedger();
  expectOk(receiveStock(ledger, { idempotencyKey: "reference-initial-stock", quantity: 100 }));
  const before = structuredClone(ledger);
  for (const [externalOrderId, orderLineKey] of [["A:B", "C"], ["A", "B:C"]]) {
    for (const type of ["SALE_PENDING", "SALE_CONFIRMED", "CANCEL_RELEASE"] as const) {
      expectFail(applyInventoryLedgerEvent(ledger, { type, channel: "shopee", externalOrderId, orderLineKey, quantity: 1 }), "INVALID_ORDER_REFERENCE");
    }
    expectFail(receiveReturn(ledger, { idempotencyKey: "reference-return-key", channel: "shopee", externalOrderId, orderLineKey, quantity: 1 }), "INVALID_ORDER_REFERENCE");
    assert.deepEqual(ledger, before);
  }
  for (const refs of [
    { channel: "shopee" }, { externalOrderId: "ORDER" }, { orderLineKey: "LINE" },
    { channel: "shopee", externalOrderId: "ORDER" }, { channel: "shopee", orderLineKey: "LINE" },
    { externalOrderId: "ORDER", orderLineKey: "LINE" },
  ]) {
    expectFail(receiveReturn(ledger, { ...refs, idempotencyKey: "reference-return-key", quantity: 1 }), "INVALID_ORDER_REFERENCE");
    assert.deepEqual(ledger, before);
  }
});

test("합성키 240문자 경계와 Unicode는 SQL 계약과 같고 정상 재시도는 보존한다", () => {
  const ledger = freshLedger();
  expectOk(receiveStock(ledger, { idempotencyKey: "boundary-initial-stock", quantity: 100 }));
  for (const char of ["L", "😀"]) {
    const order = { channel: "shopee", externalOrderId: "O", orderLineKey: char.repeat(231), quantity: 1 };
    expectOk(reserveStock(ledger, order));
    assert.equal(expectOk(reserveStock(ledger, order)).replayed, true);
    const before = structuredClone(ledger);
    expectFail(reserveStock(ledger, { ...order, orderLineKey: char.repeat(232) }), "INVALID_ORDER_REFERENCE");
    expectFail(receiveReturn(ledger, { ...order, orderLineKey: char.repeat(232), idempotencyKey: "boundary-return-key" }), "INVALID_ORDER_REFERENCE");
    assert.deepEqual(ledger, before);
    expectOk(receiveReturn(ledger, { ...order, idempotencyKey: `boundary-return-${char}` }));
  }
  expectOk(receiveReturn(ledger, { quantity: 1, idempotencyKey: "unbound-reference-key" }));
  assert.equal(expectOk(receiveReturn(ledger, { quantity: 1, idempotencyKey: "unbound-reference-key", channel: " ", externalOrderId: " ", orderLineKey: " " })).replayed, true);
});
