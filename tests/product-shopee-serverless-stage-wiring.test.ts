import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  deriveServerlessCsGatewayCredentials,
  runServerlessCsGatewayDrain,
} = await import("../lib/channels/serverless-gateway");

const CRON_SECRET = "serverless-shopee-create-stage-cron";
const JOB_ID = "51000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "52000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "53000000-0000-4000-8000-000000000001";

const SHOPEE_STAGE_RPCS = {
  state: "sellerpilot_service_read_shopee_sg_create_stage_state_v1",
  begin: "sellerpilot_service_begin_shopee_sg_create_stage_v1",
  complete: "sellerpilot_service_complete_shopee_sg_create_stage_v1",
  resume: "sellerpilot_service_read_shopee_sg_create_resume_v1",
  rebind: "sellerpilot_service_rebind_shopee_sg_successor_v1",
  recordGlobal: "sellerpilot_service_record_shopee_sg_global_create_readback_v1",
} as const;

function shopeeCreateClaim(): GatewayClaim {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: "shopee",
    operation: "listing.create",
    environment: "production",
    request: {
      arguments: {
        globalProduct: true,
        market: "SG",
        merchantId: "5511564",
        publish: { shop_id: "1719148844" },
      },
    },
    credential: { partner_id: "2031489" },
    attempt_count: 1,
  };
}

function authorizedRequest() {
  const { wakeBearer } = deriveServerlessCsGatewayCredentials(CRON_SECRET);
  return new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
    method: "POST",
    headers: { authorization: `Bearer ${wakeBearer}` },
  });
}

function rateBudgetRpc(name: string) {
  return name === "sellerpilot_service_reserve_provider_rate_budget_v1"
    ? {
      data: {
        contract: "sellerpilot-provider-rate-budget/1",
        status: "reserved",
        retryAfterSeconds: 0,
      },
      error: null,
    }
    : null;
}

function liveCreateResult(map?: Record<string, unknown>) {
  return {
    ok: true as const,
    channel: "shopee" as const,
    operation: "listing.create" as const,
    steps: [{ name: "local-publish", ok: true, status: 200, data: {} }],
    remoteId: "8001",
    publicationIntent: "live" as const,
    publicationStateContract: "verified_remote_state_v1" as const,
    remoteState: {
      verified: true as const,
      visibility: "live" as const,
      providerStatus: "NORMAL",
      verifiedAt: "2026-09-10T00:00:00.000Z",
      evidence: {
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
      },
      resources: { remoteId: "8001" },
      locale: "en-SG",
      fingerprint: "a".repeat(64),
      imageCount: 8,
    },
    publicationFulfilled: true,
    safeMessage: "Shopee SG create completed",
    ...(map ? { shopeeSgCreateCompletionMap: map } : {}),
  };
}

function drainRpc(
  calls: Array<{ name: string; arguments_: Record<string, unknown> }>,
  extra: (name: string, arguments_: Record<string, unknown>) =>
    { data: unknown; error: { code?: string | null } | null } | null = () => null,
) {
  let claims = 0;
  return async (name: string, arguments_: Record<string, unknown> = {}) => {
    calls.push({ name, arguments_ });
    if (name === "sellerpilot_service_enqueue_periodic_sync") {
      return { data: { status: "already_pending" }, error: null };
    }
    if (name === "sellerpilot_claim_serverless_gateway_job") {
      claims += 1;
      return { data: claims === 1 ? shopeeCreateClaim() : null, error: null };
    }
    const rateBudget = rateBudgetRpc(name);
    if (rateBudget) return rateBudget;
    if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
    if (name === SHOPEE_STAGE_RPCS.state) {
      return {
        data: {
          contract: "sellerpilot-shopee-sg-create-stage/1",
          status: "ready",
          nextSequence: 0,
          completedStages: [],
          startedStage: null,
        },
        error: null,
      };
    }
    if (name === SHOPEE_STAGE_RPCS.begin) {
      return {
        data: {
          contract: "sellerpilot-shopee-sg-create-stage/1",
          status: "started",
          sequence: arguments_.p_stage_sequence,
        },
        error: null,
      };
    }
    if (name === SHOPEE_STAGE_RPCS.complete) {
      return {
        data: {
          contract: "sellerpilot-shopee-sg-create-stage/1",
          status: "completed",
          sequence: arguments_.p_stage_sequence,
        },
        error: null,
      };
    }
    if (name === SHOPEE_STAGE_RPCS.resume) {
      return {
        data: { contract: "sellerpilot-shopee-sg-create-resume/1", status: "absent" },
        error: null,
      };
    }
    if (name === SHOPEE_STAGE_RPCS.rebind || name === SHOPEE_STAGE_RPCS.recordGlobal) {
      return { data: { status: "ok" }, error: null };
    }
    if (name === "sellerpilot_service_begin_serverless_cs_credential_refresh") {
      return { data: true, error: null };
    }
    if (name === "sellerpilot_service_prepare_serverless_cs_credential_refresh") {
      return { data: { status: "prepared", credential_id: CREDENTIAL_ID }, error: null };
    }
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return {
        data: {
          status: "running",
          channel: "shopee",
          operation: "listing.create",
          normalization_timestamp: "2026-08-28T00:00:00.000Z",
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    const override = extra(name, arguments_);
    if (override) return override;
    return { data: null, error: { code: "unexpected_rpc" } };
  };
}

test("serverless gateway exposes Shopee create stage hooks and rebinds after credential refresh", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: drainRpc(calls),
    executeProvider: async ({ hooks }) => {
      assert.equal(typeof hooks.readShopeeSgCreateStageState, "function");
      assert.equal(typeof hooks.beginShopeeSgCreateStage, "function");
      assert.equal(typeof hooks.completeShopeeSgCreateStage, "function");
      assert.equal(typeof hooks.readShopeeSgCreateResume, "function");
      assert.equal(typeof hooks.recordShopeeSgGlobalCreateReadback, "function");
      await hooks.readShopeeSgCreateStageState?.();
      await hooks.beginShopeeSgCreateStage?.({
        sequence: 0,
        stage: "image-upload",
        preparedPayloadSha256: "a".repeat(64),
        sourceUrl: "https://fixture.invalid/image-0.jpg",
        sourceSha256: "b".repeat(64),
      });
      await hooks.completeShopeeSgCreateStage?.({
        sequence: 0,
        stage: "image-upload",
        preparedPayloadSha256: "a".repeat(64),
        sourceUrl: "https://fixture.invalid/image-0.jpg",
        sourceSha256: "b".repeat(64),
        outputId: "provider-image-0",
        result: { response: { image_info: { image_id: "provider-image-0" } } },
      });
      assert.equal(await hooks.readShopeeSgCreateResume?.(), null);
      await hooks.recordShopeeSgGlobalCreateReadback?.({
        globalItemId: "21000000000001",
        createResponse: { response: { global_item_id: 21000000000001 } },
        officialReadback: { response: { global_item_list: [] } },
      });
      await hooks.beginCredentialMutation();
      await hooks.stageCredentialRefresh({
        payload: { access_token: "rotated" },
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      throw new Error("fixture stopped before provider mutation");
    },
  });
  assert.equal(response.status, 200);
  const hookBody = await response.json() as { status?: string };
  assert.equal(hookBody.status, "reconciliation_required");
  assert.deepEqual(
    calls.map(({ name }) => name).filter((name) => Object.values(SHOPEE_STAGE_RPCS).includes(name as typeof SHOPEE_STAGE_RPCS[keyof typeof SHOPEE_STAGE_RPCS])),
    [
      SHOPEE_STAGE_RPCS.state,
      SHOPEE_STAGE_RPCS.begin,
      SHOPEE_STAGE_RPCS.complete,
      SHOPEE_STAGE_RPCS.resume,
      SHOPEE_STAGE_RPCS.recordGlobal,
      SHOPEE_STAGE_RPCS.rebind,
    ],
  );
  const begin = calls.find(({ name }) => name === SHOPEE_STAGE_RPCS.begin);
  assert.equal(begin?.arguments_.p_stage_name, "image-upload");
  assert.equal(begin?.arguments_.p_stage_sequence, 0);
  const complete = calls.find(({ name }) => name === SHOPEE_STAGE_RPCS.complete);
  assert.equal(complete?.arguments_.p_output_id, "provider-image-0");
  const rebindIndex = calls.findIndex(({ name }) => name === SHOPEE_STAGE_RPCS.rebind);
  const prepareIndex = calls.findIndex(({ name }) =>
    name === "sellerpilot_service_prepare_serverless_cs_credential_refresh");
  assert.ok(prepareIndex >= 0);
  assert.ok(rebindIndex > prepareIndex);
});

test("serverless Shopee create success uses same-transaction completion map and skips generic ledger RPC", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: drainRpc(calls),
    executeProvider: async () => liveCreateResult({
      sameTransactionAsLocalPublish: true,
      globalItemId: "7001",
      localItemId: "8001",
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { status?: string };
  assert.equal(body.status, "succeeded");
  assert.equal(
    calls.some(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction"),
    false,
  );
});

test("serverless Shopee create success without same-transaction mapping does not complete the generic ledger", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: drainRpc(calls),
    executeProvider: async () => liveCreateResult(),
  });
  assert.equal(response.status, 503);
  assert.equal(
    calls.some(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction"),
    false,
  );
});
