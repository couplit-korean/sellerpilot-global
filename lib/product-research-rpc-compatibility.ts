type ProductResearchRpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type ProductResearchRpcArguments = {
  p_id: string;
  p_kind: "product_research" | "product_studio";
  p_request_payload: Record<string, unknown>;
};

type CreateProductResearchJob = (
  arguments_: ProductResearchRpcArguments,
) => PromiseLike<{ error: ProductResearchRpcError | null }>;

function errorText(error: ProductResearchRpcError) {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function isMissingProductResearchRpcContract(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const candidate = error as ProductResearchRpcError;
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const text = errorText(candidate);
  if (!/\b(?:public\.)?sellerpilot_create_ai_job\b/i.test(text)) return false;

  if (code === "PGRST202") {
    return /could not find the function|no matches were found in the schema cache/i.test(text);
  }
  if (code === "42883") {
    return /function\s+(?:public\.)?sellerpilot_create_ai_job\s*\([^)]*\)\s+does not exist/i.test(text);
  }
  return false;
}

function legacyResearchPayload(jobId: string, researchInput: string, sourcePhotoSha256: string) {
  const firstUrl = researchInput.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;!?\]}]+$/g, "")
    ?? "https://sellerpilot-global.vercel.app/";
  return {
    research_only: true,
    research_input: researchInput,
    source_photo_sha256: sourcePhotoSha256,
    description: "상품 등록 전 CLI 상세정보 조사 전용 작업입니다.",
    product_url: firstUrl,
    image_paths: [`research-only/${jobId}.jpg`],
    image_specs: [{ id: "research-only", angle: "reference" }],
    manual_fields: {
      researchInput,
      productName: researchInput.slice(0, 160),
      sellerSku: `RESEARCH-${jobId.replaceAll("-", "")}`,
      categoryHint: "상품정보 조사",
      brandName: "확인 필요",
      manufacturer: "확인 필요",
      countryOfOrigin: "확인 필요",
      material: "CLI 조사 후 판매자 확인 필요",
      packageContents: "CLI 조사 후 판매자 확인 필요",
      description: "상품 등록 전에 링크 또는 판매자 설명에서 상세정보를 조사하는 전용 작업입니다.",
      productUrl: firstUrl,
      imageRightsConfirmed: true,
      productFactsConfirmed: true,
      sellingPrice: 1,
      stock: 1,
      weightKg: 1,
    },
  };
}

export async function createProductResearchJobWithLegacyFallback({
  createJob,
  jobId,
  researchInput,
  sourcePhotoSha256,
}: {
  createJob: CreateProductResearchJob;
  jobId: string;
  researchInput: string;
  sourcePhotoSha256: string;
}) {
  const primary = await createJob({
    p_id: jobId,
    p_kind: "product_research",
    p_request_payload: {
      research_input: researchInput,
      source_photo_sha256: sourcePhotoSha256,
    },
  });
  if (!primary.error || !isMissingProductResearchRpcContract(primary.error)) {
    return { error: primary.error, usedLegacyFallback: false };
  }

  const compatibility = await createJob({
    p_id: jobId,
    p_kind: "product_studio",
    p_request_payload: legacyResearchPayload(jobId, researchInput, sourcePhotoSha256),
  });
  return { error: compatibility.error, usedLegacyFallback: true };
}
