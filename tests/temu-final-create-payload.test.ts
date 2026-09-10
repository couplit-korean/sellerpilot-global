import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { bindTemuFinalCreatePayloadBeforeEnqueue } from "../lib/product-registration/temu/final-create-payload";

const input = {
  ownerId: "10000000-0000-4000-8000-000000000001",
  productId: "20000000-0000-4000-8000-000000000002",
  credentialId: "30000000-0000-4000-8000-000000000003",
  attemptId: "40000000-0000-4000-8000-000000000004",
  sourceId: "50000000-0000-4000-8000-000000000005",
  requestFingerprint: "a".repeat(64),
};

describe("Temu post-image final payload binding", () => {
  it("strips a browser final marker and returns only the DB digest binding", async () => {
    const rpc = mock.fn(async (_name: string, parameters: Record<string, unknown>) => ({
      data: { contract: "temu_final_create_payload_binding_v1",
        finalPayloadId: "60000000-0000-4000-8000-000000000006",
        sourceId: input.sourceId, attemptId: input.attemptId,
        finalArgumentsSha256: "b".repeat(64), assetBytesSha256: "c".repeat(64) },
      error: null,
      parameters,
    }));
    const result = await bindTemuFinalCreatePayloadBeforeEnqueue({ ...input, rpc,
      finalArguments: { body: { exact: true }, sellerpilotTemuFinalPayload: { forged: true } } });
    const parameters = rpc.mock.calls[0]?.arguments[1] as Record<string, unknown>;
    assert.deepEqual(parameters.p_final_arguments, { body: { exact: true } });
    assert.equal((result.sellerpilotTemuFinalPayload as Record<string, unknown>).finalPayloadId,
      "60000000-0000-4000-8000-000000000006");
  });

  it("does not retry a finalization whose response may have been lost", async () => {
    const rpc = mock.fn(async () => { throw new Error("response lost"); });
    await assert.rejects(bindTemuFinalCreatePayloadBeforeEnqueue({ ...input, rpc,
      finalArguments: { body: { exact: true } } }), /response lost/u);
    assert.equal(rpc.mock.callCount(), 1);
  });
});
