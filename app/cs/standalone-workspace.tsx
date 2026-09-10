"use client";
import Link from "next/link";
import styles from "./standalone-workspace.module.css";
import { useCallback, useMemo, useState } from "react";
import { authenticatedFetch } from "../../lib/authenticated-fetch";
import { type CsChannelFilter, type CsStatusFilter, csNavigationParams } from "../cs-navigation";
import { displayCsTickets } from "./display-tickets";
import { CsPage } from "./workspace";
import { useCsWorkspace } from "./use-workspace";

export function CsStandaloneWorkspace(initial: { initialChannel: CsChannelFilter; initialStatus: CsStatusFilter; initialTicketId: string | null }) {
  const [notice, setNotice] = useState("");
  const notify = useCallback((message: string) => setNotice(message), []);
  const cs = useCsWorkspace({ authenticatedFetch, notify, active: true });
  const tickets = useMemo(() => displayCsTickets(cs.snapshot), [cs.snapshot]);
  const onFilterChange = useCallback((channel: CsChannelFilter, status: CsStatusFilter, ticketId?: string | null) => {
    const params = csNavigationParams({ channel, status, ticketId });
    params.delete("view");
    window.history.replaceState(window.history.state, "", `/cs${params.size ? `?${params}` : ""}`);
  }, []);
  return <main className={styles.workspace}>
    <header className={styles.header}><div><h1>고객 문의</h1><p>채널별 문의 이력과 답변을 관리합니다.</p></div><Link href="/?view=products" prefetch={false}>상품 관리</Link></header>
    {notice && <div role="status" className={styles.notice}>{notice}<button type="button" onClick={() => setNotice("")}>알림 닫기</button></div>}
    {cs.loading && !cs.snapshot ? <p role="status" className={styles.status}>문의 데이터를 불러오고 있습니다.</p> : null}
    {cs.error && <div role="alert" className={styles.status}><h2>문의 연결 확인이 필요합니다</h2><p>{cs.error}</p><div className={styles.actions}><button type="button" onClick={() => void cs.reload()}>다시 불러오기</button> <Link href="/" prefetch={false}>로그인 확인</Link></div></div>}
    {cs.snapshot && <CsPage {...initial} authenticatedFetch={authenticatedFetch} notify={notify} displayTickets={tickets}
      onSend={cs.saveTicketReply} onDeliveryStatus={cs.getTicketDeliveryStatus} onDraft={cs.generateSupportReply} onStatus={cs.updateTicketStatus}
      onSync={cs.syncCsInquiries} onBackfill={(channel, endDate) => cs.syncCsInquiries(false, 30, channel, endDate)}
      syncing={cs.syncingCsInquiries} syncStatus={cs.snapshot.syncStatus} historyBackfill={cs.inquiryHistoryBackfill}
      snapshotGeneratedAt={cs.snapshot.generatedAt} onFilterChange={onFilterChange} />}
  </main>;
}
