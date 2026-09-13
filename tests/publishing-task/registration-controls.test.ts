import assert from "node:assert/strict";
import test from "node:test";
import { applyRegistrationHistoryReset } from "../../app/_publishing/registration-draft-storage";
import { registrationActivityDisplayStatusLabel, retryableRegistrationActivityJobId, type RegistrationActivity } from "../../app/_registration/registration-status";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(),
  } satisfies Storage;
}

test("history clear removes only stale product drafts once, preserving new work and unrelated session state", () => {
  const storage = storageFixture();
  storage.setItem("sellerpilot:publishing-draft:v3:new", "old input");
  storage.setItem("sellerpilot:product-research-pending:v3", "old job");
  storage.setItem("sellerpilot:product-studio:active-job:v1", "old studio job");
  storage.setItem("auth", "preserved");
  const cutoff = "2026-09-14T00:00:00Z";
  assert.equal(applyRegistrationHistoryReset(storage, cutoff), true);
  assert.equal(storage.getItem("sellerpilot:product-research-pending:v3"), null);
  assert.equal(storage.getItem("sellerpilot:publishing-draft:v3:new"), null);
  assert.equal(storage.getItem("sellerpilot:product-studio:active-job:v1"), null);
  assert.equal(storage.getItem("auth"), "preserved");
  storage.setItem("sellerpilot:publishing-draft:v3:new", "new input");
  assert.equal(applyRegistrationHistoryReset(storage, cutoff), false);
  assert.equal(storage.getItem("sellerpilot:publishing-draft:v3:new"), "new input");
  assert.equal(applyRegistrationHistoryReset(storage, null), false);
});

test("queued, stopping and stopped cards distinguish execution from cancellation and prevent retry", () => {
  const card = { id: "job:11111111-1111-4111-8111-111111111111", status: "analyzing", queueState: "queued", message: "", productId: null } as RegistrationActivity;
  assert.equal(registrationActivityDisplayStatusLabel(card), "작업 대기 중");
  assert.equal(registrationActivityDisplayStatusLabel({ ...card, status: "publishing", controlState: "stopping" }), "중지 요청됨 · 응답 확인 중");
  assert.equal(registrationActivityDisplayStatusLabel({ ...card, status: "failed", controlState: "stopped" }), "작업 중지됨");
  assert.equal(retryableRegistrationActivityJobId({ ...card, status: "failed", controlState: "stopped" }), null);
  assert.equal(retryableRegistrationActivityJobId({ ...card, status: "failed", queueState: null }), "11111111-1111-4111-8111-111111111111");
});
