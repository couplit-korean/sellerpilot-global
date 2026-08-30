import {
  lazadaRequest,
  runWithProviderReadOnlyTransport,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

export const exactLazadaRecoveryJobId =
  "5ac7a12f-94d5-451f-bd47-3b07d86c21b8" as const;
export const exactLazadaRecoveryWorkerVersion =
  "sellerpilot-lazada-recovery/1.1" as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };

type RecoveryClaim = {
  status: "claimed";
  id: typeof exactLazadaRecoveryJobId;
  claimToken: string;
  request: Record<string, unknown>;
  credential: SecretPayload;
};

export type ExactLazadaRecoveryDependencies = {
  rpc: (name: string, arguments_?: Record<string, unknown>) => Promise<RpcResult>;
  readSeller?: (credential: SecretPayload) => Promise<RemoteResponse>;
};

export type ExactLazadaRecoveryOutcome = {
  httpStatus: 200 | 400 | 409 | 503;
  body: {
    ok: boolean;
    status:
      | "requeued"
      | "invalid_job"
      | "state_mismatch"
      | "provider_read_transient"
      | "snapshot_rejected"
      | "identity_mismatch"
      | "recovery_unavailable";
    replacementJobId?: string;
  };
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function parseClaim(value: unknown): RecoveryClaim | null {
  const claim = recordValue(value);
  const request = recordValue(claim?.request);
  const credential = recordValue(claim?.credential);
  const claimToken = textValue(claim?.claim_token);
  if (claim?.status !== "claimed"
      || claim.id !== exactLazadaRecoveryJobId
      || claim.channel !== "lazada"
      || claim.operation !== "orders.list"
      || claim.environment !== "production"
      || !uuidPattern.test(claimToken)
      || !request
      || !credential) {
    return null;
  }
  return {
    status: "claimed",
    id: exactLazadaRecoveryJobId,
    claimToken,
    request,
    credential,
  };
}

function providerReadSucceeded(remote: RemoteResponse) {
  const providerCode = textValue(remote.data.code);
  const providerError = textValue(remote.data.error);
  return remote.response.ok
    && providerCode === "0"
    && !providerError
    && recordValue(remote.data.data) !== null;
}

function providerReadIsTransient(remote: RemoteResponse) {
  const providerCode = textValue(remote.data.code).toLowerCase();
  // Lazada returns provider failures inside an HTTP 200 envelope. Keep known
  // credential rejection codes terminal even if a contradictory message or
  // HTTP status accompanies them, then recognize only the documented
  // retryable codes/messages.
  if ([
    "illegalaccesstoken",
    "invalidaccesstoken",
    "accesstokenexpired",
  ].includes(providerCode)) return false;
  if (["15", "apicalllimit", "servicetimeout"].includes(providerCode)) {
    return true;
  }

  const status = remote.response.status;
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }

  const providerMessage = [
    remote.data.message,
    remote.data.error,
    remote.data.detail,
  ].map(textValue).filter(Boolean).join(" ");
  return /(?:api access frequency exceeds the limit|remote service error|service timeout)/i
    .test(providerMessage);
}

async function preserveRecovery(
  tokenHash: string,
  claim: RecoveryClaim,
  reason:
    | "provider_read_transient"
    | "snapshot_rejected"
    | "identity_invalid"
    | "identity_mismatch",
  dependencies: ExactLazadaRecoveryDependencies,
) {
  const aborted = await dependencies.rpc(
    "sellerpilot_service_abort_exact_lazada_recovery",
    {
      p_token_hash: tokenHash,
      p_job_id: claim.id,
      p_claim_token: claim.claimToken,
      p_reason: reason,
    },
  );
  return !aborted.error && aborted.data === true;
}

function unavailable(): ExactLazadaRecoveryOutcome {
  return {
    httpStatus: 503,
    body: { ok: false, status: "recovery_unavailable" },
  };
}

export async function recoverExactLazadaCredential(
  input: { jobId: string; tokenHash: string },
  dependencies: ExactLazadaRecoveryDependencies,
): Promise<ExactLazadaRecoveryOutcome> {
  if (input.jobId !== exactLazadaRecoveryJobId
      || !/^[a-f0-9]{64}$/.test(input.tokenHash)) {
    return {
      httpStatus: 400,
      body: { ok: false, status: "invalid_job" },
    };
  }

  const claimed = await dependencies.rpc(
    "sellerpilot_service_claim_exact_lazada_recovery",
    {
      p_token_hash: input.tokenHash,
      p_job_id: exactLazadaRecoveryJobId,
      p_worker_version: exactLazadaRecoveryWorkerVersion,
    },
  );
  if (claimed.error) return unavailable();
  const claimEnvelope = recordValue(claimed.data);
  if (claimEnvelope?.status === "state_mismatch") {
    return {
      httpStatus: 409,
      body: { ok: false, status: "state_mismatch" },
    };
  }
  const claim = parseClaim(claimed.data);
  if (!claim) return unavailable();

  let providerRead: RemoteResponse;
  try {
    providerRead = await runWithProviderReadOnlyTransport(() => (
      dependencies.readSeller
        ? dependencies.readSeller(claim.credential)
        : lazadaRequest({ payload: claim.credential, path: "/seller/get" })
    ));
  } catch {
    const preserved = await preserveRecovery(
      input.tokenHash,
      claim,
      "provider_read_transient",
      dependencies,
    );
    return preserved
      ? {
        httpStatus: 503,
        body: { ok: false, status: "provider_read_transient" },
      }
      : unavailable();
  }

  if (!providerReadSucceeded(providerRead)) {
    const transient = providerReadIsTransient(providerRead);
    const preserved = await preserveRecovery(
      input.tokenHash,
      claim,
      transient ? "provider_read_transient" : "snapshot_rejected",
      dependencies,
    );
    if (!preserved) return unavailable();
    return transient
      ? {
        httpStatus: 503,
        body: { ok: false, status: "provider_read_transient" },
      }
      : {
        httpStatus: 409,
        body: { ok: false, status: "snapshot_rejected" },
      };
  }

  const prepared = await dependencies.rpc(
    "sellerpilot_service_prepare_exact_lazada_recovery",
    {
      p_token_hash: input.tokenHash,
      p_job_id: claim.id,
      p_claim_token: claim.claimToken,
      p_provider_read: providerRead.data,
    },
  );
  // A transport or database error can have an uncertain acknowledgement.
  // Do not issue a compensating update. The lease reaper will inspect the
  // durable prepared/snapshot state and choose queue vs reconciliation.
  if (prepared.error) return unavailable();
  const preparation = recordValue(prepared.data);
  if (preparation?.status === "identity_invalid"
      || preparation?.status === "identity_mismatch") {
    const mismatch = preparation.status === "identity_mismatch";
    const preserved = await preserveRecovery(
      input.tokenHash,
      claim,
      mismatch ? "identity_mismatch" : "identity_invalid",
      dependencies,
    );
    return preserved
      ? {
        httpStatus: 409,
        body: { ok: false, status: "identity_mismatch" },
      }
      : unavailable();
  }
  if (preparation?.status !== "prepared"
      || !uuidPattern.test(textValue(preparation.credentialId))) {
    return {
      httpStatus: 409,
      body: { ok: false, status: "state_mismatch" },
    };
  }

  const finished = await dependencies.rpc(
    "sellerpilot_service_finish_exact_lazada_recovery",
    {
      p_token_hash: input.tokenHash,
      p_job_id: claim.id,
      p_claim_token: claim.claimToken,
    },
  );
  // As above, a missing acknowledgement is not permission to retry a state
  // change. Row/claim fences plus the lease reaper make the outcome converge.
  if (finished.error) return unavailable();
  const completion = recordValue(finished.data);
  const replacementJobId = textValue(completion?.replacementJobId);
  if (completion?.status !== "requeued" || !uuidPattern.test(replacementJobId)) {
    return {
      httpStatus: 409,
      body: { ok: false, status: "state_mismatch" },
    };
  }
  return {
    httpStatus: 200,
    body: {
      ok: true,
      status: "requeued",
      replacementJobId,
    },
  };
}
