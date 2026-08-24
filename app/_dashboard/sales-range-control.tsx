"use client";

import { CalendarDays } from "lucide-react";
import type { SalesRange } from "../use-operations-snapshot";

const salesRangeLabels: Record<SalesRange["preset"], string> = {
  day: "일",
  week: "주",
  month: "월",
  year: "연",
  custom: "맞춤",
};

const salesRangePresets = Object.keys(salesRangeLabels) as SalesRange["preset"][];

function localDateString(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function salesRangeForPreset(preset: SalesRange["preset"], now = new Date()): SalesRange {
  const to = localDateString(now);
  if (preset === "day") return { preset, from: to, to };
  if (preset === "week") return { preset, from: localDateString(new Date(now.getTime() - 6 * 86_400_000)), to };
  if (preset === "year") return { preset, from: localDateString(new Date(now.getFullYear(), 0, 1)), to };
  return { preset: preset === "custom" ? "custom" : "month", from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

export function SalesRangeControl({ range, onChange, compact = false }: {
  range: SalesRange;
  onChange: (range: SalesRange) => void;
  compact?: boolean;
}) {
  return <div className={`sales-range-control ${compact ? "compact" : ""}`}>
    <div className="segmented-control" aria-label="매출 집계 기간">{salesRangePresets.map((preset) => <button type="button" className={range.preset === preset ? "active" : ""} onClick={() => onChange(preset === "custom" ? { ...range, preset } : salesRangeForPreset(preset))} key={preset}>{salesRangeLabels[preset]}</button>)}</div>
    {range.preset === "custom" ? <div className="custom-date-range"><label><span className="sr-only">시작일</span><input type="date" value={range.from} max={range.to} onChange={(event) => onChange({ ...range, from: event.target.value })} /></label><span>—</span><label><span className="sr-only">종료일</span><input type="date" value={range.to} min={range.from} onChange={(event) => onChange({ ...range, to: event.target.value })} /></label></div> : <span className="selected-date-range"><CalendarDays size={14} />{range.from} — {range.to}</span>}
  </div>;
}
