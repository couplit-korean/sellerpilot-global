import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../../../../lib/admin-api";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const inputSchema = z.object({ floorDate: day, throughDate: day }).strict()
  .refine(value => value.floorDate <= value.throughDate, { message: "invalid range" });
const checkpointSchema = z.object({
  contract: z.literal("sellerpilot-smartstore-history-checkpoint/4"),
  checkedAt: z.string().datetime({ offset: true }), environment: z.literal("production"),
  totalWindowCount: z.number().int().nonnegative(), completedWindowCount: z.number().int().nonnegative(),
  remainingWindowCount: z.number().int().nonnegative(), complete: z.boolean(),
  nextWindow: z.object({ key: z.string(), fromDate: day, throughDate: day,
    productItemKey: z.string(), customerItemKey: z.string() }).strict().nullable(),
  advanceRule: z.literal("current_cutoff_deferred_behind_older_exact_full_kst_day_windows"),
}).strict().refine(value => value.totalWindowCount > 0
  && value.totalWindowCount === value.completedWindowCount + value.remainingWindowCount
  && value.complete === (value.remainingWindowCount === 0)
  && value.complete === (value.nextWindow === null), { message: "inconsistent checkpoint" });

async function context(request: Request, input: unknown) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return { response: admin } as const;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { response: NextResponse.json({ message: "전체 이력 기간을 확인해 주세요." }, { status: 400, headers }) } as const;
  const { data: rows, error: credentialError } = await admin.userClient.rpc("sellerpilot_list_credentials");
  const credentials = Array.isArray(rows) ? rows.filter(row => row && typeof row === "object"
    && row.channel === "smartstore" && row.environment === "production" && row.status === "active") : [];
  const credential = credentials.length === 1 ? credentials[0] : null;
  if (credentialError || !credential || typeof credential.id !== "string") {
    return { response: NextResponse.json({ message: "활성 스마트스토어 운영 credential을 확인해 주세요." }, { status: 409, headers }) } as const;
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_next_smartstore_history_window_v4", {
    p_floor_date: parsed.data.floorDate, p_through_date: parsed.data.throughDate,
    p_credential_id: credential.id, p_environment: "production",
  });
  const checkpoint = checkpointSchema.safeParse(data);
  if (error || !checkpoint.success) {
    return { response: NextResponse.json({ message: "스마트스토어 이력 체크포인트를 읽지 못했습니다." }, { status: 503, headers }) } as const;
  }
  const { floorDate, throughDate } = parsed.data;
  const totalDays = (Date.parse(`${throughDate}T00:00:00Z`) - Date.parse(`${floorDate}T00:00:00Z`)) / 86_400_000 + 1;
  const next = checkpoint.data.nextWindow;
  const daysBefore = next ? (Date.parse(`${throughDate}T00:00:00Z`) - Date.parse(`${next.throughDate}T00:00:00Z`)) / 86_400_000 : 0;
  const expectedStart = next ? new Date(Math.max(Date.parse(`${floorDate}T00:00:00Z`),
    Date.parse(`${next.throughDate}T00:00:00Z`) - 29 * 86_400_000)).toISOString().slice(0, 10) : null;
  if (checkpoint.data.totalWindowCount !== Math.ceil(totalDays / 30)
    || (next && (daysBefore < 0 || daysBefore % 30 !== 0 || next.fromDate !== expectedStart
      || next.throughDate < floorDate || next.throughDate > throughDate
      || next.key !== `smartstore:history:v4:${next.fromDate}:${next.throughDate}`
      || next.productItemKey !== `product:${next.fromDate}:${next.throughDate}`
      || next.customerItemKey !== `customer:${next.fromDate}:${next.throughDate}`))) {
    return { response: NextResponse.json({ message: "요청 기간과 스마트스토어 이력 조회 결과가 일치하지 않습니다." }, { status: 502, headers }) } as const;
  }
  return { admin: admin as AdminApiContext, checkpoint: checkpoint.data, credentialId: credential.id } as const;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resolved = await context(request, {
    floorDate: url.searchParams.get("floorDate"), throughDate: url.searchParams.get("throughDate"),
  });
  if ("response" in resolved) return resolved.response;
  return NextResponse.json(resolved.checkpoint, { headers });
}

export async function POST(request: Request) {
  const resolved = await context(request, await request.json().catch(() => null));
  if ("response" in resolved) return resolved.response;
  if (!resolved.checkpoint.nextWindow) {
    return NextResponse.json({ ok: true, checkpoint: resolved.checkpoint, historyBackfill: null }, { headers });
  }
  const { data, error } = await resolved.admin.userClient.rpc("sellerpilot_start_smartstore_inquiry_history_window_v7", {
    p_from_date: resolved.checkpoint.nextWindow.fromDate,
    p_through_date: resolved.checkpoint.nextWindow.throughDate,
    p_credential_id: resolved.credentialId,
    p_environment: "production",
  });
  if (error) return NextResponse.json({ ok: false, checkpoint: resolved.checkpoint,
    message: "다음 스마트스토어 읽기 창을 접수하지 못했습니다." }, { status: 409, headers });
  return NextResponse.json({ ok: true, checkpointBeforeEnqueue: resolved.checkpoint,
    historyBackfill: data, acceptedNotCompleted: true }, { status: 202, headers });
}
