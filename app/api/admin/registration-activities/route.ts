import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store, max-age=0" };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clear") }).strict(),
  z.object({ action: z.enum(["stop", "delete"]), activityId: z.string().regex(/^(product|job|research|asset|revision):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) }).strict(),
]);
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_registration_history_reset");
  return NextResponse.json(error ? { message: "등록 기록 정리 상태를 확인하지 못했습니다." } : { clearedAt: data }, { status: error ? 503 : 200, headers });
}
export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "상품 작업과 동작을 확인해 주세요." }, { status: 400, headers });
  const { data, error } = await admin.userClient.rpc("sellerpilot_control_registration_activity", {
    p_activity_id: parsed.data.action === "clear" ? null : parsed.data.activityId,
    p_action: parsed.data.action,
  });
  if (error) return NextResponse.json({ message: error.code === "42501" ? "이 상품 작업을 변경할 권한이 없습니다." : "작업 상태를 변경하지 못했습니다. 다시 확인해 주세요." }, { status: error.code === "42501" ? 403 : 503, headers });
  const outcome = data as { inFlight?: number; deletedCount?: number };
  const message = parsed.data.action === "clear" ? "기존 상품 등록 기록을 삭제했습니다."
    : parsed.data.action === "delete" ? "상품 작업을 중지하고 등록 기록에서 삭제했습니다."
      : outcome?.inFlight ? "새 전송을 중지했습니다. 이미 전달된 채널 응답을 확인하고 있습니다." : "상품 작업을 중지했습니다.";
  return NextResponse.json({ ...outcome, message }, { headers });
}
