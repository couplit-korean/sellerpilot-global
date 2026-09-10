import assert from "node:assert/strict";
import test from "node:test";
import { csCompletionStatus } from "../lib/cs/operations/completion-status";
import type { CsOperationResult } from "../lib/cs/operations/contracts";

function reply(status: number, data: Record<string, unknown> = {}): CsOperationResult {
  return { channel: "elevenst", operation: "inquiries.reply", ok: false,
    safeMessage: "rejected", steps: [{ name: "inquiry-reply", ok: false, status, data }] };
}

test("definitive reply rejection never becomes a successful completion", () => {
  for (const status of [200, 400, 401, 403, 422, 429]) {
    assert.equal(csCompletionStatus(reply(status, { resultCode: "500" })), "failed");
  }
  assert.equal(csCompletionStatus({ ...reply(200), steps: [] }), "failed");
});

test("uncertain reply mutations retain reconciliation instead of safe retry", () => {
  for (const status of [408, 500, 502, 503, 599]) {
    assert.equal(csCompletionStatus(reply(status)), "reconciliation_required");
  }
  assert.equal(csCompletionStatus(reply(200, { sellerpilotMutation: "accepted" })), "reconciliation_required");
  assert.equal(csCompletionStatus(reply(200, { sellerpilotReconciliationRequired: true })), "reconciliation_required");
  const accepted = reply(200);
  accepted.steps[0].ok = true;
  assert.equal(csCompletionStatus(accepted), "reconciliation_required");
});

test("read failures and successful operations preserve their completion semantics", () => {
  assert.equal(csCompletionStatus({ ...reply(503), operation: "inquiries.list" }), "failed");
  for (const operation of ["inquiries.list", "inquiries.reply"]) {
    assert.equal(csCompletionStatus({ ...reply(200), operation, ok: true }), "succeeded");
  }
});
