import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("new product intake uses the authenticated server draft with CAS status", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /getProductRegistrationDraft<ProductRegistrationIntakeDraft>/);
  assert.match(page, /putProductRegistrationDraft<ProductRegistrationIntakeDraft>/);
  assert.match(page, /expectedVersion: registrationDraftVersionRef\.current/);
  assert.match(page, /error instanceof ProductRegistrationDraftClientError && error\.status === 409/);
  assert.match(page, /서버 초안 저장됨/);
  assert.match(page, /저장 완료로 표시하지 않았습니다/);
  assert.doesNotMatch(page, /sessionStorage\.setItem\(draftStorageKey, JSON\.stringify\(intake\)\)/);
});

test("browser-only images remain explicit while the editable facts resume", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /uploadedPath: null/);
  assert.match(page, /로컬 사진 \{restoredLocalPhotoCount\}장은 브라우저 보안상 복원할 수 없습니다/);
  assert.match(page, /원본 File은 이 브라우저에만 있습니다/);
  assert.match(page, /imageRightsConfirmed: false,[\s\S]{0,100}productFactsConfirmed: false/);
});

test("initial defaults require a seller decision and AI does not replace dirty fields", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /value=\{intakeDecisions\.condition \? intake\.condition : ""\}/);
  assert.match(page, /value=\{intakeDecisions\.gtinStatus \? intake\.gtinStatus : ""\}/);
  assert.match(page, /value=\{intakeDecisions\.currency \? intake\.currency : ""\}/);
  assert.match(page, /value=\{intakeDecisions\.shippingFeeKrw \? intake\.shippingFeeKrw : ""\}/);
  assert.match(page, /sellerEdited\.has\(key\) \|\| currentIntake\[key\]\.trim\(\)/);
  assert.match(page, /sellerEdited\.has\("gtinStatus"\)/);
});
