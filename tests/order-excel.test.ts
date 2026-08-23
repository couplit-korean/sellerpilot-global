import assert from "node:assert/strict";
import test from "node:test";
import { buildPaidOrdersExcelWorkbook, paidOrdersExcelFilename, type PaidOrderExcelRecord } from "../lib/order-excel";

const baseOrder: PaidOrderExcelRecord = {
  id: "ORDER-001",
  channel: "쿠팡",
  customer: "김&구매자",
  product: "화이트 <머그컵>",
  amount: "5,000원",
  status: "결제완료",
  time: "2026-08-23 10:30",
  carrierCode: null,
  trackingNumber: null,
  settlementStatus: "정산 대기",
  settlementAmount: null,
  settlementCurrency: "KRW",
  exchangeLossPercent: 1.25,
};

test("exports only paid orders as an Excel-readable SpreadsheetML workbook", () => {
  const workbook = buildPaidOrdersExcelWorkbook([
    baseOrder,
    { ...baseOrder, id: "ORDER-CANCELLED", status: "취소완료", customer: "취소 고객" },
  ], new Date("2026-08-23T00:00:00.000Z"));

  assert.equal(workbook.count, 1);
  assert.match(workbook.xml, /<Worksheet ss:Name="결제완료 주문">/);
  assert.match(workbook.xml, /ss:ExpandedRowCount="2"/);
  assert.match(workbook.xml, /ORDER-001/);
  assert.doesNotMatch(workbook.xml, /ORDER-CANCELLED|취소 고객/);
  assert.match(workbook.xml, /김&amp;구매자/);
  assert.match(workbook.xml, /화이트 &lt;머그컵&gt;/);
});

test("uses a stable date-based Excel filename", () => {
  assert.equal(paidOrdersExcelFilename(new Date("2026-08-23T11:22:33.000Z")), "sellerpilot-paid-orders-2026-08-23.xls");
});
