import { elevenstProcessedFoodNotificationFields, elevenstProcessedFoodProductNameNoticeCode } from "../lib/channels/elevenst-listing";
import type { ElevenstNewProductSourceApprovalRequest } from "../lib/product-registration/elevenst/new-product-source-approval";

export function elevenstApprovalDraft(draft: Record<string, unknown>) {
  const product = (draft.product ?? {}) as Record<string, unknown>;
  const notification = product.ProductNotification as { item?: Array<{ code?: string; name?: string }> } | undefined;
  const notices = elevenstProcessedFoodNotificationFields.filter(field => field.code !== elevenstProcessedFoodProductNameNoticeCode)
    .map(field => ({ ...field, value: String(notification?.item?.find(item => item.code === field.code)?.name ?? "").trim() }));
  const text = (key: string) => typeof product[key] === "string" ? product[key].trim() : "";
  const money = (key: string) => {
    const value = product[key];
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
    return /^\d+$/u.test(text(key)) ? Number(text(key)) : NaN;
  };
  const shipping = { shippingFeeKrw: money("dlvCst1"), bundleDeliveryCode: text("bndlDlvCnYn"), outboundAddressId: text("addrSeqOut"), returnAddressId: text("addrSeqIn") };
  const returns = { returnFeeKrw: money("rtngdDlvCst"), exchangeFeeKrw: money("exchDlvCst"), asDetail: text("asDetail"), returnExchangeDetail: text("rtngExchDetail") };
  const problems: string[] = notices.filter(notice => !notice.value).map(notice => notice.label);
  if (shipping.shippingFeeKrw !== 3000) problems.push("배송비 3,000원");
  if (!["Y", "N"].includes(shipping.bundleDeliveryCode)) problems.push("묶음 배송 여부");
  if (!/^[1-9]\d{0,19}$/u.test(shipping.outboundAddressId)) problems.push("출고지 번호");
  if (!/^[1-9]\d{0,19}$/u.test(shipping.returnAddressId)) problems.push("반품지 번호");
  for (const [name, value] of [["반품 배송비", returns.returnFeeKrw], ["교환 배송비", returns.exchangeFeeKrw]] as const)
    if (!Number.isSafeInteger(value) || value < 0 || value > 9999990 || value % 10) problems.push(name);
  if (!returns.asDetail) problems.push("A/S 안내");
  if (!returns.returnExchangeDetail) problems.push("반품·교환 안내");
  return { notices, shipping, returns, problems };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function sha(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export type ElevenstLabelEvidence = { sha256: string; capturedAt: string; fileCount: number };
export async function readElevenstLabelEvidence(files: Array<Pick<File, "size" | "type" | "arrayBuffer">>, capturedAt = new Date().toISOString()): Promise<ElevenstLabelEvidence> {
  if (!files.length || files.length > 12 || files.some(file => !file.type.startsWith("image/") || file.size < 1 || file.size > 20 * 1024 * 1024)
    || files.reduce((total, file) => total + file.size, 0) > 120 * 1024 * 1024) throw new Error("라벨 사진을 선택해 주세요. 사진별 20MB, 전체 120MB까지 확인할 수 있습니다.");
  const hashes: string[] = [];
  for (const file of files) hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join(""));
  return { sha256: await sha(canonical(hashes.sort())), capturedAt, fileCount: files.length };
}
export async function buildElevenstApprovalRequest(input: {
  productId: string; credentialId: string; market: string; targetId: string; expectedDraftVersion: number;
  draft: Record<string, unknown>; sellerAccount: string; reviewed: boolean; sellerConfirmedAt: string; availableConfirmedAt: string;
  approvalRequestId: string; capturedAt: string;
  labelEvidence: ElevenstLabelEvidence | null; labelConfirmed: boolean;
}): Promise<ElevenstNewProductSourceApprovalRequest & { expectedDraftVersion: number }> {
  const values = elevenstApprovalDraft(input.draft);
  if (values.problems.length || !input.reviewed || !input.sellerAccount.trim()
    || !Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
    || !Number.isFinite(Date.parse(input.sellerConfirmedAt)) || !Number.isFinite(Date.parse(input.availableConfirmedAt))
    || !input.labelConfirmed || !input.labelEvidence || !/^[a-f0-9]{64}$/u.test(input.labelEvidence.sha256)
    || !Number.isFinite(Date.parse(input.labelEvidence.capturedAt)))
    throw new Error("고시·판매자 계정·공식센터 접속 상태·배송 및 반품 정책을 확인해 주세요.");
  return {
    contract: "sellerpilot_elevenst_new_product_source_approval_v1", approvalRequestId: input.approvalRequestId,
    productId: input.productId, credentialId: input.credentialId, market: input.market, targetId: input.targetId,
    expectedDraftVersion: input.expectedDraftVersion,
    notices: await Promise.all(values.notices.map(async ({ code, value }) => ["42154823", "23757260", "23756754"].includes(code)
      ? { code, value, sourceKind: "seller_declaration" as const,
        sourceSha256: await sha(canonical({ productId: input.productId, draftVersion: input.expectedDraftVersion, code, value, sourceKind: "seller_declaration", capturedAt: input.capturedAt })), capturedAt: input.capturedAt }
      : { code, value, sourceKind: "product_label" as const, sourceSha256: input.labelEvidence!.sha256, capturedAt: input.labelEvidence!.capturedAt })),
    sellerOfficeAccountSha256: await sha(`elevenst\0${input.sellerAccount.trim()}`), sellerVerifiedAt: input.sellerConfirmedAt,
    availability: { contract: "sellerpilot_elevenst_provider_availability_v1", state: "available", observedAt: input.availableConfirmedAt },
    shipping: values.shipping as ElevenstNewProductSourceApprovalRequest["shipping"], returns: values.returns,
  };
}

export class ElevenstApprovalRequestCache {
  private pending: { key: string; body: Awaited<ReturnType<typeof buildElevenstApprovalRequest>> } | null = null;
  clear() { this.pending = null; }
  async get(key: string, input: Omit<Parameters<typeof buildElevenstApprovalRequest>[0], "approvalRequestId" | "capturedAt">) {
    if (this.pending?.key !== key) this.pending = { key, body: await buildElevenstApprovalRequest({ ...input, approvalRequestId: crypto.randomUUID(), capturedAt: new Date().toISOString() }) };
    return this.pending.body;
  }
}
