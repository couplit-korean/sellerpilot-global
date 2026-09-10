import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  completeSmartstoreListingCreate,
} from "../../../../../lib/server-smartstore-listing-create-completion";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const digits = z.string().regex(/^[0-9]+$/u);
const completeSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  originProductNo: digits,
  channelProductNo: digits,
  responsePayload: z.record(z.string(), z.unknown()),
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

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "스마트스토어 등록 완료 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  try {
    const completion = await completeSmartstoreListingCreate({
      rpc: (name, argumentsValue) => serviceClient.rpc(name, argumentsValue),
      tokenHash,
      jobId: parsed.data.jobId,
      claimToken: parsed.data.claimToken,
      originProductNo: parsed.data.originProductNo,
      channelProductNo: parsed.data.channelProductNo,
      responsePayload: parsed.data.responsePayload,
    });
    return NextResponse.json(completion, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    const unavailable = error instanceof Error
      && error.message === "SMARTSTORE_CREATE_COMPLETION_UNAVAILABLE";
    return NextResponse.json(
      { message: workerRpcErrorMessage(unavailable ? 503 : 409) },
      { status: unavailable ? 503 : 409 },
    );
  }
}
