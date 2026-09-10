import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { csCredentialBindingsSchema } from "../../../../../lib/cs/credential-bindings";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_read_cs_credential_bindings_v1");
  if (error) return NextResponse.json({ message: "CS 자격증명 결속을 읽지 못했습니다." }, { status: 503, headers });
  const parsed = csCredentialBindingsSchema.safeParse(data);
  return parsed.success
    ? NextResponse.json(parsed.data, { headers })
    : NextResponse.json({ message: "CS 자격증명 결속 형식을 확인하지 못했습니다." }, { status: 502, headers });
}
