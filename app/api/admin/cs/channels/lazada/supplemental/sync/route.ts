import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../lib/admin-api";
import {
  ingestLazadaSupplementalProviderPage,
  lazadaSupplementalProviderSyncRequestSchema,
} from "../../../../../../../../lib/cs/channels/lazada/supplemental-provider-ingest";

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
    return fail(413, "REQUEST_TOO_LARGE", "Lazada 보조 CS 수집 요청이 너무 큽니다.");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4_096) {
    return fail(413, "REQUEST_TOO_LARGE", "Lazada 보조 CS 수집 요청이 너무 큽니다.");
  }
  const parsed = lazadaSupplementalProviderSyncRequestSchema.safeParse(
    (() => { try { return JSON.parse(raw); } catch { return null; } })(),
  );
  if (!parsed.success) {
    return fail(400, "LAZADA_SUPPLEMENTAL_SYNC_INVALID", "Lazada 보조 CS 수집 범위를 확인해 주세요.");
  }

  try {
    const receipt = await ingestLazadaSupplementalProviderPage(parsed.data, {
      prepare: async (input) => {
        const result = await admin.serviceClient.rpc("sellerpilot_service_prepare_lazada_supplemental_read_v1", {
          p_credential_id: input.credentialId,
          p_country: input.country,
          p_source_path: input.sourcePath,
          p_resource_id: input.resourceId ?? null,
          p_page_size: input.pageSize ?? 20,
        });
        return { data: result.data, error: result.error };
      },
      readCredential: async (credentialId) => {
        const result = await admin.serviceClient.rpc("sellerpilot_decrypt_credential", {
          p_credential_id: credentialId,
        });
        return { data: result.data, error: result.error };
      },
      ingestAndAcknowledge: async (input) => {
        const result = await admin.serviceClient.rpc("sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1", {
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
        });
        return { data: result.data, error: result.error };
      },
    });
    return NextResponse.json(receipt, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "LAZADA_SUPPLEMENTAL_PERMISSION_REQUIRED") {
      return fail(403, code, "이 계정·국가·조회 표면의 Lazada 서버 확인 권한이 없습니다.");
    }
    if (code.includes("BINDING_MISMATCH") || code.includes("ACCOUNT_MISMATCH")
        || code.includes("COUNTRY_MISMATCH")) {
      return fail(409, "LAZADA_SUPPLEMENTAL_ACCOUNT_MISMATCH", "Lazada 계정·국가 결합이 일치하지 않습니다.");
    }
    return fail(502, "LAZADA_SUPPLEMENTAL_SYNC_UNVERIFIED", "Lazada 보조 CS 한 페이지 수집 결과를 확인하지 못했습니다.");
  }
}

