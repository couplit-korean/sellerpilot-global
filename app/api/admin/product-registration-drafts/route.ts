import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import {
  PRODUCT_REGISTRATION_DRAFT_GET_RPC,
  PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES,
  PRODUCT_REGISTRATION_DRAFT_PUT_RPC,
  parseProductRegistrationDraftPut,
  parseProductRegistrationDraftQuery,
  productRegistrationDraftDataIssue,
  productRegistrationDraftRpcResult,
} from "../../../../lib/product-registration-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store, max-age=0" };
const maxRequestBytes = PRODUCT_REGISTRATION_DRAFT_MAX_DATA_BYTES + 8_192;

type RpcError = { code?: string; message?: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function storageUnavailable(error: RpcError) {
  return ["PGRST002", "PGRST202", "42883", "42P01"].includes(error.code ?? "")
    || /schema cache|does not exist|could not find the function/i.test(error.message ?? "");
}

function rpcErrorResponse(error: RpcError, operation: "read" | "write") {
  const message = error.message ?? "";
  if (message.includes("PRODUCT_REGISTRATION_DRAFT_QUERY_INVALID")) {
    return json({
      code: operation === "read"
        ? "PRODUCT_REGISTRATION_DRAFT_INVALID_QUERY"
        : "PRODUCT_REGISTRATION_DRAFT_INVALID_BODY",
      message: operation === "read"
        ? "초안 ID와 종류를 확인해 주세요."
        : "초안 저장 형식을 확인해 주세요.",
    }, 400);
  }
  if (message.includes("PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT")) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT",
      message: "다른 창에서 초안이 먼저 저장되었습니다. 최신 초안을 다시 불러와 주세요.",
    }, 409);
  }
  if (message.includes("PRODUCT_REGISTRATION_DRAFT_PRODUCT_REBIND_FORBIDDEN")) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_PRODUCT_REBIND_FORBIDDEN",
      message: "이미 연결된 초안을 다른 상품에 연결할 수 없습니다.",
    }, 409);
  }
  if (message.includes("PRODUCT_REGISTRATION_DRAFT_PRODUCT_NOT_OWNED")) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_PRODUCT_NOT_OWNED",
      message: "초안에 연결할 상품을 사용할 권한이 없습니다.",
    }, 403);
  }
  if (message.includes("PRODUCT_REGISTRATION_DRAFT_DATA_INVALID")) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_DATA_INVALID",
      message: "초안 데이터 형식이나 크기가 허용 범위를 벗어났습니다.",
    }, 400);
  }
  if (error.code === "42501") {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_ACCESS_DENIED",
      message: "초안 저장소에 접근할 권한이 없습니다.",
    }, 403);
  }
  if (storageUnavailable(error)) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_STORAGE_UNAVAILABLE",
      message: "초안 저장소가 아직 설치되지 않았거나 현재 사용할 수 없습니다.",
    }, 503);
  }
  return json({
    code: operation === "read"
      ? "PRODUCT_REGISTRATION_DRAFT_READ_FAILED"
      : "PRODUCT_REGISTRATION_DRAFT_WRITE_FAILED",
    message: operation === "read"
      ? "저장된 상품 등록 초안을 불러오지 못했습니다."
      : "상품 등록 초안을 저장하지 못했습니다.",
  }, 503);
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const parsed = parseProductRegistrationDraftQuery({
    draftId: url.searchParams.get("draftId"),
    kind: url.searchParams.get("kind"),
  });
  if (!parsed.success) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_INVALID_QUERY",
      message: "초안 ID와 종류를 확인해 주세요.",
      draft: null,
    }, 400);
  }

  let result: Awaited<ReturnType<typeof admin.serviceClient.rpc>>;
  try {
    result = await admin.serviceClient.rpc(
      PRODUCT_REGISTRATION_DRAFT_GET_RPC,
      {
        p_owner_id: admin.user.id,
        p_draft_id: parsed.data.draftId,
        p_kind: parsed.data.kind,
      },
    );
  } catch {
    return rpcErrorResponse({}, "read");
  }
  const { data, error } = result;
  if (error) return rpcErrorResponse(error, "read");

  try {
    const draft = productRegistrationDraftRpcResult(data);
    if (draft && (
      draft.draftId !== parsed.data.draftId
      || draft.kind !== parsed.data.kind
    )) {
      return json({
        code: "PRODUCT_REGISTRATION_DRAFT_READ_FAILED",
        message: "저장된 초안의 식별자가 요청과 일치하지 않습니다.",
        draft: null,
      }, 503);
    }
    return json({ draft });
  } catch {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_READ_FAILED",
      message: "저장된 상품 등록 초안의 형식이 올바르지 않습니다.",
      draft: null,
    }, 503);
  }
}

export async function PUT(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_DATA_TOO_LARGE",
      message: "초안 데이터가 허용된 크기를 초과했습니다.",
    }, 400);
  }

  const bodyText = await request.text().catch(() => "");
  if (new TextEncoder().encode(bodyText).byteLength > maxRequestBytes) {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_DATA_TOO_LARGE",
      message: "초안 데이터가 허용된 크기를 초과했습니다.",
    }, 400);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_INVALID_BODY",
      message: "초안 저장 요청이 올바른 JSON이 아닙니다.",
    }, 400);
  }

  const parsed = parseProductRegistrationDraftPut(body);
  if (!parsed.success) {
    const data = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).data
      : undefined;
    const dataIssue = productRegistrationDraftDataIssue(data);
    return json({
      code: dataIssue?.includes("bytes")
        ? "PRODUCT_REGISTRATION_DRAFT_DATA_TOO_LARGE"
        : dataIssue
          ? "PRODUCT_REGISTRATION_DRAFT_DATA_INVALID"
          : "PRODUCT_REGISTRATION_DRAFT_INVALID_BODY",
      message: dataIssue ?? parsed.error.issues[0]?.message ?? "초안 저장 형식을 확인해 주세요.",
    }, 400);
  }

  let result: Awaited<ReturnType<typeof admin.serviceClient.rpc>>;
  try {
    result = await admin.serviceClient.rpc(
      PRODUCT_REGISTRATION_DRAFT_PUT_RPC,
      {
        p_owner_id: admin.user.id,
        p_draft_id: parsed.data.draftId,
        p_kind: parsed.data.kind,
        p_product_id: parsed.data.productId ?? null,
        p_expected_version: parsed.data.expectedVersion,
        p_data: parsed.data.data,
      },
    );
  } catch {
    return rpcErrorResponse({}, "write");
  }
  const { data, error } = result;
  if (error) return rpcErrorResponse(error, "write");

  try {
    const draft = productRegistrationDraftRpcResult(data);
    if (!draft
        || draft.draftId !== parsed.data.draftId
        || draft.kind !== parsed.data.kind
        || (parsed.data.productId && draft.productId !== parsed.data.productId)
        || draft.version !== parsed.data.expectedVersion + 1) {
      return json({
        code: "PRODUCT_REGISTRATION_DRAFT_WRITE_FAILED",
        message: "저장된 초안 결과가 요청과 일치하지 않습니다.",
      }, 503);
    }
    return json({ draft });
  } catch {
    return json({
      code: "PRODUCT_REGISTRATION_DRAFT_WRITE_FAILED",
      message: "저장된 상품 등록 초안의 형식이 올바르지 않습니다.",
    }, 503);
  }
}
