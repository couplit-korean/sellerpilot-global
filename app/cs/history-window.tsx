"use client";

import { useState } from "react";

export function CsHistoryWindow({ onBackfill, disabled }: {
  onBackfill: (channel: "coupang" | "smartstore", endDate?: string) => Promise<void>;
  disabled: boolean;
}) {
  const [today] = useState(() => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(today);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && endDate >= "2000-01-30" && endDate <= today
    && Number.isFinite(Date.parse(`${endDate}T00:00:00Z`))
    && new Date(`${endDate}T00:00:00Z`).toISOString().slice(0, 10) === endDate;
  const startDate = valid ? new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10) : "";
  return <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={disabled}>
    <legend className="sr-only">이전 기간의 문의 가져오기</legend>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label>이력 종료일 <input aria-label="과거 문의 종료일" type="date" min="2000-01-30" max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} onInput={(event) => setEndDate(event.currentTarget.value)} /></label>
      <button className="filter-button" type="button" disabled={!valid} onClick={() => void onBackfill("smartstore", endDate)}>스마트스토어 30일</button>
      <button className="filter-button" type="button" disabled={!valid} onClick={() => void onBackfill("coupang", endDate)}>쿠팡 30일</button>
    </div>
    <small>{valid ? `${startDate}~${endDate} · 채널에서 조회 가능한 이력만 가져옵니다.` : "종료일을 선택해 주세요."}</small>
  </fieldset>;
}
