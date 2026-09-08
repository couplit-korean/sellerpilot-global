export type TemuCsKind = "after_sales" | "buyer_chat";

export type TemuCsRuntimeState = {
  appRegion: string;
  expectedRegion: string;
  appStatus: string;
  complianceStatus: string;
  securityQuestionnaireStatus: string;
  sellerAuthorizationStatus: string;
  credentialSellerAccountKey: string;
  expectedSellerAccountKey: string;
  permissionPackages: string[];
  buyerChatContract?: {
    listApi: string;
    messageHistoryApi: string;
    webhookEvent: string;
    replyApi: string;
    permissionPackage: string;
  };
};

export type TemuCsReadiness = {
  ready: boolean;
  kind: TemuCsKind;
  blockers: string[];
};

const AFTER_SALES_VIEW_PERMISSIONS = new Set([
  "Semi Aftersales Management View",
  "Aftersales Management View",
]);

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function contractField(value: string | undefined) {
  return Boolean(value?.trim());
}

/**
 * Fail-closed readiness contract for Temu CS reads. This function performs no
 * provider call and stores no credential. The common gateway must supply live,
 * provider-read state before enabling a Temu job.
 */
export function temuCsReadiness(kind: TemuCsKind, state: TemuCsRuntimeState): TemuCsReadiness {
  const blockers: string[] = [];
  if (!state.expectedRegion.trim() || normalized(state.appRegion) !== normalized(state.expectedRegion)) {
    blockers.push("TEMU_APP_REGION_MISMATCH");
  }
  if (normalized(state.appStatus) !== "active") blockers.push("TEMU_APP_INACTIVE");
  if (normalized(state.complianceStatus) !== "approved") blockers.push("TEMU_COMPLIANCE_NOT_APPROVED");
  if (normalized(state.securityQuestionnaireStatus) !== "approved") {
    blockers.push("TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED");
  }
  if (normalized(state.sellerAuthorizationStatus) !== "approved") {
    blockers.push("TEMU_SELLER_AUTHORIZATION_NOT_APPROVED");
  }
  if (!state.expectedSellerAccountKey.trim()
      || state.credentialSellerAccountKey !== state.expectedSellerAccountKey) {
    blockers.push("TEMU_SELLER_SCOPE_MISMATCH");
  }

  if (kind === "after_sales") {
    if (!state.permissionPackages.some((permission) => AFTER_SALES_VIEW_PERMISSIONS.has(permission.trim()))) {
      blockers.push("TEMU_AFTER_SALES_VIEW_PERMISSION_MISSING");
    }
  } else {
    const contract = state.buyerChatContract;
    if (!contract
        || !contractField(contract.listApi)
        || !contractField(contract.messageHistoryApi)
        || !contractField(contract.webhookEvent)
        || !contractField(contract.replyApi)
        || !contractField(contract.permissionPackage)) {
      blockers.push("TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED");
    } else if (!state.permissionPackages.includes(contract.permissionPackage)) {
      blockers.push("TEMU_BUYER_CHAT_PERMISSION_MISSING");
    }
  }

  return { ready: blockers.length === 0, kind, blockers };
}
