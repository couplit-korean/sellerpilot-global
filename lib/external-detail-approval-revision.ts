import { externalDetailDigest } from "./external-detail-copy";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const withoutStock = (value: unknown): JsonRecord => {
  const result = { ...record(value) };
  delete result.stock;
  return result;
};

/**
 * The immutable review commitment intentionally excludes operational state
 * such as product/job status, stock, prices, timestamps, and job results.
 * Customer-facing product copy, facts, source inputs, reviewed documents, and
 * every approved image receipt remain committed.
 */
export function externalDetailApprovalContentSnapshot(
  productValue: unknown,
  importValue: unknown,
  sourceJobValue: unknown,
) {
  const product = record(productValue);
  const externalImport = record(importValue);
  const payload = record(externalImport.payload);
  const sourceJob = record(sourceJobValue);
  const request = record(sourceJob.requestPayload);

  return {
    contract: "sellerpilot_external_detail_content_v1",
    productId: product.id ?? null,
    ownerId: product.owner_id ?? null,
    importId: externalImport.id ?? null,
    requestSha256: externalImport.request_sha256 ?? null,
    detailVersion: product.detail_page_version ?? null,
    product: {
      externalCode: product.external_code ?? null,
      sku: product.sku ?? null,
      name: product.name ?? null,
      description: product.description ?? null,
      sourceUrl: product.source_url ?? null,
      imageUrl: product.image_url ?? null,
      aiJobId: product.ai_job_id ?? null,
      productFacts: withoutStock(product.product_facts),
      detailPageData: product.detail_page_data ?? null,
      detailPageApprovedVersion: product.detail_page_approved_version ?? null,
      detailPageImageManifest: product.detail_page_image_manifest ?? null,
    },
    sourceJob: {
      id: sourceJob.id ?? null,
      manualFields: withoutStock(request.manual_fields),
      imagePaths: Array.isArray(request.image_paths) ? request.image_paths : [],
      imageSpecs: Array.isArray(request.image_specs) ? request.image_specs : [],
    },
    approval: {
      reviewedCopy: payload.reviewedCopy ?? null,
      assets: payload.assets ?? null,
      receipts: externalImport.receipts ?? null,
      originalEvidence: payload.originalEvidence ?? null,
    },
  };
}

export function externalDetailApprovalContentSha256(
  productValue: unknown,
  importValue: unknown,
  sourceJobValue: unknown,
) {
  return externalDetailDigest(
    externalDetailApprovalContentSnapshot(
      productValue,
      importValue,
      sourceJobValue,
    ),
  );
}
