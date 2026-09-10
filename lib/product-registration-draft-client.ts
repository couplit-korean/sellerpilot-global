export type ProductRegistrationDraftKind = "intake" | "publish";
export type ProductRegistrationDraft<T = Record<string, unknown>> = {
  draftId: string;
  kind: ProductRegistrationDraftKind;
  productId: string | null;
  version: number;
  data: T;
  updatedAt: string;
};
export type RegistrationAuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class ProductRegistrationDraftClientError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ProductRegistrationDraftClientError";
  }
}
type Query = { draftId: string; kind: ProductRegistrationDraftKind; signal?: AbortSignal };
type Save<T> = Query & { productId?: string | null; expectedVersion: number; data: T };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
async function decode<T>(response: Response, query: Query, nullable: boolean): Promise<ProductRegistrationDraft<T> | null> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProductRegistrationDraftClientError(
      object(body) && typeof body.message === "string" ? body.message : "초안 저장소에 연결하지 못했습니다. 입력 내용은 현재 화면에 유지됩니다.",
      response.status,
      object(body) && typeof body.code === "string" ? body.code : undefined,
    );
  }
  if (object(body) && body.draft === null && nullable) return null;
  const row = object(body) ? body.draft : null;
  if (!object(row) || row.draftId !== query.draftId || row.kind !== query.kind
      || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || !object(row.data)
      || !(row.productId === null || typeof row.productId === "string")
      || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) {
    throw new ProductRegistrationDraftClientError("저장 응답의 상품·버전을 확인하지 못했습니다. 서버 초안을 다시 불러와 확인해 주세요.", 502, "PRODUCT_REGISTRATION_DRAFT_RESPONSE_INVALID");
  }
  return row as ProductRegistrationDraft<T>;
}
export async function getProductRegistrationDraft<T = Record<string, unknown>>(
  authenticatedFetch: RegistrationAuthenticatedFetch, query: Query,
): Promise<ProductRegistrationDraft<T> | null> {
  const params = new URLSearchParams({ draftId: query.draftId, kind: query.kind });
  return decode<T>(await authenticatedFetch(`/api/admin/product-registration-drafts?${params}`, {
    cache: "no-store", signal: query.signal,
  }), query, true);
}
export async function putProductRegistrationDraft<T = Record<string, unknown>>(
  authenticatedFetch: RegistrationAuthenticatedFetch, input: Save<T>,
): Promise<ProductRegistrationDraft<T>> {
  const { signal, ...body } = input;
  const row = await decode<T>(await authenticatedFetch("/api/admin/product-registration-drafts", {
    method: "PUT", cache: "no-store", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), input, false);
  if (!row || row.version !== input.expectedVersion + 1
      || (input.productId != null && row.productId !== input.productId)) {
    throw new ProductRegistrationDraftClientError("저장 버전이 예상과 다릅니다. 서버 초안을 다시 확인해 주세요.", 409, "PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT");
  }
  return row;
}
