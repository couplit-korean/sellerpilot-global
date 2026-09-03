/**
 * 중앙 재고 원장 (append-only ledger) 순수 로직 모듈.
 *
 * docs/무인_상품등록_자동화_구축_계획.md §10 구현:
 * - 원장 이벤트: RECEIPT, SALE_PENDING, SALE_CONFIRMED, CANCEL_RELEASE,
 *   RETURN_RECEIVED, ADJUSTMENT, SAFETY_STOCK_CHANGE
 * - 판매가능재고 = 실재고(onHand) - 예약재고(reserved) - 안전재고(safetyStock), 음수 불가
 * - 예약/확정/취소/반품은 "채널 + 주문번호 + 주문라인" 멱등키로 중복 차단
 * - 상태는 이벤트 재생(replay)으로만 도출된다. 이벤트가 유일한 진실.
 *
 * 각 apply* 호출은 단일 원자 트랜잭션처럼 동작한다: 전체 검증을 먼저 수행하고
 * 실패 시 상태를 전혀 변경하지 않는다. 동일 멱등키 재적용은 replay(no-op)로
 * 처리되어 중복 차감·중복 입고가 0건임을 보장한다.
 *
 * DB 대응 구현은 supabase/migrations/20260903100000_inventory_ledger.sql:
 * 동일한 규칙을 SELECT ... FOR UPDATE 행 잠금 + 유니크 제약으로 강제한다.
 */

export const INVENTORY_LEDGER_EVENT_TYPES = [
  "RECEIPT",
  "SALE_PENDING",
  "SALE_CONFIRMED",
  "CANCEL_RELEASE",
  "RETURN_RECEIVED",
  "ADJUSTMENT",
  "SAFETY_STOCK_CHANGE",
] as const;

export type InventoryLedgerEventType = (typeof INVENTORY_LEDGER_EVENT_TYPES)[number];

export const MAX_INVENTORY_QUANTITY = 99_999_999;

export const SUPPORTED_INVENTORY_CHANNELS = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
  "alibaba",
  "one688",
] as const;

export type InventoryChannel = (typeof SUPPORTED_INVENTORY_CHANNELS)[number];

export type InventoryLedgerErrorCode =
  | "INVALID_SKU"
  | "INVALID_QUANTITY"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_CHANNEL"
  | "INVALID_ORDER_REFERENCE"
  | "INVALID_REASON"
  | "INSUFFICIENT_STOCK"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_NOT_PENDING"
  | "RESERVATION_QUANTITY_MISMATCH"
  | "ADJUSTMENT_BELOW_RESERVED";

/** 원장에 기록되는 append-only 이벤트 한 건. */
export type InventoryLedgerEvent = {
  /** 아이템별 1부터 시작하는 단조 증가 순번. */
  sequence: number;
  type: InventoryLedgerEventType;
  /**
   * 이벤트 유형별 멱등키. (type, idempotencyKey) 조합으로 중복 재적용을 차단한다.
   * 주문 흐름 이벤트는 orderKey(= channel:externalOrderId:orderLineKey)와 동일.
   */
  idempotencyKey: string;
  /**
   * 유량 이벤트(입고/예약/확정/취소/반품)는 수량 크기,
   * ADJUSTMENT는 보정 후 절대 실재고, SAFETY_STOCK_CHANGE는 변경 후 절대 안전재고.
   */
  quantity: number;
  orderKey: string | null;
  channel: string | null;
  onHandDelta: number;
  reservedDelta: number;
  safetyStockDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  safetyStockAfter: number;
  availableAfter: number;
  reason: string;
  occurredAt: string;
};

export type InventoryReservationStatus = "pending" | "confirmed" | "released";

export type InventoryReservation = {
  orderKey: string;
  channel: string;
  externalOrderId: string;
  orderLineKey: string;
  quantity: number;
  status: InventoryReservationStatus;
  createdAt: string;
  confirmedAt: string | null;
  releasedAt: string | null;
};

/**
 * 원장 상태. events만이 진실이며 onHand/reserved/safetyStock은
 * events를 재생한 결과의 캐시(materialized state)다.
 */
export type InventoryLedger = {
  sku: string;
  onHand: number;
  reserved: number;
  safetyStock: number;
  events: InventoryLedgerEvent[];
  reservations: InventoryReservation[];
  /** `${eventType}:${idempotencyKey}` -> eventType. 멱등 재적용 판별용. */
  seenKeys: Map<string, InventoryLedgerEventType>;
  /** orderKey -> 예약. confirm/cancel 조회용 인덱스. */
  reservationIndex: Map<string, InventoryReservation>;
};

export type InventoryLedgerSnapshot = {
  sku: string;
  onHand: number;
  reserved: number;
  safetyStock: number;
  available: number;
  eventCount: number;
  events: InventoryLedgerEvent[];
  reservations: InventoryReservation[];
};

export type InventoryLedgerEventInput =
  | {
      type: "RECEIPT";
      idempotencyKey: string;
      quantity: number;
      reason?: string;
      occurredAt?: string;
    }
  | {
      type: "SALE_PENDING";
      channel: string;
      externalOrderId: string;
      orderLineKey: string;
      quantity: number;
      occurredAt?: string;
    }
  | {
      type: "SALE_CONFIRMED";
      channel: string;
      externalOrderId: string;
      orderLineKey: string;
      quantity: number;
      occurredAt?: string;
    }
  | {
      type: "CANCEL_RELEASE";
      channel: string;
      externalOrderId: string;
      orderLineKey: string;
      quantity: number;
      occurredAt?: string;
    }
  | {
      type: "RETURN_RECEIVED";
      idempotencyKey: string;
      quantity: number;
      channel?: string;
      externalOrderId?: string;
      orderLineKey?: string;
      reason?: string;
      occurredAt?: string;
    }
  | {
      type: "ADJUSTMENT";
      newOnHand: number;
      idempotencyKey: string;
      reason: string;
      occurredAt?: string;
    }
  | {
      type: "SAFETY_STOCK_CHANGE";
      safetyStock: number;
      idempotencyKey: string;
      reason?: string;
      occurredAt?: string;
    };

export type LedgerApplyResult =
  | {
      ok: true;
      ledger: InventoryLedger;
      event: InventoryLedgerEvent;
      /** true면 멱등키 중복으로 아무 것도 적용하지 않은 재생(replay). */
      replayed: boolean;
      snapshot: InventoryLedgerSnapshot;
    }
  | {
      ok: false;
      code: InventoryLedgerErrorCode;
      message: string;
      ledger: InventoryLedger;
    };

type RawInventoryEvent = {
  type: InventoryLedgerEventType;
  idempotencyKey: string;
  quantity: number;
  orderKey: string | null;
  channel: string | null;
  reason: string;
  occurredAt: string;
};

type NormalizeOutcome =
  | { ok: true; raw: RawInventoryEvent }
  | { ok: false; result: LedgerApplyResult };

export type InventoryLedgerReplayResult =
  | { ok: true; ledger: InventoryLedger }
  | { ok: false; code: InventoryLedgerErrorCode; message: string; ledger: InventoryLedger };

function splitOrderKey(orderKey: string): {
  channel: string;
  externalOrderId: string;
  orderLineKey: string;
} {
  const first = orderKey.indexOf(":");
  const last = orderKey.lastIndexOf(":");
  return {
    channel: orderKey.slice(0, first),
    externalOrderId: orderKey.slice(first + 1, last),
    orderLineKey: orderKey.slice(last + 1),
  };
}

function fail(
  ledger: InventoryLedger,
  code: InventoryLedgerErrorCode,
  message: string,
): LedgerApplyResult {
  return { ok: false, code, message, ledger };
}

function nowIso(): string {
  return new Date().toISOString();
}

function validateSku(sku: unknown): string {
  if (typeof sku !== "string") throw new Error("INVENTORY_LEDGER_SKU_REQUIRED");
  const trimmed = sku.trim();
  if (!trimmed || trimmed.length > 240) throw new Error("INVENTORY_LEDGER_SKU_INVALID");
  return trimmed;
}

function validateIdempotencyKey(key: unknown): string {
  if (typeof key !== "string") return "";
  const trimmed = key.trim();
  if (trimmed.length < 8 || trimmed.length > 240) return "";
  return trimmed;
}

function isPositiveInteger(value: unknown, min = 1): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= MAX_INVENTORY_QUANTITY
  );
}

/** "채널 + 주문번호 + 주문라인" 멱등키. */
export function buildOrderKey(channel: string, externalOrderId: string, orderLineKey: string): string {
  return `${channel}:${externalOrderId}:${orderLineKey}`;
}

/** 빈 원장 생성. 실재고는 RECEIPT 이벤트로만 적재된다(순수 재생 유지). */
export function createInventoryLedger(sku: string): InventoryLedger {
  return {
    sku: validateSku(sku),
    onHand: 0,
    reserved: 0,
    safetyStock: 0,
    events: [],
    reservations: [],
    seenKeys: new Map(),
    reservationIndex: new Map(),
  };
}

/** 판매가능재고 = 실재고 - 예약재고 - 안전재고. 음수는 0으로 표시. */
export function availableStock(ledger: InventoryLedger): number {
  return Math.max(0, ledger.onHand - ledger.reserved - ledger.safetyStock);
}

export function inventoryLedgerSnapshot(ledger: InventoryLedger): InventoryLedgerSnapshot {
  return {
    sku: ledger.sku,
    onHand: ledger.onHand,
    reserved: ledger.reserved,
    safetyStock: ledger.safetyStock,
    available: availableStock(ledger),
    eventCount: ledger.events.length,
    events: [...ledger.events],
    reservations: [...ledger.reservations],
  };
}

export function cloneInventoryLedger(ledger: InventoryLedger): InventoryLedger {
  const cloned: InventoryLedger = {
    sku: ledger.sku,
    onHand: ledger.onHand,
    reserved: ledger.reserved,
    safetyStock: ledger.safetyStock,
    events: ledger.events.map((event) => ({ ...event })),
    reservations: ledger.reservations.map((reservation) => ({ ...reservation })),
    seenKeys: new Map(ledger.seenKeys),
    reservationIndex: new Map(ledger.reservationIndex),
  };
  return cloned;
}

/**
 * 원장 이벤트 목록을 처음부터 다시 재생해 상태를 도출한다.
 * 저장된 after/delta 필드는 무시하고 type/idempotencyKey/quantity만으로 재계산한다.
 * DB에서 읽어온 이벤트로 상태를 복원하거나 정합성 검증에 사용한다.
 */
export function replayInventoryLedger(
  sku: string,
  events: readonly InventoryLedgerEvent[],
): InventoryLedgerReplayResult {
  const ledger = createInventoryLedger(sku);
  for (const event of events) {
    const result = applyRawEvent(ledger, {
      type: event.type,
      idempotencyKey: event.idempotencyKey,
      quantity: event.quantity,
      orderKey: event.orderKey ?? null,
      channel: event.channel ?? null,
      reason: event.reason,
      occurredAt: event.occurredAt,
    });
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message, ledger };
    }
  }
  return { ok: true, ledger };
}

function normalizeInput(
  ledger: InventoryLedger,
  input: InventoryLedgerEventInput,
): NormalizeOutcome {
  switch (input.type) {
    case "RECEIPT": {
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
      if (!idempotencyKey) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_IDEMPOTENCY_KEY", "입고 멱등키는 8~240자여야 합니다."),
        };
      }
      if (!isPositiveInteger(input.quantity)) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_QUANTITY", `입고 수량은 1~${MAX_INVENTORY_QUANTITY} 정수여야 합니다.`),
        };
      }
      return {
        ok: true,
        raw: {
        type: "RECEIPT",
        idempotencyKey,
        quantity: input.quantity,
        orderKey: null,
        channel: null,
        reason: (input.reason ?? "입고").trim().slice(0, 2000),
        occurredAt: input.occurredAt ?? nowIso(),
        },
      };
    }
    case "SALE_PENDING":
    case "SALE_CONFIRMED":
    case "CANCEL_RELEASE": {
      const channel = typeof input.channel === "string" ? input.channel.trim().toLowerCase() : "";
      const externalOrderId =
        typeof input.externalOrderId === "string" ? input.externalOrderId.trim() : "";
      const orderLineKey =
        typeof input.orderLineKey === "string" ? input.orderLineKey.trim() : "";
      if (!(SUPPORTED_INVENTORY_CHANNELS as readonly string[]).includes(channel)) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_CHANNEL", `지원하지 않는 채널입니다: ${channel || "(빈 값)"}`),
        };
      }
      if (!externalOrderId || externalOrderId.length > 240) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_ORDER_REFERENCE", "주문번호는 1~240자여야 합니다."),
        };
      }
      if (!orderLineKey || orderLineKey.length > 240) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_ORDER_REFERENCE", "주문라인 키는 1~240자여야 합니다."),
        };
      }
      if (!isPositiveInteger(input.quantity)) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_QUANTITY", `주문 수량은 1~${MAX_INVENTORY_QUANTITY} 정수여야 합니다.`),
        };
      }
      const orderKey = buildOrderKey(channel, externalOrderId, orderLineKey);
      return {
        ok: true,
        raw: {
        type: input.type,
        idempotencyKey: orderKey,
        quantity: input.quantity,
        orderKey,
        channel,
        reason:
          input.type === "SALE_PENDING"
            ? "주문 접수 예약"
            : input.type === "SALE_CONFIRMED"
              ? "판매 확정"
              : "취소로 예약 해제",
        occurredAt: input.occurredAt ?? nowIso(),
        },
      };
    }
    case "RETURN_RECEIVED": {
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
      if (!idempotencyKey) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_IDEMPOTENCY_KEY", "반품 멱등키는 8~240자여야 합니다."),
        };
      }
      if (!isPositiveInteger(input.quantity)) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_QUANTITY", `반품 수량은 1~${MAX_INVENTORY_QUANTITY} 정수여야 합니다.`),
        };
      }
      const channel =
        typeof input.channel === "string" && input.channel.trim()
          ? input.channel.trim().toLowerCase()
          : null;
      const externalOrderId =
        typeof input.externalOrderId === "string" ? input.externalOrderId.trim() : "";
      const orderLineKey =
        typeof input.orderLineKey === "string" ? input.orderLineKey.trim() : "";
      let orderKey: string | null = null;
      if (channel && externalOrderId && orderLineKey) {
        if (!(SUPPORTED_INVENTORY_CHANNELS as readonly string[]).includes(channel)) {
          return {
            ok: false,
            result: fail(ledger, "INVALID_CHANNEL", `지원하지 않는 채널입니다: ${channel}`),
          };
        }
        if (externalOrderId.length > 240 || orderLineKey.length > 240) {
          return {
            ok: false,
            result: fail(ledger, "INVALID_ORDER_REFERENCE", "반품 주문 참조는 240자 이하여야 합니다."),
          };
        }
        orderKey = buildOrderKey(channel, externalOrderId, orderLineKey);
      }
      return {
        ok: true,
        raw: {
        type: "RETURN_RECEIVED",
        idempotencyKey,
        quantity: input.quantity,
        orderKey,
        channel,
        reason: (input.reason ?? "검수 후 반품 재입고").trim().slice(0, 2000),
        occurredAt: input.occurredAt ?? nowIso(),
        },
      };
    }
    case "ADJUSTMENT": {
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
      if (!idempotencyKey) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_IDEMPOTENCY_KEY", "실사 보정 멱등키는 8~240자여야 합니다."),
        };
      }
      if (!isPositiveInteger(input.newOnHand, 0)) {
        return {
          ok: false,
          result: fail(
            ledger,
            "INVALID_QUANTITY",
            `보정 실재고는 0~${MAX_INVENTORY_QUANTITY} 정수여야 합니다.`,
          ),
        };
      }
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!reason || reason.length > 2000) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_REASON", "실사 보정 사유는 1~2000자여야 합니다."),
        };
      }
      return {
        ok: true,
        raw: {
        type: "ADJUSTMENT",
        idempotencyKey,
        quantity: input.newOnHand,
        orderKey: null,
        channel: null,
        reason,
        occurredAt: input.occurredAt ?? nowIso(),
        },
      };
    }
    case "SAFETY_STOCK_CHANGE": {
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
      if (!idempotencyKey) {
        return {
          ok: false,
          result: fail(ledger, "INVALID_IDEMPOTENCY_KEY", "안전재고 변경 멱등키는 8~240자여야 합니다."),
        };
      }
      if (!isPositiveInteger(input.safetyStock, 0)) {
        return {
          ok: false,
          result: fail(
            ledger,
            "INVALID_QUANTITY",
            `안전재고는 0~${MAX_INVENTORY_QUANTITY} 정수여야 합니다.`,
          ),
        };
      }
      return {
        ok: true,
        raw: {
        type: "SAFETY_STOCK_CHANGE",
        idempotencyKey,
        quantity: input.safetyStock,
        orderKey: null,
        channel: null,
        reason: (input.reason ?? "안전재고 변경").trim().slice(0, 2000),
        occurredAt: input.occurredAt ?? nowIso(),
        },
      };
    }
  }
}

/**
 * 이벤트 한 건을 원자적으로 적용한다.
 * - 멱등키 중복이면 상태 변경 없이 기존 이벤트를 돌려준다(replayed=true).
 * - 검증 실패 시 상태를 전혀 변경하지 않는다.
 */
export function applyInventoryLedgerEvent(
  ledger: InventoryLedger,
  input: InventoryLedgerEventInput,
): LedgerApplyResult {
  const normalized = normalizeInput(ledger, input);
  if (!normalized.ok) {
    return normalized.result;
  }
  return applyRawEvent(ledger, normalized.raw);
}

function applyRawEvent(ledger: InventoryLedger, raw: RawInventoryEvent): LedgerApplyResult {
  const seenKey = `${raw.type}:${raw.idempotencyKey}`;
  const seenType = ledger.seenKeys.get(seenKey);
  if (seenType !== undefined) {
    const event = ledger.events.find(
      (candidate) =>
        candidate.type === raw.type && candidate.idempotencyKey === raw.idempotencyKey,
    );
    if (!event) {
      return fail(ledger, "RESERVATION_NOT_FOUND", "원장 인덱스와 이벤트 기록이 불일치합니다.");
    }
    return { ok: true, ledger, event, replayed: true, snapshot: inventoryLedgerSnapshot(ledger) };
  }

  const onHandBefore = ledger.onHand;
  const reservedBefore = ledger.reserved;
  const safetyBefore = ledger.safetyStock;
  let onHandDelta = 0;
  let reservedDelta = 0;
  let safetyStockDelta = 0;
  let reservation: InventoryReservation | null = null;

  switch (raw.type) {
    case "RECEIPT":
      onHandDelta = raw.quantity;
      break;

    case "SALE_PENDING": {
      if (availableStock(ledger) < raw.quantity) {
        return fail(
          ledger,
          "INSUFFICIENT_STOCK",
          `판매가능재고 ${availableStock(ledger)}개로 ${raw.quantity}개를 예약할 수 없습니다.`,
        );
      }
      reservedDelta = raw.quantity;
      reservation = {
        ...splitOrderKey(raw.orderKey as string),
        orderKey: raw.orderKey as string,
        quantity: raw.quantity,
        status: "pending",
        createdAt: raw.occurredAt,
        confirmedAt: null,
        releasedAt: null,
      };
      break;
    }

    case "SALE_CONFIRMED": {
      const existing = ledger.reservationIndex.get(raw.orderKey as string);
      if (!existing) {
        return fail(ledger, "RESERVATION_NOT_FOUND", "확정할 예약이 없습니다.");
      }
      if (existing.status !== "pending") {
        return fail(ledger, "RESERVATION_NOT_PENDING", "대기 상태 예약만 확정할 수 있습니다.");
      }
      if (existing.quantity !== raw.quantity) {
        return fail(
          ledger,
          "RESERVATION_QUANTITY_MISMATCH",
          `확정 수량 ${raw.quantity}개가 예약 수량 ${existing.quantity}개와 다릅니다.`,
        );
      }
      onHandDelta = -raw.quantity;
      reservedDelta = -raw.quantity;
      break;
    }

    case "CANCEL_RELEASE": {
      const existing = ledger.reservationIndex.get(raw.orderKey as string);
      if (!existing) {
        return fail(ledger, "RESERVATION_NOT_FOUND", "해제할 예약이 없습니다.");
      }
      if (existing.status !== "pending") {
        return fail(ledger, "RESERVATION_NOT_PENDING", "대기 상태 예약만 해제할 수 있습니다.");
      }
      if (existing.quantity !== raw.quantity) {
        return fail(
          ledger,
          "RESERVATION_QUANTITY_MISMATCH",
          `해제 수량 ${raw.quantity}개가 예약 수량 ${existing.quantity}개와 다릅니다.`,
        );
      }
      reservedDelta = -raw.quantity;
      break;
    }

    case "RETURN_RECEIVED":
      onHandDelta = raw.quantity;
      break;

    case "ADJUSTMENT": {
      if (raw.quantity < ledger.reserved) {
        return fail(
          ledger,
          "ADJUSTMENT_BELOW_RESERVED",
          `보정 실재고 ${raw.quantity}개는 예약재고 ${ledger.reserved}개보다 작을 수 없습니다.`,
        );
      }
      onHandDelta = raw.quantity - ledger.onHand;
      break;
    }

    case "SAFETY_STOCK_CHANGE":
      safetyStockDelta = raw.quantity - ledger.safetyStock;
      break;
  }

  const onHandAfter = onHandBefore + onHandDelta;
  const reservedAfter = reservedBefore + reservedDelta;
  const safetyStockAfter = safetyBefore + safetyStockDelta;
  const availableAfter = Math.max(0, onHandAfter - reservedAfter - safetyStockAfter);

  // 원장 불변식: 예약은 실재고를 넘을 수 없고, 모든 재고는 음수 불가.
  if (
    onHandAfter < 0 ||
    reservedAfter < 0 ||
    safetyStockAfter < 0 ||
    reservedAfter > onHandAfter ||
    availableAfter < 0
  ) {
    return fail(ledger, "INVALID_QUANTITY", "적용 결과가 재고 불변식(음수 불가)을 위반합니다.");
  }

  const sequence = ledger.events.length + 1;
  const event: InventoryLedgerEvent = {
    sequence,
    type: raw.type,
    idempotencyKey: raw.idempotencyKey,
    quantity: raw.quantity,
    orderKey: raw.orderKey,
    channel: raw.channel,
    onHandDelta,
    reservedDelta,
    safetyStockDelta,
    onHandAfter,
    reservedAfter,
    safetyStockAfter,
    availableAfter,
    reason: raw.reason,
    occurredAt: raw.occurredAt,
  };

  ledger.events.push(event);
  ledger.seenKeys.set(seenKey, raw.type);
  ledger.onHand = onHandAfter;
  ledger.reserved = reservedAfter;
  ledger.safetyStock = safetyStockAfter;

  if (reservation) {
    ledger.reservations.push(reservation);
    ledger.reservationIndex.set(reservation.orderKey, reservation);
  } else if (raw.type === "SALE_CONFIRMED" || raw.type === "CANCEL_RELEASE") {
    const existing = ledger.reservationIndex.get(raw.orderKey as string) as InventoryReservation;
    if (raw.type === "SALE_CONFIRMED") {
      existing.status = "confirmed";
      existing.confirmedAt = raw.occurredAt;
    } else {
      existing.status = "released";
      existing.releasedAt = raw.occurredAt;
    }
  }

  return { ok: true, ledger, event, replayed: false, snapshot: inventoryLedgerSnapshot(ledger) };
}

/* 편의 래퍼: SQL 마이그레이션의 RPC 이름과 1:1 대응 */

export function receiveStock(
  ledger: InventoryLedger,
  args: { idempotencyKey: string; quantity: number; reason?: string; occurredAt?: string },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "RECEIPT", ...args });
}

export function reserveStock(
  ledger: InventoryLedger,
  args: {
    channel: string;
    externalOrderId: string;
    orderLineKey: string;
    quantity: number;
    occurredAt?: string;
  },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "SALE_PENDING", ...args });
}

export function confirmSale(
  ledger: InventoryLedger,
  args: {
    channel: string;
    externalOrderId: string;
    orderLineKey: string;
    quantity: number;
    occurredAt?: string;
  },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "SALE_CONFIRMED", ...args });
}

export function cancelRelease(
  ledger: InventoryLedger,
  args: {
    channel: string;
    externalOrderId: string;
    orderLineKey: string;
    quantity: number;
    occurredAt?: string;
  },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "CANCEL_RELEASE", ...args });
}

export function receiveReturn(
  ledger: InventoryLedger,
  args: {
    idempotencyKey: string;
    quantity: number;
    channel?: string;
    externalOrderId?: string;
    orderLineKey?: string;
    reason?: string;
    occurredAt?: string;
  },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "RETURN_RECEIVED", ...args });
}

export function adjustOnHand(
  ledger: InventoryLedger,
  args: { newOnHand: number; idempotencyKey: string; reason: string; occurredAt?: string },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "ADJUSTMENT", ...args });
}

export function setSafetyStock(
  ledger: InventoryLedger,
  args: { safetyStock: number; idempotencyKey: string; reason?: string; occurredAt?: string },
): LedgerApplyResult {
  return applyInventoryLedgerEvent(ledger, { type: "SAFETY_STOCK_CHANGE", ...args });
}
