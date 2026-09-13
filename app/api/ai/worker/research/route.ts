import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs, coreFirstDraftAssetIds } from "../../../../../lib/ai-generated-assets";
import { sourceImagePathsForWorker } from "../../../../../lib/studio-image-paths";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch, workerRpcErrorStatus } from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "no-store, max-age=0" };
const actions = new Set(["claim", "touch", "release", "complete", "sources", "upload", "remove"]);
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token.startsWith("spw_") || token.length < 24) return NextResponse.json({ message: "작업자 인증이 필요합니다." }, { status: 401, headers });
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret || !supabaseUrl) return NextResponse.json({ message: "작업자 연결을 확인해 주세요." }, { status: 503, headers });
  const body = await request.json().catch(() => null);
  if (!body || !actions.has(body.action) || !body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) return NextResponse.json({ message: "잘못된 분석 요청입니다." }, { status: 400, headers });
  const client = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: createBoundedSupabaseFetch() } });
  const storageAction = ["sources", "upload", "remove"].includes(body.action);
  const { data, error } = await client.rpc("sellerpilot_service_local_product_research", {
    p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_action: storageAction ? "context" : body.action,
    p_arguments: body.arguments,
  });
  if (error) return NextResponse.json({ message: "분석 작업 소유권 또는 연결을 확인하지 못했습니다." }, { status: workerRpcErrorStatus(error), headers });
  if (!storageAction) return NextResponse.json({ data }, { headers });
  try {
    const bucket = client.storage.from("sellerpilot-ai");
    if (body.action === "sources") {
      const paths = sourceImagePathsForWorker(data.image_paths, data.image_specs);
      const signed = await bucket.createSignedUrls(paths, 15 * 60);
      if (signed.error || signed.data?.length !== paths.length || signed.data.some(item => !item.signedUrl || item.error)) throw new Error("source_signing");
      return NextResponse.json({ data: signed.data.map((item, i) => ({ path: paths[i], url: item.signedUrl })) }, { headers });
    }
    const specs = aiGeneratedAssetSpecs.filter(asset => coreFirstDraftAssetIds.includes(asset.id as typeof coreFirstDraftAssetIds[number]));
    const expected = new Map(specs.map(spec => [aiGeneratedAssetPath(body.arguments.p_job_id, spec, body.arguments.p_claim_token), spec]));
    if (body.action === "remove") {
      if (!Array.isArray(body.paths) || body.paths.some((path: unknown) => typeof path !== "string" || !expected.has(path))) return NextResponse.json({ message: "허용되지 않은 이미지 경로입니다." }, { status: 400, headers });
      const removed = await bucket.remove(body.paths);
      if (removed.error) throw new Error("remove_failed");
      return NextResponse.json({ data: true }, { headers });
    }
    const spec = expected.get(body.path);
    if (!spec || typeof body.bytes !== "string" || body.bytes.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.bytes)) return NextResponse.json({ message: "잘못된 이미지 업로드입니다." }, { status: 400, headers });
    const bytes = Buffer.from(body.bytes, "base64");
    const meta = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
    if (meta.format !== "png" || meta.width !== spec.width || meta.height !== spec.height) return NextResponse.json({ message: "이미지 규격이 다릅니다." }, { status: 400, headers });
    const uploaded = await bucket.upload(body.path, bytes, { contentType: "image/png", upsert: false });
    if (uploaded.error) {
      const existing = await bucket.download(body.path);
      if (existing.error || !existing.data || !Buffer.from(await existing.data.arrayBuffer()).equals(bytes)) throw new Error("upload_failed");
      return NextResponse.json({ data: "identical" }, { headers });
    }
    return NextResponse.json({ data: "uploaded" }, { headers });
  } catch {
    return NextResponse.json({ message: "분석 이미지 저장 연결을 확인하지 못했습니다." }, { status: 503, headers });
  }
}
