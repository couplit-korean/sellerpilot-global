"use client";
import styles from "./desk.module.css";
import { activeChannelKeys } from "../../lib/channels/catalog";
import { channels } from "../channel-config";
import { type CsChannelFilter, type CsStatusFilter } from "../cs-navigation";
import { CsPage } from "./workspace";
import type { DisplayTicket, InquiryHistoryBackfill, OperationTicketDelivery, ReplyQueueResult, SupportLocale, CsSyncStatus } from "./workspace-contracts";

export function CsInAppDesk(props: {
  notify: (message: string) => void;
  displayTickets: DisplayTicket[];
  onSend: (ticket: DisplayTicket, reply: string) => Promise<ReplyQueueResult | null>;
  onDeliveryStatus: (ticketId: string, jobId: string) => Promise<OperationTicketDelivery | null>;
  onDraft: (ticket: DisplayTicket, targetLocale: SupportLocale) => Promise<string | null>;
  onStatus: (ticket: DisplayTicket, status: "waiting" | "in_progress" | "resolved") => Promise<boolean>;
  onSync: () => Promise<void>;
  onBackfill: (channel: "coupang" | "elevenst" | "smartstore", endDate?: string) => Promise<void>;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  syncing: boolean;
  syncStatus: CsSyncStatus;
  historyBackfill: InquiryHistoryBackfill | null;
  snapshotGeneratedAt: string | null;
  initialQuery?: string;
  initialTicketId?: string | null;
  initialChannel?: CsChannelFilter;
  initialStatus?: CsStatusFilter;
  onFilterChange: (channel: CsChannelFilter, status: CsStatusFilter, ticketId?: string | null) => void;
}) {
  const channel = props.initialChannel ?? "all";
  const openChannel = (next: CsChannelFilter) => props.onFilterChange(next, "open", null);
  return <div className={styles.inApp}>
    <nav className={styles.rail} aria-label="판매채널">
      {activeChannelKeys.map((channelKey) => {
        const openCount = props.displayTickets.filter((ticket) => ticket.channelKey === channelKey && ticket.status !== "처리 완료").length;
        return <button type="button" key={channelKey} className={channel === channelKey ? "active" : undefined} onClick={() => openChannel(channelKey)}>
          <span>
            <b>{channels[channelKey].name}</b>
            <small>{channels[channelKey].market}</small>
          </span>
          <em className={styles.count}>{openCount}</em>
        </button>;
      })}
    </nav>
    <div className={styles.embed}>
      {channel === "all" ? <div>
        <div className={styles.toolbar}><div><h2>채널 선택</h2><p>한 채널씩 문의에 답합니다. 저장된 대화가 있으면 해당 채널에 표시됩니다.</p></div></div>
        <div className={styles.pick}>
          {activeChannelKeys.map((channelKey) => {
            const openCount = props.displayTickets.filter((ticket) => ticket.channelKey === channelKey && ticket.status !== "처리 완료").length;
            return <button type="button" key={channelKey} onClick={() => openChannel(channelKey)}>
              <strong>{channels[channelKey].name}</strong>
              <span>{openCount}건 미처리 · {channels[channelKey].market}</span>
              <small>{csChannelDeskHint(channelKey)}</small>
            </button>;
          })}
        </div>
      </div> : <CsPage {...props} initialChannel={channel} />}
    </div>
  </div>;
}
