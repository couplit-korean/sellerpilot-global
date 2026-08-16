import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";

export const runtime = "nodejs";

const productIdSchema = z.string().uuid();

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const params = await context.params;
  const productId = productIdSchema.safeParse(params.id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_product_publish_context", {
    p_product_id: productId.data,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "상품 등록 준비 정보를 불러오지 못했습니다." }, { status: 404 });
  }

  const payload = data as Record<string, unknown>;
  const sourcePaths = stringList(payload.sourceImagePaths)
    .filter((path) => path.startsWith(`${admin.user.id}/`) && !path.includes(".."));
  const generatedPaths = Object.entries(stringRecord(payload.generatedImagePaths))
    .filter(([, path]) => path.startsWith("results/") && !path.includes(".."));
  const allPaths = [...sourcePaths, ...generatedPaths.map(([, path]) => path)];
  const { data: signed, error: signedError } = allPaths.length
    ? await admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(allPaths, 2 * 60 * 60)
    : { data: [], error: null };
  if (signedError) return NextResponse.json({ message: "상품 이미지 접근 주소를 만들지 못했습니다." }, { status: 500 });

  const sourceImages = sourcePaths.map((path, index) => ({ path, url: signed?.[index]?.signedUrl ?? null }));
  const generatedImages = generatedPaths.map(([id, path], index) => ({
    id,
    path,
    url: signed?.[sourcePaths.length + index]?.signedUrl ?? null,
  }));
  delete payload.sourceImagePaths;
  delete payload.generatedImagePaths;
  return NextResponse.json({ ...payload, sourceImages, generatedImages }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
