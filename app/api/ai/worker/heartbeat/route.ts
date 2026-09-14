import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const heartbeatSchema = z.object({
  jobId: z.string().uuid(),
  version: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || !supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }

  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "CLI 작업자 신호 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc("sellerpilot_touch_ai_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_worker_version: parsed.data.version ?? "sellerpilot-cli-worker/1.1",
  });
  if (error) {
    return NextResponse.json({ message: "CLI 작업자 신호를 저장하지 못했습니다." }, { status: 401 });
  }
  if (!data) {
    return NextResponse.json({ message: "AI 작업을 찾지 못했습니다." }, { status: 404 });
  }
  return NextResponse.json({ status: data }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
