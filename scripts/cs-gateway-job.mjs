import { csCompletionStatus } from "../lib/cs/operations/completion-status.ts";
import { executeCsProviderJob } from "../lib/cs/operations/provider.ts";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding.ts";
import { buildCsFailedCompletionPayload } from "../lib/cs/operations/failed-completion.ts";
import { createGatewayMutationBoundary } from "./gateway-mutation-boundary.mjs";
import { GATEWAY_COMPLETION_TRANSIENT_GRACE_MS, WorkerRequestTerminalError } from "./worker-lifecycle-retry.mjs";

// Lifecycle dependencies are supplied per invocation. No product jobs, assets,
// prompts, image processes, or product completion journals are reachable here.
export async function processCsGatewayJob(job, { createGatewayHeartbeat, persistWorkerCompletion, reserveProviderRequest, executeProvider = executeCsProviderJob }) {
  if (!["inquiries.list", "inquiries.reply"].includes(job.operation)) throw new Error("CS_WORKER_OPERATION_REQUIRED");
  const claimToken = String(job.claim_token ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimToken)) throw new Error("CS_CLAIM_TOKEN_REQUIRED");
  const heartbeat = createGatewayHeartbeat(job.id, claimToken);
  let stopped = false;
  let externalWriteStarted = false;
  let credentialMutationInFlight = false;
  let completionPersistenceStarted = false;
  let credentialRefresh;
  const signal = AbortSignal.timeout(180_000);
  const assertLeaseHealthy = () => heartbeat.assertHealthy();
  const persist = (path, payload, label) => persistWorkerCompletion(path, payload, label, GATEWAY_COMPLETION_TRANSIENT_GRACE_MS);
  const assertCompletionReplaySafe = async () => {
    try {
      await assertLeaseHealthy();
    } catch (error) {
      const completionMayAlreadyBeCommitted = error instanceof WorkerRequestTerminalError
        && (error.status === 0 || error.status === 404 || error.status === 409 || (error.status >= 500 && error.status <= 599));
      // The exact completion endpoint is the authority after a lost response:
      // it returns replay for the same receipt and conflict for another owner.
      if (!completionMayAlreadyBeCommitted) throw error;
    }
  };
  const persistFinalCompletion = async completion => {
    completionPersistenceStarted = true;
    let lastError;
    // One persistence window already retries the identical body for ten
    // minutes. A second/third window is only for a sustained 5xx and keeps the
    // same claim heartbeat alive; it never re-enters the provider operation.
    for (let window = 0; window < 3; window += 1) {
      if (window === 0) await assertLeaseHealthy();
      else await assertCompletionReplaySafe();
      try {
        return await persist("/api/channel-gateway/worker/complete", completion, "CS 결과 저장 실패");
      } catch (error) {
        lastError = error;
        const transient = error instanceof WorkerRequestTerminalError
          && (error.status === 0 || (error.status >= 500 && error.status <= 599));
        if (!transient) throw error;
        await assertCompletionReplaySafe();
      }
    }
    throw lastError;
  };
  const stop = async () => { if (!stopped) { stopped = true; await heartbeat.stop(); } };
  const beginProviderMutation = createGatewayMutationBoundary({
    assertLeaseHealthy,
    persist: () => persist("/api/channel-gateway/worker/begin-mutation", { jobId: job.id, claimToken }, "CS 외부 호출 경계 저장 실패"),
    onStarted: () => { externalWriteStarted = true; },
  });
  const beginCredentialMutation = async () => {
    await assertLeaseHealthy();
    credentialMutationInFlight = true;
    await persist("/api/channel-gateway/worker/credential-refresh", { action: "begin", jobId: job.id, claimToken }, "CS 인증 갱신 경계 저장 실패");
    await assertLeaseHealthy();
  };
  const stageCredentialRefresh = async refresh => {
    credentialRefresh = refresh;
    await assertLeaseHealthy();
    await persist("/api/channel-gateway/worker/credential-refresh", { action: "stage", jobId: job.id, claimToken, credentialRefresh: refresh }, "CS 인증 갱신 결과 저장 실패");
    await assertLeaseHealthy();
    credentialMutationInFlight = false;
  };
  try {
    await heartbeat.start();
    await assertLeaseHealthy();
    // Temu keeps the serverless guard for writes, but its after-sales inquiry
    // read must run on the allowlisted Mac lane: the Temu app only accepts the
    // registered egress IP, so the Vercel lane cannot serve it at all.
    const result = await executeProvider({ job, signal, hooks: { assertLeaseHealthy, beginProviderMutation, beginCredentialMutation, stageCredentialRefresh, reserveProviderRequest } });
    const credentialBinding = result.ok ? csCredentialBindingEvidence({ channel: job.channel, operation: job.operation, credential: credentialRefresh?.payload ?? job.credential, request: job.request }) : null;
    const status = csCompletionStatus(result);
    const completion = status !== "failed"
      ? { jobId: job.id, claimToken, status, ...(status === "reconciliation_required" ? { error: result.safeMessage } : {}), result, ...(credentialRefresh ? { credentialRefresh } : {}), ...(credentialBinding ? { credentialBinding } : {}) }
      : buildCsFailedCompletionPayload({ job, claimToken, error: result.safeMessage, result, credentialRefresh });
    await persistFinalCompletion(completion);
    await stop();
  } catch (caught) {
    let error = caught;
    // Once an exact provider result is being persisted, never replace it with
    // a newly classified failure. A 5xx may mean the server committed but lost
    // the response; only an identical replay can resolve that ambiguity.
    if (completionPersistenceStarted) {
      try { await stop(); } catch (stopError) { error = stopError; }
      const lostCompletion = error instanceof WorkerRequestTerminalError && [401, 404, 409].includes(error.status);
      if (lostCompletion) return;
      throw error;
    }
    const lost = error instanceof WorkerRequestTerminalError && [401, 404, 409].includes(error.status);
    if (lost) {
      try { await stop(); } catch { /* The expired worker cannot modify the next owner's job. */ }
      return;
    }
    // Keep the real provider reason on the job. A bare code made every CS failure
    // look identical in the ledger, so the cause could not be diagnosed.
    const reason = String(error?.message ?? error ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    // A successful stage receipt makes the refreshed credentials durable.
    // A later read failure is then known to have no unresolved mutation. Keep
    // both an unstaged refresh and any business write fenced for reconciliation.
    const mutationUncertain = externalWriteStarted || credentialMutationInFlight;
    const failureCompletion = {
      jobId: job.id, claimToken,
      status: mutationUncertain ? "reconciliation_required" : "failed",
      error: mutationUncertain
        ? "CS_PROVIDER_RESULT_REQUIRES_RECONCILIATION"
        : `CS_PROVIDER_EXECUTION_FAILED:${reason || "unknown"}`,
      ...(!credentialMutationInFlight && credentialRefresh ? { credentialRefresh } : {}),
    };
    try {
      await persistFinalCompletion(failureCompletion);
    } finally {
      await stop();
    }
  }
}
