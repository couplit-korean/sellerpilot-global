import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../../lib/admin-api";
import {
  lazadaSupplementalUiScopesSchema,
  lazadaSupplementalUiScopeStateSchema,
} from "../../../../../../../../lib/cs/channels/lazada/supplemental-ui-workflow";
import { lazadaSupplementalSourcePathSchema } from "../../../../../../../../lib/cs/channels/lazada/supplemental-contract";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const scopeQuerySchema = z.object({
  view: z.literal("scope"),
  credentialId: z.string().uuid(),
  country: z.enum(["SG", "MY", "TH", "VN", "ID", "PH"]),
  sourcePath: lazadaSupplementalSourcePathSchema,
  resourceId: z.string().regex(/^(?:|[1-9][0-9]{0,31})$/u),
  limit: z.coerce.number().int().min(1).max(50),
}).strict().superRefine((value, context) => {
  if (value.sourcePath !== "/reverse/getreverseordersforseller" && !value.resourceId) {
    context.addIssue({ code: "custom", message: "resource required" });
  }
});

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers });
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "scopes") {
    if ([...url.searchParams.keys()].some((key) => key !== "view")) {
      return fail(400, "LAZADA_SUPPLEMENTAL_UI_QUERY_INVALID", "Lazada 조회 범위 요청을 확인해 주세요.");
    }
    const { data, error } = await admin.userClient.rpc(
      "sellerpilot_list_lazada_supplemental_ui_scopes_v1",
    );
    const parsed = lazadaSupplementalUiScopesSchema.safeParse(data);
    if (error || !parsed.success) {
      return fail(503, "LAZADA_SUPPLEMENTAL_UI_SCOPES_UNAVAILABLE", "Lazada 연결 계정과 권한 범위를 확인하지 못했습니다.");
    }
    return NextResponse.json(parsed.data, { headers });
  }
  if (view !== "scope") {
    return fail(400, "LAZADA_SUPPLEMENTAL_UI_VIEW_INVALID", "Lazada 조회 화면 종류를 확인해 주세요.");
  }
  const parsedQuery = scopeQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsedQuery.success) {
    return fail(400, "LAZADA_SUPPLEMENTAL_UI_SCOPE_INVALID", "계정·국가·조회 경로와 대상 ID를 확인해 주세요.");
  }
  const query = parsedQuery.data;
  const { data, error } = await admin.userClient.rpc(
    "sellerpilot_read_lazada_supplemental_ui_scope_v1",
    {
      p_credential_id: query.credentialId,
      p_country: query.country,
      p_source_path: query.sourcePath,
      p_resource_id: query.resourceId || null,
      p_limit: query.limit,
    },
  );
  const parsed = lazadaSupplementalUiScopeStateSchema.safeParse(data);
  const expectedSurface = query.sourcePath === "/review/seller/list"
    ? "product_review"
    : "reverse_order_after_sales";
  if (error) {
    return fail(409, "LAZADA_SUPPLEMENTAL_UI_SCOPE_UNAVAILABLE", "선택한 Lazada 계정·국가 범위가 현재 서버 권한과 일치하지 않습니다.");
  }
  if (!parsed.success || parsed.data.credentialId !== query.credentialId
      || parsed.data.country !== query.country || parsed.data.surface !== expectedSurface
      || parsed.data.sourcePath !== query.sourcePath
      || parsed.data.resourceId !== query.resourceId) {
    return fail(502, "LAZADA_SUPPLEMENTAL_UI_SCOPE_MISMATCH", "선택한 Lazada 조회 상태의 계정·범위를 검증하지 못했습니다.");
  }
  return NextResponse.json(parsed.data, { headers });
}
