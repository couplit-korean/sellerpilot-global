import assert from "node:assert/strict";
import test from "node:test";
import { recordQoo10ReplyS3Requery } from "../lib/channels/cs/qoo10/reply-readback-requery-runtime.ts";

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  credential: "00000000-0000-4000-8000-000000000002",
  delivery: "00000000-0000-4000-8000-000000000003",
  reply: "00000000-0000-4000-8000-000000000004",
  read: "00000000-0000-4000-8000-000000000005",
  child: "00000000-0000-4000-8000-000000000006",
};
const lineage = {
  ownerId: ids.owner, credentialId: ids.credential, sellerAccountKey: "a".repeat(64),
  environment: "production", deliveryId: ids.delivery, replyJobId: ids.reply,
  inboundKey: "qoo10:inbound:fixture", searchStartAt: "20260909000000",
  searchEndAt: "20260909235959",
  target: { inquiryType: "MSG", questionNo: "700", sequenceNo: "701" },
};

test("Qoo10 requery runtime uses the attested context and accepts one exact scheduled receipt", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const receipt = await recordQoo10ReplyS3Requery({
    tokenHash: "b".repeat(64), jobId: ids.read,
    claimToken: "00000000-0000-4000-8000-000000000007",
    verification: { state: "pending", reason: "exact_s3_not_observed", matchingRows: 0, resendAllowed: false, replyContentObserved: false },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name.endsWith("_context_v1")) return { error: null, data: {
        contract: "sellerpilot-qoo10-reply-s3-requery-context/1",
        sourceReadbackJobId: ids.read, attemptNumber: 1, expectedLineageDigest: null,
        firstCheckedAt: "2026-09-09T00:00:00.000Z", lastCheckedAt: "2026-09-09T00:00:00.000Z", lineage,
      } };
      const descriptor = args.p_descriptor as Record<string, unknown>;
      return { error: null, data: {
        contract: "sellerpilot-qoo10-reply-s3-requery-result/1", status: "scheduled",
        sourceReadbackJobId: ids.read, deliveryId: ids.delivery, attemptNumber: 1,
        nextAttemptNumber: 2, lineageDigest: descriptor.lineageDigest,
        requeryJobId: ids.child, replayed: false,
      } };
    },
  });
  assert.equal(receipt.status, "scheduled");
  assert.deepEqual(calls.map((call) => call.name), [
    "sellerpilot_service_qoo10_reply_s3_requery_context_v1",
    "sellerpilot_service_apply_qoo10_reply_s3_requery_v1",
  ]);
  const descriptor = calls[1]!.args.p_descriptor as Record<string, unknown>;
  assert.equal(descriptor.operation, "inquiries.list");
  assert.equal(descriptor.resendAllowed, false);
  assert.equal(JSON.stringify(descriptor).includes("contents"), false);
});

test("Qoo10 exact observation stops without a child and accepts verified receipt", async () => {
  const receipt = await recordQoo10ReplyS3Requery({
    tokenHash: "b".repeat(64), jobId: ids.read,
    claimToken: "00000000-0000-4000-8000-000000000007",
    verification: { state: "verified", reason: "exact_s3_status_observed", matchingRows: 1, resendAllowed: false, replyContentObserved: false },
    rpc: async (name, args) => name.endsWith("_context_v1")
      ? { error: null, data: {
          contract: "sellerpilot-qoo10-reply-s3-requery-context/1",
          sourceReadbackJobId: ids.read, attemptNumber: 1, expectedLineageDigest: null,
          firstCheckedAt: "2026-09-09T00:00:00.000Z", lastCheckedAt: "2026-09-09T00:00:00.000Z", lineage,
        } }
      : { error: null, data: {
          contract: "sellerpilot-qoo10-reply-s3-requery-result/1", status: "verified",
          sourceReadbackJobId: ids.read, deliveryId: ids.delivery, attemptNumber: 1,
          lineageDigest: (args.p_descriptor as Record<string, unknown>).lineageDigest,
          replayed: false,
        } },
  });
  assert.equal(receipt.status, "verified");
});
