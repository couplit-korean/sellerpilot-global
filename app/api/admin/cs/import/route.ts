import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { chunkCsImportRows, prepareCsImportRows } from "../../../../../lib/cs/import-staging";
import { csImportMaxRows } from "../../../../../lib/cs/import-limits";
import { csImportPreviewSchema } from "../../../../../lib/cs/import-preview";
import { activeChannelKeys } from "../../../../../lib/channels/catalog";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "cache-control": "private, no-store, max-age=0" };
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const beginSchema = z.object({
  action: z.literal("begin"),
  credentialId: z.string().uuid(),
  channel: z.enum(activeChannelKeys),
  sourceName: z.string().trim().min(1).max(240),
  sourceDigest: digestSchema,
  sourceAccountKey: digestSchema,
  declaredRowCount: z.number().int().min(1).max(csImportMaxRows),
}).strict();
const stageSchema = z.object({
  action: z.literal("stage"),
  batchId: z.string().uuid(),
  sourceDigest: digestSchema,
  startRowNumber: z.number().int().min(1).max(csImportMaxRows),
  records: z.array(z.unknown()).min(1).max(500),
}).strict();
const uploadSchema = z.discriminatedUnion("action", [beginSchema, stageSchema]);
const actionSchema = z.object({ batchId: z.string().uuid(), action: z.enum(["commit", "cancel"]) }).strict();
const previewQuerySchema = z.object({
  batchId: z.string().uuid(),
  afterRowNumber: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const batchStatusSchema = z.enum(["staging", "preview_ready", "committing", "committed", "cancelled"]);
const begunBatchSchema = z.object({
  batchId: z.string().uuid(),
  status: batchStatusSchema,
  stagedRowCount: z.number().int().min(0),
  declaredRowCount: z.number().int().positive(),
  nextRowNumber: z.number().int().positive().nullable(),
  remainingRowCount: z.number().int().min(0).nullable().optional(),
  reused: z.boolean(),
}).strict().superRefine((batch, context) => {
  if (batch.stagedRowCount > batch.declaredRowCount) {
    context.addIssue({ code: "custom", path: ["stagedRowCount"], message: "invalid staged count" });
  }
  if (batch.status === "staging" && batch.nextRowNumber === null) {
    context.addIssue({ code: "custom", path: ["nextRowNumber"], message: "staging batch requires a resume row" });
  }
  if (["preview_ready", "committing", "committed"].includes(batch.status)
      && (batch.stagedRowCount !== batch.declaredRowCount || batch.nextRowNumber !== null)) {
    context.addIssue({ code: "custom", path: ["status"], message: "complete staging state is inconsistent" });
  }
});
const stagedBatchSchema = z.object({
  batchId: z.string().uuid(),
  status: z.enum(["staging", "preview_ready"]),
  stagedRowCount: z.number().int().min(0),
  declaredRowCount: z.number().int().positive(),
  nextRowNumber: z.number().int().positive().nullable(),
}).strict().superRefine((batch, context) => {
  if (batch.stagedRowCount > batch.declaredRowCount
      || (batch.status === "preview_ready"
        && (batch.stagedRowCount !== batch.declaredRowCount || batch.nextRowNumber !== null))
      || (batch.status === "staging" && batch.nextRowNumber === null)) {
    context.addIssue({ code: "custom", path: ["status"], message: "stage progress is inconsistent" });
  }
});
const commitReceiptSchema = z.object({
  contract: z.literal("sellerpilot-cs-import/1"),
  batchId: z.string().uuid(),
  status: z.enum(["committing", "committed"]),
  importedRowCount: z.number().int().min(0),
  duplicateRowCount: z.number().int().min(0),
  remainingRowCount: z.number().int().min(0),
  processedThisCall: z.number().int().min(0),
}).strict().superRefine((receipt, context) => {
  if ((receipt.status === "committed") !== (receipt.remainingRowCount === 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "commit progress is inconsistent" });
  }
});
const cancelReceiptSchema = z.object({
  contract: z.literal("sellerpilot-cs-import/1"),
  batchId: z.string().uuid(),
  status: z.literal("cancelled"),
  existingDataChanged: z.literal(false),
}).strict();

function requestBodyTooLarge(request: Request) {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > 1_250_000;
}

async function readBoundedJson(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 1_250_000) throw new Error("CS_IMPORT_REQUEST_TOO_LARGE");
  return JSON.parse(text);
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const url = new URL(request.url);
  const query = previewQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return NextResponse.json({ message: "가져오기 미리보기 범위가 올바르지 않습니다." }, { status: 400, headers });
  }
  const result = await admin.userClient.rpc("sellerpilot_get_cs_import_preview_v1", {
    p_batch_id: query.data.batchId,
    p_after_row_number: query.data.afterRowNumber,
    p_limit: query.data.limit,
  });
  if (result.error) {
    return NextResponse.json({ message: "가져오기 미리보기를 조회하지 못했습니다." }, { status: 503, headers });
  }
  const preview = csImportPreviewSchema.safeParse(result.data);
  return preview.success
    ? NextResponse.json(preview.data, { headers })
    : NextResponse.json({ message: "가져오기 미리보기 응답이 올바르지 않습니다." }, { status: 502, headers });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  if (requestBodyTooLarge(request)) {
    return NextResponse.json({ message: "가져오기 조각이 너무 큽니다." }, { status: 413, headers });
  }
  let rawBody: unknown;
  try {
    rawBody = await readBoundedJson(request);
  } catch (error) {
    const status = error instanceof Error && error.message === "CS_IMPORT_REQUEST_TOO_LARGE" ? 413 : 400;
    return NextResponse.json({ message: status === 413 ? "가져오기 조각이 너무 큽니다." : "가져오기 요청 형식이 올바르지 않습니다." }, { status, headers });
  }
  const body = uploadSchema.safeParse(rawBody);
  if (!body.success) {
    return NextResponse.json({ message: "가져오기 요청 형식이 올바르지 않습니다." }, { status: 400, headers });
  }

  if (body.data.action === "begin") {
    const begun = await admin.userClient.rpc("sellerpilot_begin_cs_import_v1", {
      p_credential_id: body.data.credentialId,
      p_channel: body.data.channel,
      p_source_format: "normalized_json_v1",
      p_source_digest: body.data.sourceDigest,
      p_source_account_key: body.data.sourceAccountKey,
      p_source_name: body.data.sourceName,
      p_declared_row_count: body.data.declaredRowCount,
    });
    if (begun.error) {
      return NextResponse.json({ message: "원본 계정과 연결 자격증명이 일치하지 않습니다." }, { status: 409, headers });
    }
    const batch = begunBatchSchema.safeParse(begun.data);
    if (!batch.success || batch.data.declaredRowCount !== body.data.declaredRowCount) {
      return NextResponse.json({ message: "가져오기 배치 상태가 올바르지 않습니다." }, { status: 502, headers });
    }
    return NextResponse.json({
      contract: "sellerpilot-cs-import/1",
      ...batch.data,
      sourceDigest: body.data.sourceDigest,
      providerSpecificAdapters: "sample_required",
    }, { headers });
  }

  let rows;
  try {
    rows = prepareCsImportRows(body.data.records, body.data.startRowNumber, body.data.sourceDigest);
  } catch {
    return NextResponse.json({ message: "정규화된 CS export 행 계약을 확인해 주세요." }, { status: 400, headers });
  }
  const chunks = chunkCsImportRows(rows);
  let state: z.infer<typeof stagedBatchSchema> | null = null;
  for (const chunk of chunks) {
    const staged = await admin.userClient.rpc("sellerpilot_stage_cs_import_rows_v1", {
      p_batch_id: body.data.batchId,
      p_expected_source_digest: body.data.sourceDigest,
      p_rows: chunk,
    });
    if (staged.error) {
      return NextResponse.json({
        message: "가져오기 행 검증에 실패했습니다.",
        batchId: body.data.batchId,
        status: "staging",
        stagedRowCount: state?.stagedRowCount ?? 0,
      }, { status: 409, headers });
    }
    const parsed = stagedBatchSchema.safeParse(staged.data);
    if (!parsed.success || parsed.data.batchId !== body.data.batchId) {
      return NextResponse.json({ message: "검증된 가져오기 상태를 확인하지 못했습니다." }, { status: 502, headers });
    }
    state = parsed.data;
  }
  if (!state) {
    return NextResponse.json({ message: "가져오기 행을 준비하지 못했습니다." }, { status: 502, headers });
  }
  return NextResponse.json({ contract: "sellerpilot-cs-import/1", ...state, sourceDigest: body.data.sourceDigest }, { headers });
}

export async function PATCH(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const body = actionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ message: "배치 작업 형식이 올바르지 않습니다." }, { status: 400, headers });
  }
  const rpc = body.data.action === "commit"
    ? "sellerpilot_commit_cs_import_v1"
    : "sellerpilot_cancel_cs_import_v1";
  const result = await admin.userClient.rpc(rpc, { p_batch_id: body.data.batchId });
  if (result.error) {
    return NextResponse.json({ message: "배치 상태를 변경하지 못했습니다." }, { status: 409, headers });
  }
  const receipt = body.data.action === "commit"
    ? commitReceiptSchema.safeParse(result.data)
    : cancelReceiptSchema.safeParse(result.data);
  return receipt.success
    ? NextResponse.json(receipt.data, { headers })
    : NextResponse.json({ message: "배치 처리 결과가 올바르지 않습니다." }, { status: 502, headers });
}
