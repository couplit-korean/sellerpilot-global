import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { getPushPublicConfiguration } from "../../../../lib/push-notifications";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(4096),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(8).max(512),
  }),
  deviceLabel: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  return NextResponse.json(getPushPublicConfiguration(), {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Android 알림 구독 정보를 확인해 주세요." }, { status: 400 });
  if (!getPushPublicConfiguration().configured) {
    return NextResponse.json({ message: "운영 푸시 알림 키가 아직 설정되지 않았습니다." }, { status: 503 });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_upsert_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth_secret: parsed.data.keys.auth,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? "",
    p_device_label: parsed.data.deviceLabel ?? "Android 웹앱",
  });
  if (error || typeof data !== "string") {
    return NextResponse.json({ message: "이 기기의 알림 구독을 저장하지 못했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "주문·배송 알림이 이 기기에 연결됐습니다." });
}

export async function DELETE(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = subscriptionSchema.pick({ endpoint: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "해제할 알림 구독을 확인해 주세요." }, { status: 400 });
  const { error } = await admin.userClient.rpc("sellerpilot_disable_push_subscription", {
    p_endpoint: parsed.data.endpoint,
  });
  if (error) return NextResponse.json({ message: "알림 구독을 해제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
