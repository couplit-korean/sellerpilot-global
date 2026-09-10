import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSmartstoreHistoryWindows,
  resumeSmartstoreHistoryWindows,
  smartstoreHistoryPlanDigest,
} from "../lib/channels/cs/smartstore/history-recovery.ts";
import { projectSmartstoreOrderBinding } from "../lib/cs/channels/smartstore/order-binding-projection.ts";
import {
  reconcileSmartstoreSnapshot,
  type SmartstoreReconciliationSnapshot,
} from "../lib/cs/channels/smartstore/reconciliation.ts";

const digest = (character: string) => character.repeat(64);

test("backward history plan uses exact inclusive 30-day windows and resumes idempotently", () => {
  const windows = buildSmartstoreHistoryWindows("2024-01-01", "2024-02-29");
  assert.deepEqual(windows.map(window => [window.fromDate, window.toDate]), [
    ["2024-01-31", "2024-02-29"],
    ["2024-01-01", "2024-01-30"],
  ]);
  assert.equal(windows[0]?.requests[0]?.periodicKey, "inquiries:history:2024-01-31:2024-02-29:product:all");
  assert.deepEqual(windows[0]?.requests[0]?.arguments, {
    kind: "product",
    query: {
      fromDate: "2024-01-31T00:00:00.000+09:00",
      toDate: "2024-02-29T23:59:59.999+09:00",
      page: 1,
      size: 100,
    },
  });
  assert.deepEqual(windows[0]?.requests[1]?.arguments, {
    kind: "customer",
    query: { startSearchDate: "2024-01-31", endSearchDate: "2024-02-29", page: 1, size: 200 },
  });

  const firstKey = windows[0]!.key;
  const resumed = resumeSmartstoreHistoryWindows(windows, [firstKey, firstKey]);
  assert.equal(resumed.nextWindow?.key, windows[1]?.key);
  assert.equal(resumed.completedDistinctCount, 1);
  assert.equal(resumed.duplicateCompletionCount, 1);
  assert.equal(resumeSmartstoreHistoryWindows(windows, windows.map(window => window.key)).nextWindow, null);
  assert.throws(() => resumeSmartstoreHistoryWindows(windows, ["unknown"]), /UNKNOWN_WINDOW/);
});

test("full live denominator regenerates the same 46-window deterministic plan", () => {
  const windows = buildSmartstoreHistoryWindows("2022-11-30", "2026-09-08");
  assert.equal(windows.length, 46);
  assert.equal(windows[0]?.toDate, "2026-09-08");
  assert.equal(windows.at(-1)?.fromDate, "2022-11-30");
  assert.match(smartstoreHistoryPlanDigest(windows), /^[a-f0-9]{64}$/);
});

test("Smartstore provider and ledger order states project to explicit safe UI states", () => {
  const exact = projectSmartstoreOrderBinding({
    providerContext: { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: ["10001"] },
    externalOrderReference: "10001",
    ledgerStatus: "exact",
  });
  assert.equal(exact.uiState, "exact");
  assert.equal(exact.automaticOrderLinkAllowed, true);
  assert.equal(exact.csCommerceMutationAllowed, false);

  for (const [providerState, ids, expected] of [
    ["ambiguous_product_orders", ["10001", "10002"], "ambiguous_product_orders"],
    ["invalid_product_order_list", [], "invalid_product_order_list"],
    ["unavailable", [], "not_applicable"],
  ] as const) {
    const projected = projectSmartstoreOrderBinding({
      providerContext: { kind: "customer", orderReferenceState: providerState, productOrderIds: ids },
      ledgerStatus: "not_applicable",
    });
    assert.equal(projected.uiState, expected);
    assert.equal(projected.automaticOrderLinkAllowed, false);
  }

  assert.equal(projectSmartstoreOrderBinding({
    providerContext: { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: ["10001"] },
    externalOrderReference: "parent-order-id",
    ledgerStatus: "exact",
  }).uiState, "contract_mismatch");
  assert.equal(projectSmartstoreOrderBinding({
    providerContext: { kind: "customer", orderReferenceState: "ambiguous_product_orders", productOrderIds: ["10001"] },
    ledgerStatus: "not_applicable",
  }).uiState, "ambiguous_product_orders");
  for (const malformed of [["10001", null], ["10001", ""], ["10001", "10001"], "10001"]) {
    const projected = projectSmartstoreOrderBinding({
      providerContext: { kind: "customer", orderReferenceState: "exact_product_order", productOrderIds: malformed },
      externalOrderReference: "10001",
      ledgerStatus: "exact",
    });
    assert.equal(projected.uiState, "contract_mismatch");
    assert.equal(projected.automaticOrderLinkAllowed, false);
  }
  assert.equal(projectSmartstoreOrderBinding({
    providerContext: { kind: "product", orderReferenceState: "unavailable" },
    ledgerStatus: "not_applicable",
  }).uiState, "not_applicable");
});

test("de-identified live-zero fixture reconciles scoped data but never upgrades auth claims to evidence", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/cs/smartstore/live-zero-reconciliation-v2.json", import.meta.url),
    "utf8",
  )) as SmartstoreReconciliationSnapshot;
  const result = reconcileSmartstoreSnapshot(fixture);
  assert.equal(result.history.plannedWindowCount, 46);
  assert.equal(result.history.complete, true);
  assert.equal(result.authStatusClaimConsistent, true);
  assert.equal(result.authBoundaryVerified, false);
  assert.equal(result.requiresIndependentAuthEvidence, true);
  assert.equal(result.dataReconciliationComplete, true);
  assert.equal(result.operationalReadReconciliationComplete, false);
  assert.ok(result.kinds.every(kind => kind.providerUniqueCount === 0 && kind.reconciled));
  assert.deepEqual([result.providerWrites, result.databaseWrites, result.customerBodiesIncluded], [0, 0, false]);
});

test("duplicate provider observations dedupe while missing ledger or web IDs remain visible", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/cs/smartstore/live-zero-reconciliation-v2.json", import.meta.url),
    "utf8",
  )) as SmartstoreReconciliationSnapshot;
  fixture.provider[0]!.nativeIdDigests = [digest("a"), digest("b"), digest("b")];
  fixture.ledger[0]!.nativeIdDigests = [digest("a"), digest("b")];
  fixture.web[0]!.nativeIdDigests = [digest("a"), digest("b")];
  const deduplicated = reconcileSmartstoreSnapshot(fixture);
  assert.equal(deduplicated.kinds[0]?.providerDuplicateCount, 1);
  assert.equal(deduplicated.kinds[0]?.reconciled, true);

  fixture.ledger[0]!.nativeIdDigests.pop();
  fixture.web[0]!.nativeIdDigests.pop();
  const missing = reconcileSmartstoreSnapshot(fixture);
  assert.equal(missing.kinds[0]?.missingInLedgerCount, 1);
  assert.equal(missing.kinds[0]?.missingInWebCount, 1);
  assert.equal(missing.dataReconciliationComplete, false);

  fixture.web[0]!.comparisonFromDate = "2026-06-08";
  assert.throws(() => reconcileSmartstoreSnapshot(fixture), /COMPARISON_RANGE_MISMATCH/);
});

test("a different seller, credential, shop or environment cannot satisfy ledger provenance", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/cs/smartstore/live-zero-reconciliation-v2.json", import.meta.url),
    "utf8",
  )) as SmartstoreReconciliationSnapshot;
  for (const key of ["sellerAccountSha256", "credentialSha256", "shopSha256"] as const) {
    const mismatch = structuredClone(fixture);
    mismatch.ledger[0]!.scope[key] = digest("d");
    const result = reconcileSmartstoreSnapshot(mismatch);
    assert.equal(result.kinds[0]?.scopeMatches, false);
    assert.equal(result.kinds[0]?.reconciled, false);
    assert.equal(result.dataReconciliationComplete, false);
  }
  const environmentMismatch = structuredClone(fixture);
  environmentMismatch.ledger[0]!.scope.environment = "sandbox";
  assert.equal(reconcileSmartstoreSnapshot(environmentMismatch).kinds[0]?.scopeMatches, false);

  const evidenceTimeMismatch = structuredClone(fixture);
  evidenceTimeMismatch.sourceEvidence.observedAt = "2026-09-08T10:12:22.460Z";
  assert.throws(
    () => reconcileSmartstoreSnapshot(evidenceTimeMismatch),
    /SOURCE_EVIDENCE_TIME_INVALID/,
  );
});
