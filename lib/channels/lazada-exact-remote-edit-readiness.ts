import {
  lazadaExactExistingPublicationIdentity,
  lazadaExactExistingSellerSku,
  lazadaExactExistingUpdateContract,
} from "./lazada-exact-existing-identity";

type UnknownRecord = Record<string, unknown>;

export type LazadaExactRemoteEditReadinessBlock = {
  mode: string;
  reason: string;
};

type LazadaExactRemoteEditReadinessInput = {
  credentialId?: string | null;
  targetId?: string | null;
  preparationData: unknown;
  preparationError?: boolean;
  providerIdentityData: unknown;
  providerIdentityError?: boolean;
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function uuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(text(value));
}

function digest(value: unknown) {
  return /^[a-f0-9]{64}$/u.test(text(value).toLowerCase());
}

const unavailableBlock: LazadaExactRemoteEditReadinessBlock = {
  mode: "lazada_exact_lineage_readiness_unavailable",
  reason: "Lazada MY 판매자 계보 준비 상태를 서버 원장에서 확인하지 못해 원격 수정을 차단했습니다.",
};

const adoptionRequiredBlock: LazadaExactRemoteEditReadinessBlock = {
  mode: "lazada_exact_lineage_adoption_required",
  reason: "Lazada MY 상품의 판매자 target과 seller 계보를 원격 읽기 검증으로 결속하기 전에는 수정할 수 없습니다.",
};

const providerLineageRequiredBlock: LazadaExactRemoteEditReadinessBlock = {
  mode: "lazada_exact_provider_lineage_required",
  reason: "Lazada MY item·SellerSku·판매자 OAuth 계보의 provider 확인값이 현재 원장과 일치하지 않아 원격 수정을 차단했습니다.",
};

export function lazadaExactRemoteEditReadinessBlock(
  input: LazadaExactRemoteEditReadinessInput,
): LazadaExactRemoteEditReadinessBlock | null {
  const identity = lazadaExactExistingPublicationIdentity;
  const preparation = recordValue(input.preparationData);
  const preparationStatus = text(preparation.status);

  if (input.preparationError
      || preparation.listing_id !== identity.listingId
      || preparation.channel !== "lazada"
      || text(preparation.market).toUpperCase() !== identity.market
      || !["ready", "already_bound", "manual_required"].includes(preparationStatus)) {
    return unavailableBlock;
  }

  // `ready` means the read-only adoption job may run. It does not mean the
  // listing is already safe to update. Only a completed, provider-attested
  // adoption (`already_bound`) may continue to the exact update identity.
  if (preparationStatus !== "already_bound") return adoptionRequiredBlock;

  const credentialId = text(input.credentialId).toLowerCase();
  const targetId = text(input.targetId);
  if (!uuid(credentialId) || !/^\d+$/u.test(targetId)) {
    return adoptionRequiredBlock;
  }

  // The exact identity RPC converts SQL exceptions to null. Treat an absent or
  // malformed response as an unavailable server read, not as a proven lineage
  // mismatch. The listing DTO deliberately does not expose sellerAccountKey.
  if (input.providerIdentityError || !isRecord(input.providerIdentityData)) {
    return unavailableBlock;
  }
  const providerIdentity = recordValue(input.providerIdentityData);
  const providerIdentityMatches = providerIdentity.contract === lazadaExactExistingUpdateContract
    && providerIdentity.productId === identity.productId
    && providerIdentity.listingId === identity.listingId
    && text(providerIdentity.credentialId).toLowerCase() === credentialId
    && providerIdentity.itemId === identity.remoteId
    && providerIdentity.sellerSku === lazadaExactExistingSellerSku
    && digest(providerIdentity.sellerAccountKey)
    && text(providerIdentity.targetId) === targetId
    && uuid(providerIdentity.lineageAttestationId)
    && digest(providerIdentity.lineageEvidenceDigest);

  return providerIdentityMatches ? null : providerLineageRequiredBlock;
}
