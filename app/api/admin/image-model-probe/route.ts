import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Operator diagnostic: which image models this deployment can actually generate
// with. The Vercel AI Gateway free tier covers only a subset of the catalog, so
// the first-draft pipeline must know which model it may rely on instead of
// failing into the source-photo fallback.
const candidateModels = [
  "google/gemini-3.1-flash-image",
  "google/gemini-3.1-flash-lite-image",
  "xai/grok-imagine-image-2.0",
  "bytedance/seedream-5.0-pro",
  "meta/muse-image-1.0",
  "recraft/recraft-v4.1",
  "openai/gpt-image-2",
] as const;

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const { generateImage } = await import("ai");
  const results: Array<Record<string, unknown>> = [];
  for (const model of candidateModels) {
    const started = Date.now();
    try {
      const generated = await generateImage({
        model,
        prompt: "a plain white ceramic mug on a light gray studio background",
        n: 1,
        size: "1024x1024",
        maxRetries: 0,
      });
      const bytes = generated.images?.[0]?.uint8Array?.byteLength ?? 0;
      results.push({ model, ok: bytes > 0, bytes, ms: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ model, ok: false, ms: Date.now() - started, message: message.slice(0, 200) });
    }
  }
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store, max-age=0" } });
}
