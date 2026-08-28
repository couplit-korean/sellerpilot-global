import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRevenueCalendarPages,
  initialRevenueCalendarPageIndex,
  localTodayIso,
  shiftRevenueCalendarRange,
} from "../app/_dashboard/revenue-calendar-navigation";

test("year calendar is paged by month and opens the page containing today", () => {
  const pages = buildRevenueCalendarPages([
    { date: "2026-08-28", revenueKrw: 1_000, sold: 1, orderCount: 1, domesticRevenueKrw: 700, overseasRevenueKrw: 300, channels: {} },
  ], { preset: "year", from: "2026-01-01", to: "2026-08-28" });

  assert.equal(pages.length, 8);
  assert.equal(pages[7]?.label, "2026년 8월 · 연간 8/8");
  assert.equal(initialRevenueCalendarPageIndex(pages, "2026-08-28"), 7);
  assert.equal(pages[7]?.cells.find((cell) => cell.date === "2026-08-28")?.value?.revenueKrw, 1_000);
});

test("week and custom ranges do not render one unbounded calendar", () => {
  const weekPages = buildRevenueCalendarPages([], { preset: "week", from: "2026-08-19", to: "2026-08-25" });
  assert.equal(weekPages.length, 1);
  assert.equal(weekPages[0]?.cells.length, 7);

  const customPages = buildRevenueCalendarPages([], { preset: "custom", from: "2026-07-28", to: "2026-08-03" });
  assert.deepEqual(customPages.map((page) => page.key), ["2026-07", "2026-08"]);
});

test("local today does not shift dates through UTC conversion", () => {
  assert.equal(localTodayIso(new Date(2026, 7, 28, 0, 5)), "2026-08-28");
});

test("day, week, and month arrows move the queried period without entering the future", () => {
  assert.deepEqual(
    shiftRevenueCalendarRange({ preset: "day", from: "2026-08-28", to: "2026-08-28" }, -1, "2026-08-28"),
    { preset: "day", from: "2026-08-27", to: "2026-08-27" },
  );
  assert.equal(
    shiftRevenueCalendarRange({ preset: "day", from: "2026-08-28", to: "2026-08-28" }, 1, "2026-08-28"),
    null,
  );
  assert.deepEqual(
    shiftRevenueCalendarRange({ preset: "week", from: "2026-08-15", to: "2026-08-21" }, 1, "2026-08-28"),
    { preset: "week", from: "2026-08-22", to: "2026-08-28" },
  );
  assert.deepEqual(
    shiftRevenueCalendarRange({ preset: "month", from: "2026-07-01", to: "2026-07-31" }, 1, "2026-08-28"),
    { preset: "month", from: "2026-08-01", to: "2026-08-28" },
  );
});
