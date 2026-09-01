import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { lazadaExactExistingPublicationIdentity } from "../../../../../../lib/channels/lazada-exact-existing-identity";

export const runtime = "nodejs";

const requestSchema = z.object({
  listingId: z.string().uuid(),
  mode: z.enum(["dry_run", "execute"]),
}).strict();

const prepareResultSchema = z.object({
  status: z.enum(["ready", "already_bound", "manual_required"]),
  listing_id: z.string().uuid(),
  credential_id: z.string().uuid().optional(),
  channel: z.enum(["qoo10", "shopee", "lazada", "ebay"]).optional(),
  market: z.string().trim().max(80).optional(),
}).strip().superRefine((value, context) => {
  if (value.status === "ready" && (!value.credential_id || !value.channel)) {
    context.addIssue({
      code: "custom",
      message: "ready verification requires an exact credential and channel",
    });
  }
});

const enqueueResultSchema = z.object({
  status: z.enum(["queued", "running", "already_bound", "manual_required"]),
  listing_id: z.string().uuid(),
  job_id: z.string().uuid().optional(),
  reused: z.boolean(),
}).strip().superRefine((value, context) => {
  if ((value.status === "queued" || value.status === "running") && !value.job_id) {
    context.addIssue({
      code: "custom",
      message: "active verification requires a gateway job",
    });
  }
});

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function prepareMessage(status: z.infer<typeof prepareResultSchema>["status"]) {
  if (status === "ready") return "현재 게시 원장과 판매자 계정을 원격 판매채널에서 읽기 전용으로 검증할 수 있습니다.";
  if (status === "already_bound") return "이 상품 게시 원장은 이미 검증된 판매자 계정에 연결되어 있습니다.";
  return "현재 저장된 원장만으로는 안전한 자동 검증 대상을 하나로 확정할 수 없습니다.";
}

function enqueueMessage(status: z.infer<typeof enqueueResultSchema>["status"], reused: boolean) {
  if (status === "queued") {
    return reused
      ? "동일한 판매자 계보 검증 작업이 이미 대기 중이므로 새 작업을 만들지 않았습니다."
      : "판매자 계보 읽기 전용 검증 작업을 대기열에 등록했습니다.";
  }
  if (status === "running") return "동일한 판매자 계보 검증 작업이 이미 진행 중입니다.";
  if (status === "already_bound") return "이 상품 게시 원장은 이미 검증된 판매자 계정에 연결되어 있습니다.";
  return "원격 검증 결과를 자동 확정할 수 없어 수동 확인이 필요합니다.";
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ message: "상품 게시 원장 검증 요청 형식이 올바르지 않습니다." }, 400);
  }
  const exactLazadaLiveAdoption = parsed.data.listingId
    === lazadaExactExistingPublicationIdentity.listingId;
  const prepareRpc = exactLazadaLiveAdoption
    ? "sellerpilot_service_prepare_exact_lazada_live_adoption"
    : "sellerpilot_service_prepare_listing_lineage_verification";

  const { data: prepareData, error: prepareError } = await admin.serviceClient.rpc(
    prepareRpc,
    { p_listing_id: parsed.data.listingId },
  );
  const prepared = prepareResultSchema.safeParse(prepareData);
  if (prepareError || !prepared.success || prepared.data.listing_id !== parsed.data.listingId) {
    return response({
      message: "상품 게시 원장의 판매자 계보 검증 준비 상태를 확인하지 못했습니다.",
      status: "unavailable",
    }, 503);
  }

  const preparation = prepared.data;
  if (parsed.data.mode === "dry_run") {
    return response({
      dryRun: true,
      listingId: parsed.data.listingId,
      channel: preparation.channel,
      market: preparation.market,
      status: preparation.status,
      eligible: preparation.status === "ready",
      verified: preparation.status === "already_bound",
      manualRequired: preparation.status === "manual_required",
      message: prepareMessage(preparation.status),
    });
  }

  if (preparation.status === "already_bound") {
    return response({
      ok: true,
      listingId: parsed.data.listingId,
      status: "already_bound",
      verified: true,
      reused: true,
      message: prepareMessage(preparation.status),
    });
  }
  if (preparation.status === "manual_required" || !preparation.credential_id) {
    return response({
      ok: false,
      listingId: parsed.data.listingId,
      status: "manual_required",
      manualRequired: true,
      message: prepareMessage("manual_required"),
    }, 409);
  }

  const { data: enqueueData, error: enqueueError } = await admin.serviceClient.rpc(
    exactLazadaLiveAdoption
      ? "sellerpilot_service_enqueue_exact_lazada_live_adoption"
      : "sellerpilot_service_enqueue_listing_lineage_verification",
    {
      p_listing_id: parsed.data.listingId,
      p_credential_id: preparation.credential_id,
    },
  );
  const enqueued = enqueueResultSchema.safeParse(enqueueData);
  if (enqueueError || !enqueued.success || enqueued.data.listing_id !== parsed.data.listingId) {
    return response({
      message: "판매자 계보 검증 작업을 안전하게 대기열에 등록하지 못했습니다.",
      status: "unavailable",
    }, 503);
  }

  const result = enqueued.data;
  if (result.status === "manual_required") {
    return response({
      ok: false,
      listingId: parsed.data.listingId,
      status: result.status,
      manualRequired: true,
      reused: result.reused,
      message: enqueueMessage(result.status, result.reused),
    }, 409);
  }
  if (result.status === "already_bound") {
    return response({
      ok: true,
      listingId: parsed.data.listingId,
      status: result.status,
      verified: true,
      reused: result.reused,
      message: enqueueMessage(result.status, result.reused),
    });
  }

  return response({
    ok: false,
    accepted: true,
    inProgress: result.status === "running",
    listingId: parsed.data.listingId,
    jobId: result.job_id,
    status: result.status,
    reused: result.reused,
    message: enqueueMessage(result.status, result.reused),
  }, 202);
}
