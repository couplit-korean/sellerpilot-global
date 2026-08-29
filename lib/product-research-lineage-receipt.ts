import "server-only";

import {
  createProductResearchLineageReceipt,
  verifyProductResearchLineageReceipt,
  type ProductResearchLineageReceiptExpectation,
} from "./product-research-lineage-receipt-core";

function productResearchLineageSecret() {
  return process.env.SELLERPILOT_AI_WORKER_TOKEN?.trim() ?? "";
}

export function productResearchLineageReceiptConfigured() {
  return productResearchLineageSecret().length >= 16;
}

export function issueProductResearchLineageReceipt(
  expectation: ProductResearchLineageReceiptExpectation,
) {
  return createProductResearchLineageReceipt(productResearchLineageSecret(), expectation);
}

export function verifyIssuedProductResearchLineageReceipt(
  receipt: string,
  expectation: ProductResearchLineageReceiptExpectation,
) {
  return verifyProductResearchLineageReceipt(productResearchLineageSecret(), receipt, expectation);
}
