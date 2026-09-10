import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../lib/admin-api";
import {
  lazadaProductReviewReplyRequestSchema,
  prepareAndEnqueueLazadaProductReviewReply,
} from "../../../../../../../../lib/cs/channels/lazada/product-review-reply";
import { lazadaProductReviewReplyCapabilityProjectionSchema } from "../../../../../../../../lib/cs/channels/lazada/product-review-reply-ui";
import { z } from "zod";

export const runtime = "nodejs";
const noStore = { "cache-control": "no-store, max-age=0" };

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("PERMISSION_REQUIRED") || message.includes("PERMISSION_REVOKED")) {
    return [403, "Lazada Product Review 답글·조회 권한의 provider readback이 필요합니다."] as const;
  }
  if (message.includes("CONFLICT") || message.includes("STALE")) {
    return [409, "이 리뷰는 이미 답글 처리 중이거나 답글이 확인되어 재전송할 수 없습니다."] as const;
  }
  if (message.includes("BINDING_MISMATCH")) {
    return [409, "리뷰의 계정·국가·세대 연결이 변경되어 답글을 접수하지 않았습니다."] as const;
  }
  return [503, "Lazada Product Review 답글 준비 원장을 확인하지 못했습니다."] as const;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = lazadaProductReviewReplyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "리뷰 답글 대상을 확인해 주세요." }, { status: 400, headers: noStore });
  }
  try {
    const submission = await prepareAndEnqueueLazadaProductReviewReply(parsed.data, {
      prepare: async (input) => admin.userClient.rpc("sellerpilot_prepare_lazada_product_review_reply_v1", {
        p_credential_id: input.credentialId,
        p_country: input.country,
        p_review_id: input.reviewId,
        p_generation: input.generation,
        p_reply_text: input.reply,
      }),
      enqueue: async (prepared) => admin.userClient.rpc("sellerpilot_enqueue_lazada_product_review_reply_v1", {
        p_delivery_id: prepared.deliveryId,
        p_expected_identity_fingerprint: prepared.identityFingerprint,
      }),
    });
    const status = submission.enqueue?.status ?? submission.prepared.status;
    return NextResponse.json({ submission }, { status: status === "queued" ? 202 : 200, headers: noStore });
  } catch (error) {
    const [status, message] = safeMessage(error);
    return NextResponse.json({ message }, { status, headers: noStore });
  }
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  const capabilityQuery = z.object({
    credentialId: z.string().uuid(),
    country: z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]),
  }).strict().safeParse(Object.fromEntries(params));
  if (capabilityQuery.success) {
    const result = await admin.userClient.rpc("sellerpilot_get_lazada_product_review_reply_capability_v1", {
      p_credential_id: capabilityQuery.data.credentialId,
      p_country: capabilityQuery.data.country,
    });
    const capability = lazadaProductReviewReplyCapabilityProjectionSchema.safeParse(result.data);
    if (result.error || !capability.success) {
      return NextResponse.json({ message: "Lazada Product Review 답글 권한을 확인하지 못했습니다." },
        { status: 503, headers: noStore });
    }
    return NextResponse.json({ capability: { ...capability.data, viewerId: admin.user.id } }, { headers: noStore });
  }
  const deliveryId = params.get("deliveryId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(deliveryId)) {
    return NextResponse.json({ message: "리뷰 답글 원장 ID를 확인해 주세요." }, { status: 400, headers: noStore });
  }
  const result = await admin.userClient.rpc("sellerpilot_get_lazada_product_review_reply_v1", {
    p_delivery_id: deliveryId,
  });
  if (result.error) {
    return NextResponse.json({ message: "리뷰 답글 상태를 확인하지 못했습니다." }, { status: 503, headers: noStore });
  }
  return NextResponse.json({ delivery: result.data }, { headers: noStore });
}

export async function PUT(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const body = await request.json().catch(() => null);
  const deliveryId = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as Record<string, unknown>).deliveryId ?? "")
    : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(deliveryId)) {
    return NextResponse.json({ message: "리뷰 답글 원장 ID를 확인해 주세요." }, { status: 400, headers: noStore });
  }
  const result = await admin.userClient.rpc("sellerpilot_enqueue_lazada_product_review_readback_v1", {
    p_delivery_id: deliveryId,
  });
  if (result.error) {
    return NextResponse.json(
      { message: "재전송 없이 확인할 수 있는 readback 상태가 아닙니다." },
      { status: 409, headers: noStore },
    );
  }
  return NextResponse.json({ readback: result.data }, { status: 202, headers: noStore });
}
