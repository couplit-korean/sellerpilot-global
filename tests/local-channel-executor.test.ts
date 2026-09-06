import assert from "node:assert/strict";
import test from "node:test";
import {
  egressIpSha256,
  externalDetailApprovalBindingFromPublishContext,
  isLocalChannelExecutorTuple,
  localChannelExecutorAccess,
  localExecutorWorkerVersion,
  normalizeEgressIp,
  parseLocalChannelExecutorReadiness,
  parseLocalExecutorWorkerVersion,
  vercelForwardedClientIp,
} from "../lib/channels/local-channel-executor";

const releaseSha = "8".repeat(40);
const egressSha256 = "a".repeat(64);

test("the local executor has an exact read/write operation whitelist", () => {
  assert.equal(localChannelExecutorAccess("coupang", "categories.attributes"), "read");
  assert.equal(localChannelExecutorAccess("coupang", "categories.validate"), "read");
  assert.equal(localChannelExecutorAccess("coupang", "listing.create"), "write");
  assert.equal(localChannelExecutorAccess("smartstore", "listing.create"), "write");
  assert.equal(localChannelExecutorAccess("smartstore", "listing.update"), "write");
  assert.equal(isLocalChannelExecutorTuple("smartstore", "listing.stop"), false);
  assert.equal(isLocalChannelExecutorTuple("coupang", "orders.list"), false);
  assert.equal(isLocalChannelExecutorTuple("smartstore", "orders.list"), false);
  assert.equal(isLocalChannelExecutorTuple("coupang", "listing.update"), false);
  assert.equal(isLocalChannelExecutorTuple("elevenst", "listing.create"), false);
});

test("release and egress are jointly encoded in the bounded worker version", () => {
  const version = localExecutorWorkerVersion(releaseSha, egressSha256);
  assert.equal(version, `sellerpilot-cli-worker/1.61+${releaseSha}.aaaaaaaaaaa`);
  assert.equal(version?.length, 80);
  assert.deepEqual(parseLocalExecutorWorkerVersion(version), {
    releaseSha,
    egressSha256Prefix: "a".repeat(11),
  });
  assert.equal(localExecutorWorkerVersion("short", egressSha256), null);
  assert.equal(parseLocalExecutorWorkerVersion("sellerpilot-cli-worker/1.61"), null);
});

test("the observed Vercel client address must be singular and canonical", () => {
  const headers = new Headers({ "x-vercel-forwarded-for": "112.172.127.206" });
  assert.equal(vercelForwardedClientIp(headers), "112.172.127.206");
  assert.equal(
    egressIpSha256(vercelForwardedClientIp(headers)),
    egressIpSha256("112.172.127.206"),
  );
  assert.equal(vercelForwardedClientIp(new Headers({
    "x-vercel-forwarded-for": "112.172.127.206, 10.0.0.1",
  })), null);
  assert.equal(normalizeEgressIp("999.1.1.1"), null);
});

test("revision and content hash must be paired and identical across the publish snapshot", () => {
  assert.deepEqual(externalDetailApprovalBindingFromPublishContext({
    externalDetailImport: { approvalRevision: 3, contentSha256: "b".repeat(64) },
    externalDetailSnapshot: { approvalRevision: 3, contentSha256: "b".repeat(64) },
  }), { approvalRevision: 3, contentSha256: "b".repeat(64) });
  assert.deepEqual(externalDetailApprovalBindingFromPublishContext({}), {
    approvalRevision: null,
    contentSha256: null,
  });
  assert.deepEqual(externalDetailApprovalBindingFromPublishContext({
    externalDetailImport: { approvalRevision: null, contentSha256: null },
  }), {
    approvalRevision: null,
    contentSha256: null,
  });
  assert.throws(() => externalDetailApprovalBindingFromPublishContext({
    externalDetailImport: { approvalRevision: 3, contentSha256: "b".repeat(64) },
    externalDetailSnapshot: { approvalRevision: 4, contentSha256: "b".repeat(64) },
  }), /EXTERNAL_DETAIL_APPROVAL_REVISION_INVALID/u);
  assert.throws(() => externalDetailApprovalBindingFromPublishContext({
    externalDetailImport: { approvalRevision: 3 },
  }), /EXTERNAL_DETAIL_APPROVAL_REVISION_INVALID/u);
});

test("readiness is accepted only when every requested binding is echoed", () => {
  const expected = {
    access: "write" as const,
    channel: "coupang",
    operation: "listing.create",
    credentialId: "00000000-0000-4000-8000-000000000001",
    productId: "00000000-0000-4000-8000-000000000002",
    releaseSha,
    approvalRevision: 3,
    contentSha256: "b".repeat(64),
  };
  const response = {
    contract: "local_channel_executor_readiness_v1",
    ready: true,
    ...expected,
  };
  assert.deepEqual(parseLocalChannelExecutorReadiness(response, expected), response);
  assert.equal(parseLocalChannelExecutorReadiness({
    ...response,
    approvalRevision: 2,
  }, expected), null);
  assert.equal(parseLocalChannelExecutorReadiness({
    ...response,
    credentialId: "00000000-0000-4000-8000-000000000099",
  }, expected), null);
});
