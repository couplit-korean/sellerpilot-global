import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { downloadPublicImage } from "../../../../lib/public-image-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({ url: z.string().trim().url().max(2_048) });

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "공개 이미지 URL을 확인해 주세요." }, { status: 400 });

  try {
    const image = await downloadPublicImage(parsed.data.url);
    return new Response(image.bytes, {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": image.contentType,
        "x-sellerpilot-image-source": encodeURIComponent(image.finalUrl).slice(0, 1_500),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "공개 이미지를 가져오지 못했습니다.";
    return NextResponse.json({ message }, { status: 422, headers: { "cache-control": "no-store" } });
  }
}
