import type { SalesAnalytics, SalesRange } from "../use-operations-snapshot";

export type RevenueCalendarDay = SalesAnalytics["daily"][number];

export type RevenueCalendarCell = {
  date: string;
  value: RevenueCalendarDay | null;
};

export type RevenueCalendarPage = {
  key: string;
  label: string;
  rangeLabel: string;
  cells: RevenueCalendarCell[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCalendarDays(value: string, offset: number) {
  const date = parseIsoDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

function earlierIsoDate(left: string, right: string) {
  return left <= right ? left : right;
}

export function shiftRevenueCalendarRange(
  range: Pick<SalesRange, "from" | "to" | "preset">,
  direction: -1 | 1,
  today = localTodayIso(),
): SalesRange | null {
  if (!parseIsoDate(today) || !parseIsoDate(range.from) || !parseIsoDate(range.to)) return null;
  if (range.preset === "custom" || range.preset === "year") return null;

  if (range.preset === "day") {
    const date = addCalendarDays(range.to, direction);
    if (!date || date > today) return null;
    return { preset: "day", from: date, to: date };
  }

  if (range.preset === "week") {
    const from = addCalendarDays(range.from, direction * 7);
    const to = addCalendarDays(range.to, direction * 7);
    if (!from || !to || from > today) return null;
    if (to <= today) return { preset: "week", from, to };
    const cappedFrom = addCalendarDays(today, -6);
    return cappedFrom ? { preset: "week", from: cappedFrom, to: today } : null;
  }

  const source = parseIsoDate(range.from);
  if (!source) return null;
  const targetStart = new Date(source.getFullYear(), source.getMonth() + direction, 1, 12);
  const from = isoDate(targetStart);
  if (from > today) return null;
  const targetEnd = new Date(targetStart.getFullYear(), targetStart.getMonth() + 1, 0, 12);
  return { preset: "month", from, to: earlierIsoDate(isoDate(targetEnd), today) };
}

function eachDate(from: string, to: string) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end || start > end) return [];
  const values: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && values.length < 400) {
    values.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

function monthLabel(date: string) {
  const parsed = parseIsoDate(date);
  return parsed
    ? `${parsed.getFullYear()}년 ${parsed.getMonth() + 1}월`
    : date;
}

function pageForDates(key: string, label: string, dates: string[], values: Map<string, RevenueCalendarDay>): RevenueCalendarPage {
  return {
    key,
    label,
    rangeLabel: dates.length > 1 ? `${dates[0]} — ${dates.at(-1)}` : dates[0] ?? "조회 기간 없음",
    cells: dates.map((date) => ({ date, value: values.get(date) ?? null })),
  };
}

export function buildRevenueCalendarPages(
  days: SalesAnalytics["daily"],
  range: Pick<SalesRange, "from" | "to" | "preset">,
) {
  const dates = eachDate(range.from, range.to);
  const values = new Map(days.map((day) => [day.date.slice(0, 10), day]));
  if (dates.length === 0) return [];

  if (range.preset === "day") {
    return dates.map((date) => pageForDates(date, monthLabel(date), [date], values));
  }

  if (range.preset === "week") {
    const pages: RevenueCalendarPage[] = [];
    for (let offset = 0; offset < dates.length; offset += 7) {
      const pageDates = dates.slice(offset, offset + 7);
      pages.push(pageForDates(`week-${offset / 7}`, `${monthLabel(pageDates[0])} · 주간`, pageDates, values));
    }
    return pages;
  }

  const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
  return monthKeys.map((monthKey, index) => {
    const pageDates = dates.filter((date) => date.startsWith(monthKey));
    const label = range.preset === "year"
      ? `${monthLabel(pageDates[0])} · 연간 ${index + 1}/${monthKeys.length}`
      : monthLabel(pageDates[0]);
    return pageForDates(monthKey, label, pageDates, values);
  });
}

export function initialRevenueCalendarPageIndex(pages: RevenueCalendarPage[], today: string) {
  if (pages.length === 0) return 0;
  const todayIndex = pages.findIndex((page) => page.cells.some((cell) => cell.date === today));
  return todayIndex >= 0 ? todayIndex : pages.length - 1;
}

export function localTodayIso(now = new Date()) {
  return isoDate(now);
}
