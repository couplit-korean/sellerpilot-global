import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it, mock } from "node:test";

import { produceTemuCreateAuthoritativeSourceBeforeClaim, recordAndReadTemuCreateSource } from "../lib/product-registration/temu/authoritative-create-producer";
import { TemuCreateSourceLedgerError } from "../lib/product-registration/temu/create-authoritative-source-ledger";

const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000002";
const credentialId = "30000000-0000-4000-8000-000000000003";

describe("Temu actual listing.create producer boundary", () => {
  for (const [appState, complianceState, code] of [
    ["inactive", "approved", "TEMU_CREATE_APP_INACTIVE"],
    ["active", "reviewing", "TEMU_CREATE_COMPLIANCE_NOT_APPROVED"],
  ] as const) it(`performs zero downstream work for ${appState}/${complianceState}`, async () => {
    const rpc = mock.fn(async () => ({ data: {
      contract: "temu_verified_create_app_gate_v1", status: "blocked", appState,
      complianceState,
    }, error: null }));
    const decryptCredential = mock.fn(async () => ({}));
    const providerRequest = mock.fn(async () => {
      throw new Error("provider request must not run");
    });
    await assert.rejects(produceTemuCreateAuthoritativeSourceBeforeClaim({
      rpc, ownerId, productId, credentialId,
      requestFingerprint: "a".repeat(64), argumentsValue: {},
      publishContext: {}, credentialMetadata: {}, decryptCredential,
      providerRequest,
    }), (error: unknown) => error instanceof TemuCreateSourceLedgerError
      && error.code === code);
    assert.equal(rpc.mock.callCount(), 1, "only app-gate RPC is allowed");
    assert.equal(decryptCredential.mock.callCount(), 0);
    assert.equal(providerRequest.mock.callCount(), 0);
  });

  it("route produces both immutable bindings after identity and before claim", async () => {
    const route = await readFile(new URL(
      "../app/api/admin/channel-operations/route.ts",
      import.meta.url,
    ), "utf8");
    const clientSourceRemoval = route.indexOf(
      "delete effectiveArguments.sellerpilotTemuAuthoritativeSource",
    );
    const producer = route.indexOf("produceTemuCreateAuthoritativeSourceBeforeClaim({");
    const sourceBinding = route.indexOf("sellerpilotTemuAuthoritativeSource: produced.sourceBinding", producer);
    const prewriteBinding = route.indexOf("sellerpilotTemuReviewAndCreatePrewrite: produced.prewriteBinding", producer);
    assert.ok(clientSourceRemoval >= 0 && producer > clientSourceRemoval);
    assert.ok(sourceBinding > producer && prewriteBinding > producer);
  });

  it("freezes the actual post-image arguments before gateway enqueue", async () => {
    const route = await readFile(new URL(
      "../app/api/admin/channel-operations/route.ts",
      import.meta.url,
    ), "utf8");
    const producer = route.indexOf("produceTemuCreateAuthoritativeSourceBeforeClaim({");
    const finalization = route.indexOf("bindTemuFinalCreatePayloadBeforeEnqueue", producer);
    assert.ok(producer >= 0 && finalization > producer);
  });

  it("keeps product revision identity distinct from request fingerprint", async () => {
    const source = await readFile(new URL(
      "../lib/product-registration/temu/authoritative-create-producer.ts",
      import.meta.url,
    ), "utf8");
    assert.ok(source.includes("p_product_revision_fingerprint: productFingerprint"));
    assert.ok(source.includes("p_request_fingerprint: input.requestFingerprint"));
    assert.equal(source.includes("p_product_revision_fingerprint: input.requestFingerprint"), false);
  });

  it("producer wires token, nine preparation reads, exact goods/SKU and record/readback", async () => {
    const source = await readFile(new URL(
      "../lib/product-registration/temu/authoritative-create-producer.ts",
      import.meta.url,
    ), "utf8");
    for (const marker of [
      "createTemuAuthoritativeProviderReadAdapter",
      "createTemuAuthoritativePreparationReadAdapter",
      "readGlobalEgressAttestation",
      "recordTemuCreateAuthoritativeSource",
      "bindTemuCreateAuthoritativeSourceBeforeClaim",
      "expectedExternalSkuId: externalSkuId",
    ]) assert.ok(source.includes(marker), marker);
    const helperAt = source.indexOf("export async function recordAndReadTemuCreateSource");
    const recordAt = source.indexOf("await recordTemuCreateAuthoritativeSource", helperAt);
    const freshReadAt = source.indexOf("return await readback()", recordAt);
    assert.ok(recordAt >= 0 && freshReadAt > recordAt);
  });

  it("reconciles a lost append response by exact fresh readback without a second append", async () => {
    const requestFingerprint = "a".repeat(64);
    let recordCalls = 0;
    const rpc = mock.fn(async (name: string) => {
      if (name === "sellerpilot_service_record_temu_create_authoritative_source_v1") {
        recordCalls += 1;
        throw new Error("response lost after commit");
      }
      if (name === "sellerpilot_service_read_temu_verified_create_app_gate_v1") {
        return { data: { contract: "temu_verified_create_app_gate_v1", status: "allowed",
          appState: "active", complianceState: "approved" }, error: null };
      }
      return { data: { contract: "temu_create_authoritative_source_read_v1",
        status: "ready", sourceId: "40000000-0000-4000-8000-000000000004",
        sourceRevision: 1, evidenceSha256: "b".repeat(64), requestFingerprint,
        productRevisionFingerprint: "c".repeat(64),
        expiresAt: "2026-09-10T08:00:00.000Z" }, error: null };
    });
    const result = await recordAndReadTemuCreateSource({ rpc, ownerId,
      productId, credentialId, requestFingerprint, recordParameters: {} });
    assert.equal(result.requestFingerprint, requestFingerprint);
    assert.equal(recordCalls, 1);
    assert.equal(rpc.mock.callCount(), 3);
  });

  it("uses the reserved forward migration number and PostgreSQL-safe function names", async () => {
    const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
    const names = await readdir(migrationDirectory);
    assert.equal(names.includes("20260910034000_temu_operator_app_observation_source.sql"), false);
    assert.equal(names.filter((name) => name.startsWith("20260910040500_")).length, 1);
    assert.equal(names.filter((name) => name.startsWith("20260910040600_")).length, 1);
    for (const name of [
      "20260910033000_temu_create_producer_context.sql",
      "20260910040500_temu_operator_app_observation_source.sql",
      "20260910040600_temu_official_app_attestation_and_final_body_cas.sql",
    ]) {
      const sql = await readFile(new URL(name, migrationDirectory), "utf8");
      for (const match of sql.matchAll(/create(?:\s+or\s+replace)?\s+function\s+(?:public|sellerpilot_private)\.([a-z0-9_]+)/giu)) {
        assert.ok(Buffer.byteLength(match[1], "utf8") <= 63, match[1]);
      }
    }
  });
});
