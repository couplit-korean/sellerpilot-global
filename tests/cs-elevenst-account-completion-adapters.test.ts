import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { completeCsWorker } = await import("../lib/cs/operations/worker-completion.ts");

const credentialId = "44444444-4444-4444-8444-444444444444";
const jobId = "10000000-0000-4000-8000-000000000011";
const claimToken = "20000000-0000-4000-8000-000000000011";
const identity = {
  contract: "sellerpilot-elevenst-cs-account-identity/1",
  credentialId,
  sellerId: "account_1234567890abcdef12345678",
  sellerName: "11번가 연결 계정 · v3",
  environment: "production",
  version: 3,
  verifiedAt: "2026-09-09T09:00:00.000Z",
};
const providerResult = {
  ok: true,
  channel: "elevenst",
  operation: "inquiries.list",
  steps: [{
    name: "inquiries",
    ok: true,
    status: 200,
    data: {
      accepted: true,
      resultCode: "200",
      productQnas: [],
      sellerpilotInquiryKind: "product_qna",
      sellerpilotElevenstProductQnaParseContract: "sellerpilot-elevenst-product-qna-parser/1",
      sellerpilotElevenstProductQnaDocumentReady: true,
      sellerpilotElevenstProductQnaObservedRows: 0,
      sellerpilotElevenstProductQnaParseIncomplete: false,
      sellerpilotProductQnaParserReady: true,
    },
  }],
  safeMessage: "fixture",
};

test("CONT-07 external worker completion resolves server identity before recording", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const serviceClient = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args: structuredClone(args) });
      if (name === "sellerpilot_service_elevenst_cs_account_identity_v1") {
        return Promise.resolve({ data: identity, error: null });
      }
      if (name === "sellerpilot_service_complete_gateway_transaction") {
        return Promise.resolve({ data: { status: "completed" }, error: null });
      }
      if (name === "sellerpilot_service_record_elevenst_cs_read_v1") {
        return Promise.resolve({ data: { contract: "sellerpilot-elevenst-cs-read-record/1" }, error: null });
      }
      if (name === "sellerpilot_service_record_cs_history_page_v1") {
        return Promise.resolve({
          data: {
            contract: "cs_history_coverage_v1",
            status: "completed",
            jobId,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { code: "unexpected_rpc" } });
    },
  };
  const response = await completeCsWorker({
    serviceClient,
    tokenHash: "fixture-token",
    job: {
      id: jobId,
      claim_token: claimToken,
      credential_id: credentialId,
      channel: "elevenst",
      operation: "inquiries.list",
      normalization_timestamp: "2026-09-09T10:00:00.000Z",
      request: {
        arguments: {
          kind: "product_qna",
          startDate: "20260903",
          endDate: "20260909",
          answerStatus: "00",
        },
      },
    },
    completion: {
      jobId,
      claimToken,
      status: "succeeded",
      result: providerResult,
    },
  });
  assert.equal(response.status, 200);
  assert.ok(calls.findIndex((call) => call.name === "sellerpilot_service_elevenst_cs_account_identity_v1")
    < calls.findIndex((call) => call.name === "sellerpilot_service_complete_gateway_transaction"));
  const recorded = calls.find((call) => call.name === "sellerpilot_service_record_elevenst_cs_read_v1");
  assert.equal(recorded?.args.p_credential_id, credentialId);
  assert.deepEqual(
    [
      (recorded?.args.p_observation as Record<string, unknown>).sellerId,
      (recorded?.args.p_observation as Record<string, unknown>).sellerName,
    ],
    [identity.sellerId, identity.sellerName],
  );
});

test("CONT-07 external worker fails closed when credential identity cannot be resolved", async () => {
  const calls: string[] = [];
  const response = await completeCsWorker({
    serviceClient: {
      rpc(name: string) {
        calls.push(name);
        if (name === "sellerpilot_service_elevenst_cs_account_identity_v1") {
          return Promise.resolve({ data: null, error: { code: "identity_missing" } });
        }
        return Promise.resolve({ data: null, error: { code: "unexpected_rpc" } });
      },
    },
    tokenHash: "fixture-token",
    job: {
      id: jobId,
      claim_token: claimToken,
      credential_id: credentialId,
      channel: "elevenst",
      operation: "inquiries.list",
      normalization_timestamp: "2026-09-09T10:00:00.000Z",
      request: {
        arguments: {
          kind: "product_qna",
          startDate: "20260903",
          endDate: "20260909",
          answerStatus: "00",
        },
      },
    },
    completion: {
      jobId,
      claimToken,
      status: "succeeded",
      result: providerResult,
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["sellerpilot_service_elevenst_cs_account_identity_v1"]);
});
