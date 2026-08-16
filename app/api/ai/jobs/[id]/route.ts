import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";

export async function GET(request: Request, context: RouteContext<"/api/ai/jobs/[id]">) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const { id } = await context.params;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: id });
  if (error) return NextResponse.json({ message: "CLI 작업 상태를 읽지 못했습니다." }, { status: 500 });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "요청한 CLI 작업을 찾지 못했습니다." }, { status: 404 });
  }

  const job = data as Record<string, unknown>;
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
    ? { ...(job.result as Record<string, unknown>) }
    : null;
  if (result && typeof result.hero_storage_path === "string") {
    const { data: signed } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrl(result.hero_storage_path, 60 * 60);
    result.heroUrl = signed?.signedUrl ?? null;
    delete result.hero_storage_path;
  }

  return NextResponse.json({ ...job, result }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
