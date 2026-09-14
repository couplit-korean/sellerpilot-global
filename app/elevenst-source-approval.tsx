"use client";
import { useEffect, useRef, useState } from "react";
import { ElevenstApprovalRequestCache, elevenstApprovalDraft, readElevenstLabelEvidence, type ElevenstLabelEvidence } from "./elevenst-source-approval-client";

type Props = {
  productId: string; credentialId: string; market: string; targetId: string; draft: Record<string, unknown>;
  disabled: boolean; onSave: () => Promise<{ version: number; accessToken: string }>;
};
export function ElevenstSourceApproval(props: Props) {
  const values = elevenstApprovalDraft(props.draft);
  const [sellerAccount, setSellerAccount] = useState("");
  const [sellerConfirmedAt, setSellerConfirmedAt] = useState("");
  const [availableConfirmedAt, setAvailableConfirmedAt] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [labelEvidence, setLabelEvidence] = useState<ElevenstLabelEvidence | null>(null);
  const [labelConfirmed, setLabelConfirmed] = useState(false);
  const [readingLabels, setReadingLabels] = useState(false);
  const labelReadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [approvedFor, setApprovedFor] = useState("");
  const running = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pending = useRef(new ElevenstApprovalRequestCache());
  const identity = JSON.stringify([props.productId, props.credentialId, props.market, props.targetId, props.draft]);
  const confirmation = JSON.stringify([identity, sellerAccount, sellerConfirmedAt, availableConfirmedAt, reviewed, labelEvidence, labelConfirmed]);
  useEffect(() => { generation.current++; setReviewed(false); setLabelConfirmed(false); setMessage(""); setApprovedFor(""); pending.current.clear(); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  const approve = async () => {
    if (running.current || props.disabled || values.problems.length || !reviewed || !sellerAccount.trim() || !sellerConfirmedAt || !availableConfirmedAt || readingLabels || !labelEvidence || !labelConfirmed) return;
    running.current = true; setBusy(true); setMessage("");
    const currentGeneration = generation.current;
    const requestController = new AbortController(); controller.current = requestController;
    try {
      const saved = await props.onSave();
      if (currentGeneration !== generation.current) throw new Error("입력이 바뀌었습니다. 현재 값을 다시 검토해 주세요.");
      const key = JSON.stringify([confirmation, saved.version]);
      const body = await pending.current.get(key, {
        productId: props.productId, credentialId: props.credentialId, market: props.market, targetId: props.targetId,
        draft: props.draft, expectedDraftVersion: saved.version, sellerAccount, reviewed, sellerConfirmedAt, availableConfirmedAt, labelEvidence, labelConfirmed,
      });
      if (currentGeneration !== generation.current) throw new Error("입력이 바뀌었습니다. 현재 값을 다시 검토해 주세요.");
      const response = await fetch("/api/admin/elevenst/new-product-source-approval", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${saved.accessToken}` }, body: JSON.stringify(body), signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(60_000)]) });
      const result = await response.json().catch(() => null) as { ok?: boolean; status?: string; message?: string } | null;
      if (!response.ok || !result?.ok || !["approved", "existing"].includes(result.status ?? "")) throw new Error(result?.message ?? "승인 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인할 수 있습니다.");
      if (currentGeneration === generation.current) { setApprovedFor(confirmation); setMessage("11번가 등록 정보를 승인했습니다. 채널 등록 버튼으로 상품 등록을 진행하세요."); }
    } catch (error) {
      if (currentGeneration === generation.current) setMessage(error instanceof Error ? error.message : "승인 결과를 확인하지 못했습니다.");
    } finally { running.current = false; if (mounted.current) setBusy(false); controller.current = null; }
  };
  return <section className="publish-required-fields" aria-label="11번가 등록 정보 승인">
    <div className="publish-required-head"><b>11번가 등록 정보 승인</b><small>아래 내용은 현재 초안의 값입니다. 수정은 위 입력란에서 할 수 있습니다.</small></div>
    <details><summary>상품 고시 10개와 배송·반품 정책 검토</summary>
      <dl>{values.notices.map(notice => <div key={notice.code}><dt>{notice.label}</dt><dd>{notice.value || "입력 필요"}</dd></div>)}</dl>
      <p>배송비 {Number.isFinite(values.shipping.shippingFeeKrw) ? values.shipping.shippingFeeKrw.toLocaleString("ko-KR") : "입력 필요"}원 · 묶음 배송 {values.shipping.bundleDeliveryCode === "Y" ? "가능" : values.shipping.bundleDeliveryCode === "N" ? "불가" : "입력 필요"}</p>
      <p>출고지 {values.shipping.outboundAddressId || "입력 필요"} · 반품지 {values.shipping.returnAddressId || "입력 필요"}</p>
      <p>반품비 {Number.isFinite(values.returns.returnFeeKrw) ? `${values.returns.returnFeeKrw.toLocaleString("ko-KR")}원` : "입력 필요"} · 교환비 {Number.isFinite(values.returns.exchangeFeeKrw) ? `${values.returns.exchangeFeeKrw.toLocaleString("ko-KR")}원` : "입력 필요"}</p><p>A/S: {values.returns.asDetail || "입력 필요"}</p><p>반품·교환: {values.returns.returnExchangeDetail || "입력 필요"}</p>
    </details>
    <fieldset disabled={busy} className="publish-manual-fields">
      <label><span>고시 내용을 확인한 상품 라벨 사진</span><input type="file" accept="image/*" multiple onChange={event => {
        const files = Array.from(event.target.files ?? []);
        const sequence = ++labelReadSequence.current;
        setLabelEvidence(null); setLabelConfirmed(false); setReadingLabels(true); setMessage("");
        void readElevenstLabelEvidence(files).then(evidence => { if (mounted.current && labelReadSequence.current === sequence) setLabelEvidence(evidence); })
          .catch(error => { if (mounted.current && labelReadSequence.current === sequence) setMessage(error instanceof Error ? error.message : "라벨 사진을 확인하지 못했습니다."); })
          .finally(() => { if (mounted.current && labelReadSequence.current === sequence) setReadingLabels(false); });
      }} /><small>{readingLabels ? "선택한 사진 확인 중…" : labelEvidence ? `라벨 사진 ${labelEvidence.fileCount}장 확인 · 파일은 이 기기에서만 읽습니다.` : "촬영한 라벨 사진을 선택하세요. 사진을 다시 생성하거나 업로드하지 않습니다."}</small></label>
      <label><input type="checkbox" disabled={!labelEvidence || readingLabels} checked={labelConfirmed} onChange={event => setLabelConfirmed(event.target.checked)} />생산자·기한·영양·주의사항·원재료·내용량·식품 유형 고시를 선택한 상품 라벨에서 확인했습니다.</label>
      <label><span>공식 셀러오피스에서 확인한 판매자 ID</span><input autoComplete="off" value={sellerAccount} onChange={event => { setSellerAccount(event.target.value); setSellerConfirmedAt(""); }} /></label>
      <label><input type="checkbox" checked={Boolean(sellerConfirmedAt)} onChange={event => setSellerConfirmedAt(event.target.checked ? new Date().toISOString() : "")} />위 판매자 ID로 로그인한 셀러오피스 계정이 맞습니다.</label>
      <label><input type="checkbox" checked={Boolean(availableConfirmedAt)} onChange={event => setAvailableConfirmedAt(event.target.checked ? new Date().toISOString() : "")} />지금 공식 셀러오피스와 점검 공지를 확인했으며, 상품 등록이 가능한 상태이고 점검 중이 아닙니다.</label>
      <label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />상품 고시 10개와 배송·반품 정책을 확인했으며, 이 내용을 판매자 확인 정보로 승인합니다.</label>
    </fieldset>
    {values.problems.length > 0 && <p role="alert">먼저 입력해 주세요: {values.problems.join(" · ")}</p>}
    <button type="button" className="credential-secondary" disabled={props.disabled || busy || readingLabels || !labelEvidence || !labelConfirmed || values.problems.length > 0 || !reviewed || !sellerAccount.trim() || !sellerConfirmedAt || !availableConfirmedAt || approvedFor === confirmation} onClick={() => void approve()}>{busy ? "저장 및 승인 확인 중…" : approvedFor === confirmation ? "11번가 등록 정보 승인됨" : "11번가 등록 정보 승인"}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
