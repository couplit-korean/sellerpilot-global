import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { qoo10LotteShippingS1Target } from "../../../../../../lib/channels/qoo10-lotte-shipping-s1-identity";
import { resolveRuntimeReleaseIdentity } from "../../../../../../lib/internal-scheduler-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const productIdSchema = z.string().uuid();
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verify"),
    listingId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("activate"),
    listingId: z.string().uuid(),
    verifierJobId: z.string().uuid(),
  }).strict(),
]);

function noStore(status = 200) {
  return { status, headers: { "cache-control": "no-store, max-age=0" } };
}

function noStoreAdminError(response: NextResponse) {
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

function exactTarget(productId: string, listingId: string) {
  return qoo10LotteShippingS1Target(productId, listingId);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return noStoreAdminError(admin);
  const productId = productIdSchema.safeParse((await context.params).id);
  const listingId = new URL(request.url).searchParams.get("listingId") ?? "";
  if (!productId.success || !exactTarget(productId.data, listingId)) {
    return NextResponse.json({
      message: "Qoo10 shipping S1 상품·게시 원장 식별값이 일치하지 않습니다.",
    }, noStore(400));
  }
  const runtimeRelease = resolveRuntimeReleaseIdentity();
  if (runtimeRelease.status !== "valid") {
    return NextResponse.json({
      message: "현재 서버 릴리스 SHA를 확정하지 못했습니다.",
      mode: "runtime_release_required",
    }, noStore(503));
  }
  const { data, error } = await admin.serviceClient.rpc(
    "sellerpilot_service_get_qoo10_shipping_s1_release_status",
    {
      p_product_id: productId.data,
      p_listing_id: listingId,
      p_release_sha: runtimeRelease.release,
    },
  );
  if (error || !data) {
    return NextResponse.json({
      message: "Qoo10 shipping S1 검증·활성화 상태를 읽지 못했습니다.",
      mode: "qoo10_shipping_s1_release_status_unavailable",
    }, noStore(503));
  }
  return NextResponse.json(data, noStore());
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return noStoreAdminError(admin);
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success
      || !exactTarget(productId.data, body.data.listingId)) {
    return NextResponse.json({
      message: "Qoo10 shipping S1 요청의 상품·게시 원장·작업 식별값을 확인해 주세요.",
    }, noStore(400));
  }
  const runtimeRelease = resolveRuntimeReleaseIdentity();
  if (runtimeRelease.status !== "valid") {
    return NextResponse.json({
      message: "현재 서버 릴리스 SHA를 확정하지 못했습니다.",
      mode: "runtime_release_required",
    }, noStore(503));
  }
  const rpc = body.data.action === "verify"
    ? "sellerpilot_service_enqueue_qoo10_shipping_s1_verifier"
    : "sellerpilot_service_enqueue_qoo10_shipping_s1_activation";
  const argumentsValue = body.data.action === "verify"
    ? {
        p_listing_id: body.data.listingId,
        p_release_sha: runtimeRelease.release,
      }
    : {
        p_verifier_job_id: body.data.verifierJobId,
        p_release_sha: runtimeRelease.release,
      };
  const { data, error } = await admin.serviceClient.rpc(rpc, argumentsValue);
  if (error || !data) {
    return NextResponse.json({
      message: body.data.action === "verify"
        ? "현재 S1 원격 상태와 shipping 정규화 결속을 확인하지 못해 verifier를 만들지 않았습니다."
        : "2분 이내의 shipping S1 관측과 one-use permit을 확인하지 못해 활성화를 만들지 않았습니다.",
      mode: body.data.action === "verify"
        ? "qoo10_shipping_s1_verifier_precondition_failed"
        : "qoo10_shipping_s1_activation_precondition_failed",
    }, noStore(409));
  }
  return NextResponse.json(data, noStore(202));
}
