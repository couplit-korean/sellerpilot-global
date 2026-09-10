import { runChannelDiagnostic } from "../lib/channel-diagnostics.ts";

export async function processElevenstPendingDiagnosticJob(job, { complete }) {
  if (job?.channel !== "elevenst"
      || job?.operation !== "diagnostic.test"
      || job?.request?.sellerpilotPendingCredentialDiagnosticV1 !== true
      || job?.request?.identityEvidence !== "admin_claim_v1"
      || typeof job?.id !== "string"
      || typeof job?.claim_token !== "string") {
    throw new Error("ELEVENST_PENDING_DIAGNOSTIC_CLAIM_MISMATCH");
  }
  let diagnostic;
  try {
    diagnostic = await runChannelDiagnostic(
      "elevenst",
      job.credential,
      job.environment === "sandbox" ? "sandbox" : "production",
    );
  } catch {
    diagnostic = {
      status: "failed",
      message: "11번가 pending 키의 고정 IP 연결 검사 중 안전하게 처리된 오류가 발생했습니다.",
    };
  }
  const response = await complete({
    jobId: job.id,
    claimToken: job.claim_token,
    diagnostic,
  });
  if (!response.ok) {
    throw new Error(`ELEVENST_PENDING_DIAGNOSTIC_COMPLETE_HTTP_${response.status}`);
  }
  const receipt = await response.json();
  if (receipt?.status !== "completed"
      || receipt?.jobId !== job.id
      || receipt?.diagnosticStatus !== diagnostic.status
      || receipt?.identityEvidence !== "admin_claim_v1") {
    throw new Error("ELEVENST_PENDING_DIAGNOSTIC_COMPLETION_MISMATCH");
  }
  return { diagnostic, receipt };
}
