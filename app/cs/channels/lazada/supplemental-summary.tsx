import type {
  LazadaSupplementalReadResponse,
  LazadaSupplementalStoredEvent,
} from "../../../../lib/cs/channels/lazada/supplemental-contract";

const surfaceLabels = {
  product_review: "상품 리뷰",
  reverse_order_after_sales: "반품·환불·취소 사후지원",
} as const;

function formatTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function lazadaSupplementalEventRowKey(event: LazadaSupplementalStoredEvent) {
  return `${event.credentialId}:${event.country}:${event.surface}:${event.resourceKey}:${event.eventKey}`;
}

function EventRow({ event }: { event: LazadaSupplementalStoredEvent }) {
  return <li>
    <strong>{surfaceLabels[event.surface]} · {event.title}</strong>
    <span>{event.country} · {event.status} · {formatTime(event.occurredAt)}</span>
    <p>{event.body ?? "본문 없음"}</p>
    <small>항목 {event.resourceKey} · 주문 {event.externalOrderId ?? "미제공"} · 상품 {event.externalItemId ?? "미제공"}</small>
  </li>;
}

export function LazadaSupplementalReadSummary({ state }: { state: LazadaSupplementalReadResponse }) {
  return <>
    <p role="status">저장된 읽기 이력만 표시합니다. 이 화면을 열어도 Lazada 호출이나 주문·환불 변경이 실행되지 않습니다.</p>
    <div>
      {state.capabilities.map((capability) => <article key={capability.surface}>
        <header><strong>{surfaceLabels[capability.surface]}</strong><span>{capability.state === "permission_pending" ? "권한 확인 필요" : "조건부 읽기"}</span></header>
        <dl>
          <div><dt>저장 처리</dt><dd>준비됨</dd></div>
          <div><dt>Lazada 접근 권한</dt><dd>미확인</dd></div>
          <div><dt>자동 수집</dt><dd>비활성</dd></div>
          <div><dt>답글·상태 변경</dt><dd>비활성</dd></div>
        </dl>
        <p>{capability.message}</p>
      </article>)}
    </div>
    <ul>{state.events.map((event) => <EventRow key={lazadaSupplementalEventRowKey(event)} event={event} />)}</ul>
    {state.events.length === 0 ? <p>저장된 리뷰·사후지원 읽기 이력이 없습니다. 이것은 원격 0건 확인을 의미하지 않습니다.</p> : null}
  </>;
}
