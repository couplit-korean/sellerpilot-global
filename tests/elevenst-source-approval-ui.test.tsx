import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { elevenstProcessedFoodNotificationFields, elevenstProcessedFoodProductNameNoticeCode } from "../lib/channels/elevenst-listing";
import { elevenstNewProductSourceDigest } from "../lib/product-registration/elevenst/new-product-input-source";
import { elevenstNewProductSourceApprovalRequestSchema } from "../lib/product-registration/elevenst/new-product-source-approval";
import { buildElevenstApprovalRequest, elevenstApprovalDraft, ElevenstApprovalRequestCache, readElevenstLabelEvidence } from "../app/elevenst-source-approval-client";
import { ElevenstSourceApproval } from "../app/elevenst-source-approval";

function fixture() {
  return {
    productId: "c0bdb493-6447-41bf-af0a-46a3da7a75a8", credentialId: "12345678-1234-4234-8234-123456789012", market: "KR", targetId: "", expectedDraftVersion: 8,
    draft: { product: { ProductNotification: { item: elevenstProcessedFoodNotificationFields.map(field => ({ code: field.code, name: `Fixture ${field.label}` })) }, dlvCst1: "3000", bndlDlvCnYn: "Y", addrSeqOut: "12345", addrSeqIn: "54321", rtngdDlvCst: "3000", exchDlvCst: "6000", asDetail: "Fixture A/S", rtngExchDetail: "Fixture returns" } },
    sellerAccount: " fixture-seller ", reviewed: true, sellerConfirmedAt: "2026-09-14T01:00:00.000Z", availableConfirmedAt: "2026-09-14T01:00:00.000Z",
    approvalRequestId: "12345678-1234-4234-8234-123456789013", capturedAt: "2026-09-14T01:00:01.000Z",
    labelEvidence: { sha256: "a".repeat(64), capturedAt: "2026-09-14T00:59:00.000Z", fileCount: 2 }, labelConfirmed: true,
  };
}

test("approval uses saved notices, canonical declaration digest and actual typed seller identity", async () => {
  const input = fixture(); const before = structuredClone(input);
  const request = await buildElevenstApprovalRequest(input);
  assert.equal(elevenstNewProductSourceApprovalRequestSchema.safeParse(request).success, true);
  assert.equal(request.expectedDraftVersion, 8);
  assert.equal(request.notices.length, 10);
  assert.ok(request.notices.every(notice => notice.code !== elevenstProcessedFoodProductNameNoticeCode));
  assert.equal(request.notices.filter(notice => notice.sourceKind === "product_label").length, 7);
  for (const notice of request.notices) {
    if (notice.sourceKind === "seller_declaration") assert.equal(notice.sourceSha256, elevenstNewProductSourceDigest({ productId: input.productId, draftVersion: 8, code: notice.code, value: notice.value, sourceKind: "seller_declaration", capturedAt: input.capturedAt }));
    else { assert.equal(notice.sourceSha256, input.labelEvidence.sha256); assert.equal(notice.capturedAt, input.labelEvidence.capturedAt); }
  }
  assert.equal(request.sellerOfficeAccountSha256, createHash("sha256").update("elevenst\0fixture-seller").digest("hex"));
  assert.equal(request.availability.observedAt, input.availableConfirmedAt);
  assert.deepEqual(input, before);
});

test("missing notices, policy values, review or seller confirmation cannot create approval requests", async () => {
  for (const alter of [
    (x: ReturnType<typeof fixture>) => { x.reviewed = false; },
    (x: ReturnType<typeof fixture>) => { x.labelConfirmed = false; },
    (x: ReturnType<typeof fixture>) => { x.sellerConfirmedAt = ""; },
    (x: ReturnType<typeof fixture>) => { x.availableConfirmedAt = ""; },
    (x: ReturnType<typeof fixture>) => { x.expectedDraftVersion = 0; },
    (x: ReturnType<typeof fixture>) => { x.draft.product.addrSeqOut = ""; },
    (x: ReturnType<typeof fixture>) => { x.draft.product.ProductNotification.item[0].name = ""; },
  ]) { const input = fixture(); alter(input); await assert.rejects(buildElevenstApprovalRequest(input)); }
  assert.equal(elevenstApprovalDraft(fixture().draft).problems.length, 0);
});

test("uncertain retry preserves the exact approval id, timestamps and hashes; changed version is new approval", async () => {
  const cache = new ElevenstApprovalRequestCache(); const input = fixture();
  const first = await cache.get("same-v8", input);
  const retry = await cache.get("same-v8", input);
  assert.deepEqual(first, retry);
  const changed = await cache.get("new-v9", { ...input, expectedDraftVersion: 9 });
  assert.notEqual(changed.approvalRequestId, first.approvalRequestId);
  assert.notEqual(changed.notices[2].sourceSha256, first.notices[2].sourceSha256);
  const workbench = readFileSync(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");
  const save = workbench.slice(workbench.indexOf("const saveRegistrationDraft = useCallback(async () =>"), workbench.indexOf("const synchronizeCommonDrafts"));
  const unchanged = save.indexOf("if (registrationSavedRef.current === registrationSignature) return true;");
  assert.ok(unchanged >= 0 && unchanged < save.indexOf("await putProductRegistrationDraft"));
});

test("numeric won amounts work while negative, fractional and malformed amounts stay blocked without NaN UI", () => {
  const input = fixture();
  const product: Record<string, unknown> = input.draft.product;
  product.dlvCst1 = 3000; product.rtngdDlvCst = 0; product.exchDlvCst = 6000;
  const valid = elevenstApprovalDraft(input.draft);
  assert.equal(valid.problems.length, 0);
  assert.equal(valid.shipping.shippingFeeKrw, 3000);
  assert.equal(valid.returns.returnFeeKrw, 0);
  for (const invalid of [-10, 10.5, NaN, Infinity, true, "-10", "10.5", "3,000", "1e3", ""]) {
    product.rtngdDlvCst = invalid;
    assert.ok(elevenstApprovalDraft(input.draft).problems.includes("반품 배송비"));
  }
  const html = renderToStaticMarkup(createElement(ElevenstSourceApproval, { ...input, disabled: false, onSave: async () => ({ version: 8, accessToken: "unused" }) }));
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /반품비 입력 필요/);
});

test("approval panel starts unchecked, shows current ten notices and explicit seller/availability checks", () => {
  let saves = 0;
  const html = renderToStaticMarkup(createElement(ElevenstSourceApproval, { ...fixture(), disabled: false, onSave: async () => { saves++; return { version: 8, accessToken: "fixture-token" }; } }));
  assert.equal(saves, 0);
  assert.match(html, /11번가 등록 정보 승인/);
  assert.match(html, /공식 셀러오피스에서 확인한 판매자 ID/);
  assert.match(html, /점검 공지를 확인/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.doesNotMatch(html, /sourceSha256|sellerOfficeAccountSha256|fixture-token/);
  const source = readFileSync(new URL("../app/elevenst-source-approval.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("await props.onSave()") < source.indexOf('await fetch("/api/admin/elevenst/new-product-source-approval"'));
  assert.match(source, /if \(running.current/);
  assert.match(source, /controller.current\?\.abort\(\)/);
});


test("selected label bytes determine the sorted bundle digest, never filenames or a fabricated label assertion", async () => {
  const a = new File(["actual fixture bytes A"], "a.jpg", { type: "image/jpeg" });
  const b = new File(["actual fixture bytes B"], "b.png", { type: "image/png" });
  const capturedAt = "2026-09-14T00:59:00.000Z";
  const bundle = await readElevenstLabelEvidence([a, b], capturedAt);
  assert.deepEqual(bundle, await readElevenstLabelEvidence([b, a], capturedAt));
  const hashes = ["actual fixture bytes A", "actual fixture bytes B"].map(bytes => createHash("sha256").update(bytes).digest("hex")).sort();
  assert.equal(bundle.sha256, elevenstNewProductSourceDigest(hashes));
  assert.equal(bundle.capturedAt, capturedAt);
  await assert.rejects(readElevenstLabelEvidence([]));
  await assert.rejects(readElevenstLabelEvidence([new File(["text"], "not-image.txt", { type: "text/plain" })]));
});
