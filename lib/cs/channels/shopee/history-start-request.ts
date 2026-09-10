import { z } from "zod";

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 86_400_000;
const MAXIMUM_RANGE_SECONDS = 3_650 * 86_400;

export const shopeeHistoryStartRequestSchema = z.object({
  requestKey: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
}).strict();

function kstMidnight(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error("SHOPEE_HISTORY_DATE_INVALID");
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const utcCalendar = Date.UTC(year, month - 1, day);
  const verified = new Date(utcCalendar);
  if (verified.getUTCFullYear() !== year || verified.getUTCMonth() !== month - 1
      || verified.getUTCDate() !== day) {
    throw new Error("SHOPEE_HISTORY_DATE_INVALID");
  }
  return utcCalendar - KST_OFFSET_MS;
}

function kstDateKey(nowMs: number) {
  const value = new Date(nowMs + KST_OFFSET_MS);
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shopeeHistoryRangeEpoch(input: {
  fromDate: string;
  toDate: string;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("SHOPEE_HISTORY_DATE_INVALID");
  const today = kstDateKey(nowMs);
  if (input.fromDate > input.toDate || input.toDate > today) {
    throw new Error("SHOPEE_HISTORY_DATE_INVALID");
  }
  const fromMs = kstMidnight(input.fromDate);
  const toStartMs = kstMidnight(input.toDate);
  const toMs = input.toDate === today ? nowMs : toStartMs + DAY_MS - 1_000;
  const from = Math.floor(fromMs / 1_000);
  const to = Math.floor(toMs / 1_000);
  if (from < 1 || from >= to || to - from > MAXIMUM_RANGE_SECONDS) {
    throw new Error("SHOPEE_HISTORY_DATE_INVALID");
  }
  return { from, to, today, toUsesCurrentTime: input.toDate === today };
}

export function shopeeHistoryRunIdForRequestKey(requestKey: string) {
  const parsed = z.string().uuid().parse(requestKey);
  return `shopee-history-${parsed.replaceAll("-", "").toLowerCase()}`;
}

export function shopeeHistoryStartMatchesRequestKey(
  requestKey: string,
  response: { historyRunId: string },
) {
  return response.historyRunId === shopeeHistoryRunIdForRequestKey(requestKey);
}
