"use client";
import Link from "next/link";
import styles from "./desk.module.css";
import { useCallback, useMemo, useState } from "react";
import { authenticatedFetch } from "../../lib/authenticated-fetch";
import { type CsChannelFilter, type CsStatusFilter, csNavigationParams } from "../cs-navigation";
import { displayCsTickets } from "./display-tickets";
import { CsPage } from "./workspace";
import { useCsWorkspace } from "./use-workspace";
import { activeChannelKeys } from "../../lib/channels/catalog";
import { channels } from "../channel-config";

export function CsStandaloneWorkspace(initial: { initialChannel: CsChannelFilter; initialStatus: CsStatusFilter; initialTicketId: string | null }) {
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState<CsChannelFilter>(initial.initialChannel);
  const [status, setStatus] = useState<CsStatusFilter>(initial.initialStatus);
  const [ticketId, setTicketId] = useState<string | null>(initial.initialTicketId);
  const notify = useCallback((message: string) => setNotice(message), []);
  const cs = useCsWorkspace({ authenticatedFetch, notify, active: true });
  const tickets = useMemo(() => displayCsTickets(cs.snapshot), [cs.snapshot]);
  const onFilterChange = useCallback((nextChannel: CsChannelFilter, nextStatus: CsStatusFilter, nextTicketId?: string | null) => {
    setChannel(nextChannel);
    setStatus(nextStatus);
    setTicketId(nextTicketId ?? null);
    const params = csNavigationParams({ channel: nextChannel, status: nextStatus, ticketId: nextTicketId });
    params.delete("view");
    window.history.replaceState(window.history.state, "", `/cs${params.size ? `?${params}` : ""}`);
  }, []);
  const openChannel = (nextChannel: CsChannelFilter) => onFilterChange(nextChannel, "open", null);
  return <div className={styles.shell}>
    <header className={styles.top}>
      <div>
        <h1>고객 문의</h1>
        <p>판매채널을 고르고, 그 채널 문의만 응대합니다.</p>
      </div>
      <Link href="/?view=products" prefetch={false}>상품 관리</Link>
    </header>
    {notice ? <div role="status" className={styles.notice}>{notice}<button type="button" onClick={() => setNotice("")}>닫기</button></div> : null}
    {cs.error ? <div role="alert" className={styles.error}><h2>문의 연결 확인이 필요합니다</h2><p>{cs.error}</p><div><button type="button" onClick={() => void cs.reload()}>다시 불러오기</button> <Link href="/" prefetch={false}>로그인 확인</Link></div></div> : null}
    {cs.loading && !cs.snapshot ? <p className={styles.main}>문의 데이터를 불러오고 있습니다.</p> : null}
    {cs.snapshot ? <div className={styles.body}>
      <nav className={styles.rail} aria-label="판매채널">
        {activeChannelKeys.map((channelKey) => {
          const openCount = tickets.filter((ticket) => ticket.channelKey === channelKey && ticket.status !== "처리 완료").length;
          return <button type="button" key={channelKey} className={channel === channelKey ? "active" : undefined}
            onClick={() => openChannel(channelKey)}>
            <span>
              <b>{channels[channelKey].name}</b>
              <small>{channels[channelKey].market}</small>
            </span>
            <em className={styles.count}>{openCount}</em>
          </button>;
        })}
      </nav>
      <div className={styles.main}>
        {channel === "all" ? <div>
          <div className={styles.toolbar}><div><h2>채널 선택</h2><p>한 채널씩 문의에 답합니다.</p></div></div>
          <div className={styles.pick}>
            {activeChannelKeys.map((channelKey) => {
              const openCount = tickets.filter((ticket) => ticket.channelKey === channelKey && ticket.status !== "처리 완료").length;
              return <button type="button" key={channelKey} onClick={() => openChannel(channelKey)}>
                <strong>{channels[channelKey].name}</strong>
                <span>{openCount}건 미처리 · {channels[channelKey].market}</span>
              </button>;
            })}
          </div>
        </div> : <CsPage initialChannel={channel} initialStatus={status} initialTicketId={ticketId} authenticatedFetch={authenticatedFetch} notify={notify} displayTickets={tickets}
          onSend={cs.saveTicketReply} onDeliveryStatus={cs.getTicketDeliveryStatus} onDraft={cs.generateSupportReply} onStatus={cs.updateTicketStatus}
          onSync={cs.syncCsInquiries} onBackfill={(channel, endDate) => cs.syncCsInquiries(false, 30, channel, endDate)}
          syncing={cs.syncingCsInquiries} syncStatus={cs.snapshot.syncStatus} historyBackfill={cs.inquiryHistoryBackfill}
          snapshotGeneratedAt={cs.snapshot.generatedAt} onFilterChange={onFilterChange} />}
      </div>
    </div> : null}
  </div>;
}
