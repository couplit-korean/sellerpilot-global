import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  beginQoo10GatewayCreateMutationBoundary,
  qoo10DurableCreateFulfillmentBindingArgument,
  qoo10DurableCreateFulfillmentBindingContract,
} from "../../../../../lib/server-qoo10-listing-create-fulfillment-source";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const bindingSchema = z.object({
  contract: z.literal(qoo10DurableCreateFulfillmentBindingContract),
  sourceId: z.string().uuid(),
  ownerId: z.string().uuid(),
  productId: z.string().uuid(),
  credentialId: z.string().uuid(),
  credentialVersion: z.number().int().positive(),
  sellerId: z.string().trim().min(1).max(160),
  market: z.literal("JP"),
  targetId: z.string().trim().min(1).max(160),
  sourceRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  captureDigest: digest,
  fulfillmentEvidenceDigest: digest,
  observedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

const requestSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  binding: bindingSchema,
}).strict();

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
    return NextResponse.json({ message: "Qoo10 CREATE 경계 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const binding = parsed.data.binding;
  try {
    const receipt = await beginQoo10GatewayCreateMutationBoundary({
      rpc: (name, parameters) => serviceClient.rpc(name, parameters),
      argumentsValue: {
        [qoo10DurableCreateFulfillmentBindingArgument]: binding,
        sellerpilotQoo10CreateFulfillmentEvidence: {
          evidenceDigest: binding.fulfillmentEvidenceDigest,
        },
        sellerpilotQoo10CreateApprovalBinding: {
          fulfillmentEvidenceDigest: binding.fulfillmentEvidenceDigest,
        },
      },
      gatewayTokenHash: tokenHash,
      jobId: parsed.data.jobId,
      claimToken: parsed.data.claimToken,
    });
    return NextResponse.json({
      contract: "sellerpilot_qoo10_gateway_create_boundary_v1",
      status: "started",
      sourceId: receipt.binding.sourceId,
      attemptId: receipt.attemptId,
      listingId: receipt.listingId,
      requestFingerprint: receipt.requestFingerprint,
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({
      code: "QOO10_GATEWAY_CREATE_BOUNDARY_UNCERTAIN",
      message: "Qoo10 CREATE 외부 호출 경계를 확정할 수 없어 자동 재시도를 중지합니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
