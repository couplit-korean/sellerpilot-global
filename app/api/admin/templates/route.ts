import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";

const templateSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["shipping_fee", "packaging_shipping"]),
  values: z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])),
  isDefault: z.boolean().default(false),
});

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_list_commerce_templates");
  if (error) return NextResponse.json({ message: "템플릿을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ templates: Array.isArray(data) ? data : [] }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = templateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "템플릿 입력값을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_save_commerce_template", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_kind: parsed.data.kind,
    p_values: parsed.data.values,
    p_is_default: parsed.data.isDefault,
  });
  if (error) return NextResponse.json({ message: "템플릿을 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true, id: data });
}

export async function DELETE(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ message: "삭제할 템플릿을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_delete_commerce_template", { p_id: id.data });
  if (error || data !== true) return NextResponse.json({ message: "템플릿을 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
