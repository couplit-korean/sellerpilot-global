import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  elevenstNewProductInputContract,
  elevenstProviderAvailabilityReceiptContract,
  elevenstSellerIdentityReceiptContract,
  resolveElevenstNewProductInput,
  type ElevenstNewProductInput,
  type ElevenstNoticeInput,
} from "../lib/channels/elevenst-new-product-input";
import { elevenstProcessedFoodNotificationFields } from "../lib/channels/elevenst-listing";

const productId = "1ed4acfc-7603-48ec-a638-241131e59358";
const now = new Date("2026-09-10T03:15:00+09:00");
const validDigest = "a".repeat(64);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function notice(code: string, value = `테스트 승인값 ${code}`, revision = 1): ElevenstNoticeInput {
  const sourceSha256 = sha256(`source:${code}:${revision}`);
  const sourceKind = code === "176398001"
    ? "product_label"
    : ["42154823", "23757260"].includes(code)
      ? "seller_declaration"
      : "manufacturer_document";
  return {
    code,
    required: true,
    value,
    source: {
      kind: sourceKind,
      productId,
      revision,
      sourceSha256,
      capturedAt: "2026-09-10T03:09:00+09:00",
    },
    approval: {
      productId,
      categoryId: "1346631",
      fieldCode: code,
      revision,
      sourceSha256,
      valueSha256: sha256(value),
      approvedAt: "2026-09-10T03:10:00+09:00",
    },
  };
}

function availableInput(overrides: Partial<ElevenstNewProductInput> = {}): ElevenstNewProductInput {
  return {
    contract: elevenstNewProductInputContract,
    product: {
      id: productId,
      name: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      approvalRevision: 2,
    },
    categoryId: "1346631",
    notices: elevenstProcessedFoodNotificationFields
      .filter(({ code }) => code !== "176317774")
      .map(({ code }) => notice(code, code === "42155152" ? "315g (6봉입)" : undefined)),
    sellerIdentity: {
      contract: elevenstSellerIdentityReceiptContract,
      credentialId: "credential-11st-production",
      credentialVersion: 3,
      environment: "production",
      sellerIdSha256: validDigest,
      sellerOfficeAccountSha256: validDigest,
      ownershipRevision: 1,
      verifiedAt: "2026-09-10T03:10:00+09:00",
    },
    providerAvailability: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "available",
      observedAt: "2026-09-10T03:10:00+09:00",
    },
    ...overrides,
  };
}

test("11st preflight returns the exact nine missing inputs from the 006 2-of-11 candidate", () => {
  const keptCodes = new Set(["42155152"]);
  const input = availableInput({
    notices: availableInput().notices.filter(({ code }) => keptCodes.has(code)),
  });
  const result = resolveElevenstNewProductInput(input, now);

  assert.equal(result.state, "blocked");
  assert.equal(result.canCreate, false);
  assert.equal(result.requiredNoticeCount, 11);
  assert.equal(result.resolvedNoticeCount, 2);
  assert.equal(result.productNotification, null);
  const noticeBlockers = result.blockers.filter(({ code }) => code === "ELEVENST_NOTICE_INPUT_MISSING");
  assert.deepEqual(noticeBlockers.map(({ fieldCode }) => fieldCode), [
    "176400445",
    "176398001",
    "42154823",
    "23757260",
    "23757095",
    "176312674",
    "23756754",
    "23757245",
    "23757000",
  ]);
  assert.ok(noticeBlockers.every(({ required, missing, acceptedSourceKinds }) => required
    && missing?.join(",") === "value,source,approval"
    && Number(acceptedSourceKinds?.length) > 0));
});

test("11st preflight exposes ProductNotification only when all 11 inputs have bound evidence", () => {
  const result = resolveElevenstNewProductInput(availableInput(), now);

  assert.equal(result.state, "ready");
  assert.equal(result.canCreate, true);
  assert.equal(result.resolvedNoticeCount, 11);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.productNotification?.type, "891031");
  assert.deepEqual(
    result.productNotification?.item.map(({ code }) => code),
    elevenstProcessedFoodNotificationFields.map(({ code }) => code),
  );
  assert.ok(result.resolved.every(({ required, sourceRevision, approvalRevision, valueSha256 }) => required
    && sourceRevision > 0 && approvalRevision > 0 && /^[a-f0-9]{64}$/u.test(valueSha256)));
});

test("requiredness cannot be downgraded and existing-product recovery is not an accepted source", () => {
  const requirednessInput = availableInput();
  requirednessInput.notices[0] = { ...requirednessInput.notices[0], required: false };
  const requiredness = resolveElevenstNewProductInput(requirednessInput, now);
  assert.equal(requiredness.canCreate, false);
  assert.ok(requiredness.blockers.some(({ code, fieldCode }) => code === "ELEVENST_NOTICE_REQUIREDNESS_TAMPERED"
    && fieldCode === requirednessInput.notices[0].code));

  const copiedInput = availableInput();
  copiedInput.notices[0] = {
    ...copiedInput.notices[0],
    source: { ...copiedInput.notices[0].source!, kind: "existing_product_recovery" as "product_label" },
  };
  const copied = resolveElevenstNewProductInput(copiedInput, now);
  assert.equal(copied.canCreate, false);
  assert.ok(copied.blockers.some(({ code }) => code === "ELEVENST_NOTICE_SOURCE_INVALID"));
});

test("approval revision is bound to exact product, category, field, source and normalized value", () => {
  const cases: Array<(row: ElevenstNoticeInput) => ElevenstNoticeInput> = [
    (row) => ({ ...row, approval: { ...row.approval!, revision: 0 } }),
    (row) => ({ ...row, approval: { ...row.approval!, productId: "other-product" } }),
    (row) => ({ ...row, approval: { ...row.approval!, categoryId: "1341821" } }),
    (row) => ({ ...row, approval: { ...row.approval!, fieldCode: "other-field" } }),
    (row) => ({ ...row, approval: { ...row.approval!, sourceSha256: "b".repeat(64) } }),
    (row) => ({ ...row, approval: { ...row.approval!, valueSha256: "c".repeat(64) } }),
  ];
  for (const mutate of cases) {
    const input = availableInput();
    input.notices[0] = mutate(input.notices[0]);
    const result = resolveElevenstNewProductInput(input, now);
    assert.equal(result.canCreate, false);
    assert.ok(result.blockers.some(({ code }) => code === "ELEVENST_NOTICE_APPROVAL_BINDING_INVALID"));
  }
});

test("operating seller identity must be fresh, digest-matched, and contain no raw account field", () => {
  const mismatch = availableInput();
  mismatch.sellerIdentity = { ...mismatch.sellerIdentity!, sellerOfficeAccountSha256: "b".repeat(64) };
  assert.ok(resolveElevenstNewProductInput(mismatch, now).blockers
    .some(({ code }) => code === "ELEVENST_SELLER_IDENTITY_MISMATCH"));

  const stale = availableInput();
  stale.sellerIdentity = { ...stale.sellerIdentity!, verifiedAt: "2026-09-10T02:00:00+09:00" };
  assert.ok(resolveElevenstNewProductInput(stale, now).blockers
    .some(({ code }) => code === "ELEVENST_SELLER_IDENTITY_FRESH_READ_REQUIRED"));

  const raw = availableInput();
  raw.sellerIdentity = { ...raw.sellerIdentity!, sellerId: "must-not-be-here" } as typeof raw.sellerIdentity;
  const rawResult = resolveElevenstNewProductInput(raw, now);
  assert.equal(rawResult.canCreate, false);
  assert.ok(rawResult.blockers.some(({ code, missing }) => code === "ELEVENST_SELLER_IDENTITY_RAW_OR_UNKNOWN_FIELD_FORBIDDEN"
    && missing?.includes("remove:sellerId")));
});

test("02:00-06:00 KST maintenance blocks CREATE and requires a new read after the window", () => {
  const maintenance = availableInput({
    providerAvailability: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "scheduled_maintenance",
      observedAt: "2026-09-10T03:10:00+09:00",
      maintenance: {
        startsAt: "2026-09-10T02:00:00+09:00",
        endsAt: "2026-09-10T06:00:00+09:00",
      },
    },
  });
  const active = resolveElevenstNewProductInput(maintenance, now);
  assert.equal(active.canCreate, false);
  assert.deepEqual(active.blockers.find(({ code }) => code === "ELEVENST_PROVIDER_MAINTENANCE_WINDOW_ACTIVE"), {
    code: "ELEVENST_PROVIDER_MAINTENANCE_WINDOW_ACTIVE",
    path: "providerAvailability.state",
    required: true,
    message: "11번가 공식 점검창 안이므로 CREATE할 수 없습니다.",
    retryAfter: "2026-09-10T06:00:00+09:00",
  });

  const after = resolveElevenstNewProductInput(maintenance, new Date("2026-09-10T06:01:00+09:00"));
  assert.equal(after.canCreate, false);
  assert.ok(after.blockers.some(({ code }) => code === "ELEVENST_PROVIDER_AVAILABILITY_FRESH_READ_REQUIRED"));
});

test("stale available status and duplicate notice inputs remain structured blockers", () => {
  const input = availableInput({
    providerAvailability: {
      contract: elevenstProviderAvailabilityReceiptContract,
      state: "available",
      observedAt: "2026-09-10T02:00:00+09:00",
    },
  });
  input.notices.push(input.notices[0]);
  const result = resolveElevenstNewProductInput(input, now);

  assert.equal(result.canCreate, false);
  assert.ok(result.blockers.some(({ code }) => code === "ELEVENST_PROVIDER_AVAILABILITY_FRESH_READ_REQUIRED"));
  assert.ok(result.blockers.some(({ code, fieldCode }) => code === "ELEVENST_NOTICE_INPUT_DUPLICATE"
    && fieldCode === input.notices[0].code));
  assert.equal(result.productNotification, null);
});

test("unknown and manual product-name notice codes cannot enter the resolved payload", () => {
  const input = availableInput();
  input.notices.push(notice("99999999"));
  input.notices.push(notice("176317774", "수동 제품명"));
  const result = resolveElevenstNewProductInput(input, now);

  assert.equal(result.canCreate, false);
  assert.equal(result.productNotification, null);
  assert.deepEqual(
    result.blockers.filter(({ code }) => code === "ELEVENST_NOTICE_INPUT_UNEXPECTED").map(({ fieldCode }) => fieldCode),
    ["99999999", "176317774"],
  );
});

test("future source evidence and approval before capture are rejected", () => {
  const future = availableInput();
  future.notices[0] = {
    ...future.notices[0],
    source: { ...future.notices[0].source!, capturedAt: "2026-09-10T03:16:00+09:00" },
    approval: { ...future.notices[0].approval!, approvedAt: "2026-09-10T03:17:00+09:00" },
  };
  assert.ok(resolveElevenstNewProductInput(future, now).blockers
    .some(({ code }) => code === "ELEVENST_NOTICE_SOURCE_INVALID"));

  const reversed = availableInput();
  reversed.notices[0] = {
    ...reversed.notices[0],
    source: { ...reversed.notices[0].source!, capturedAt: "2026-09-10T03:10:00+09:00" },
    approval: { ...reversed.notices[0].approval!, approvedAt: "2026-09-10T03:09:00+09:00" },
  };
  assert.ok(resolveElevenstNewProductInput(reversed, now).blockers
    .some(({ code }) => code === "ELEVENST_NOTICE_APPROVAL_BINDING_INVALID"));
});
