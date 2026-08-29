import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertStudioSourceByteBudget,
  maximumStudioJobSourceBytes,
} from "../lib/studio-source-photo-policy";
import { createStudioPhotoSelectionBudget } from "../lib/studio-photo-selection-budget";
import { createAbortableConcurrencyGate } from "../lib/abortable-concurrency-gate";
import { createStudioPhotoEditSession } from "../lib/studio-photo-edit-session";

function handler(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `${start} handler must exist`);
  assert.ok(endIndex > startIndex, `${start} handler boundary must exist`);
  return source.slice(startIndex, endIndex);
}

test("studio photo selection byte budget accepts 200MB exactly and rejects one byte more", () => {
  assert.equal(
    assertStudioSourceByteBudget([{ size: maximumStudioJobSourceBytes }]),
    maximumStudioJobSourceBytes,
  );
  assert.throws(
    () => assertStudioSourceByteBudget([{ size: maximumStudioJobSourceBytes }, { size: 1 }]),
    /한 상품의 원본 사진 합계는 200MB 이하로 등록해 주세요/,
  );
});

test("pending byte reservations close concurrent selection races and commit atomically", () => {
  const megabyte = 1024 * 1024;
  const budget = createStudioPhotoSelectionBudget(200 * megabyte);
  const baseEntries = Array.from({ length: 10 }, (_, index) => ({ key: `base:${index}`, size: 18 * megabyte }));
  const base = budget.reserve(baseEntries);
  assert.equal(budget.commit(base, baseEntries), true);
  assert.equal(budget.committedBytes(), 180 * megabyte);

  const front = budget.reserve([{ key: "role:front", size: 10 * megabyte }]);
  const back = budget.reserve([{ key: "role:back", size: 10 * megabyte }]);
  assert.equal(budget.projectedBytes(), 200 * megabyte);
  assert.throws(
    () => budget.reserve([{ key: "role:left", size: 1 }]),
    /한 상품의 원본 사진 합계는 200MB 이하/,
  );
  assert.equal(budget.commit(back, [{ key: "role:back", size: 10 * megabyte }]), true);
  assert.equal(budget.commit(front, [{ key: "role:front", size: 10 * megabyte }]), true);
  assert.equal(budget.committedBytes(), 200 * megabyte);
  assert.equal(budget.hasPending(), false);

  const replacementBudget = createStudioPhotoSelectionBudget(20 * megabyte);
  const priorMain = replacementBudget.reserve([{ key: "main", size: 20 * megabyte }]);
  const latestMain = replacementBudget.reserve([{ key: "main", size: 15 * megabyte }]);
  assert.equal(replacementBudget.isCurrent(priorMain), false);
  assert.equal(replacementBudget.commit(priorMain, [{ key: "main", size: 20 * megabyte }]), false);
  assert.equal(replacementBudget.commit(latestMain, [{ key: "main", size: 15 * megabyte }]), true);
  assert.equal(replacementBudget.committedBytes(), 15 * megabyte);
});

test("the shared reservation also keeps concurrent main, role, and extra selections within 100 photos", () => {
  const budget = createStudioPhotoSelectionBudget(1_000, 2);
  const main = budget.reserve([{ key: "main", size: 1 }]);
  const role = budget.reserve([{ key: "role:front", size: 1 }]);
  assert.throws(
    () => budget.reserve([{ key: "extra:pending", size: 1 }]),
    /한 상품은 분석용 사진을 최대 2장까지 등록할 수 있습니다/,
  );
  assert.equal(budget.commit(role, [{ key: "role:front", size: 1 }]), true);
  assert.equal(budget.commit(main, [{ key: "main", size: 1 }]), true);
  assert.equal(budget.committedBytes(), 2);
});

test("one screen decode gate runs at most three tasks and removes an aborted queued decode", async () => {
  const gate = createAbortableConcurrencyGate(3);
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const releases: Array<() => void> = [];
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const tasks = controllers.map((controller, index) => gate.run(async () => {
    started.push(index);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => { releases[index] = resolve; });
    active -= 1;
    return index;
  }, controller.signal));

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);
  const queuedAbort = assert.rejects(tasks[3], /대기 중인 사진 확인을 취소했습니다/);
  controllers[3].abort(new DOMException("대기 중인 사진 확인을 취소했습니다.", "AbortError"));
  await queuedAbort;
  assert.equal(gate.pendingCount(), 1);
  releases[0]();
  releases[1]();
  releases[2]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [0, 1, 2, 4]);
  releases[4]();
  assert.deepEqual(await Promise.all([tasks[0], tasks[1], tasks[2], tasks[4]]), [0, 1, 2, 4]);
  assert.equal(peak, 3);
  assert.equal(gate.activeCount(), 0);
});

test("an active gated decode receives its abort signal and releases immediately", async () => {
  const gate = createAbortableConcurrencyGate(3);
  const controller = new AbortController();
  let released = false;
  const decode = gate.run(() => new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => {
      released = true;
      reject(controller.signal.reason);
    }, { once: true });
  }), controller.signal);
  await Promise.resolve();
  controller.abort(new DOMException("같은 역할 사진을 다시 선택했습니다.", "AbortError"));
  await assert.rejects(decode, /같은 역할 사진을 다시 선택했습니다/);
  assert.equal(released, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gate.activeCount(), 0);
});

test("revision parent keeps a synchronous snapshot and ignores an old picker finally after reopen", async () => {
  const sessions = createStudioPhotoEditSession<{ id: string }>();
  const first = sessions.start();
  assert.equal(sessions.updateProcessing(first, true), true);
  assert.equal(sessions.updatePhotos(first, [{ id: "old" }]), true);
  sessions.invalidate();
  const second = sessions.start();
  assert.equal(sessions.updateProcessing(second, true), true);
  assert.equal(sessions.updatePhotos(second, [{ id: "new" }]), true);

  const staleFinallyAccepted = await Promise.resolve().then(() => sessions.updateProcessing(first, false));
  assert.equal(staleFinallyAccepted, false);
  assert.equal(sessions.snapshot().processing, true);
  assert.deepEqual(sessions.snapshot().photos, [{ id: "new" }]);

  assert.equal(sessions.updateProcessing(second, false), true);
  assert.deepEqual(sessions.snapshot(), {
    sessionId: second,
    photos: [{ id: "new" }],
    processing: false,
  });
});

test("new product delayed decodes reserve bytes and block immediate analysis until atomic commit", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const main = handler(page, "const selectMainPhoto = async", "const waitForProductResearch = async");
  const role = handler(page, "const selectSlotPhoto = async", "const selectExtraPhotos = async");
  const extras = handler(page, "const selectExtraPhotos = async", "const removeSlotPhoto =");
  const submit = handler(page, "const startAutomation = () =>", "const totalPhotoCount =");

  assert.ok(main.indexOf("photoSelectionFence.nextMain") < main.indexOf("photoSelectionBudget.reserve"));
  assert.ok(main.indexOf("abortPhotoDecodeScope") < main.indexOf("photoSelectionBudget.reserve"));
  assert.ok(main.indexOf("beginPhotoSelectionProcessing()") < main.indexOf("photoDecodeGate.run"));
  assert.ok(main.indexOf("photoSelectionBudget.commit") < main.indexOf("setMainPhoto"));

  assert.ok(role.indexOf("abortPhotoDecodeScope") < role.indexOf("photoSelectionBudget.reserve"));
  assert.ok(role.indexOf("photoSelectionBudget.reserve") < role.indexOf("pendingNewSlotPhotoRef.current.add"));
  assert.ok(role.indexOf("beginPhotoSelectionProcessing()") < role.indexOf("photoDecodeGate.run"));
  assert.ok(role.indexOf("photoSelectionBudget.commit") < role.indexOf("setSlotPhotos"));

  assert.ok(extras.indexOf("photoSelectionFence.nextExtras") < extras.indexOf("photoSelectionBudget.reserve"));
  assert.ok(extras.indexOf("abortPhotoDecodeScope") < extras.indexOf("photoSelectionBudget.reserve"));
  assert.ok(extras.indexOf("beginPhotoSelectionProcessing()") < extras.indexOf("settleWithConcurrency"));
  assert.ok(extras.indexOf("photoSelectionBudget.commit") < extras.indexOf("setExtraPhotos((current)"));
  assert.match(extras, /const selected = files\.slice\(0, remaining\)/);
  assert.match(extras, /settleWithConcurrency\(candidates, 3,/);
  assert.match(extras, /photoDecodeGate\.run/);
  assert.match(page, /createAbortableConcurrencyGate\(3\)/);
  assert.match(page, /const onAbort = \(\) => \{[\s\S]{0,220}image\.src = "";[\s\S]{0,120}releasePhotoUrl\(url\)/);
  assert.match(submit, /photoSelectionsProcessingCountRef\.current > 0 \|\| photoSelectionBudget\.hasPending\(\)/);
  assert.ok(submit.indexOf("photoSelectionsProcessingCountRef.current > 0") < submit.indexOf("productIntakeSchema.safeParse"));
  assert.match(page, /disabled=\{!registrationExecutionAvailable \|\| !firstDraftReady \|\| running \|\| researchingProduct \|\| photoSelectionsProcessing \|\| Boolean\(queuedJobId\)\}/);
  assert.match(page, /photoSelectionsProcessing \? <><LoaderCircle className="spin" size=\{17\} \/>사진 확인 중/);
});

test("product revision delayed decodes block immediate save and keep camera, count, and stale fences", async () => {
  const [page, picker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-revision-image-picker.tsx", import.meta.url), "utf8"),
  ]);
  const main = handler(picker, "const selectMain = async", "const selectRole = async");
  const role = handler(picker, "const selectRole = async", "const selectExtras = async");
  const extras = handler(picker, "const selectExtras = async", "const removeRole =");
  const save = handler(page, "const saveProductDetails = async", "setEditSaving(true)");

  assert.ok(main.indexOf("selectionFence.nextMain") < main.indexOf("selectionBudget.reserve"));
  assert.ok(main.indexOf("abortDecodeScope") < main.indexOf("selectionBudget.reserve"));
  assert.ok(main.indexOf("beginSelectionProcessing()") < main.indexOf("decodeGate.run"));
  assert.ok(main.indexOf("selectionBudget.commit") < main.indexOf("setMainPhoto"));
  assert.ok(role.indexOf("selectionBudget.reserve") < role.indexOf("pendingNewRoleRef.current.add"));
  assert.ok(role.indexOf("selectionBudget.commit") < role.indexOf("setRolePhotos"));
  assert.ok(extras.indexOf("selectionBudget.reserve") < extras.indexOf("processingRef.current = true"));
  assert.ok(extras.indexOf("selectionBudget.commit") < extras.indexOf("setExtraPhotos(kept)"));
  assert.match(extras, /settleWithConcurrency\(candidates, 3,/);
  assert.match(extras, /decodeGate\.run/);
  assert.match(role, /decodeGate\.run/);
  assert.match(picker, /createAbortableConcurrencyGate\(3\)/);
  assert.match(picker, /const onAbort = \(\) => \{[\s\S]{0,220}image\.src = "";[\s\S]{0,120}release\(url\)/);
  assert.match(save, /const revisionPhotoSnapshot = revisionPhotoSession\.snapshot\(\)/);
  assert.ok(save.indexOf("revisionPhotoSnapshot.processing") < save.indexOf("productEditSchema.safeParse"));
  assert.match(page, /revisionPhotoSnapshot\.photos/);
  assert.match(page, /disabled=\{saving \|\| photosProcessing\}/);
  assert.match(picker, /selectionFence\.isCurrent\(token\) && selectionBudget\.isCurrent\(budgetReservation\)/);
  assert.match(picker, /onChange\(sessionId,/);
  assert.ok(main.indexOf("emitSnapshot()") < main.indexOf("endSelectionProcessing()"));
  assert.match(page, /revisionPhotoSession\.updateProcessing\(sessionId, processing\)/);
  assert.match(page, /revisionPhotoSession\.isCurrent\(sessionId\)/);
  assert.match(picker, /totalPhotoCount >= 100/);
  assert.match(picker, /accept="image\/jpeg,image\/png,image\/webp" capture="environment"/);
});

test("clearing revision photos during a pending role decode reopens extras after a new main photo", async () => {
  const picker = await readFile(new URL("../app/product-revision-image-picker.tsx", import.meta.url), "utf8");
  const cleanup = handler(picker, "useEffect(() => {", "const toPhoto = useCallback");
  const removeRole = handler(picker, "const removeRole =", "const removeExtra =");
  const clearAll = handler(picker, "const clearMainAndDependents =", "return <section");
  const extras = handler(picker, "const selectExtras = async", "const removeRole =");

  assert.match(cleanup, /const pendingNewRoles = pendingNewRoleRef\.current[\s\S]*pendingNewRoles\.clear\(\)/);
  assert.ok(removeRole.indexOf("pendingNewRoleRef.current.delete(role)") < removeRole.indexOf("selectionBudget.remove"));
  assert.ok(clearAll.indexOf("pendingNewRoleRef.current.clear()") < clearAll.indexOf("selectionBudget.reset()"));
  assert.match(extras, /if \(pendingNewRoleRef\.current\.size\)/);
  assert.match(extras, /if \(!mainPhotoRef\.current\)/);
});
