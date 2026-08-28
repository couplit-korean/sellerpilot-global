"use client";

import { type RefObject, useEffect, useRef } from "react";

const focusableSelector = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const modalInteractionSurfaceSelector = [
  '[aria-modal="true"]:not(dialog)',
  'dialog[open][aria-modal="true"]',
  '.sidebar.open[aria-modal="true"]',
].join(",");

type ScrollLockBody = {
  style: Pick<CSSStyleDeclaration, "overflow" | "overscrollBehavior">;
};

type ScrollLockState = {
  count: number;
  overflow: string;
  overscrollBehavior: string;
};

const bodyScrollLocks = new WeakMap<ScrollLockBody, ScrollLockState>();
const modalInteractionStack: symbol[] = [];

export function hasActiveModalInteractionSurface(
  root?: Pick<ParentNode, "querySelector">,
) {
  const target = root ?? (typeof document === "undefined" ? null : document);
  return Boolean(target?.querySelector(modalInteractionSurfaceSelector));
}

export function acquireModalBodyScrollLock(body: ScrollLockBody) {
  const existing = bodyScrollLocks.get(body);
  if (existing) {
    existing.count += 1;
  } else {
    bodyScrollLocks.set(body, {
      count: 1,
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior,
    });
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const state = bodyScrollLocks.get(body);
    if (!state) return;
    state.count -= 1;
    if (state.count > 0) return;
    body.style.overflow = state.overflow;
    body.style.overscrollBehavior = state.overscrollBehavior;
    bodyScrollLocks.delete(body);
  };
}

/**
 * Keeps the background inert to touch/scroll, restores the opener on close,
 * and prevents keyboard focus from escaping a SellerPilot modal.
 */
export function useModalInteraction(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { dismissible?: boolean; initialFocusRef?: RefObject<HTMLElement | null> } = {},
) {
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(options.dismissible ?? true);
  const initialFocusRef = useRef(options.initialFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = options.dismissible ?? true;
    initialFocusRef.current = options.initialFocusRef;
  }, [onClose, options.dismissible, options.initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const interactionToken = Symbol("sellerpilot-modal");
    modalInteractionStack.push(interactionToken);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScrollLock = acquireModalBodyScrollLock(document.body);
    const ownsInteraction = () => modalInteractionStack.at(-1) === interactionToken;

    const focusInitialControl = () => {
      if (!ownsInteraction()) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const requested = initialFocusRef.current?.current;
      const fallback = dialog.querySelector<HTMLElement>(focusableSelector) ?? dialog;
      (requested && dialog.contains(requested) ? requested : fallback).focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusInitialControl);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!ownsInteraction()) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.closest("[inert]"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      const restoredTopInteraction = ownsInteraction();
      const stackIndex = modalInteractionStack.lastIndexOf(interactionToken);
      if (stackIndex >= 0) modalInteractionStack.splice(stackIndex, 1);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      releaseBodyScrollLock();
      if (restoredTopInteraction && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [dialogRef, open]);
}
