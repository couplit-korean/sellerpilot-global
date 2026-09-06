import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isSmartstoreExistingAdoptionActivity,
  parsePendingSmartstoreExistingAdoption,
  parseVerifiedSmartstoreExistingAdoption,
  smartstoreExistingAdoptionErrorMessage,
  smartstoreExistingAdoptionState,
} from "../app/_products/smartstore-existing-adoption-ui";

const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const listingId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

test("failed or reconciliation Smartstore listings require verified existing-product review", () => {
  assert.equal(smartstoreExistingAdoptionState([
    { channel: "smartstore", status: "failed", remoteId: null },
  ]), "review_required");
  assert.equal(smartstoreExistingAdoptionState([
    { channel: "smartstore", status: "reconciliation_required", remoteId: "13749310594" },
  ]), "review_required");
  assert.equal(smartstoreExistingAdoptionState([
    { channel: "smartstore", status: "published", remoteId: "13749310594" },
  ]), "verified");
  assert.equal(smartstoreExistingAdoptionState([
    { channel: "coupang", status: "failed" },
    { channel: "smartstore", status: "draft" },
  ]), "none");
});

test("registration history diverts only Smartstore failed or blocked product activity", () => {
  const base = {
    id: `product:${productId}`,
    productId,
    status: "failed",
    channels: [{ channel: "smartstore", status: "failed" }],
  };
  assert.equal(isSmartstoreExistingAdoptionActivity(base), true);
  assert.equal(isSmartstoreExistingAdoptionActivity({ ...base, status: "blocked", channels: [{ channel: "smartstore", status: "blocked" }] }), true);
  assert.equal(isSmartstoreExistingAdoptionActivity({ ...base, channels: [{ channel: "smartstore", status: "published" }] }), false);
  assert.equal(isSmartstoreExistingAdoptionActivity({ ...base, channels: [{ channel: "coupang", status: "failed" }] }), false);
  assert.equal(isSmartstoreExistingAdoptionActivity({ ...base, id: "job:1ed4acfc-7603-48ec-a638-241131e59358", productId: null }), false);
});

test("verified response requires exact product binding and explicit no-create/no-mutation evidence", () => {
  const verified = {
    ok: true,
    status: "verified",
    receiptId: "22222222-2222-4222-8222-222222222222",
    attestationId: "33333333-3333-4333-8333-333333333333",
    productId,
    listingId,
    originProductNo: "13688607602",
    channelProductNo: "13749310594",
    normalUpdateEligible: true,
    apiCreateSucceeded: false,
    providerMutationPerformed: false,
    contentVerified: true,
    message: "기존 상품 연결 확인 완료",
  };
  assert.deepEqual(parseVerifiedSmartstoreExistingAdoption(verified, productId), {
    receiptId: verified.receiptId,
    attestationId: verified.attestationId,
    productId,
    listingId: verified.listingId,
    originProductNo: verified.originProductNo,
    channelProductNo: verified.channelProductNo,
    message: verified.message,
  });
  assert.equal(parseVerifiedSmartstoreExistingAdoption({ ...verified, apiCreateSucceeded: true }, productId), null);
  assert.equal(parseVerifiedSmartstoreExistingAdoption({ ...verified, providerMutationPerformed: true }, productId), null);
  assert.equal(parseVerifiedSmartstoreExistingAdoption({ ...verified, contentVerified: false }, productId), null);
  assert.equal(parseVerifiedSmartstoreExistingAdoption({ ...verified, productId: "55555555-5555-4555-8555-555555555555" }, productId), null);
});

test("queued and running responses remain working only with exact read-only identities", () => {
  const pending = {
    ok: true,
    status: "queued",
    productId,
    listingId,
    jobId,
    reused: false,
    apiCreateSucceeded: false,
    providerMutationPerformed: false,
    contentVerified: false,
    normalUpdateEligible: false,
    message: "로컬 채널 작업기에 등록했습니다.",
  };
  assert.deepEqual(parsePendingSmartstoreExistingAdoption(pending, productId), {
    status: "queued",
    productId,
    listingId,
    jobId,
    reused: false,
    message: pending.message,
  });
  assert.equal(parsePendingSmartstoreExistingAdoption({ ...pending, status: "verified" }, productId), null);
  assert.equal(parsePendingSmartstoreExistingAdoption({ ...pending, contentVerified: true }, productId), null);
  assert.equal(parsePendingSmartstoreExistingAdoption({ ...pending, providerMutationPerformed: true }, productId), null);
  assert.equal(parsePendingSmartstoreExistingAdoption({ ...pending, jobId: listingId, productId: jobId }, productId), null);
});

test("error copy accepts only bounded server messages", () => {
  assert.equal(smartstoreExistingAdoptionErrorMessage({ message: "공식 조회 결과가 일치하지 않습니다." }), "공식 조회 결과가 일치하지 않습니다.");
  assert.equal(smartstoreExistingAdoptionErrorMessage({ message: "x".repeat(501) }), "기존 스마트스토어 상품의 공식 조회 결과를 확인하지 못했습니다.");
});

test("product and runtime UI expose safe Smartstore actions without browser-supplied evidence", async () => {
  const [page, runtimeCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ai-cli-runtime-card.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /smartstore-manual-adoption/);
  assert.match(page, /JSON\.stringify\(\{ confirmReadOnlyAdoption: true \}\)/);
  assert.match(page, /response\.status !== 202/);
  assert.match(page, /parsePendingSmartstoreExistingAdoption/);
  assert.match(page, /\{ method: "GET", cache: "no-store" \}/);
  assert.match(page, /pending\.jobId !== readbackJobId/);
  assert.match(page, /같은 작업 상태부터 이어서 확인합니다/);
  assert.match(page, /smartstoreAdoptionControllerRef\.current\?\.abort/);
  assert.match(page, /기존 스마트스토어 상품 연결 확인/);
  assert.match(page, /신규 상품 등록 요청 없음/);
  assert.match(page, /!isSmartstoreAdoptionReview && <button[^>]+onClick=\{\(\) => onRetryProduct\(product\)\}/);
  assert.match(runtimeCard, /readyForSmartstoreOpen/);
  assert.match(runtimeCard, /channel: "smartstore"/);
  assert.match(runtimeCard, /현재 열려 있는 다른 단일 채널 범위를 닫고/);
  assert.match(runtimeCard, /스마트스토어만 열기/);
});
