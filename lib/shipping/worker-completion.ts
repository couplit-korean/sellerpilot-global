import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderJob } from "../channels/provider-execution-contract";
import { completeShippingClaim, type ShippingCompletion } from "./complete";
import { dispatchPendingPushNotifications } from "../push-notifications";
export type ShippingWorkerCompletion = ShippingCompletion & {
  jobId: string;
  claimToken: string;
};
export async function completeShippingWorker({
  serviceClient,
  tokenHash,
  job,
  completion,
}: {
  serviceClient: SupabaseClient;
  tokenHash: string;
  job: Record<string, unknown>;
  completion: ShippingWorkerCompletion;
}) {
  const status = await completeShippingClaim(
    {
      rpc: async (name, args) => {
        // The worker route has already validated this immutable claim context.
        if (name === "sellerpilot_service_serverless_cs_completion_context")
          return { data: { ...job, status: "running" }, error: null };
        return await serviceClient.rpc(name, args);
      },
    },
    tokenHash,
    {
      ...job,
      id: completion.jobId,
      claim_token: completion.claimToken,
    } as ProviderJob,
    completion,
    true,
  );
  if (status === "ownership_lost")
    return NextResponse.json(
      { message: "배송 작업 계보가 일치하지 않습니다." },
      { status: 409 },
    );
  if (status === "unavailable")
    return NextResponse.json(
      { message: "배송 결과 저장을 확인하지 못했습니다." },
      { status: 503 },
    );
  if (job.operation === "orders.list" && completion.status === "succeeded")
    await dispatchPendingPushNotifications(serviceClient).catch(() => null);
  return NextResponse.json({
    message:
      status === "completed_reconciliation"
        ? "배송 결과를 확인 필요 상태로 보존했습니다."
        : "배송 작업 결과를 저장했습니다.",
  });
}
