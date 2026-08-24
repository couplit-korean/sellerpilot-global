import type { SalesAnalytics, SalesRange } from "../use-operations-snapshot";
import { formatCompactWon } from "./format-compact-won";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

type RevenueCalendarProps = {
  days: SalesAnalytics["daily"];
  range: Pick<SalesRange, "from" | "to">;
};

export function RevenueCalendar({ days, range }: RevenueCalendarProps) {
  const calendarOffset = days.length
    ? new Date(`${days[0].date.slice(0, 10)}T12:00:00`).getDay()
    : 0;

  return (
    <section className="panel sales-calendar-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">국내 · 해외 · 채널 통합</span>
          <h3>날짜별 실매출 달력</h3>
        </div>
        <div className="sales-calendar-meta">
          <small>{range.from} — {range.to}</small>
          <div className="sales-calendar-legend" aria-label="매출 구분">
            <span className="domestic">국내 매출</span>
            <span className="overseas">해외 매출</span>
          </div>
        </div>
      </div>
      <div className="sales-calendar-weekdays">
        {weekdays.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="sales-calendar-grid">
        {Array.from({ length: calendarOffset }, (_, index) => (
          <span className="calendar-blank" key={`blank-${index}`} />
        ))}
        {days.map((day) => (
          <article
            key={day.date}
            aria-label={`${day.date} 총매출 ${formatCompactWon(day.revenueKrw)}, 국내 ${formatCompactWon(day.domesticRevenueKrw)}, 해외 ${formatCompactWon(day.overseasRevenueKrw)}`}
          >
            <time dateTime={day.date}>{Number(day.date.slice(8, 10))}</time>
            <b className="sales-calendar-total">{formatCompactWon(day.revenueKrw)}</b>
            <div className="sales-calendar-breakdown">
              <small className="domestic"><span>국내</span><em>{formatCompactWon(day.domesticRevenueKrw)}</em></small>
              <small className="overseas"><span>해외</span><em>{formatCompactWon(day.overseasRevenueKrw)}</em></small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
