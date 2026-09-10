import {
  inspectTemuReviewAndCreateReadiness,
  type TemuAppReviewEvidence,
  type TemuCreateEvidence,
  type TemuReadinessIssue,
} from "./review-and-create-readiness";

export const temuReviewAndCreatePrewriteContract =
  "temu_review_and_create_prewrite_v1" as const;

export type TemuReviewAndCreatePrewriteBinding = {
  version: typeof temuReviewAndCreatePrewriteContract;
  publicationFingerprint: string;
  externalGoodsId: string;
  accountBinding: {
    source: "temu_partner_token_account_mapping_v1";
    observedAtEpochMs: number;
    partnerAccountSubject: string;
    tokenIdentitySubject: string;
    mallId: string;
    regionId: string;
    productRevisionFingerprint: string;
    evidenceSha256: string;
  };
  app: TemuAppReviewEvidence;
  create: TemuCreateEvidence;
};

export type TemuReviewAndCreatePrewriteInspection = {
  ok: boolean;
  verification:
    | "TEMU_REVIEW_CREATE_PREWRITE_BINDING_REQUIRED"
    | "TEMU_REVIEW_CREATE_PREWRITE_BINDING_INVALID"
    | "TEMU_REVIEW_CREATE_PREWRITE_FINGERPRINT_MISMATCH"
    | "TEMU_REVIEW_CREATE_PREWRITE_IDENTITY_MISMATCH"
    | "TEMU_REVIEW_CREATE_PREWRITE_READINESS_REJECTED"
    | "TEMU_REVIEW_CREATE_PREWRITE_VERIFIED";
  appSubmissionPrepared: boolean;
  createPrewriteReady: boolean;
  appIssues: TemuReadinessIssue[];
  createIssues: TemuReadinessIssue[];
  missingScopes: readonly string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function rejected(
  verification: Exclude<
    TemuReviewAndCreatePrewriteInspection["verification"],
    "TEMU_REVIEW_CREATE_PREWRITE_VERIFIED"
  >,
): TemuReviewAndCreatePrewriteInspection {
  return {
    ok: false,
    verification,
    appSubmissionPrepared: false,
    createPrewriteReady: false,
    appIssues: [],
    createIssues: [],
    missingScopes: [],
  };
}

export function inspectTemuReviewAndCreatePrewrite(input: {
  argumentsValue: Record<string, unknown>;
  expectedPublicationFingerprint: string;
  externalGoodsId: string;
}): TemuReviewAndCreatePrewriteInspection {
  const value = input.argumentsValue.sellerpilotTemuReviewAndCreatePrewrite;
  if (value === undefined || value === null) {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_BINDING_REQUIRED");
  }
  if (!record(value)
    || value.version !== temuReviewAndCreatePrewriteContract
    || typeof value.publicationFingerprint !== "string"
    || typeof value.externalGoodsId !== "string"
    || !record(value.accountBinding)
    || !record(value.app)
    || !record(value.create)) {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_BINDING_INVALID");
  }
  if (value.publicationFingerprint !== input.expectedPublicationFingerprint) {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_FINGERPRINT_MISMATCH");
  }
  if (value.externalGoodsId !== input.externalGoodsId
    || value.create.sellerSku !== input.externalGoodsId) {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_IDENTITY_MISMATCH");
  }
  const accountBinding = value.accountBinding;
  if (accountBinding.source !== "temu_partner_token_account_mapping_v1"
    || !Number.isFinite(accountBinding.observedAtEpochMs)
    || !/^temu-account:sha256:[a-f0-9]{64}$/u.test(
      String(accountBinding.partnerAccountSubject ?? ""),
    )
    || !/^temu:sha256:[a-f0-9]{64}$/u.test(
      String(accountBinding.tokenIdentitySubject ?? ""),
    )
    || !/^\d+$/u.test(String(accountBinding.mallId ?? ""))
    || !/^\d+$/u.test(String(accountBinding.regionId ?? ""))
    || accountBinding.productRevisionFingerprint
      !== input.expectedPublicationFingerprint
    || !/^[a-f0-9]{64}$/u.test(String(accountBinding.evidenceSha256 ?? ""))) {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_BINDING_INVALID");
  }

  try {
    const readiness = inspectTemuReviewAndCreateReadiness({
      app: value.app as TemuAppReviewEvidence,
      create: value.create as TemuCreateEvidence,
    });
    return {
      ok: readiness.createPrewriteReady,
      verification: readiness.createPrewriteReady
        ? "TEMU_REVIEW_CREATE_PREWRITE_VERIFIED"
        : "TEMU_REVIEW_CREATE_PREWRITE_READINESS_REJECTED",
      appSubmissionPrepared: readiness.appSubmissionPrepared,
      createPrewriteReady: readiness.createPrewriteReady,
      appIssues: readiness.appIssues,
      createIssues: readiness.createIssues,
      missingScopes: readiness.missingScopes,
    };
  } catch {
    return rejected("TEMU_REVIEW_CREATE_PREWRITE_BINDING_INVALID");
  }
}
