import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { sendPushNotification, type PushSubscriptionRecord } from "../../../../../lib/push-notifications";

export const runtime = "nodejs";

const schema = z.object({
  endpoint: z.string().url().startsWith("https://").max(4096),
});

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "테스트할 기기 구독을 확인해 주세요." }, { status: 400 });

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_push_subscription", {
    p_endpoint: parsed.data.endpoint,
  });
  const subscription = data && typeof data === "object" && !Array.isArray(data) ? data as PushSubscriptionRecord : null;
  if (error || !subscription?.enabled || !subscription.endpoint || !subscription.p256dh || !subscription.authSecret) {
    return NextResponse.json({ message: "이 계정에 연결된 Android 알림 구독을 찾지 못했습니다." }, { status: 404 });
  }

  const result = await sendPushNotification(subscription, {
    title: "SellerPilot 알림 연결 완료",
    body: "새 주문과 출고·배송 상태 알림을 이 기기에서 받습니다.",
    url: "/?view=orders",
    type: "purchase",
    tag: "sellerpilot-push-test",
  });
  if (result.status !== "sent") {
    if (result.status === "gone") {
      await admin.userClient.rpc("sellerpilot_disable_push_subscription", { p_endpoint: parsed.data.endpoint });
    }
    return NextResponse.json({ message: "테스트 알림을 전송하지 못했습니다. Android 알림 설정을 확인해 주세요." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: "테스트 알림을 전송했습니다." });
}
