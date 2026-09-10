import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  bindTemuCreateAuthoritativeSourceBeforeClaim,
  TemuCreateSourceLedgerError,
} from "../lib/product-registration/temu/create-authoritative-source-ledger";

const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000002";
const credentialId = "30000000-0000-4000-8000-000000000003";
const requestFingerprint = "a".repeat(64);

function rpcResults(...data: unknown[]) {
  return mock.fn(async () => ({ data: data.shift(), error: null }));
}

describe("Temu create authoritative source claim-before binding", () => {
  for (const [appState, complianceState, code] of [
    ["inactive", "approved", "TEMU_CREATE_APP_INACTIVE"],
    ["active", "reviewing", "TEMU_CREATE_COMPLIANCE_NOT_APPROVED"],
    ["active", "rejected", "TEMU_CREATE_COMPLIANCE_NOT_APPROVED"],
  ] as const) it(`stops after the app read for ${appState}/${complianceState}`, async () => {
    const rpc = rpcResults({
      contract: "temu_verified_create_app_gate_v1",
      status: "blocked",
      appState,
      complianceState,
    });
    await assert.rejects(bindTemuCreateAuthoritativeSourceBeforeClaim({
      rpc, ownerId, productId, credentialId, requestFingerprint,
    }), (error: unknown) => error instanceof TemuCreateSourceLedgerError
      && error.code === code);
    assert.equal(rpc.mock.callCount(), 1);
    assert.equal(rpc.mock.calls[0]?.arguments[0], "sellerpilot_service_read_temu_verified_create_app_gate_v1");
  });

  it("binds one exact current row only after Active and Approved", async () => {
    const rpc = rpcResults(
      {
        contract: "temu_verified_create_app_gate_v1",
        status: "allowed",
        appState: "active",
        complianceState: "approved",
      },
      {
        contract: "temu_create_authoritative_source_read_v1",
        status: "ready",
        sourceId: "40000000-0000-4000-8000-000000000004",
        sourceRevision: 7,
        evidenceSha256: "b".repeat(64),
        requestFingerprint,
        productRevisionFingerprint: "c".repeat(64),
        expiresAt: "2026-09-10T01:05:00.000Z",
      },
    );
    const result = await bindTemuCreateAuthoritativeSourceBeforeClaim({
      rpc,
      ownerId,
      productId,
      credentialId,
      requestFingerprint,
    });
    assert.deepEqual(result, {
      contract: "temu_create_authoritative_source_binding_v1",
      sourceId: "40000000-0000-4000-8000-000000000004",
      sourceRevision: 7,
      evidenceSha256: "b".repeat(64),
      requestFingerprint,
      productRevisionFingerprint: "c".repeat(64),
    });
    assert.equal(rpc.mock.callCount(), 2);
  });

  it("rejects a row bound to a different normalized request", async () => {
    const rpc = rpcResults(
      { contract: "temu_verified_create_app_gate_v1", status: "allowed" },
      {
        contract: "temu_create_authoritative_source_read_v1",
        status: "ready",
        sourceId: "40000000-0000-4000-8000-000000000004",
        sourceRevision: 1,
        evidenceSha256: "b".repeat(64),
        requestFingerprint: "c".repeat(64),
        productRevisionFingerprint: "d".repeat(64),
        expiresAt: "2026-09-10T01:05:00.000Z",
      },
    );
    await assert.rejects(bindTemuCreateAuthoritativeSourceBeforeClaim({
      rpc, ownerId, productId, credentialId, requestFingerprint,
    }), (error: unknown) => error instanceof TemuCreateSourceLedgerError
      && error.code === "TEMU_CREATE_SOURCE_CONTRACT_INVALID");
  });
});
