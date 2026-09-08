import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import { projectElevenstReadStateRpc } from "../../../../../../../lib/cs/channels/elevenst/web-rpc";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_elevenst_cs_read_state_v1", {
      p_seller_id: "couplit",
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
