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
  // PostgREST does not expose sellerpilot_private, so the ledger write goes
  // through a public SECURITY DEFINER RPC that resolves the owner itself.
  const inserted = await serviceClient.rpc("sellerpilot_public_shopee_storefront_inquiry", {
    p_external_ticket_id: externalTicketId,
    p_inbound_key: inboundKey,
    p_customer_name: parsed.data.customerName,
    p_subject: parsed.data.itemId ? `Shopee 상세 문의 · ${parsed.data.itemId}` : "Shopee 상세 문의",
    p_message: parsed.data.inquiry,
    p_received_at: receivedAt,
    p_item_id: parsed.data.itemId,
    p_order_sn: parsed.data.orderSn,
  });
  if (inserted.error || typeof inserted.data !== "string") {
    return NextResponse.json({ message: "문의 원장 저장이 거절됐습니다." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ticketId: inserted.data });
}
