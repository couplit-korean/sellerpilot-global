import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const stageSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  bodyText: z.string().min(2).max(1_048_576),
  bodySha256: digest,
  bodyByteLength: z.number().int().min(2).max(1_048_576),
  bodyBindingSha256: digest,
}).strict();

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json(
      { message: "채널 작업자 인증이 필요합니다." },
      { status: 401 },
    );
  }
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json(
      { message: workerRpcErrorMessage(503) },
      { status: 503 },
    );
  }

  const parsed = stageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success
      || Buffer.byteLength(parsed.data.bodyText, "utf8")
        !== parsed.data.bodyByteLength
      || createHash("sha256").update(parsed.data.bodyText, "utf8").digest("hex")
        !== parsed.data.bodySha256) {
    return NextResponse.json(
      { message: "스마트스토어 최종 전송 본문 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data, error } = await serviceClient.rpc(
    "sellerpilot_service_stage_smartstore_create_transport",
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_body_text: parsed.data.bodyText,
      p_body_sha256: parsed.data.bodySha256,
      p_body_byte_length: parsed.data.bodyByteLength,
      p_body_binding_sha256: parsed.data.bodyBindingSha256,
    },
  );
  if (error) {
    const status = workerRpcErrorStatus(error);
    return NextResponse.json(
      { message: workerRpcErrorMessage(status) },
      { status },
    );
  }
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
