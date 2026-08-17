import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("order_status"),
    id: z.string().uuid(),
    status: z.enum(["paid", "ready_to_ship", "shipped", "delivered", "cancelled", "refunded"]),
  }),
  z.object({
    action: z.literal("ticket_update"),
    id: z.string().uuid(),
    status: z.enum(["urgent", "waiting", "in_progress", "resolved"]),
    replyDraft: z.string().max(8000).optional(),
  }),
  z.object({
    action: z.literal("margin_save"),
    name: z.string().trim().min(1).max(120),
    channelKey: z.enum(["qoo10", "shopee", "lazada", "coupang", "smartstore", "ebay", "temu"]),
    inputs: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()),
  }),
  z.object({
    action: z.literal("margin_delete"),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("product_create"),
    jobId: z.string().uuid(),
  }),
]);

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const [{ data, error }, { data: marginScenarios }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_operations_snapshot"),
    admin.userClient.rpc("sellerpilot_list_margin_scenarios", { p_limit: 5 }),
  ]);
  if (error) {
    return NextResponse.json({ message: "운영 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>) }
    : {};
  payload.marginScenarios = Array.isArray(marginScenarios) ? marginScenarios : [];
  if (Array.isArray(payload.products)) {
    const products = payload.products.filter((product): product is Record<string, unknown> => Boolean(product) && typeof product === "object" && !Array.isArray(product));
    const paths = products.map((product) => typeof product.aiHeroPath === "string" ? product.aiHeroPath : "").filter(Boolean);
    const { data: signed } = paths.length
      ? await admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 60 * 60)
      : { data: [] };
    let signedIndex = 0;
    payload.products = products.map((product) => {
      const next = { ...product };
      if (typeof next.aiHeroPath === "string" && next.aiHeroPath) {
        next.imageUrl = signed?.[signedIndex]?.signedUrl ?? next.imageUrl ?? null;
        signedIndex += 1;
      }
      delete next.aiHeroPath;
      return next;
    });
  }
  return NextResponse.json(payload, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "운영 데이터 변경 요청을 확인해 주세요." }, { status: 400 });
  }

  let mutationError: { message: string } | null = null;
  let id: string | null = null;
  if (parsed.data.action === "order_status") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_update_order_status", {
      p_id: parsed.data.id,
      p_status: parsed.data.status,
    });
    mutationError = error ?? (data === true ? null : { message: "order not found" });
  } else if (parsed.data.action === "ticket_update") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_update_ticket", {
      p_id: parsed.data.id,
      p_status: parsed.data.status,
      p_reply_draft: parsed.data.replyDraft ?? null,
    });
    mutationError = error ?? (data === true ? null : { message: "ticket not found" });
  } else if (parsed.data.action === "margin_save") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_save_margin_scenario", {
      p_name: parsed.data.name,
      p_channel_key: parsed.data.channelKey,
      p_inputs: parsed.data.inputs,
      p_result: parsed.data.result,
    });
    id = typeof data === "string" ? data : null;
    mutationError = error;
  } else if (parsed.data.action === "margin_delete") {
    const { data, error } = await admin.userClient.rpc("sellerpilot_delete_margin_scenario", {
      p_id: parsed.data.id,
    });
    mutationError = error ?? (data === true ? null : { message: "scenario not found" });
  } else {
    const { data, error } = await admin.userClient.rpc("sellerpilot_create_product_from_ai_v2", {
      p_job_id: parsed.data.jobId,
    });
    id = typeof data === "string" ? data : null;
    mutationError = error;
  }

  if (mutationError) {
    return NextResponse.json({ message: "운영 데이터를 저장하지 못했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id }, { headers: { "cache-control": "no-store, max-age=0" } });
}
