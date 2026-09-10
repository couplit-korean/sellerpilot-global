import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../../lib/admin-api";
import {
  temuBuyerChatReadinessViewSchema,
  temuBuyerChatRuntimeReadSchema,
  temuCsReadiness,
} from "../../../../../../../lib/channels/cs/temu/runtime-readiness";
import { temuHistoryAccountsSchema } from "../../../../../../../lib/cs/channels/temu/history-resume";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const querySchema = z.object({ credentialId: z.string().uuid() }).strict();
const statusSchema = z.enum(["Active", "Inactive", "Approved", "Reviewing", "Rejected", "Unknown"]);
const observationSchema = z.object({
  credentialId: z.string().uuid(),
  clientObservationId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  observedAt: z.string().datetime({ offset: true }),
  claimedAppStatus: statusSchema,
  claimedComplianceStatus: statusSchema,
  claimedSecurityQuestionnaireStatus: statusSchema,
  claimedSellerAuthorizationStatus: statusSchema,
}).strict();
const observationResultSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-observation-diagnostic/1"),
  artifactId: z.string().uuid(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  credentialId: z.string().uuid(),
  sellerAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  environment: z.literal("production"),
  region: z.literal("GLOBAL"),
  sourceKind: z.literal("authenticated_admin_diagnostic"),
  sourceRevision: z.number().int().positive(),
  verificationState: z.literal("unverified"),
  observedAt: z.string().datetime({ offset: true }),
  recordedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  diagnosticReason: z.literal("PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED"),
  trustedReadinessEvidenceCreated: z.literal(false),
}).strict();

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({
      message: "관찰 기록 형식이 올바르지 않습니다.",
      code: "TEMU_BUYER_CHAT_OBSERVATION_INVALID",
      trustedReadinessEvidenceCreated: false,
    }, { status: 400, headers });
  }
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({
      message: "관찰 기록은 지정된 진단 필드만 허용합니다.",
      code: "TEMU_BUYER_CHAT_OBSERVATION_INVALID",
      trustedReadinessEvidenceCreated: false,
    }, { status: 400, headers });
  }

  const artifactId = randomUUID();
  const artifactSha256 = createHash("sha256").update(JSON.stringify({
    contract: "sellerpilot-temu-buyer-chat-observation-request/1",
    artifactId,
    ...parsed.data,
  })).digest("hex");
  const result = await admin.userClient.rpc(
    "sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1",
    {
      p_credential_id: parsed.data.credentialId,
      p_client_observation_id: parsed.data.clientObservationId,
      p_artifact_id: artifactId,
      p_artifact_sha256: artifactSha256,
      p_expected_revision: parsed.data.expectedRevision,
      p_observed_at: parsed.data.observedAt,
      p_claimed_app_status: parsed.data.claimedAppStatus,
      p_claimed_compliance_status: parsed.data.claimedComplianceStatus,
      p_claimed_security_questionnaire_status: parsed.data.claimedSecurityQuestionnaireStatus,
      p_claimed_seller_authorization_status: parsed.data.claimedSellerAuthorizationStatus,
    },
  );
  const diagnostic = observationResultSchema.safeParse(result.data);
  if (result.error || !diagnostic.success
      || diagnostic.data.artifactId !== artifactId
      || diagnostic.data.artifactSha256 !== artifactSha256
      || diagnostic.data.credentialId !== parsed.data.credentialId) {
    return NextResponse.json({
      message: "Temu Buyer Chat 관찰 진단을 기록하지 못했습니다.",
      code: "TEMU_BUYER_CHAT_OBSERVATION_WRITE_FAILED",
      trustedReadinessEvidenceCreated: false,
    }, { status: 409, headers });
  }
  return NextResponse.json({
    ...diagnostic.data,
    providerAuthenticatedSourceVerified: false,
    providerFetchPerformed: false,
  }, { status: 201, headers });
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;

  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsedQuery.success || url.searchParams.getAll("credentialId").length !== 1) {
    return NextResponse.json({
      message: "조회할 Temu 운영 계정을 정확히 하나 선택해 주세요.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID",
      providerFetchPerformed: false,
    }, { status: 400, headers });
  }

  const accountsResult = await admin.userClient.rpc("sellerpilot_list_temu_cs_accounts_v1");
  const accounts = temuHistoryAccountsSchema.safeParse(accountsResult.data);
  if (accountsResult.error || !accounts.success) {
    return NextResponse.json({
      message: "Temu 운영 계정 목록을 확인하지 못했습니다.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_EVIDENCE_UNAVAILABLE",
      providerFetchPerformed: false,
    }, { status: 503, headers });
  }
  const account = accounts.data.accounts.find(
    item => item.credentialId === parsedQuery.data.credentialId,
  );
  if (!account) {
    return NextResponse.json({
      message: "선택한 Temu 운영 계정이 활성·provider-certified 상태가 아닙니다.",
      code: "TEMU_BUYER_CHAT_ACCOUNT_SELECTION_INVALID",
      providerFetchPerformed: false,
    }, { status: 409, headers });
  }

  const readinessResult = await admin.userClient.rpc(
    "sellerpilot_read_temu_buyer_chat_readiness_v1",
    { p_credential_id: account.credentialId },
  );
  if (readinessResult.error) {
    return NextResponse.json({
      message: "Temu Buyer Chat 서버 증거를 확인하지 못했습니다.",
      code: "TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE",
      providerFetchPerformed: false,
    }, { status: 503, headers });
  }
  const read = temuBuyerChatRuntimeReadSchema.safeParse(readinessResult.data);
  if (!read.success
      || read.data.credentialId !== account.credentialId
      || read.data.sellerAccountKey !== account.sellerAccountKeyHash
      || read.data.environment !== account.environment) {
    return NextResponse.json({
      message: "Temu Buyer Chat 서버 증거의 계정·환경 계약이 일치하지 않습니다.",
      code: "TEMU_BUYER_CHAT_EVIDENCE_INVALID",
      providerFetchPerformed: false,
    }, { status: 502, headers });
  }

  const readiness = temuCsReadiness("buyer_chat", read.data.evidence, {
    credentialId: account.credentialId,
    sellerAccountKey: account.sellerAccountKeyHash,
    environment: account.environment,
    expectedRegion: "GLOBAL",
    now: new Date().toISOString(),
  });
  const response = temuBuyerChatReadinessViewSchema.parse({
    contract: "sellerpilot-temu-buyer-chat-readiness-view/1",
    checkedAt: new Date().toISOString(),
    credentialId: account.credentialId,
    sellerAccountKey: account.sellerAccountKeyHash,
    environment: account.environment,
    state: readiness.ready ? "ready" : "permission_pending",
    ready: readiness.ready,
    blockers: readiness.blockers,
    evidenceSource: read.data.evidence ? {
      sourceKind: read.data.evidence.sourceKind,
      sourceRevision: read.data.evidence.sourceRevision,
      observedAt: read.data.evidence.observedAt,
      expiresAt: read.data.evidence.expiresAt,
      region: read.data.evidence.region,
    } : null,
    providerFetchPerformed: false,
    receive: false,
    history: false,
    reply: false,
    readback: false,
  });
  return NextResponse.json(response, { headers });
}
