import { shippingCompletionStatus } from "../lib/shipping/completion-status.ts";
import { executeShippingProviderJob } from "../lib/shipping/provider.ts";
import { createGatewayMutationBoundary } from "./gateway-mutation-boundary.mjs";
import {
  GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
  WorkerRequestTerminalError,
} from "./worker-lifecycle-retry.mjs";

// Shipping owns its lifecycle state; the shared worker supplies lease and transport only.
export async function processShippingGatewayJob(
  job,
  {
    createGatewayHeartbeat,
    persistWorkerCompletion,
    reserveProviderRequest,
    executeProvider = executeShippingProviderJob,
  },
) {
  if (
    ![
      "orders.list",
      "orders.get",
      "shipment.acknowledge",
      "shipment.confirm",
    ].includes(job.operation)
  )
    throw new Error("SHIPPING_WORKER_OPERATION_REQUIRED");
  const claimToken = String(job.claim_token ?? "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      claimToken,
    )
  )
    throw new Error("SHIPPING_CLAIM_TOKEN_REQUIRED");
  const heartbeat = createGatewayHeartbeat(job.id, claimToken);
  let stopped = false;
  let externalWriteStarted = false;
  let credentialMutationInFlight = false;
  let credentialRefresh;
  const signal = AbortSignal.timeout(180_000);
  const assertLeaseHealthy = () => heartbeat.assertHealthy();
  const persist = (path, payload, label) =>
    persistWorkerCompletion(
      path,
      payload,
      label,
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await heartbeat.stop();
    }
  };
  const beginProviderMutation = createGatewayMutationBoundary({
    assertLeaseHealthy,
    persist: () =>
      persist(
        "/api/channel-gateway/worker/begin-mutation",
        { jobId: job.id, claimToken },
        "SHIPPING 외부 호출 경계 저장 실패",
      ),
    onStarted: () => {
      externalWriteStarted = true;
    },
  });
  const beginCredentialMutation = async () => {
    await assertLeaseHealthy();
    externalWriteStarted = true;
    credentialMutationInFlight = true;
    await persist(
      "/api/channel-gateway/worker/credential-refresh",
      { action: "begin", jobId: job.id, claimToken },
      "SHIPPING 인증 갱신 경계 저장 실패",
    );
    await assertLeaseHealthy();
  };
  const stageCredentialRefresh = async (refresh) => {
    credentialRefresh = refresh;
    await assertLeaseHealthy();
    await persist(
      "/api/channel-gateway/worker/credential-refresh",
      {
        action: "stage",
        jobId: job.id,
        claimToken,
        credentialRefresh: refresh,
      },
      "SHIPPING 인증 갱신 결과 저장 실패",
    );
    await assertLeaseHealthy();
    credentialMutationInFlight = false;
  };
  try {
    await heartbeat.start();
    await assertLeaseHealthy();
    const result = await executeProvider({
      job,
      signal,
      hooks: {
        assertLeaseHealthy,
        beginProviderMutation,
        beginCredentialMutation,
        stageCredentialRefresh,
        reserveProviderRequest,
      },
    });
    const status = shippingCompletionStatus(result);
    const completion =
      status !== "failed"
        ? {
            jobId: job.id,
            claimToken,
            status,
            ...(status === "reconciliation_required"
              ? { error: result.safeMessage }
              : {}),
            result,
            ...(credentialRefresh ? { credentialRefresh } : {}),
          }
        : {
            jobId: job.id,
            claimToken,
            status: "failed",
            error: result.safeMessage,
            ...(credentialRefresh ? { credentialRefresh } : {}),
          };
    await assertLeaseHealthy();
    await stop();
    await persist(
      "/api/channel-gateway/worker/complete",
      completion,
      "SHIPPING 결과 저장 실패",
    );
  } catch (caught) {
    let error = caught;
    try {
      await stop();
    } catch (stopError) {
      error = stopError;
    }
    const lost =
      error instanceof WorkerRequestTerminalError &&
      [401, 404, 409].includes(error.status);
    if (lost) return; // The expired worker cannot modify the next owner's job.
    await persist(
      "/api/channel-gateway/worker/complete",
      {
        jobId: job.id,
        claimToken,
        status: externalWriteStarted ? "reconciliation_required" : "failed",
        error: externalWriteStarted
          ? "SHIPPING_PROVIDER_RESULT_REQUIRES_RECONCILIATION"
          : "SHIPPING_PROVIDER_EXECUTION_FAILED",
        ...(!credentialMutationInFlight && credentialRefresh
          ? { credentialRefresh }
          : {}),
      },
      "SHIPPING 실패 결과 저장 실패",
    );
  }
}
