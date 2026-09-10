import type { CsRuntimeAccountContext } from "../../../cs/operations/contracts";
import { z } from "zod";

export type TemuCsKind = "after_sales" | "buyer_chat";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid();
const region = z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/u);
const evidenceStatus = z.enum(["Active", "Inactive", "Approved", "Reviewing", "Rejected", "Unknown"]);

const afterSalesRuntimeStateSchema = z.object({
  appRegion: z.string().min(1).max(40),
  expectedRegion: z.string().min(1).max(40),
  appStatus: z.string().min(1).max(40),
  complianceStatus: z.string().min(1).max(40),
  securityQuestionnaireStatus: z.string().min(1).max(40),
  sellerAuthorizationStatus: z.string().min(1).max(40),
  credentialSellerAccountKey: z.string().min(1).max(200),
  expectedSellerAccountKey: z.string().min(1).max(200),
  permissionPackages: z.array(z.string().min(1).max(160)).max(100),
}).strict();

export type TemuCsRuntimeState = z.infer<typeof afterSalesRuntimeStateSchema>;

export const temuBuyerChatRuntimeEvidenceSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-runtime-evidence/1"),
  source: z.literal("sellerpilot_private.temu_buyer_chat_readiness_evidence"),
  sourceKind: z.enum([
    "partner_center_authenticated_readback",
    "partner_api_authenticated_readback",
  ]),
  sourceRevision: z.number().int().positive(),
  sourceRevisionSha256: digest,
  credentialId: uuid,
  sellerAccountKey: digest,
  environment: z.enum(["sandbox", "production"]),
  region,
  observedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  appStatus: evidenceStatus,
  complianceStatus: evidenceStatus,
  securityQuestionnaireStatus: evidenceStatus,
  sellerAuthorizationStatus: evidenceStatus,
  contractKey: z.string().regex(/^[A-Z0-9][A-Z0-9_.:/-]{2,159}$/u).nullable(),
  contractRevisionSha256: digest.nullable(),
  permissionPackage: z.string().min(1).max(160).nullable(),
  grantedPermissionPackages: z.array(z.string().min(1).max(160)).max(100),
}).strict().superRefine((value, context) => {
  const contractFields = [value.contractRevisionSha256, value.permissionPackage];
  if (value.contractKey === null && contractFields.some(item => item !== null)) {
    context.addIssue({ code: "custom", message: "unverified contract cannot carry revision or permission" });
  }
  if (value.contractKey !== null && contractFields.some(item => item === null)) {
    context.addIssue({ code: "custom", message: "contract key requires revision and permission" });
  }
  if (new Set(value.grantedPermissionPackages).size !== value.grantedPermissionPackages.length) {
    context.addIssue({ code: "custom", message: "duplicate permission package" });
  }
});

export type TemuBuyerChatRuntimeEvidence = z.infer<typeof temuBuyerChatRuntimeEvidenceSchema>;

export const temuBuyerChatRuntimeReadSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-runtime-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKey: digest,
  environment: z.enum(["sandbox", "production"]),
  evidence: temuBuyerChatRuntimeEvidenceSchema.nullable(),
}).strict();

export const temuBuyerChatReadinessViewSchema = z.object({
  contract: z.literal("sellerpilot-temu-buyer-chat-readiness-view/1"),
  checkedAt: z.string().datetime({ offset: true }),
  credentialId: uuid,
  sellerAccountKey: digest,
  environment: z.enum(["sandbox", "production"]),
  state: z.enum(["permission_pending", "ready"]),
  ready: z.boolean(),
  blockers: z.array(z.string().regex(/^TEMU_[A-Z0-9_]+$/u)).min(0).max(32),
  evidenceSource: z.object({
    sourceKind: z.enum([
      "partner_center_authenticated_readback",
      "partner_api_authenticated_readback",
    ]),
    sourceRevision: z.number().int().positive(),
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    region,
  }).strict().nullable(),
  providerFetchPerformed: z.literal(false),
  receive: z.literal(false),
  history: z.literal(false),
  reply: z.literal(false),
  readback: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.ready !== (value.state === "ready") || value.ready !== (value.blockers.length === 0)) {
    context.addIssue({ code: "custom", message: "inconsistent Buyer Chat readiness view" });
  }
});

export type TemuBuyerChatReadinessView = z.infer<typeof temuBuyerChatReadinessViewSchema>;

export type TemuBuyerChatExpectedContext = CsRuntimeAccountContext;

export type TemuCsReadiness = {
  ready: boolean;
  kind: TemuCsKind;
  blockers: string[];
};

type KnownBuyerChatContract = {
  revisionSha256: string;
  permissionPackage: string;
};

// Intentionally empty until an official Temu Buyer Chat contract is reviewed.
// A non-empty string from request arguments, credential payload or a database row
// is never enough to promote the capability.
const knownBuyerChatContracts = new Map<string, KnownBuyerChatContract>();

export function temuKnownBuyerChatContractCount() {
  return knownBuyerChatContracts.size;
}

const AFTER_SALES_VIEW_PERMISSIONS = new Set([
  "Semi Aftersales Management View",
  "Aftersales Management View",
]);

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function buyerChatReadiness(
  rawEvidence: unknown,
  expected: TemuBuyerChatExpectedContext | undefined,
): TemuCsReadiness {
  if (!expected) return {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_RUNTIME_CONTEXT_UNVERIFIED"],
  };
  const expectedParsed = z.object({
    credentialId: uuid,
    sellerAccountKey: digest,
    environment: z.enum(["sandbox", "production"]),
    expectedRegion: region,
    now: z.string().datetime({ offset: true }),
  }).strict().safeParse(expected);
  if (!expectedParsed.success) return {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_RUNTIME_CONTEXT_INVALID"],
  };
  if (rawEvidence === null || rawEvidence === undefined) return {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"],
  };
  const parsed = temuBuyerChatRuntimeEvidenceSchema.safeParse(rawEvidence);
  if (!parsed.success) return {
    ready: false,
    kind: "buyer_chat",
    blockers: ["TEMU_BUYER_CHAT_EVIDENCE_INVALID"],
  };

  const evidence = parsed.data;
  const blockers: string[] = [];
  if (evidence.credentialId !== expectedParsed.data.credentialId) {
    blockers.push("TEMU_BUYER_CHAT_CREDENTIAL_MISMATCH");
  }
  if (evidence.sellerAccountKey !== expectedParsed.data.sellerAccountKey) {
    blockers.push("TEMU_BUYER_CHAT_SELLER_ACCOUNT_MISMATCH");
  }
  if (evidence.environment !== expectedParsed.data.environment) {
    blockers.push("TEMU_BUYER_CHAT_ENVIRONMENT_MISMATCH");
  }
  if (evidence.region !== expectedParsed.data.expectedRegion) {
    blockers.push("TEMU_APP_REGION_MISMATCH");
  }

  const now = Date.parse(expectedParsed.data.now);
  const observedAt = Date.parse(evidence.observedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (observedAt > now + 60_000 || expiresAt <= observedAt || expiresAt - observedAt > 15 * 60_000) {
    blockers.push("TEMU_BUYER_CHAT_EVIDENCE_TIME_INVALID");
  } else if (expiresAt <= now) {
    blockers.push("TEMU_BUYER_CHAT_EVIDENCE_EXPIRED");
  }

  if (evidence.appStatus !== "Active") blockers.push("TEMU_APP_INACTIVE");
  if (evidence.complianceStatus !== "Approved") blockers.push("TEMU_COMPLIANCE_NOT_APPROVED");
  if (evidence.securityQuestionnaireStatus !== "Approved") {
    blockers.push("TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED");
  }
  if (evidence.sellerAuthorizationStatus !== "Approved") {
    blockers.push("TEMU_SELLER_AUTHORIZATION_NOT_APPROVED");
  }

  if (evidence.contractKey === null) {
    blockers.push("TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED");
  } else {
    const known = knownBuyerChatContracts.get(evidence.contractKey);
    if (!known) {
      blockers.push("TEMU_BUYER_CHAT_CONTRACT_UNKNOWN");
    } else if (evidence.contractRevisionSha256 !== known.revisionSha256
        || evidence.permissionPackage !== known.permissionPackage) {
      blockers.push("TEMU_BUYER_CHAT_CONTRACT_REVISION_MISMATCH");
    } else if (!evidence.grantedPermissionPackages.includes(known.permissionPackage)) {
      blockers.push("TEMU_BUYER_CHAT_PERMISSION_MISSING");
    }
  }

  const finalBlockers = unique(blockers);
  return { ready: finalBlockers.length === 0, kind: "buyer_chat", blockers: finalBlockers };
}

/**
 * Fail-closed readiness contract. Buyer Chat accepts only strict server-owned
 * runtime evidence tied to the selected credential/account and an allowlisted
 * official contract revision. It performs no provider call.
 */
export function temuCsReadiness(
  kind: TemuCsKind,
  state: unknown,
  expected?: TemuBuyerChatExpectedContext,
): TemuCsReadiness {
  if (kind === "buyer_chat") return buyerChatReadiness(state, expected);
  const parsed = afterSalesRuntimeStateSchema.safeParse(state);
  if (!parsed.success) return {
    ready: false,
    kind,
    blockers: ["TEMU_RUNTIME_EVIDENCE_INVALID"],
  };
  const value = parsed.data;
  const blockers: string[] = [];
  if (!value.expectedRegion.trim() || normalized(value.appRegion) !== normalized(value.expectedRegion)) {
    blockers.push("TEMU_APP_REGION_MISMATCH");
  }
  if (normalized(value.appStatus) !== "active") blockers.push("TEMU_APP_INACTIVE");
  if (normalized(value.complianceStatus) !== "approved") blockers.push("TEMU_COMPLIANCE_NOT_APPROVED");
  if (normalized(value.securityQuestionnaireStatus) !== "approved") {
    blockers.push("TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED");
  }
  if (normalized(value.sellerAuthorizationStatus) !== "approved") {
    blockers.push("TEMU_SELLER_AUTHORIZATION_NOT_APPROVED");
  }
  if (!value.expectedSellerAccountKey.trim()
      || value.credentialSellerAccountKey !== value.expectedSellerAccountKey) {
    blockers.push("TEMU_SELLER_SCOPE_MISMATCH");
  }
  if (!value.permissionPackages.some(permission => AFTER_SALES_VIEW_PERMISSIONS.has(permission.trim()))) {
    blockers.push("TEMU_AFTER_SALES_VIEW_PERMISSION_MISSING");
  }
  return { ready: blockers.length === 0, kind, blockers };
}
