"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { SalesAnalytics, SalesRange } from "../use-operations-snapshot";
import { formatCompactWon } from "./format-compact-won";
import {
  buildRevenueCalendarPages,
  initialRevenueCalendarPageIndex,
  localTodayIso,
  shiftRevenueCalendarRange,
} from "./revenue-calendar-navigation";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

type RevenueCalendarProps = {
  days: SalesAnalytics["daily"];
  range: SalesRange;
  onRangeChange: (range: SalesRange) => void;
};

export function RevenueCalendar(props: RevenueCalendarProps) {
  const rangeKey = `${props.range.preset}:${props.range.from}:${props.range.to}`;
  return <RevenueCalendarViewport key={rangeKey} {...props} />;
}

function RevenueCalendarViewport({ days, range, onRangeChange }: RevenueCalendarProps) {
  const today = localTodayIso();
  const pages = useMemo(() => buildRevenueCalendarPages(days, range), [days, range]);
  const [pageIndex, setPageIndex] = useState(() => initialRevenueCalendarPageIndex(pages, today));
  const safePageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[safePageIndex] ?? null;
  const previousRange = pages.length <= 1 ? shiftRevenueCalendarRange(range, -1, today) : null;
  const nextRange = pages.length <= 1 ? shiftRevenueCalendarRange(range, 1, today) : null;
  const canMovePrevious = safePageIndex > 0 || previousRange !== null;
  const canMoveNext = safePageIndex < pages.length - 1 || nextRange !== null;
  const calendarOffset = page?.cells.length
    ? new Date(`${page.cells[0].date}T12:00:00`).getDay()
    : 0;

  return (
    <section className="panel sales-calendar-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">국내 · 해외 · 채널 통합</span>
          <h3>날짜별 실매출 달력</h3>
        </div>
        <div className="sales-calendar-meta">
          <div className="sales-calendar-pager">
            <button type="button" aria-label="이전 매출 기간" disabled={!canMovePrevious} onClick={() => {
              if (safePageIndex > 0) setPageIndex((current) => Math.max(0, current - 1));
              else if (previousRange) onRangeChange(previousRange);
            }}><ChevronLeft size={15} /></button>
            <span><b>{page?.label ?? "조회 기간 없음"}</b><small>{page?.rangeLabel ?? `${range.from} — ${range.to}`}</small></span>
            <button type="button" aria-label="다음 매출 기간" disabled={!canMoveNext} onClick={() => {
              if (safePageIndex < pages.length - 1) setPageIndex((current) => Math.min(pages.length - 1, current + 1));
              else if (nextRange) onRangeChange(nextRange);
            }}><ChevronRight size={15} /></button>
          </div>
          <div className="sales-calendar-legend" aria-label="매출 구분">
            <span className="domestic">국내 매출</span>
            <span className="overseas">해외 매출</span>
          </div>
        </div>
      </div>
      <div className="sales-calendar-scroll" role="region" aria-label="요일과 날짜별 실매출 달력">
        <div className="sales-calendar-weekdays">
          {weekdays.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="sales-calendar-grid">
          {Array.from({ length: calendarOffset }, (_, index) => (
            <span className="calendar-blank" key={`blank-${index}`} />
          ))}
          {page?.cells.map(({ date, value }) => (
            <article
              className={`${date === today ? "today" : ""} ${value ? "" : "empty"}`.trim()}
              key={date}
              aria-current={date === today ? "date" : undefined}
              aria-label={value ? `${date} 총매출 ${formatCompactWon(value.revenueKrw)}, 국내 ${formatCompactWon(value.domesticRevenueKrw)}, 해외 ${formatCompactWon(value.overseasRevenueKrw)}` : `${date} 매출 집계 없음`}
            >
              <time dateTime={date}>{Number(date.slice(8, 10))}{date === today ? <span className="sr-only">오늘</span> : null}</time>
              <b className="sales-calendar-total">{value ? formatCompactWon(value.revenueKrw) : "—"}</b>
              <div className="sales-calendar-breakdown">
                <small className="domestic"><span>국내</span><em>{value ? formatCompactWon(value.domesticRevenueKrw) : "—"}</em></small>
                <small className="overseas"><span>해외</span><em>{value ? formatCompactWon(value.overseasRevenueKrw) : "—"}</em></small>
              </div>
            </article>
          )) ?? null}
        </div>
      </div>
    </section>
  );
}
