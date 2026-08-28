import { productResearchFailureMessage } from "../../lib/product-research-failure";

export class ProductResearchNotFoundError extends Error {
  constructor() {
    super("요청한 AI 상품정보 작업을 찾지 못했습니다.");
    this.name = "ProductResearchNotFoundError";
  }
}

export class ProductResearchTerminalError extends Error {
  constructor(message?: string | null) {
    super(productResearchFailureMessage(message));
    this.name = "ProductResearchTerminalError";
  }
}

export function shouldClearPendingProductResearch(error: unknown) {
  return error instanceof ProductResearchNotFoundError
    || error instanceof ProductResearchTerminalError;
}

const unresolvedResearchValue = /(?:확인\s*필요|미확인|알\s*수\s*없|unknown|not\s+provided|n\/?a|no\s+brand)/i;

export function confirmedProductResearchValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && !unresolvedResearchValue.test(normalized) ? normalized : "";
}
