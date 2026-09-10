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

const identity = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
});
const stage = z.object({
  sequence: z.number().int().min(0).max(10),
  stage: z.enum(["image-upload", "global-item-create", "local-publish"]),
  preparedPayloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(),
  globalItemId: z.string().regex(/^[1-9][0-9]{0,31}$/u).nullable().optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  identity.extend({ action: z.literal("state") }),
  identity.extend({ action: z.literal("resume") }),
  identity.extend({ action: z.literal("rebind-successor") }),
  identity.merge(stage).extend({ action: z.literal("begin") }),
  identity.merge(stage).extend({
    action: z.literal("complete"),
    outputId: z.string().min(1).max(255),
    result: z.record(z.string(), z.unknown()),
  }),
  identity.extend({
    action: z.literal("record-global"),
    globalItemId: z.string().regex(/^[1-9][0-9]{0,31}$/u),
    createResponse: z.record(z.string(), z.unknown()),
    readbackResponse: z.record(z.string(), z.unknown()),
    preparedArguments: z.record(z.string(), z.unknown()),
  }),
]);

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "채널 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Shopee SG 단계 경계 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const common = {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_claim_token: parsed.data.claimToken,
  };
  let rpc: string;
  let parameters: Record<string, unknown> = common;
  switch (parsed.data.action) {
    case "state":
      rpc = "sellerpilot_service_read_shopee_sg_create_stage_state_v1";
      break;
    case "resume":
      rpc = "sellerpilot_service_read_shopee_sg_create_resume_v1";
      break;
    case "rebind-successor":
      rpc = "sellerpilot_service_rebind_shopee_sg_successor_v1";
      break;
    case "begin":
    case "complete": {
      const value = parsed.data;
      rpc = value.action === "begin"
        ? "sellerpilot_service_begin_shopee_sg_create_stage_v1"
        : "sellerpilot_service_complete_shopee_sg_create_stage_v1";
      parameters = {
        ...common,
        p_stage_sequence: value.sequence,
        p_stage_name: value.stage,
        p_prepared_payload_sha256: value.preparedPayloadSha256,
        p_source_url: value.sourceUrl ?? null,
        p_source_sha256: value.sourceSha256 ?? null,
        p_global_item_id: value.globalItemId ?? null,
        ...(value.action === "complete" ? {
          p_output_id: value.outputId,
          p_result: value.result,
        } : {}),
      };
      break;
    }
    case "record-global":
      rpc = "sellerpilot_service_record_shopee_sg_global_create_readback_v1";
      parameters = {
        ...common,
        p_global_item_id: parsed.data.globalItemId,
        p_create_response: parsed.data.createResponse,
        p_readback_response: parsed.data.readbackResponse,
        p_prepared_arguments: parsed.data.preparedArguments,
      };
      break;
  }
  const { data, error } = await serviceClient.rpc(rpc, parameters);
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("Shopee SG create stage RPC failed", {
      action: parsed.data.action,
      code: error.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
