import { buildSmartstoreHistoryWindows, smartstoreHistoryPlanDigest } from "../../../channels/cs/smartstore/history-recovery.ts";

type Kind = "product" | "customer";
const DIGEST = /^[a-f0-9]{64}$/;

export type SmartstoreReconciliationScope = {
  sellerAccountSha256: string;
  credentialSha256: string;
  shopSha256: string;
  environment: "production" | "sandbox";
};

type SmartstoreObservationScope = {
  kind: Kind;
  scope: SmartstoreReconciliationScope;
  comparisonFromDate: string;
  comparisonThroughDate: string;
  nativeIdDigests: string[];
};

export type SmartstoreReconciliationSnapshot = {
  contract: "sellerpilot-cs-smartstore-reconciliation-input/2";
  checkedAt: string;
  timezone: "Asia/Seoul";
  sourceEvidence: {
    artifactSha256: string;
    observedAt: string;
  };
  scope: SmartstoreReconciliationScope;
  floorDate: string;
  throughDate: string;
  history: {
    plannedWindowCount: number;
    completedWindowCount: number;
    failedWindowCount: number;
    duplicateCompletionCount: number;
    plannedWindowKeysSha256: string;
    completedWindowKeysSha256: string;
  };
  provider: Array<SmartstoreObservationScope & {
    successfulWindowCount: number;
    failedWindowCount: number;
  }>;
  ledger: SmartstoreObservationScope[];
  web: SmartstoreObservationScope[];
  authClaim: {
    evidenceLevel: "snapshot_claim_only";
    administratorStatus: number;
    anonymousStatus: number;
    expiredSessionStatus: number;
  };
  customerBodiesIncluded: false;
  providerWrites: 0;
  databaseWrites: 0;
};

function integer(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`SMARTSTORE_RECONCILIATION_${name}_INVALID`);
  return value;
}

function digest(value: string, name: string) {
  if (!DIGEST.test(value)) throw new Error(`SMARTSTORE_RECONCILIATION_${name}_INVALID`);
  return value;
}

function validateScope(scope: SmartstoreReconciliationScope) {
  digest(scope.sellerAccountSha256, "SELLER_ACCOUNT_SCOPE");
  digest(scope.credentialSha256, "CREDENTIAL_SCOPE");
  digest(scope.shopSha256, "SHOP_SCOPE");
  if (scope.environment !== "production" && scope.environment !== "sandbox") {
    throw new Error("SMARTSTORE_RECONCILIATION_ENVIRONMENT_INVALID");
  }
  return scope;
}

function sameScope(left: SmartstoreReconciliationScope, right: SmartstoreReconciliationScope) {
  return left.sellerAccountSha256 === right.sellerAccountSha256
    && left.credentialSha256 === right.credentialSha256
    && left.shopSha256 === right.shopSha256
    && left.environment === right.environment;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function difference(left: readonly string[], right: readonly string[]) {
  const rightSet = new Set(right);
  return left.filter(value => !rightSet.has(value));
}

function comparisonRange(fromDate: string, throughDate: string, floorDate: string, historyThroughDate: string) {
  const windows = buildSmartstoreHistoryWindows(fromDate, throughDate);
  if (windows.length > 4) throw new Error("SMARTSTORE_RECONCILIATION_COMPARISON_RANGE_TOO_LARGE");
  if (fromDate < floorDate || throughDate > historyThroughDate) {
    throw new Error("SMARTSTORE_RECONCILIATION_COMPARISON_RANGE_OUTSIDE_HISTORY");
  }
  return { fromDate, throughDate };
}

function exactKind<T extends { kind: Kind }>(rows: readonly T[], kind: Kind, source: string) {
  const matches = rows.filter(row => row.kind === kind);
  if (matches.length !== 1) throw new Error(`SMARTSTORE_RECONCILIATION_${source}_KIND_INVALID`);
  return matches[0]!;
}

export function reconcileSmartstoreSnapshot(snapshot: SmartstoreReconciliationSnapshot) {
  if (snapshot.contract !== "sellerpilot-cs-smartstore-reconciliation-input/2"
      || snapshot.timezone !== "Asia/Seoul" || snapshot.customerBodiesIncluded !== false
      || snapshot.providerWrites !== 0 || snapshot.databaseWrites !== 0
      || snapshot.authClaim.evidenceLevel !== "snapshot_claim_only") {
    throw new Error("SMARTSTORE_RECONCILIATION_CONTRACT_INVALID");
  }
  if (!Number.isFinite(Date.parse(snapshot.checkedAt))) throw new Error("SMARTSTORE_RECONCILIATION_CHECKED_AT_INVALID");
  digest(snapshot.sourceEvidence.artifactSha256, "SOURCE_EVIDENCE");
  if (!Number.isFinite(Date.parse(snapshot.sourceEvidence.observedAt))
      || snapshot.sourceEvidence.observedAt !== snapshot.checkedAt) {
    throw new Error("SMARTSTORE_RECONCILIATION_SOURCE_EVIDENCE_TIME_INVALID");
  }
  validateScope(snapshot.scope);
  const windows = buildSmartstoreHistoryWindows(snapshot.floorDate, snapshot.throughDate);
  const planDigest = smartstoreHistoryPlanDigest(windows);
  const plannedWindowCount = integer(snapshot.history.plannedWindowCount, "PLANNED_WINDOW_COUNT");
  const completedWindowCount = integer(snapshot.history.completedWindowCount, "COMPLETED_WINDOW_COUNT");
  const failedWindowCount = integer(snapshot.history.failedWindowCount, "FAILED_WINDOW_COUNT");
  const duplicateCompletionCount = integer(snapshot.history.duplicateCompletionCount, "DUPLICATE_COMPLETION_COUNT");
  const historyPlanMatches = plannedWindowCount === windows.length
    && snapshot.history.plannedWindowKeysSha256 === planDigest;
  const historyComplete = historyPlanMatches && completedWindowCount === plannedWindowCount
    && failedWindowCount === 0 && snapshot.history.completedWindowKeysSha256 === planDigest;

  if (snapshot.provider.length !== 2 || snapshot.ledger.length !== 2 || snapshot.web.length !== 2) {
    throw new Error("SMARTSTORE_RECONCILIATION_SOURCE_KINDS_INVALID");
  }

  const kinds = (["product", "customer"] as const).map(kind => {
    const provider = exactKind(snapshot.provider, kind, "PROVIDER");
    const ledger = exactKind(snapshot.ledger, kind, "LEDGER");
    const web = exactKind(snapshot.web, kind, "WEB");
    validateScope(provider.scope);
    validateScope(ledger.scope);
    validateScope(web.scope);
    const scopeMatches = sameScope(snapshot.scope, provider.scope)
      && sameScope(snapshot.scope, ledger.scope) && sameScope(snapshot.scope, web.scope);
    const providerComparisonRange = comparisonRange(
      provider.comparisonFromDate,
      provider.comparisonThroughDate,
      snapshot.floorDate,
      snapshot.throughDate,
    );
    const ledgerComparisonRange = comparisonRange(
      ledger.comparisonFromDate,
      ledger.comparisonThroughDate,
      snapshot.floorDate,
      snapshot.throughDate,
    );
    const webComparisonRange = comparisonRange(
      web.comparisonFromDate,
      web.comparisonThroughDate,
      snapshot.floorDate,
      snapshot.throughDate,
    );
    if (providerComparisonRange.fromDate !== ledgerComparisonRange.fromDate
        || providerComparisonRange.throughDate !== ledgerComparisonRange.throughDate
        || providerComparisonRange.fromDate !== webComparisonRange.fromDate
        || providerComparisonRange.throughDate !== webComparisonRange.throughDate) {
      throw new Error("SMARTSTORE_RECONCILIATION_COMPARISON_RANGE_MISMATCH");
    }

    const providerObservations = provider.nativeIdDigests.map(value => digest(value, "PROVIDER_ID"));
    const providerUnique = unique(providerObservations);
    const ledgerObservations = ledger.nativeIdDigests.map(value => digest(value, "LEDGER_ID"));
    const ledgerUnique = unique(ledgerObservations);
    const webObservations = web.nativeIdDigests.map(value => digest(value, "WEB_ID"));
    const webUnique = unique(webObservations);
    const successfulWindowCount = integer(provider.successfulWindowCount, "SUCCESSFUL_WINDOW_COUNT");
    const providerFailedWindowCount = integer(provider.failedWindowCount, "PROVIDER_FAILED_WINDOW_COUNT");
    const reconciled = scopeMatches && successfulWindowCount === plannedWindowCount
      && providerFailedWindowCount === 0
      && ledgerObservations.length === ledgerUnique.length
      && webObservations.length === webUnique.length
      && difference(providerUnique, ledgerUnique).length === 0
      && difference(ledgerUnique, providerUnique).length === 0
      && difference(providerUnique, webUnique).length === 0
      && difference(webUnique, providerUnique).length === 0;
    return {
      kind,
      scopeMatches,
      comparisonFromDate: providerComparisonRange.fromDate,
      comparisonThroughDate: providerComparisonRange.throughDate,
      successfulWindowCount,
      failedWindowCount: providerFailedWindowCount,
      providerObservationCount: providerObservations.length,
      providerUniqueCount: providerUnique.length,
      providerDuplicateCount: providerObservations.length - providerUnique.length,
      ledgerObservationCount: ledgerObservations.length,
      ledgerUniqueCount: ledgerUnique.length,
      ledgerDuplicateCount: ledgerObservations.length - ledgerUnique.length,
      webObservationCount: webObservations.length,
      webUniqueCount: webUnique.length,
      webDuplicateCount: webObservations.length - webUnique.length,
      missingInLedgerCount: difference(providerUnique, ledgerUnique).length,
      ledgerOnlyCount: difference(ledgerUnique, providerUnique).length,
      missingInWebCount: difference(providerUnique, webUnique).length,
      webOnlyCount: difference(webUnique, providerUnique).length,
      reconciled,
    };
  });

  const authStatusClaimConsistent = snapshot.authClaim.administratorStatus === 200
    && snapshot.authClaim.anonymousStatus === 401 && snapshot.authClaim.expiredSessionStatus === 401;
  const dataReconciliationComplete = historyComplete && kinds.every(kind => kind.reconciled);
  return {
    contract: "sellerpilot-cs-smartstore-reconciliation-result/2" as const,
    checkedAt: snapshot.checkedAt,
    timezone: snapshot.timezone,
    sourceEvidence: snapshot.sourceEvidence,
    scope: snapshot.scope,
    history: {
      plannedWindowCount,
      completedWindowCount,
      failedWindowCount,
      duplicateCompletionCount,
      planDigest,
      planMatches: historyPlanMatches,
      complete: historyComplete,
    },
    kinds,
    authEvidenceLevel: "snapshot_claim_only" as const,
    authStatusClaimConsistent,
    authBoundaryVerified: false as const,
    requiresIndependentAuthEvidence: true as const,
    dataReconciliationComplete,
    operationalReadReconciliationComplete: false as const,
    providerWrites: 0 as const,
    databaseWrites: 0 as const,
    customerBodiesIncluded: false as const,
  };
}
