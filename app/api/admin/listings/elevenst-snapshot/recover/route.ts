import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import {
  configuredServerlessStaticEgressChannels,
  hasServerlessStaticEgressFor,
  SERVERLESS_STATIC_EGRESS_REQUIRED,
} from "../../../../../../lib/channels/serverless-static-egress";

export const runtime = "nodejs";

const requestSchema = z.object({
  listingId: z.string().uuid(),
  mode: z.enum(["dry_run", "execute"]),
}).strict();

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const snapshotOnlySafety = {
  readOnly: true,
  snapshotOnly: true,
  approvedContentVerified: false,
  publicationReviewAllowed: false,
  createAllowed: false,
  listingMutationAllowed: false,
} as const;

function recordValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value) && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
    return value[0] as Record<string, unknown>;
  }
  return null;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      message: "11번가 기존 상품 복구 대상을 확인해 주세요.",
    }, { status: 400, headers: noStoreHeaders });
  }

  const runtimeStaticEgressReady = hasServerlessStaticEgressFor(
    configuredServerlessStaticEgressChannels(),
    ["elevenst"],
  );
  const prepared = await admin.serviceClient.rpc(
    "sellerpilot_service_prepare_elevenst_listing_snapshot_recovery",
    { p_listing_id: parsed.data.listingId },
  );
  if (prepared.error) {
    return NextResponse.json({
      ok: false,
      ...snapshotOnlySafety,
      message: "11번가 기존 상품의 읽기 전용 복구 원장이 아직 준비되지 않았습니다.",
    }, { status: 503, headers: noStoreHeaders });
  }
  const context = recordValue(prepared.data);
  if (!context) {
    return NextResponse.json({
      ok: false,
      ...snapshotOnlySafety,
      message: "11번가 기존 상품의 복구 조건을 확인하지 못했습니다.",
    }, { status: 409, headers: noStoreHeaders });
  }

  if (!runtimeStaticEgressReady) {
    return NextResponse.json({
      ...context,
      ok: false,
      ...snapshotOnlySafety,
      staticEgressReady: false,
      blockedReason: SERVERLESS_STATIC_EGRESS_REQUIRED,
      message: "11번가에 승인된 고정 egress IP와 서버 설정을 활성화하기 전에는 원격 GET도 실행하지 않습니다.",
    }, { status: 409, headers: noStoreHeaders });
  }

  if (context.status !== "ready") {
    return NextResponse.json({
      ...context,
      ok: false,
      ...snapshotOnlySafety,
      message: "11번가 기존 상품의 정확한 읽기 전용 복구 조건이 충족되지 않았습니다.",
    }, { status: 409, headers: noStoreHeaders });
  }

  if (parsed.data.mode === "dry_run") {
    return NextResponse.json({
      ...context,
      ok: true,
      dryRun: true,
      staticEgressReady: true,
      message: "기존 remote ID를 새 상품 생성 없이 GET으로 재검증할 준비가 됐습니다.",
    }, { headers: noStoreHeaders });
  }

  const enqueued = await admin.serviceClient.rpc(
    "sellerpilot_service_enqueue_elevenst_listing_snapshot_recovery",
    { p_listing_id: parsed.data.listingId },
  );
  if (enqueued.error) {
    return NextResponse.json({
      ok: false,
      ...snapshotOnlySafety,
      message: "11번가 읽기 전용 복구 작업을 대기열에 넣지 못했습니다.",
    }, { status: 503, headers: noStoreHeaders });
  }
  const recovery = recordValue(enqueued.data);
  if (!recovery || recovery.queued !== true) {
    return NextResponse.json({
      ...(recovery ?? {}),
      ok: false,
      ...snapshotOnlySafety,
      message: "11번가 읽기 전용 복구 작업은 생성되지 않았습니다.",
    }, { status: 409, headers: noStoreHeaders });
  }

  return NextResponse.json({
    ...recovery,
    ok: true,
    accepted: true,
    staticEgressReady: true,
    ...snapshotOnlySafety,
    message: "기존 11번가 remote ID의 정확한 GET snapshot 관찰을 대기열에 등록했습니다. 이 작업은 현재 승인 콘텐츠나 공개 게시를 확정하지 않습니다.",
  }, { status: 202, headers: noStoreHeaders });
}
