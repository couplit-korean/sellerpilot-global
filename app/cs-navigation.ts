import { activeChannelKeys, type ActiveChannelKey } from "../lib/channels/catalog";

export const csStatusFilters = [
  "all",
  "open",
  "waiting",
  "in_progress",
  "resolved",
  "urgent",
  "reconciliation",
] as const;

export type CsStatusFilter = (typeof csStatusFilters)[number];
export type CsChannelFilter = ActiveChannelKey | "all";

export function csChannelFilterFromValue(value: unknown): CsChannelFilter {
  return typeof value === "string" && activeChannelKeys.includes(value as ActiveChannelKey)
    ? value as ActiveChannelKey
    : "all";
}

export function csStatusFilterFromValue(value: unknown): CsStatusFilter {
  return typeof value === "string" && (csStatusFilters as readonly string[]).includes(value)
    ? value as CsStatusFilter
    : "open";
}

export function csTicketMatchesFilter(ticket: {
  status: "긴급" | "답변 대기" | "처리 중" | "처리 완료";
  replyDeliveryStatus: string | null;
}, filter: CsStatusFilter) {
  if (filter === "all") return true;
  if (filter === "open") return ticket.status !== "처리 완료";
  if (filter === "waiting") return ticket.status === "긴급" || ticket.status === "답변 대기";
  if (filter === "in_progress") return ticket.status === "처리 중";
  if (filter === "resolved") return ticket.status === "처리 완료";
  if (filter === "urgent") return ticket.status === "긴급";
  return ticket.replyDeliveryStatus === "reconciliation_required";
}

export function csNavigationParams(input: {
  channel?: CsChannelFilter;
  status?: CsStatusFilter;
  ticketId?: string | null;
}) {
  const params = new URLSearchParams({ view: "cs" });
  const channel = csChannelFilterFromValue(input.channel);
  const status = csStatusFilterFromValue(input.status);
  const ticketId = input.ticketId?.trim() ?? "";
  if (channel !== "all") params.set("channel", channel);
  if (status !== "open") params.set("status", status);
  if (ticketId) params.set("ticketId", ticketId);
  return params;
}
