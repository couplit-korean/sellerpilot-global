import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../lib/admin-api";
import { ingestLazadaSupplementalProviderPage } from "../../../../../../../../lib/cs/channels/lazada/supplemental-provider-ingest";
import {
  lazadaSupplementalResyncRequestSchema,
  resyncLazadaSupplementalProviderPage,
} from "../../../../../../../../lib/cs/channels/lazada/supplemental-provider-resync";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 4_096) {
    return fail(413, "REQUEST_TOO_LARGE", "Lazada 보조 CS 새 읽기 요청이 너무 큽니다.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4_096) {
    return fail(413, "REQUEST_TOO_LARGE", "Lazada 보조 CS 새 읽기 요청이 너무 큽니다.");
  }
  const parsed = lazadaSupplementalResyncRequestSchema.safeParse(
    (() => { try { return JSON.parse(raw); } catch { return null; } })(),
  );
  if (!parsed.success) {
    return fail(400, "LAZADA_SUPPLEMENTAL_RESYNC_INVALID", "완료된 Lazada 읽기 회차와 새 요청 ID를 확인해 주세요.");
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await admin.serviceClient.rpc(name, args);
    return { data: result.data, error: result.error };
  };
  const ingestDependencies = {
    prepare: (input: typeof parsed.data) => rpc("sellerpilot_service_prepare_lazada_supplemental_read_v1", {
      p_credential_id: input.credentialId,
      p_country: input.country,
      p_source_path: input.sourcePath,
      p_resource_id: input.resourceId ?? null,
      p_page_size: input.pageSize ?? 20,
    }),
    readCredential: (credentialId: string) => rpc("sellerpilot_decrypt_credential", {
      p_credential_id: credentialId,
    }),
    ingestAndAcknowledge: (input: {
      continuationId: string; expectedRevision: number; credentialId: string; country: string;
      surface: string; sourcePath: string; resourceId: string; pageNumber: number; pageSize: number;
      rows: unknown[]; pagination: unknown;
    }) => rpc("sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1", {
      p_continuation_id: input.continuationId,
      p_expected_revision: input.expectedRevision,
      p_credential_id: input.credentialId,
      p_country: input.country,
      p_surface: input.surface,
      p_source_path: input.sourcePath,
      p_resource_id: input.resourceId || null,
      p_page_number: input.pageNumber,
      p_page_size: input.pageSize,
      p_rows: input.rows,
      p_pagination: input.pagination,
    }),
  };
  try {
    const result = await resyncLazadaSupplementalProviderPage(parsed.data, {
      begin: (input) => rpc("sellerpilot_service_begin_lazada_supplemental_resync_v1", {
        p_actor_id: admin.user.id,
        p_completed_continuation_id: input.completedContinuationId,
        p_expected_completed_revision: input.expectedCompletedRevision,
        p_credential_id: input.credentialId,
        p_country: input.country,
        p_source_path: input.sourcePath,
        p_resource_id: input.resourceId ?? null,
        p_page_size: input.pageSize ?? 20,
        p_start_request_id: input.startRequestId,
      }),
      ingest: ingestLazadaSupplementalProviderPage,
      ingestDependencies,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("PERMISSION_REQUIRED")) {
      return fail(403, code, "이 계정·국가·조회 표면의 Lazada 새 읽기 권한이 없습니다.");
    }
    if (code.includes("CONFLICT") || code.includes("BINDING_MISMATCH")) {
      return fail(409, code, "완료 회차 또는 새 읽기 요청이 현재 서버 상태와 일치하지 않습니다.");
    }
    return fail(502, "LAZADA_SUPPLEMENTAL_RESYNC_UNVERIFIED", "Lazada 보조 CS 새 읽기 결과를 확인하지 못했습니다.");
  }
}

