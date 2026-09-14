import assert from "node:assert/strict";
import test from "node:test";
import { gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";

test("channel gateway accepts the full Shopee asynchronous verification trail", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "1b1f43a7-16d1-4a59-93df-22e76e9c8726",
    status: "succeeded",
    result: {
      ok: false,
      channel: "shopee",
      operation: "listing.create",
      remoteId: "48366301456",
      safeMessage: "Shopee 게시 결과를 다시 확인해야 합니다.",
      steps: Array.from({ length: 25 }, (_, index) => ({
        name: `published-item-readback-${index + 1}`,
        ok: index < 24,
        status: 200,
        data: {},
      })),
    },
  });

  assert.equal(parsed.success, true);
});
