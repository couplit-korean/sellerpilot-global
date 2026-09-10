import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../../lib/admin-api";
import { executeViaChannelGateway } from "../../../../../../lib/channels/gateway";
import {
  resolveLocalGatewayReadReady,
} from "../../../../../../lib/channels/smartstore-local-read-routing";
import {
  assertSmartstoreCreateCategorySourceFreshSnapshot,
  parseSmartstoreCreateCategorySourceCollectionContext,
  smartstoreCreateCategoryOfficialReceipt,
  smartstoreCreateProviderAttributes,
} from "../../../../../../lib/server-smartstore-create-category-source-collector";

export const runtime = "nodejs";
export const maxDuration = 300;

const paramsSchema = z.object({ id: z.string().uuid() });
const requestSchema = z.object({
  credentialId: z.string().uuid(),
}).strict();
const noStoreHeaders = { "cache-control": "no-store, max-age=0" };

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const [rawParams, rawBody] = await Promise.all([
    context.params,
    request.json().catch(() => null),
  ]);
  const params = paramsSchema.safeParse(rawParams);
  const body = requestSchema.safeParse(rawBody);
  if (!params.success || !body.success) {
    return response({
      ok: false,
      sourceReady: false,
      providerMutationPerformed: false,
      mode: "smartstore_category_source_request_invalid",
      message: "상품과 활성 스마트스토어 credential을 확인해 주세요.",
    }, 400);
  }

  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;

  const [{ data: runtimeStatus, error: runtimeError }, prepared] =
    await Promise.all([
      admin.userClient.rpc("sellerpilot_ai_runtime_status"),
      admin.serviceClient.rpc(
        "sellerpilot_service_smartstore_create_category_collect_ctx",
        {
          p_owner_id: admin.user.id,
          p_product_id: params.data.id,
          p_credential_id: body.data.credentialId,
        },
      ),
    ]);
  const localGateway = resolveLocalGatewayReadReady(runtimeStatus, {
    statusAvailable: !runtimeError,
  });
  if (!localGateway.available) {
    return response({
      ok: false,
      sourceReady: false,
      providerMutationPerformed: false,
      mode: "smartstore_category_source_local_gateway_required",
      message: localGateway.message,
    }, 503);
  }
  if (prepared.error) {
    return response({
      ok: false,
      sourceReady: false,
      providerMutationPerformed: false,
      mode: "smartstore_category_source_context_not_ready",
      message: "현재 상품·승인 상세·확정 카테고리·활성 credential 결속을 확인하지 못했습니다.",
    }, 409);
  }

  try {
    const sourceContext =
      parseSmartstoreCreateCategorySourceCollectionContext(prepared.data);
    const { result } = await executeViaChannelGateway({
      serviceClient: admin.serviceClient,
      credentialId: sourceContext.credentialId,
      attemptId: null,
      channel: "smartstore",
      operation: "categories.attributes",
      arguments: {
        categoryId: sourceContext.categoryId,
        includeAttributeValueUnits: true,
        includeStandardOptions: false,
      },
      timeoutMs: 180_000,
    });
    const official = smartstoreCreateCategoryOfficialReceipt(
      result,
      sourceContext.categoryId,
    );
    const providerAttributes = smartstoreCreateProviderAttributes({
      context: sourceContext,
      official,
    });
    const appendArguments = {
      p_owner_id: sourceContext.ownerId,
      p_product_id: sourceContext.productId,
      p_product_updated_at: sourceContext.productUpdatedAt,
      p_credential_id: sourceContext.credentialId,
      p_credential_version: sourceContext.credentialVersion,
      p_seller_account_key: sourceContext.sellerAccountKey,
      p_approved_detail_revision: sourceContext.approvedDetailRevision,
      p_approved_detail_digest: sourceContext.approvedDetailDigest,
      p_assignment_id: sourceContext.assignmentId,
      p_assignment_updated_at: sourceContext.assignmentUpdatedAt,
      p_provider_attributes: providerAttributes,
      p_official_readback: official,
    };
    let appended = await admin.serviceClient.rpc(
      "sellerpilot_service_append_smartstore_create_category_source",
      appendArguments,
    );
    const appendResponseWasUncertain = Boolean(appended.error);
    if (appendResponseWasUncertain) {
      // The first transaction may have committed while its HTTP response was
      // lost. Exact append replay is idempotent and cannot authorize new data.
      appended = await admin.serviceClient.rpc(
        "sellerpilot_service_append_smartstore_create_category_source",
        appendArguments,
      );
    }
    const [freshPrepared, freshSnapshot] = await Promise.all([
      admin.serviceClient.rpc(
        "sellerpilot_service_smartstore_create_category_collect_ctx",
        {
          p_owner_id: sourceContext.ownerId,
          p_product_id: sourceContext.productId,
          p_credential_id: sourceContext.credentialId,
        },
      ),
      admin.serviceClient.rpc(
        "sellerpilot_service_smartstore_create_source_snapshot",
        {
          p_owner_id: sourceContext.ownerId,
          p_product_id: sourceContext.productId,
          p_credential_id: sourceContext.credentialId,
        },
      ),
    ]);
    if (freshPrepared.error || freshSnapshot.error) {
      throw new Error("SMARTSTORE_CATEGORY_SOURCE_FRESH_SNAPSHOT_UNAVAILABLE");
    }
    assertSmartstoreCreateCategorySourceFreshSnapshot({
      context: sourceContext,
      freshContext: freshPrepared.data,
      sourceSnapshot: freshSnapshot.data,
      official,
      providerAttributes,
    });
    const appendResult = appended.data && typeof appended.data === "object"
      && !Array.isArray(appended.data)
      ? appended.data as Record<string, unknown>
      : {};
    return response({
      ok: true,
      sourceReady: true,
      replayed: appendResult.replayed === true || appendResponseWasUncertain,
      appendResponseRecovered: appendResponseWasUncertain,
      providerMutationPerformed: false,
      officialReadOperation: "categories.attributes",
      message: "현재 확정 카테고리에 결속된 스마트스토어 공식 속성 원본을 저장했습니다.",
    });
  } catch {
    return response({
      ok: false,
      sourceReady: false,
      providerMutationPerformed: false,
      mode: "smartstore_category_source_collection_failed",
      message: "스마트스토어 공식 카테고리·속성·값·단위를 현재 확정값과 대조하지 못했습니다.",
    }, 409);
  }
}
