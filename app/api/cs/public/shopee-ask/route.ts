import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const schema = z.object({
  customerName: z.string().trim().min(1).max(80),
  orderSn: z.string().trim().max(64).optional().default(""),
  itemId: z.string().trim().max(32).optional().default(""),
  inquiry: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "이름과 문의 내용을 확인해 주세요." }, { status: 400 });
  }
  const receivedAt = new Date().toISOString();
  const material = ["v2", "shopee", parsed.data.customerName, parsed.data.orderSn, parsed.data.itemId, parsed.data.inquiry, receivedAt].join("\u001f");
  const inboundKey = `shopee:${createHash("sha256").update(material).digest("hex")}`;
  const externalTicketId = `shopee:storefront:${inboundKey.slice(7, 23)}`;
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // The storefront form is unauthenticated, so the admin-only cs snapshot cannot
  // resolve the ledger owner here. Use the dedicated service-role resolver, which
  // follows the same ownership rule as the channel ingest functions.
  const owner = await serviceClient.rpc("sellerpilot_public_cs_ledger_owner");
  const ownerId = typeof owner.data === "string" ? owner.data : null;
  if (owner.error || !ownerId) {
    return NextResponse.json({ message: "쇼피 CS 원장 소유자를 확인하지 못했습니다." }, { status: 503 });
  }
  const inserted = await serviceClient.schema("sellerpilot_private").from("support_tickets").insert({
    owner_id: ownerId,
    external_ticket_id: externalTicketId,
    channel_key: "shopee",
    customer_name: parsed.data.customerName,
    subject: parsed.data.itemId ? `Shopee 상세 문의 · ${parsed.data.itemId}` : "Shopee 상세 문의",
    message: parsed.data.inquiry,
    status: "waiting",
    priority: 3,
    received_at: receivedAt,
    demo: false,
    updated_at: receivedAt,
    provider_status: "waiting",
    provider_status_updated_at: receivedAt,
    latest_inbound_key: inboundKey,
    provider_context: {
      kind: "storefront_form",
      itemId: parsed.data.itemId,
      orderSn: parsed.data.orderSn,
    },
    reply_context: {},
    external_order_reference: parsed.data.orderSn || null,
    ticket_kind: "conversation",
  }).select("id").maybeSingle();
  if (inserted.error || !inserted.data) {
    return NextResponse.json({ message: "문의 원장 저장이 거절됐습니다." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ticketId: inserted.data.id });
}
