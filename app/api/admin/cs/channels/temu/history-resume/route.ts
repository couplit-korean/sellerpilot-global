import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../../../../lib/admin-api";
import {
  temuDetailRetryReadSchema,
  temuHistoryAccountStateSchema,
  temuHistoryAccountsSchema,
  temuHistoryCheckpointMatchesRequest,
  temuHistoryCheckpointSchema,
  temuHistoryCoverageReadSchema,
  temuHistoryResumeRequestSchema,
  type TemuHistoryAccounts,
  type TemuHistoryResumeRequest,
} from "../../../../../../../lib/cs/channels/temu/history-resume";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
const uuid = z.string().uuid();
const checkpointQuerySchema = z.object({
  credentialId: uuid,
  runId: uuid.nullable(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
}).strict();
const postSchema = z.object({
  credentialId: uuid,
  request: temuHistoryResumeRequestSchema,
}).strict();

async function accountContext(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return { response: admin } as const;
  const { data, error } = await admin.userClient.rpc("sellerpilot_list_temu_cs_accounts_v1");
  const accounts = temuHistoryAccountsSchema.safeParse(data);
  if (error || !accounts.success) {
    return { response: NextResponse.json({
      message: "Temu 운영 계정 목록을 확인하지 못했습니다.",
    }, { status: 503, headers }) } as const;
  }
  return {
    admin: admin as AdminApiContext,
    accounts: accounts.data,
  } as const;
}

function selectedAccount(accounts: TemuHistoryAccounts, credentialId: string) {
  return accounts.accounts.find(account => account.credentialId === credentialId) ?? null;
}

function validCalendarRange(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  return Number.isFinite(from) && Number.isFinite(to)
    && new Date(from).toISOString().slice(0, 10) === fromDate
    && new Date(to).toISOString().slice(0, 10) === toDate
    && fromDate <= toDate && toDate <= today
    && (to - from) / 86_400_000 < 366;
}

export async function GET(request: Request) {
  const resolved = await accountContext(request);
  if ("response" in resolved) return resolved.response;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "checkpoint";
  if (view === "accounts") return NextResponse.json(resolved.accounts, { headers });
  const credentialId = uuid.safeParse(url.searchParams.get("credentialId"));
  if (!credentialId.success) {
    return NextResponse.json({ message: "조회할 Temu 계정을 선택해 주세요." }, { status: 400, headers });
  }
  const account = selectedAccount(resolved.accounts, credentialId.data);
  if (!account) {
    return NextResponse.json({ message: "선택한 Temu 운영 계정이 활성·검증 상태가 아닙니다." },
      { status: 409, headers });
  }
  if (view === "metadata") {
    const [coverageResult, retryResult] = await Promise.all([
      resolved.admin.userClient.rpc("sellerpilot_read_cs_history_coverage_v2", {
        p_credential_id: account.credentialId,
      }),
      resolved.admin.userClient.rpc("sellerpilot_admin_temu_after_sales_detail_retry_status_v3", {
        p_credential_id: account.credentialId,
        p_job_id: null,
      }),
    ]);
    const coverage = temuHistoryCoverageReadSchema.safeParse(coverageResult.data);
    const retry = temuDetailRetryReadSchema.safeParse(retryResult.data);
    if (coverageResult.error || retryResult.error || !coverage.success || !retry.success
        || coverage.data.credentialId !== account.credentialId
        || retry.data.credentialId !== account.credentialId
        || coverage.data.sellerAccountKeyHash !== account.sellerAccountKeyHash
        || retry.data.sellerAccountKeyHash !== account.sellerAccountKeyHash) {
      return NextResponse.json({ message: "선택한 Temu 계정의 수집·재시도 상태를 확인하지 못했습니다." },
        { status: 502, headers });
    }
    return NextResponse.json(temuHistoryAccountStateSchema.parse({
      contract: "sellerpilot-temu-history-account-state/1",
      account,
      coverage: coverage.data,
      retry: retry.data,
    }), { headers });
  }
  if (view !== "checkpoint") {
    return NextResponse.json({ message: "Temu 조회 종류를 확인해 주세요." }, { status: 400, headers });
  }
  const parsed = checkpointQuerySchema.safeParse({
    credentialId: account.credentialId,
    runId: url.searchParams.get("runId"),
    fromDate: url.searchParams.get("fromDate"),
    toDate: url.searchParams.get("toDate"),
  });
  if (!parsed.success || !validCalendarRange(parsed.data.fromDate, parsed.data.toDate)) {
    return NextResponse.json({ message: "Temu 과거조회 기간을 확인해 주세요." }, { status: 400, headers });
  }
  const { data, error } = await resolved.admin.userClient.rpc(
    "sellerpilot_get_temu_history_checkpoint_v1",
    {
      p_credential_id: account.credentialId,
      p_run_id: parsed.data.runId,
      p_from_date: parsed.data.fromDate,
      p_to_date: parsed.data.toDate,
    },
  );
  const checkpoint = temuHistoryCheckpointSchema.safeParse(data);
  if (error || !checkpoint.success || checkpoint.data.credentialId !== account.credentialId
      || checkpoint.data.sellerAccountKeyHash !== account.sellerAccountKeyHash
      || checkpoint.data.fromDate !== parsed.data.fromDate
      || checkpoint.data.toDate !== parsed.data.toDate
      || parsed.data.runId !== null && checkpoint.data.runId !== parsed.data.runId) {
    return NextResponse.json({ message: "Temu 과거조회 체크포인트를 확인하지 못했습니다." },
      { status: 502, headers });
  }
  return NextResponse.json(checkpoint.data, { headers });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000) {
    return NextResponse.json({ message: "Temu 과거조회 요청이 너무 큽니다." }, { status: 413, headers });
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.request.action === "start"
      && !validCalendarRange(parsed.data.request.fromDate, parsed.data.request.toDate)) {
    return NextResponse.json({ message: "Temu 과거조회 재개 범위를 확인해 주세요." }, { status: 400, headers });
  }
  const resolved = await accountContext(request);
  if ("response" in resolved) return resolved.response;
  const account = selectedAccount(resolved.accounts, parsed.data.credentialId);
  if (!account) {
    return NextResponse.json({ message: "선택한 Temu 운영 계정이 활성·검증 상태가 아닙니다." },
      { status: 409, headers });
  }
  const requestValue: TemuHistoryResumeRequest = parsed.data.request;
  const { data, error } = await resolved.admin.userClient.rpc(
    "sellerpilot_start_or_resume_temu_history_v1",
    {
      p_credential_id: account.credentialId,
      p_request: requestValue,
    },
  );
  const checkpoint = temuHistoryCheckpointSchema.safeParse(data);
  if (error) {
    return NextResponse.json({ ok: false, message: "Temu 과거조회 작업을 접수하지 못했습니다." },
      { status: 409, headers });
  }
  if (!checkpoint.success
      || checkpoint.data.sellerAccountKeyHash !== account.sellerAccountKeyHash
      || !temuHistoryCheckpointMatchesRequest(checkpoint.data, account.credentialId, requestValue)) {
    return NextResponse.json({ message: "Temu 과거조회 재개 결과의 계정·기간·cursor가 일치하지 않습니다." },
      { status: 502, headers });
  }
  return NextResponse.json({
    ok: true,
    checkpoint: checkpoint.data,
    acceptedNotCompleted: checkpoint.data.status !== "complete",
  }, {
    status: checkpoint.data.status === "complete" ? 200 : 202,
    headers,
  });
}
