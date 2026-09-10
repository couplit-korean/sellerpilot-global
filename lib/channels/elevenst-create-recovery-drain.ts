import {
  recoverElevenstCreateGetOnly,
  type ElevenstCreateRecoveryObservation,
  type RecoveryCredentialBinding,
} from "../product-registration/elevenst/create-recovery";

export const ELEVENST_CREATE_RECOVERY_CLAIM_RPC =
  "sellerpilot_service_claim_elevenst_create_recovery";
export const ELEVENST_CREATE_RECOVERY_FINISH_RPC =
  "sellerpilot_service_finish_elevenst_create_recovery";
export const ELEVENST_CREATE_RECOVERY_CLAIM_CONTRACT =
  "sellerpilot_elevenst_create_recovery_claim_v1";
export const ELEVENST_CREATE_RECOVERY_OBSERVATION_CONTRACT =
  "sellerpilot_elevenst_create_get_only_recovery_v2";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type ElevenstCreateRecoveryClaim = {
  contract: typeof ELEVENST_CREATE_RECOVERY_CLAIM_CONTRACT;
  jobId: string;
  recoveryToken: string;
  credentialBinding: RecoveryCredentialBinding;
  expectedProduct: Record<string, unknown>;
  payload: { api_key: string };
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseElevenstCreateRecoveryClaim(
  value: unknown,
): ElevenstCreateRecoveryClaim | null {
  const record = recordValue(value);
  const credential = recordValue(record?.credential);
  const expectedProduct = recordValue(record?.expectedProduct);
  const apiKey = text(credential?.api_key);
  const credentialId = text(record?.credentialId);
  const vaultSecretId = text(record?.vaultSecretId);
  const jobId = text(record?.jobId);
  const recoveryToken = text(record?.recoveryToken);
  const credentialVersion = record?.credentialVersion;
  if (!record
    || record.contract !== ELEVENST_CREATE_RECOVERY_CLAIM_CONTRACT
    || !UUID_PATTERN.test(jobId)
    || !UUID_PATTERN.test(recoveryToken)
    || !UUID_PATTERN.test(credentialId)
    || !UUID_PATTERN.test(vaultSecretId)
    || !Number.isInteger(credentialVersion)
    || Number(credentialVersion) < 1
    || !SHA256_PATTERN.test(text(record.expectedApiKeySha256))
    || !text(record.credentialFingerprint)
    || !/^[A-Za-z0-9]{32}$/u.test(apiKey)
    || !expectedProduct) {
    return null;
  }
  return {
    contract: ELEVENST_CREATE_RECOVERY_CLAIM_CONTRACT,
    jobId,
    recoveryToken,
    credentialBinding: {
      credentialId,
      credentialVersion: Number(credentialVersion),
      credentialFingerprint: text(record.credentialFingerprint),
      vaultSecretId,
      expectedApiKeySha256: text(record.expectedApiKeySha256),
    },
    expectedProduct,
    payload: { api_key: apiKey },
  };
}

export function assertOfficialRecoveryObservation(
  observation: ElevenstCreateRecoveryObservation,
): ElevenstCreateRecoveryObservation {
  if (observation.contract !== ELEVENST_CREATE_RECOVERY_OBSERVATION_CONTRACT) {
    throw new Error("ELEVENST_CREATE_RECOVERY_OBSERVATION_CONTRACT_INVALID");
  }
  if (observation.providerMutationPerformed !== false) {
    throw new Error("ELEVENST_CREATE_RECOVERY_MUTATION_FORBIDDEN");
  }
  if (observation.fullOfficialReadback === true) {
    const reads = observation.providerReads;
    if (observation.outcome !== "unique"
      || reads.length !== 4
      || reads.some((read) =>
        read.method !== "GET"
        || read.accepted !== true
        || read.httpStatus !== 200
        || read.responseBodyBytes < 1
        || !SHA256_PATTERN.test(read.requestBytesSha256)
        || !SHA256_PATTERN.test(read.responseBodySha256))) {
      throw new Error("ELEVENST_CREATE_RECOVERY_SYNTHETIC_OBSERVATION");
    }
  }
  return observation;
}

export async function executeElevenstCreateRecoveryClaim(
  claim: ElevenstCreateRecoveryClaim,
): Promise<ElevenstCreateRecoveryObservation> {
  return assertOfficialRecoveryObservation(await recoverElevenstCreateGetOnly({
    payload: claim.payload,
    credentialBinding: claim.credentialBinding,
    expectedProduct: claim.expectedProduct,
  }));
}

export const ELEVENST_CREATE_RECOVERY_WORKER_PATH =
  "/api/channel-gateway/worker/elevenst-create-recovery";

export type RecoveryRpc = (
  name: string,
  arguments_?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string | null } | null }>;

export type ElevenstCreateRecoveryDrainResult =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "execute_failed" }
  | { kind: "finish_failed" }
  | {
      kind: "finished";
      status: string;
      jobId: string;
      observation: ElevenstCreateRecoveryObservation;
    };

async function invokeRecoveryRpc(
  rpc: RecoveryRpc,
  name: string,
  arguments_: Record<string, unknown>,
) {
  try {
    return await rpc(name, arguments_);
  } catch {
    return { data: null, error: { code: "transport_error" } };
  }
}

export function elevenstCreateRecoveryWorkerRpc(
  request: (path: string, body: Record<string, unknown>) => Promise<Response>,
): RecoveryRpc {
  return async (name, arguments_ = {}) => {
    if (name === ELEVENST_CREATE_RECOVERY_CLAIM_RPC) {
      const response = await request(ELEVENST_CREATE_RECOVERY_WORKER_PATH, { action: "claim" });
      if (response.status === 200) {
        const body = recordValue(await response.json().catch(() => null));
        if (body?.status === "idle") return { data: null, error: null };
        if (body?.status === "claimed") return { data: body.claim ?? null, error: null };
        return { data: null, error: { code: "invalid_claim" } };
      }
      if (response.status === 401) return { data: null, error: { code: "42501" } };
      // A slow or failing recovery endpoint is a transport problem, not a
      // malformed claim. Returning an error keeps the optional recovery lane
      // idle so ordinary gateway claims are not skipped for minutes.
      return { data: null, error: { code: `http_${response.status}` } };
    }
    if (name === ELEVENST_CREATE_RECOVERY_FINISH_RPC) {
      const response = await request(ELEVENST_CREATE_RECOVERY_WORKER_PATH, {
        action: "finish",
        jobId: arguments_.p_job_id,
        recoveryToken: arguments_.p_recovery_token,
        observation: arguments_.p_observation,
      });
      if (!response.ok) {
        return { data: null, error: { code: `http_${response.status}` } };
      }
      return { data: await response.json().catch(() => null), error: null };
    }
    return { data: null, error: { code: "unexpected_rpc" } };
  };
}

export async function drainElevenstCreateRecovery(input: {
  rpc: RecoveryRpc;
  tokenHash: string;
}): Promise<ElevenstCreateRecoveryDrainResult> {
  const claimed = await invokeRecoveryRpc(input.rpc, ELEVENST_CREATE_RECOVERY_CLAIM_RPC, {
    p_token_hash: input.tokenHash,
  });
  if (claimed.error || claimed.data == null) return { kind: "idle" };
  const parsed = parseElevenstCreateRecoveryClaim(claimed.data);
  if (!parsed) return { kind: "invalid" };
  let observation: ElevenstCreateRecoveryObservation;
  try {
    observation = await executeElevenstCreateRecoveryClaim(parsed);
  } catch {
    return { kind: "execute_failed" };
  }
  const finished = await invokeRecoveryRpc(input.rpc, ELEVENST_CREATE_RECOVERY_FINISH_RPC, {
    p_token_hash: input.tokenHash,
    p_job_id: parsed.jobId,
    p_recovery_token: parsed.recoveryToken,
    p_observation: observation,
  });
  const result = recordValue(finished.data);
  if (finished.error || !result) return { kind: "finish_failed" };
  return {
    kind: "finished",
    status: text(result.status),
    jobId: parsed.jobId,
    observation,
  };
}
