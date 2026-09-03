export const smartstoreExactQaRecoveryContract =
  "smartstore_exact_qa_recovery_v1" as const;

export const smartstoreExactQaRecoveryArgument =
  "sellerpilotSmartstoreExactQaRecovery" as const;

export const smartstoreExactQaRecoveryIdentity = Object.freeze({
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listingId: "7babb554-48dc-4869-81b1-cd4d435d7b96",
  credentialId: "2aa76829-3d63-4842-9c3e-622acd3d0d2f",
  originProductNo: "13671684696",
  channelProductNo: "13732202182",
  centralSku: "QA-20260823-CC-001",
  priceKrw: 5_000,
  stock: 1,
});

export type SmartstoreExactQaRecoveryBinding = {
  contract: typeof smartstoreExactQaRecoveryContract;
  phase: "listing.update";
  productId: string;
  listingId: string;
  originProductNo: string;
  channelProductNo: string;
  centralSku: string;
  sellerManagementCodeSource: "provider_readback_required";
  sellerAccountLineage: "validated_by_service_rpc";
};

export type SmartstoreExactQaReadinessBlock = {
  mode:
    | "smartstore_exact_qa_credential_required"
    | "smartstore_exact_qa_atomic_identity_required"
    | "static_egress_required";
  reason: string;
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function smartstoreExactQaDetailImageUrls(value: unknown) {
  const html = typeof value === "string" ? value : "";
  return [...html.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/giu,
  )].map((match) => String(match[1] ?? match[2] ?? match[3] ?? "")
    .replaceAll("&amp;", "&")
    .trim())
    .filter(Boolean);
}

function normalizedMarketplaceAsset(value: unknown) {
  const row = recordValue(value);
  if (!row) return null;
  const role = typeof row.role === "string" ? row.role.trim() : "";
  const publicUrl = typeof row.publicUrl === "string" ? row.publicUrl.trim() : "";
  const objectPath = typeof row.objectPath === "string" ? row.objectPath.trim() : "";
  const contentSha256 = typeof row.contentSha256 === "string"
    ? row.contentSha256.trim()
    : "";
  if (!/^(?:detail-[a-z0-9-]+|gallery-representative)$/u.test(role)
      || !/^[a-f0-9]{64}$/u.test(contentSha256)
      || objectPath !== `normalized/${contentSha256.slice(0, 2)}/${contentSha256}.jpg`) {
    return null;
  }
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== "https:"
        || !/^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(url.hostname)
        || url.port || url.username || url.password || url.search || url.hash
        || decodeURIComponent(url.pathname)
          !== `/storage/v1/object/public/sellerpilot-marketplace/${objectPath}`) {
      return null;
    }
  } catch {
    return null;
  }
  return { role, publicUrl, objectPath, contentSha256, row };
}

/**
 * Rechecks the final, normalized gateway payload for the one exact Smartstore
 * recovery. This runs after the server has replaced client assets with the
 * approved manifest, and remains browser-safe because the workbench imports
 * the identity helpers from this module.
 */
export function smartstoreExactQaUpdateArgumentsValid(
  argumentsValue: Record<string, unknown>,
) {
  const recovery = smartstoreExactQaRecoveryBinding(argumentsValue);
  const body = recordValue(argumentsValue.body);
  const originProduct = recordValue(body?.originProduct);
  const channelProduct = recordValue(body?.smartstoreChannelProduct);
  const detailAttribute = recordValue(originProduct?.detailAttribute);
  const sellerCodeInfo = recordValue(detailAttribute?.sellerCodeInfo);
  const binding = recordValue(argumentsValue.sellerpilotPublicationAssetBinding);
  const approvedRows = Array.isArray(binding?.approvedDetailImages)
    ? binding.approvedDetailImages.map(normalizedMarketplaceAsset)
    : [];
  const transportRows = Array.isArray(binding?.providerTransportImages)
    ? binding.providerTransportImages.map(normalizedMarketplaceAsset)
    : [];
  const detailUrls = smartstoreExactQaDetailImageUrls(originProduct?.detailContent);
  const imageUrls = exactStrings(argumentsValue.imageUrls);
  const title = String(originProduct?.name ?? "").trim();
  const channelTitle = String(channelProduct?.channelProductName ?? "").trim();
  const description = String(originProduct?.detailContent ?? "").trim();
  if (!recovery
      || String(argumentsValue.originProductNo ?? "")
        !== smartstoreExactQaRecoveryIdentity.originProductNo
      || sellerCodeInfo?.sellerManagementCode !== smartstoreExactQaRecoveryIdentity.centralSku
      || Number(originProduct?.salePrice) !== smartstoreExactQaRecoveryIdentity.priceKrw
      || !Number.isSafeInteger(Number(originProduct?.stockQuantity))
      || Number(originProduct?.stockQuantity) !== smartstoreExactQaRecoveryIdentity.stock
      || title.length < 2 || title.length > 100 || !/[가-힣]/u.test(title)
      || channelTitle.length < 2 || channelTitle.length > 100
      || !/[가-힣]/u.test(channelTitle)
      || description.length < 20 || !/[가-힣]/u.test(description)
      || argumentsValue.publicationIntent !== "live"
      || argumentsValue.publicationStateContract !== "verified_remote_state_v1"
      || argumentsValue.publicationExpectedLocale !== "ko-KR"
      || argumentsValue.publicationExpectedImageCount !== 8
      || !/^[a-f0-9]{64}$/u.test(
        String(argumentsValue.publicationExpectedFingerprint ?? ""),
      )
      || binding?.contract !== "sellerpilot_publication_asset_binding_v1"
      || binding.providerImageSurface !== "gallery"
      || !Number.isSafeInteger(Number(binding.approvedDetailPageVersion))
      || Number(binding.approvedDetailPageVersion) < 1
      || !/^[a-f0-9]{64}$/u.test(String(binding.approvedManifestDigest ?? ""))
      || approvedRows.length !== 8 || approvedRows.some((row) => !row)
      || transportRows.length !== 9 || transportRows.some((row) => !row)
      || imageUrls.length !== 9 || new Set(imageUrls).size !== 9
      || detailUrls.length !== 8 || new Set(detailUrls).size !== 8) {
    return false;
  }
  const approved = approvedRows as NonNullable<ReturnType<typeof normalizedMarketplaceAsset>>[];
  const transport = transportRows as NonNullable<ReturnType<typeof normalizedMarketplaceAsset>>[];
  const representative = transport[0];
  const detailTransport = transport.slice(1);
  const representativeSourcePath = String(
    representative?.row.approvedObjectPath ?? "",
  );
  const representativeSourceSha256 = String(
    representative?.row.approvedSourceSha256 ?? "",
  );
  if (representative?.role !== "gallery-representative"
      || !/^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/thumbnail-square\.png$/iu.test(
        representativeSourcePath,
      )
      || !/^[a-f0-9]{64}$/u.test(representativeSourceSha256)
      || new Set(transport.map((row) => row.role)).size !== 9
      || new Set(transport.map((row) => row.publicUrl)).size !== 9
      || new Set(approved.map((row) => row.publicUrl)).size !== 8
      || detailUrls.some((url, index) => url !== detailTransport[index]?.publicUrl)
      || detailTransport.some((row, index) => {
        const approvedRow = approved[index];
        const approvedSourceSha256 = String(
          approvedRow?.row.approvedSourceSha256 ?? "",
        );
        const approvedObjectPath = String(approvedRow?.row.approvedObjectPath ?? "");
        return !approvedRow
          || row.role !== approvedRow.role
          || row.publicUrl !== approvedRow.publicUrl
          || row.objectPath !== approvedRow.objectPath
          || row.contentSha256 !== approvedRow.contentSha256
          || !/^[a-f0-9]{64}$/u.test(approvedSourceSha256)
          || !/^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/[^/]+\.png$/iu.test(
            approvedObjectPath,
          );
      })) {
    return false;
  }
  return transport.every((row, index) => imageUrls[index] === row.publicUrl);
}

export function assertSmartstoreExactQaUpdateArguments(
  argumentsValue: Record<string, unknown>,
) {
  if (!smartstoreExactQaUpdateArgumentsValid(argumentsValue)) {
    throw new Error("SMARTSTORE_EXACT_QA_UPDATE_ARGUMENTS_INVALID");
  }
  return argumentsValue;
}

export function smartstoreExactQaRecoveryBindingValue(
  value: unknown,
): SmartstoreExactQaRecoveryBinding | null {
  const binding = recordValue(value);
  if (!binding
      || binding.contract !== smartstoreExactQaRecoveryContract
      || binding.phase !== "listing.update"
      || binding.productId !== smartstoreExactQaRecoveryIdentity.productId
      || binding.listingId !== smartstoreExactQaRecoveryIdentity.listingId
      || String(binding.originProductNo ?? "")
        !== smartstoreExactQaRecoveryIdentity.originProductNo
      || String(binding.channelProductNo ?? "")
        !== smartstoreExactQaRecoveryIdentity.channelProductNo
      || binding.centralSku !== smartstoreExactQaRecoveryIdentity.centralSku
      || binding.sellerManagementCodeSource !== "provider_readback_required"
      || binding.sellerAccountLineage !== "validated_by_service_rpc") {
    return null;
  }
  return binding as SmartstoreExactQaRecoveryBinding;
}

/**
 * Mirrors the exact read-only gates that run before a Smartstore update can be
 * admitted. This never opens the generic listing-update release gate.
 */
export function smartstoreExactQaReadinessBlock(input: {
  credentialId?: string | null;
  identity?: unknown;
  identityError?: boolean;
  environmentStaticEgressReady?: boolean;
  databaseStaticEgressReady?: boolean;
  staticEgressError?: boolean;
}): SmartstoreExactQaReadinessBlock | null {
  if (input.credentialId !== smartstoreExactQaRecoveryIdentity.credentialId) {
    return {
      mode: "smartstore_exact_qa_credential_required",
      reason: "이 스마트스토어 기존상품에 결속된 운영 인증정보를 확인하지 못해 원격 반영을 차단했습니다.",
    };
  }
  if (input.identityError === true
      || !smartstoreExactQaRecoveryBindingValue(input.identity)) {
    return {
      mode: "smartstore_exact_qa_atomic_identity_required",
      reason: "스마트스토어 원상품·채널상품·활성 중앙상품·운영 인증정보의 exact 결속을 확인하지 못해 원격 반영을 차단했습니다.",
    };
  }
  if (input.staticEgressError === true
      || input.environmentStaticEgressReady !== true
      || input.databaseStaticEgressReady !== true) {
    return {
      mode: "static_egress_required",
      reason: "네이버 커머스API에 등록된 고정 egress IP와 서버 정책이 모두 확인될 때까지 스마트스토어 원격 반영을 차단합니다.",
    };
  }
  return null;
}

export function smartstoreExactQaRecoveryBinding(
  argumentsValue: Record<string, unknown>,
) {
  return smartstoreExactQaRecoveryBindingValue(
    argumentsValue[smartstoreExactQaRecoveryArgument],
  );
}

export function bindSmartstoreExactQaRecoveryArguments(
  argumentsValue: Record<string, unknown>,
) {
  const binding: SmartstoreExactQaRecoveryBinding = {
    contract: smartstoreExactQaRecoveryContract,
    phase: "listing.update",
    productId: smartstoreExactQaRecoveryIdentity.productId,
    listingId: smartstoreExactQaRecoveryIdentity.listingId,
    originProductNo: smartstoreExactQaRecoveryIdentity.originProductNo,
    channelProductNo: smartstoreExactQaRecoveryIdentity.channelProductNo,
    centralSku: smartstoreExactQaRecoveryIdentity.centralSku,
    sellerManagementCodeSource: "provider_readback_required",
    sellerAccountLineage: "validated_by_service_rpc",
  };
  return {
    ...argumentsValue,
    [smartstoreExactQaRecoveryArgument]: binding,
  };
}

/**
 * Replaces browser-supplied gallery candidates with the current server-owned
 * square asset. The source path and byte digest are carried only until image
 * normalization, where they are rechecked and recorded in the immutable
 * publication binding.
 */
export function bindSmartstoreExactQaApprovedRepresentative(
  argumentsValue: Record<string, unknown>,
  input: { signedUrl: string; sourceObjectPath: string; sourceSha256: string },
) {
  const assets = recordValue(argumentsValue.sellerpilotAssets);
  if (!assets
      || !/^results\/[0-9a-f-]+\/claims\/[0-9a-f-]+\/thumbnail-square\.png$/iu.test(
        input.sourceObjectPath,
      )
      || !/^[a-f0-9]{64}$/u.test(input.sourceSha256)) {
    throw new Error("SMARTSTORE_EXACT_QA_REPRESENTATIVE_INVALID");
  }
  try {
    const url = new URL(input.signedUrl);
    const expectedPath = `/storage/v1/object/sign/sellerpilot-ai/${input.sourceObjectPath}`;
    if (url.protocol !== "https:"
        || !/^[a-z0-9-]+\.supabase\.(?:co|in)$/u.test(url.hostname)
        || url.port || url.username || url.password || url.hash
        || decodeURIComponent(url.pathname) !== expectedPath
        || !url.searchParams.get("token")) {
      throw new Error("SMARTSTORE_EXACT_QA_REPRESENTATIVE_INVALID");
    }
  } catch {
    throw new Error("SMARTSTORE_EXACT_QA_REPRESENTATIVE_INVALID");
  }
  return {
    ...argumentsValue,
    sellerpilotAssets: {
      ...assets,
      galleryImageUrls: [input.signedUrl],
      approvedGalleryImagePaths: [input.sourceObjectPath],
      approvedGalleryImageSha256s: [input.sourceSha256],
    },
  };
}

export function smartstoreExactQaCreateForbidden(input: {
  productId?: string | null;
  argumentsValue?: Record<string, unknown> | null;
}) {
  if (input.productId === smartstoreExactQaRecoveryIdentity.productId) return true;
  const argumentsValue = input.argumentsValue ?? {};
  const body = recordValue(argumentsValue.body);
  const originProduct = recordValue(body?.originProduct);
  const detailAttribute = recordValue(originProduct?.detailAttribute);
  const sellerCodeInfo = recordValue(detailAttribute?.sellerCodeInfo);
  return String(argumentsValue.originProductNo ?? "")
      === smartstoreExactQaRecoveryIdentity.originProductNo
    || sellerCodeInfo?.sellerManagementCode
      === smartstoreExactQaRecoveryIdentity.centralSku;
}

/**
 * The exact QA recovery always replaces the buyer-visible detail document and
 * its eight approved images. Treat it as content-bound even when a forged or
 * incomplete browser request omits sellerpilotAssets; the admin route must
 * resolve the approved manifest from the product ledger before it can proceed.
 */
export function smartstoreExactQaApprovedContentRequired(input: {
  channel: string;
  operation: string;
  productId?: string | null;
  listingId?: string | null;
}) {
  return input.channel === "smartstore"
    && input.operation === "listing.update"
    && input.productId === smartstoreExactQaRecoveryIdentity.productId
    && input.listingId === smartstoreExactQaRecoveryIdentity.listingId;
}

export function smartstoreExactQaRecoveryCandidate(input: {
  channel: string;
  listingId?: string | null;
  remoteId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
  providerStatus?: string | null;
  publishedAt?: string | null;
  failureClass?: string | null;
}) {
  return input.channel === "smartstore"
    && input.listingId === smartstoreExactQaRecoveryIdentity.listingId
    && input.remoteId === smartstoreExactQaRecoveryIdentity.originProductNo
    && input.status === "failed"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "unknown"
    && !input.providerStatus
    && !input.publishedAt
    && input.failureClass === "external_action";
}

export function smartstoreExactQaCentralSkuVerified(value: unknown) {
  const context = recordValue(value);
  const product = recordValue(context?.product);
  const manualFields = recordValue(context?.manualFields);
  const productSku = typeof product?.sku === "string" ? product.sku.trim() : "";
  const manualSku = typeof manualFields?.sellerSku === "string"
    ? manualFields.sellerSku.trim()
    : "";
  return (productSku === smartstoreExactQaRecoveryIdentity.centralSku
      || manualSku === smartstoreExactQaRecoveryIdentity.centralSku)
    && (!productSku || productSku === smartstoreExactQaRecoveryIdentity.centralSku)
    && (!manualSku || manualSku === smartstoreExactQaRecoveryIdentity.centralSku);
}
