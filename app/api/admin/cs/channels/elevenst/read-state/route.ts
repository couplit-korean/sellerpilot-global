import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { projectElevenstReadStateRpc } from "../../../../../../../lib/cs/channels/elevenst/web-rpc";
import { elevenstReadAccountsSchema } from "../../../../../../../lib/cs/channels/elevenst/read-state-contract";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) {
    return NextResponse.json({
      code: "ELEVENST_READ_SELECTION_INVALID",
      message: "11번가 조회 조건이 중복됐습니다.",
    }, { status: 400, headers: responseHeaders });
  }
  const view = params.get("view") ?? "accounts";
  const credentialId = params.get("credentialId") ?? "";
  if (!["accounts", "state"].includes(view)
      || (view === "accounts" && (credentialId || params.size !== (params.has("view") ? 1 : 0)))
      || (view === "state" && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(credentialId)
        || params.size !== 2))) {
    return NextResponse.json({
      code: "ELEVENST_READ_SELECTION_INVALID",
      message: "조회할 활성 11번가 계정을 선택해야 합니다.",
    }, { status: 400, headers: responseHeaders });
  }
  try {
    if (view === "accounts") {
      const { data, error } = await admin.userClient.rpc("sellerpilot_read_elevenst_cs_accounts_v1");
      if (error) throw error;
      return NextResponse.json(elevenstReadAccountsSchema.parse(data), { headers: responseHeaders });
    }
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_elevenst_cs_read_state_v3", {
      p_credential_id: credentialId,
    });
    if (error) {
      return NextResponse.json({
        code: "ELEVENST_READ_STATE_UNAVAILABLE",
        message: "11번가 CS 읽기 상태를 조회하지 못했습니다.",
      }, { status: 503, headers: responseHeaders });
    }
    return NextResponse.json(projectElevenstReadStateRpc(data), { headers: responseHeaders });
  } catch {
    return NextResponse.json({
      code: "ELEVENST_READ_STATE_INVALID",
      message: "11번가 CS 읽기 상태 응답을 검증하지 못했습니다.",
    }, { status: 502, headers: responseHeaders });
  }
}
