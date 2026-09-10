import {
  buildCoupangCreateRevisionCandidate,
  resolveCoupangCreateCompleteness,
  type CoupangCreateCompletenessInput,
  type CoupangCreateCompletenessResult,
  type CoupangCreateRevisionCandidate,
} from "./create-completeness";
import {
  buildCoupangCreateOfficialReadSnapshotPayload,
  type CoupangCreateOfficialReadSnapshotPayload,
} from "./create-official-read-evidence";

export const coupangCreateReadinessSourceContract =
  "sellerpilot_coupang_create_readiness_source_v1" as const;

export type CoupangCreateReadinessReadStep =
  | "category_metadata"
  | "category_status"
  | "outbound_shipping_places"
  | "return_centers"
  | "active_credential_revision";

export type CoupangCreateReadinessSourceInput = Pick<CoupangCreateCompletenessInput,
  "source" | "body" | "publishContext" | "environment" | "now">;

export type CoupangCreateReadContext = Readonly<{
  displayCategoryCode: number;
  environment?: "sandbox" | "production";
}>;

type Awaitable<T> = T | Promise<T>;

export type CoupangCreateReadinessSourceDependencies = {
  readCategoryMetadata: (context: CoupangCreateReadContext) => Awaitable<unknown>;
  readCategoryStatus: (context: CoupangCreateReadContext) => Awaitable<unknown>;
  readOutboundShippingPlaces: (context: CoupangCreateReadContext) => Awaitable<unknown>;
  readReturnCenters: (context: CoupangCreateReadContext) => Awaitable<unknown>;
  readActiveCredentialRevision: (context: CoupangCreateReadContext) => Awaitable<unknown>;
  buildRevisionCandidate?: (input: CoupangCreateCompletenessInput) => CoupangCreateRevisionCandidate;
};

export type CoupangCreateReadinessSourceResult =
  | {
      contract: typeof coupangCreateReadinessSourceContract;
      status: "ready";
      attemptedReads: CoupangCreateReadinessReadStep[];
      completeness: CoupangCreateCompletenessResult;
      candidate: CoupangCreateRevisionCandidate;
      officialReadSnapshotPayload: CoupangCreateOfficialReadSnapshotPayload;
    }
  | {
      contract: typeof coupangCreateReadinessSourceContract;
      status: "not_ready";
      reason:
        | "seller_input_required"
        | "input_blocked"
        | "provider_read_failed"
        | "candidate_rejected";
      stage: "initial" | CoupangCreateReadinessReadStep | "candidate";
      attemptedReads: CoupangCreateReadinessReadStep[];
      completeness: CoupangCreateCompletenessResult;
    };

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

export function coupangCreatePublishContextWithApprovedManifest(
  publishContext: unknown,
  approved: { version: number; manifest: unknown },
): Row {
  const context = row(publishContext) ?? {};
  const detailPage = row(context.detailPage) ?? {};
  return {
    ...context,
    detailPage: {
      ...detailPage,
      version: approved.version,
      approvedVersion: approved.version,
      imageManifest: approved.manifest,
    },
  };
}

/**
 * Credentials are loaded by the server callback. Only the public revision
 * identity needed by the 004 completeness contract may cross this boundary.
 */
function publicCredentialRevision(value: unknown): Row {
  const source = row(value) ?? {};
  return {
    credentialId: source.credentialId,
    credentialVersion: source.credentialVersion,
    credentialFingerprint: source.credentialFingerprint,
    environment: source.environment,
    expiresAt: source.expiresAt,
    sellerIdentityReady: source.sellerIdentityReady,
  };
}

function resolution(input: CoupangCreateCompletenessInput) {
  return resolveCoupangCreateCompleteness(input);
}

function initialStop(
  completeness: CoupangCreateCompletenessResult,
  attemptedReads: CoupangCreateReadinessReadStep[],
): CoupangCreateReadinessSourceResult | null {
  if (completeness.counts.blocked > 0) {
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "not_ready",
      reason: "input_blocked",
      stage: "initial",
      attemptedReads,
      completeness,
    };
  }
  if (completeness.counts.manual_required > 0) {
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "not_ready",
      reason: "seller_input_required",
      stage: "initial",
      attemptedReads,
      completeness,
    };
  }
  return null;
}

function providerStop(
  completeness: CoupangCreateCompletenessResult,
  stage: CoupangCreateReadinessReadStep,
  attemptedReads: CoupangCreateReadinessReadStep[],
): CoupangCreateReadinessSourceResult | null {
  if (completeness.counts.blocked > 0) {
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "not_ready",
      reason: "provider_read_failed",
      stage,
      attemptedReads,
      completeness,
    };
  }
  if (completeness.counts.manual_required > 0) {
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "not_ready",
      reason: "seller_input_required",
      stage,
      attemptedReads,
      completeness,
    };
  }
  return null;
}

const failedRead = Object.freeze({ ok: false, error: "PROVIDER_READ_FAILED" });

/**
 * Resolve the seller-controlled portion first. Provider reads are strictly
 * sequential and are never used to select a shipping/return center: the 004
 * resolver exact-matches the seller-confirmed codes already present in body.
 *
 * This function stops at a sanitized 004 revision candidate. Binding the 003
 * source revision, enqueueing and claiming remain separate server operations.
 */
export async function buildCoupangCreateReadinessSource(
  input: CoupangCreateReadinessSourceInput,
  dependencies: CoupangCreateReadinessSourceDependencies,
): Promise<CoupangCreateReadinessSourceResult> {
  const state: CoupangCreateCompletenessInput = {
    source: input.source,
    body: input.body,
    publishContext: input.publishContext,
    environment: input.environment,
    now: input.now,
  };
  const attemptedReads: CoupangCreateReadinessReadStep[] = [];
  let completeness = resolution(state);
  const stoppedInitially = initialStop(completeness, attemptedReads);
  if (stoppedInitially) return stoppedInitially;

  const body = row(input.body);
  const displayCategoryCode = Number(body?.displayCategoryCode);
  const context: CoupangCreateReadContext = Object.freeze({
    displayCategoryCode,
    environment: input.environment,
  });

  const read = async (
    stage: CoupangCreateReadinessReadStep,
    callback: (context: CoupangCreateReadContext) => Awaitable<unknown>,
    assign: (value: unknown) => void,
  ): Promise<CoupangCreateReadinessSourceResult | null> => {
    attemptedReads.push(stage);
    try {
      assign(await callback(context));
    } catch {
      assign(failedRead);
    }
    completeness = resolution(state);
    return providerStop(completeness, stage, [...attemptedReads]);
  };

  let stopped = await read("category_metadata", dependencies.readCategoryMetadata,
    (value) => { state.categoryMetadataRead = value; });
  if (stopped) return stopped;
  stopped = await read("category_status", dependencies.readCategoryStatus,
    (value) => { state.categoryStatusRead = value; });
  if (stopped) return stopped;
  stopped = await read("outbound_shipping_places", dependencies.readOutboundShippingPlaces,
    (value) => { state.outboundShippingPlacesRead = value; });
  if (stopped) return stopped;
  stopped = await read("return_centers", dependencies.readReturnCenters,
    (value) => { state.returnCentersRead = value; });
  if (stopped) return stopped;
  stopped = await read("active_credential_revision", dependencies.readActiveCredentialRevision,
    (value) => { state.credentialRevision = publicCredentialRevision(value); });
  if (stopped) return stopped;

  const officialReadSnapshotPayload = buildCoupangCreateOfficialReadSnapshotPayload({
    displayCategoryCode,
    environment: input.environment ?? "production",
    now: input.now ?? new Date(),
    categoryMetadataRead: state.categoryMetadataRead,
    categoryStatusRead: state.categoryStatusRead,
    outboundShippingPlacesRead: state.outboundShippingPlacesRead,
    returnCentersRead: state.returnCentersRead,
  });
  state.officialReadEvidence = officialReadSnapshotPayload.officialReadEvidence;

  const buildCandidate = dependencies.buildRevisionCandidate
    ?? buildCoupangCreateRevisionCandidate;
  try {
    const candidate = buildCandidate(state);
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "ready",
      attemptedReads: [...attemptedReads],
      completeness: candidate.completeness,
      candidate,
      officialReadSnapshotPayload,
    };
  } catch {
    return {
      contract: coupangCreateReadinessSourceContract,
      status: "not_ready",
      reason: "candidate_rejected",
      stage: "candidate",
      attemptedReads: [...attemptedReads],
      completeness,
    };
  }
}
