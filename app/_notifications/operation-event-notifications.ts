export type OperationEventSnapshot = {
  orders: Array<{ id: string; externalOrderId: string; channelKey: string; status: string }>;
  syncStatus: Array<{ channel_key: string; data_type: string; status: string }>;
};

export type OperationEventState = {
  orders: Map<string, string>;
  sync: Map<string, string>;
};

const orderStatusLabels: Record<string, string> = {
  paid: "결제 완료",
  ready_to_ship: "출고 대기",
  shipped: "배송 중",
  delivered: "배송 완료",
  cancelled: "주문 취소",
  refunded: "환불 완료",
};

const syncStatusLabels: Record<string, string> = {
  queued: "동기화 대기",
  running: "동기화 중",
  passed: "동기화 완료",
  failed: "동기화 오류",
  unsupported: "API 미지원",
};

export function operationEventState(snapshot: OperationEventSnapshot): OperationEventState {
  return {
    orders: new Map(snapshot.orders.map((order) => [order.id, order.status])),
    sync: new Map(snapshot.syncStatus.map((item) => [`${item.channel_key}:${item.data_type}`, item.status])),
  };
}

export function operationEventNotifications(previous: OperationEventState | null, snapshot: OperationEventSnapshot) {
  if (!previous) return [];
  const messages: string[] = [];
  for (const order of snapshot.orders) {
    const oldStatus = previous.orders.get(order.id);
    if (oldStatus === order.status) continue;
    const prefix = oldStatus === undefined ? "새 주문" : "주문 상태 변경";
    messages.push(`${prefix}: ${order.channelKey} ${order.externalOrderId} · ${orderStatusLabels[order.status] ?? order.status}`);
  }
  for (const item of snapshot.syncStatus) {
    const key = `${item.channel_key}:${item.data_type}`;
    const oldStatus = previous.sync.get(key);
    if (oldStatus === undefined || oldStatus === item.status) continue;
    messages.push(`${item.channel_key} ${"주문"} ${syncStatusLabels[item.status] ?? item.status}`);
  }
  return messages;
}
