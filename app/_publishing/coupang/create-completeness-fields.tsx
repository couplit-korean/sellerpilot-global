"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RegistrationValue } from "../../../lib/channel-registration-form";
import {
  coupangCreateReadinessRequestIdentity,
  coupangCreateReadinessResponseIsCurrent,
  emptyCoupangCreateCompletenessValidation,
  mapCoupangCreateCompletenessView,
  type CoupangCreateCompletenessValidation,
  type CoupangCreateCompletenessView,
  type CoupangCreateExpectedTuple,
} from "../../../lib/product-registration/coupang/create-completeness-view";
import { createClient } from "../../../lib/supabase/client";

export type { CoupangCreateCompletenessValidation } from
  "../../../lib/product-registration/coupang/create-completeness-view";

export type CoupangCreateCompletenessFieldsProps = CoupangCreateExpectedTuple & {
  draft: Record<string, unknown>;
  onChange: (path: string[], value: RegistrationValue) => void;
  onValidationChange: (validation: CoupangCreateCompletenessValidation) => void;
};

type RequestState =
  | { state: "idle" }
  | { state: "loading"; identity: string }
  | { state: "ready"; identity: string; view: CoupangCreateCompletenessView }
  | { state: "blocked"; identity: string; message: string };

const initialValidation = emptyCoupangCreateCompletenessValidation();
const statusClass = {
  resolved: "ready",
  manual_required: "manual",
  provider_read_required: "runtime",
  blocked: "manual",
} as const;

export function CoupangCreateCompletenessFields({
  productId,
  credentialId,
  credentialVersion,
  categoryId,
  sourceFingerprint,
  draft,
  onChange,
  onValidationChange,
}: CoupangCreateCompletenessFieldsProps) {
  const expectedTuple = useMemo<CoupangCreateExpectedTuple>(() => ({
    productId,
    credentialId,
    credentialVersion,
    categoryId,
    sourceFingerprint,
  }), [categoryId, credentialId, credentialVersion, productId, sourceFingerprint]);
  const requestIdentity = useMemo(() => coupangCreateReadinessRequestIdentity({
    tuple: expectedTuple,
    draft,
  }), [draft, expectedTuple]);
  const latestIdentity = useRef(requestIdentity);
  // This fail-closed discriminator must advance before passive effects so an
  // already-resolved request cannot apply patches during the render/effect gap.
  // eslint-disable-next-line react-hooks/refs
  latestIdentity.current = requestIdentity;
  const request = useRef<{ identity: string; controller: AbortController } | null>(null);
  const [requestState, setRequestState] = useState<RequestState>({ state: "idle" });
  const currentView = requestState.state === "ready"
    && requestState.identity === requestIdentity
    ? requestState.view
    : null;
  const validation = currentView?.validation ?? initialValidation;
  const validationSignature = JSON.stringify(validation);
  const emittedValidation = useRef("");

  useEffect(() => {
    if (emittedValidation.current === validationSignature) return;
    emittedValidation.current = validationSignature;
    onValidationChange(validation);
  }, [onValidationChange, validation, validationSignature]);

  useEffect(() => {
    const active = request.current;
    if (active && active.identity !== requestIdentity) active.controller.abort();
  }, [requestIdentity]);

  useEffect(() => () => request.current?.controller.abort(), []);

  const refresh = async () => {
    request.current?.controller.abort();
    const controller = new AbortController();
    const identityAtRequest = requestIdentity;
    request.current = { identity: identityAtRequest, controller };
    setRequestState({ state: "loading", identity: identityAtRequest });
    try {
      const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const response = await fetch("/api/admin/coupang-create-readiness", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          productId,
          credentialId,
          ...(credentialVersion === undefined ? {} : { credentialVersion }),
          categoryId,
          sourceFingerprint,
          draft,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!coupangCreateReadinessResponseIsCurrent({
        latestIdentity: latestIdentity.current,
        requestIdentity: identityAtRequest,
        aborted: controller.signal.aborted,
      })) return;
      if (!response.ok) {
        const message = payload && typeof payload === "object"
          && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "쿠팡 공식 등록 조건을 확인하지 못했습니다.";
        setRequestState({ state: "blocked", identity: identityAtRequest, message });
        return;
      }
      const view = mapCoupangCreateCompletenessView(payload, expectedTuple);
      if (!view) {
        setRequestState({
          state: "blocked",
          identity: identityAtRequest,
          message: "현재 상품·카테고리·인증정보와 일치하는 쿠팡 준비 결과를 확인하지 못했습니다.",
        });
        return;
      }
      // Only exact server-returned patches are forwarded. This component does
      // not manufacture fallback values or retain the raw response/credential.
      for (const patch of view.autoFillPatches) onChange(patch.path, patch.value);
      setRequestState({ state: "ready", identity: identityAtRequest, view });
    } catch (error) {
      if (!coupangCreateReadinessResponseIsCurrent({
        latestIdentity: latestIdentity.current,
        requestIdentity: identityAtRequest,
        aborted: controller.signal.aborted,
      })) return;
      setRequestState({
        state: "blocked",
        identity: identityAtRequest,
        message: error instanceof Error
          ? error.message
          : "쿠팡 공식 등록 조건 조회가 실패했습니다.",
      });
    } finally {
      if (request.current?.controller === controller) request.current = null;
    }
  };

  const stale = requestState.state !== "idle" && requestState.identity !== requestIdentity;
  const loading = requestState.state === "loading" && !stale;
  const blockedMessage = requestState.state === "blocked" && !stale
    ? requestState.message
    : null;

  return <section className="publish-required-fields" aria-label="쿠팡 상품 등록 조건">
    <div className="publish-required-head">
      <div>
        <b>쿠팡 상품 등록 조건 19개</b>
        <small>{currentView
          ? currentView.validation.canBindCreateSourceRevision
            ? "현재 입력으로 CREATE revision 결속 가능"
            : `${currentView.validation.blockingFieldKeys.length}개 항목 보완 필요`
          : stale
            ? "입력 또는 대상이 변경되어 이전 확인 결과가 무효화됐습니다."
            : "현재 상품과 쿠팡 공식 값을 확인해 주세요."}</small>
      </div>
      <button type="button" className="credential-secondary" disabled={loading}
        onClick={() => void refresh()}>{loading ? "공식 조건 확인 중" : "쿠팡 공식 조건 다시 확인"}</button>
    </div>
    {blockedMessage && <div className="publish-blocked" role="alert">
      <b>쿠팡 등록 준비 확인 차단</b>
      <small>{blockedMessage}</small>
    </div>}
    {currentView && <div className="publish-required-list">
      {currentView.rows.map((row) => <div className={`publish-required-item ${statusClass[row.status]}`} data-status={row.status} key={row.key}>
        <span>
          <b>{row.label}</b>
          <small>{row.message}</small>
          <small>{row.fieldPathLabel}</small>
          <small>현재 값 출처: {row.selectedSourceLabel}</small>
        </span>
        <em>{row.statusLabel}</em>
      </div>)}
    </div>}
  </section>;
}
