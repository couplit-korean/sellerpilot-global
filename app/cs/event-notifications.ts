export type CsEventSnapshot = {
  tickets: Array<{ id: string; externalTicketId: string; channelKey: string; status: string }>;
  syncStatus: Array<{ channel_key: string; data_type: string; status: string }>;
};

export type CsEventState = {
  tickets: Map<string, string>;
  sync: Map<string, string>;
};

const ticketStatusLabels: Record<string, string> = {
  urgent: "긴급 문의",
  waiting: "답변 대기",
  in_progress: "처리 중",
  resolved: "처리 완료",
};

const syncStatusLabels: Record<string, string> = {
  queued: "동기화 대기",
  running: "동기화 중",
  passed: "동기화 완료",
  failed: "동기화 오류",
  unsupported: "API 미지원",
};

export function csEventState(snapshot: CsEventSnapshot): CsEventState {
  return {
    tickets: new Map(snapshot.tickets.map((ticket) => [ticket.id, ticket.status])),
    sync: new Map(snapshot.syncStatus.map((item) => [`${item.channel_key}:${item.data_type}`, item.status])),
  };
}

export function csEventNotifications(previous: CsEventState | null, snapshot: CsEventSnapshot) {
  if (!previous) return [];
  const messages: string[] = [];
  for (const ticket of snapshot.tickets) {
    const oldStatus = previous.tickets.get(ticket.id);
    if (oldStatus === ticket.status) continue;
    const prefix = oldStatus === undefined ? "새 CS" : "CS 상태 변경";
    messages.push(`${prefix}: ${ticket.channelKey} ${ticket.externalTicketId} · ${ticketStatusLabels[ticket.status] ?? ticket.status}`);
  }
  for (const item of snapshot.syncStatus) {
    const key = `${item.channel_key}:${item.data_type}`;
    const oldStatus = previous.sync.get(key);
    if (oldStatus === undefined || oldStatus === item.status) continue;
    messages.push(`${item.channel_key} ${"CS"} ${syncStatusLabels[item.status] ?? item.status}`);
  }
  return messages;
}
