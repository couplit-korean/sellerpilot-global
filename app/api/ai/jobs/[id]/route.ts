import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { sellerSafeAiJobFailure } from "../../../../../lib/ai-worker-error-safety";
import { productResearchFailureMessage } from "../../../../../lib/product-research-failure";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const { id } = await context.params;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: id });
  if (error) return NextResponse.json({ message: "AI 작업 상태를 읽지 못했습니다." }, { status: 500 });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "요청한 AI 작업을 찾지 못했습니다." }, { status: 404 });
  }

  const job = data as Record<string, unknown>;
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
    ? { ...(job.result as Record<string, unknown>) }
    : null;
  if (result && result.asset_storage_paths && typeof result.asset_storage_paths === "object" && !Array.isArray(result.asset_storage_paths)) {
    const entries = Object.entries(result.asset_storage_paths as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string");
    const { data: signed } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrls(entries.map(([, path]) => path), 60 * 60);
    result.heroUrl = signed?.[entries.findIndex(([id]) => id === "hero")]?.signedUrl ?? null;
    result.generatedImages = entries.map(([id], index) => ({ id, url: signed?.[index]?.signedUrl ?? null }));
    delete result.asset_storage_paths;
  } else if (result && typeof result.hero_storage_path === "string") {
    const { data: signed } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrl(result.hero_storage_path, 60 * 60);
    result.heroUrl = signed?.signedUrl ?? null;
    delete result.hero_storage_path;
  }

  if (job.kind === "product_research" && typeof job.error === "string") {
    job.error = productResearchFailureMessage(job.error);
  } else if (typeof job.error === "string") {
    job.error = sellerSafeAiJobFailure(job.error);
  }

  return NextResponse.json({ ...job, result }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
