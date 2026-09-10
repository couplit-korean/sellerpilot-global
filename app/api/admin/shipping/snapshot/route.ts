import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../lib/admin-api";
import { shippingSnapshotSchema } from "../../../../../lib/shipping/snapshot";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const url = new URL(request.url);
  const range = z
    .object({ from: z.string().date(), to: z.string().date() })
    .refine((v) => v.from <= v.to)
    .safeParse({
      from:
        url.searchParams.get("from") ??
        new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
      to: url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10),
    });
  if (!range.success)
    return NextResponse.json(
      { message: "주문 조회 기간을 확인해 주세요." },
      { status: 400 },
    );
  const [snapshot, analytics] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_shipping_snapshot"),
    admin.userClient.rpc("sellerpilot_get_shipping_sales_analytics", {
      p_from: range.data.from,
      p_to: range.data.to,
    }),
  ]);
  const parsed = shippingSnapshotSchema.safeParse({
    ...snapshot.data,
    analytics: analytics.data,
  });
  if (snapshot.error || analytics.error || !parsed.success)
    return NextResponse.json(
      { message: "배송 데이터를 불러오지 못했습니다." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  return NextResponse.json(parsed.data, {
    headers: { "cache-control": "no-store" },
  });
}
