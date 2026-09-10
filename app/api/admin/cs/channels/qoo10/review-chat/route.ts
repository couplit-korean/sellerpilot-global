import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  projectQoo10ReviewChatStatus,
  qoo10ReviewChatAccountsSchema,
  qoo10ReviewChatObservationReadSchema,
} from "../../../../../../../lib/cs/channels/qoo10/review-chat-contract";
import { qoo10InquirySourceReadSchema } from "../../../../../../../lib/cs/channels/qoo10/source-capability";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  const params = new URL(request.url).searchParams;
  const allowedKeys = new Set(["view", "credentialId"]);
  if ([...params.keys()].some(
    (key) => !allowedKeys.has(key) || params.getAll(key).length !== 1,
  )) {
    return NextResponse.json({
      code: "QOO10_REVIEW_CHAT_SELECTION_INVALID",
      message: "Qoo10 review·Buyer Chat 조회 조건을 확인해 주세요.",
    }, { status: 400, headers });
  }
  const view = params.get("view") ?? "accounts";
  const credentialId = params.get("credentialId") ?? "";
  if (!new Set(["accounts", "status"]).has(view)
      || (view === "accounts" && (
        credentialId || params.size !== (params.has("view") ? 1 : 0)
      ))
      || (view === "status" && (
        !uuidPattern.test(credentialId) || params.size !== 2
      ))) {
    return NextResponse.json({
      code: "QOO10_REVIEW_CHAT_SELECTION_INVALID",
      message: "조회할 Qoo10 연결 계정을 선택해 주세요.",
    }, { status: 400, headers });
  }

  try {
    const accountsResult = await admin.userClient.rpc(
      "sellerpilot_read_qoo10_review_chat_accounts_v1",
    );
    const accounts = qoo10ReviewChatAccountsSchema.safeParse(accountsResult.data);
    if (accountsResult.error || !accounts.success) {
      return NextResponse.json({
        code: "QOO10_REVIEW_CHAT_ACCOUNTS_UNAVAILABLE",
        message: "Qoo10 연결 계정 상태를 조회하지 못했습니다.",
      }, { status: 503, headers });
    }
    if (view === "accounts") {
      return NextResponse.json(accounts.data, { headers });
    }

    const account = accounts.data.accounts.find(
      (candidate) => candidate.credentialId === credentialId,
    );
    if (!account) {
      return NextResponse.json({
        code: "QOO10_REVIEW_CHAT_ACCOUNT_MISMATCH",
        message: "선택한 Qoo10 계정과 조회 가능한 계정이 일치하지 않습니다.",
      }, { status: 409, headers });
    }

    const observationResult = await admin.userClient.rpc(
      "sellerpilot_read_qoo10_review_chat_observation_v1",
      { p_credential_id: account.credentialId },
    );
    if (observationResult.error) {
      return NextResponse.json({
        code: "QOO10_REVIEW_CHAT_OBSERVATION_UNAVAILABLE",
        message: "Qoo10 review·Buyer Chat 관측 원장을 조회하지 못했습니다.",
      }, { status: 503, headers });
    }
    const read = qoo10ReviewChatObservationReadSchema.safeParse(
      observationResult.data,
    );
    if (!read.success) {
      return NextResponse.json({
        code: "QOO10_REVIEW_CHAT_OBSERVATION_INVALID",
        message: "Qoo10 review·Buyer Chat 관측 원장의 결속을 검증하지 못했습니다.",
      }, { status: 502, headers });
    }

    const inquirySourceResult = await admin.userClient.rpc(
      "sellerpilot_read_qoo10_inquiry_source_v1",
      { p_credential_id: account.credentialId },
    );
    if (inquirySourceResult.error) {
      return NextResponse.json({
        code: "QOO10_INQUIRY_SOURCE_UNAVAILABLE",
        message: "Qoo10 일반 문의 canonical 원장 상태를 조회하지 못했습니다.",
      }, { status: 503, headers });
    }
    const inquirySourceRead = qoo10InquirySourceReadSchema.safeParse(
      inquirySourceResult.data,
    );
    if (!inquirySourceRead.success) {
      return NextResponse.json({
        code: "QOO10_INQUIRY_SOURCE_INVALID",
        message: "Qoo10 일반 문의 원장의 계정 결속을 검증하지 못했습니다.",
      }, { status: 502, headers });
    }

    return NextResponse.json(projectQoo10ReviewChatStatus({
      expectedAccount: account,
      runtimeRead: read.data,
      inquirySourceRead: inquirySourceRead.data,
    }), { headers });
  } catch {
    return NextResponse.json({
      code: "QOO10_REVIEW_CHAT_STATUS_INVALID",
      message: "Qoo10 review·Buyer Chat 증거 상태를 검증하지 못했습니다.",
    }, { status: 502, headers });
  }
}
