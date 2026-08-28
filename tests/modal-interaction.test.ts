import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireModalBodyScrollLock,
  hasActiveModalInteractionSurface,
  modalInteractionSurfaceSelector,
} from "../app/use-modal-interaction";

test("nested modal body locks restore the original styles only after the final release", () => {
  const body = {
    style: {
      overflow: "auto",
      overscrollBehavior: "contain",
    },
  } as Parameters<typeof acquireModalBodyScrollLock>[0];

  const releaseFirst = acquireModalBodyScrollLock(body);
  const releaseSecond = acquireModalBodyScrollLock(body);
  assert.deepEqual(body.style, { overflow: "hidden", overscrollBehavior: "none" });

  releaseFirst();
  assert.deepEqual(body.style, { overflow: "hidden", overscrollBehavior: "none" });
  releaseFirst();
  assert.deepEqual(body.style, { overflow: "hidden", overscrollBehavior: "none" });

  releaseSecond();
  assert.deepEqual(body.style, { overflow: "auto", overscrollBehavior: "contain" });
});

test("modal-surface detection includes active custom modals, native dialogs and the drawer", () => {
  assert.match(modalInteractionSurfaceSelector, /\[aria-modal="true"\]:not\(dialog\)/);
  assert.match(modalInteractionSurfaceSelector, /dialog\[open\]\[aria-modal="true"\]/);
  assert.match(modalInteractionSurfaceSelector, /\.sidebar\.open\[aria-modal="true"\]/);

  const seen: string[] = [];
  assert.equal(hasActiveModalInteractionSurface({
    querySelector(selector: string) {
      seen.push(selector);
      return { nodeName: "SECTION" } as Element;
    },
  }), true);
  assert.deepEqual(seen, [modalInteractionSurfaceSelector]);
  assert.equal(hasActiveModalInteractionSurface({ querySelector: () => null }), false);
});
