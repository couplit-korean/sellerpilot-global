"use client";

import { useEffect, useRef, useState } from "react";
import { channelCatalog } from "../../lib/channels/catalog";
import { csCredentialBindingsSchema, type CsCredentialBindings } from "../../lib/cs/credential-bindings";
import styles from "./lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const time = (value: string | null) => value
  ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
  : "관측 없음";
const short = (value: string | null) => value ? value.slice(0, 12) : "미검증";

export function CsCredentialBindings({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [data, setData] = useState<CsCredentialBindings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const load = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/cs/credential-bindings", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const next = csCredentialBindingsSchema.parse(await response.json());
      if (!controller.signal.aborted) setData(next);
    } catch {
      if (!controller.signal.aborted) { setData(null); setError("자격증명 결속을 조회하지 못했습니다."); }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return <details className={`panel ${styles.panel}`}><summary>앱·토큰·Shop 결속 증거</summary>
    <p>로그인 상태와 API 권한을 분리합니다. 지문은 원문 키를 노출하지 않으며, 실제 성공한 CS 작업에 결속된 값만 표시합니다.</p>
    <button type="button" className="filter-button" disabled={loading} onClick={() => void load()}>{loading ? "조회 중…" : "결속 증거 조회"}</button>
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.messages}>{data?.bindings.map((binding, index) => <article key={`${binding.credentialId}:${binding.operation}:${binding.targetFingerprint}:${index}`}><header>
      <strong>{channelCatalog[binding.channel].name} · {binding.operation ?? "성공 호출 미검증"} · {binding.country ?? "국가 미검증"}</strong><span>{binding.bindingStatus}</span>
    </header><dl>
      <div><dt>계정 결속</dt><dd>{binding.sellerAccountBinding} · credential {short(binding.credentialFingerprint)}</dd></div>
      <div><dt>앱/토큰/대상 지문</dt><dd>{short(binding.appFingerprint)} / {short(binding.tokenFingerprint)} / {short(binding.targetFingerprint)}</dd></div>
      <div><dt>자격 상태</dt><dd>{binding.credentialStatus} · 만료 {time(binding.credentialExpiresAt)}</dd></div>
      <div><dt>마지막 성공 결속</dt><dd>{time(binding.verifiedAt)}</dd></div>
    </dl></article>)}</div>
  </details>;
}
