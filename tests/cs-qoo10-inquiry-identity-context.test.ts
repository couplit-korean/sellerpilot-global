import assert from "node:assert/strict";
import test from "node:test";
import {
  parseQoo10InquiryIdentityContext,
  qoo10InquiryIdentityContextContract,
  qoo10InquiryIdentityContextRpcArguments,
} from "../lib/channels/cs/qoo10/inquiry-identity-context.ts";

const credentialId = "00000000-0000-4000-8000-000000000002";
const context = {
  contract: qoo10InquiryIdentityContextContract,
  ownerId: "00000000-0000-4000-8000-000000000001",
  sellerAccountKey: "a".repeat(64),
  environment: "production",
  sourceCredentialId: credentialId,
};

test("Qoo10 identity context accepts only the exact credential and environment", () => {
  assert.deepEqual(parseQoo10InquiryIdentityContext(context, {
    credentialId,
    environment: "production",
  }), {
    account: {
      ownerId: context.ownerId,
      sellerAccountKey: context.sellerAccountKey,
      environment: "production",
    },
    sourceCredentialId: credentialId,
  });
  assert.throws(() => parseQoo10InquiryIdentityContext({ ...context, sourceCredentialId: "00000000-0000-4000-8000-000000000003" }, {
    credentialId,
    environment: "production",
  }), /QOO10_INQUIRY_IDENTITY_CONTEXT_INVALID/u);
  assert.throws(() => parseQoo10InquiryIdentityContext(context, {
    credentialId,
    environment: "sandbox",
  }), /QOO10_INQUIRY_IDENTITY_CONTEXT_INVALID/u);
});

test("Qoo10 identity context RPC arguments preserve the exact completion claim", () => {
  assert.deepEqual(qoo10InquiryIdentityContextRpcArguments({
    tokenHash: "b".repeat(64),
    jobId: "00000000-0000-4000-8000-000000000004",
    claimToken: "00000000-0000-4000-8000-000000000005",
  }), {
    p_token_hash: "b".repeat(64),
    p_job_id: "00000000-0000-4000-8000-000000000004",
    p_claim_token: "00000000-0000-4000-8000-000000000005",
  });
});
