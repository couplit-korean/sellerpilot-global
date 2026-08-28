"use client";

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  RefreshCw,
  ServerCog,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type {
  PlatformProviderState,
  PlatformUsagePayload,
  SupabaseApiUsage,
  VercelServiceUsage,
} from "../lib/platform-usage";
import styles from "./platform-usage-page.module.css";

const providerStateLabel: Record<PlatformProviderState, string> = {
  connected: "연결됨",
  partial: "일부 조회",
  not_configured: "연결 안 됨",
  unavailable: "조회 실패",
};

function formatDate(value: string | null) {
  if (!value) return "확인 전";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "확인 전";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: amount >= 100 ? 0 : 1 }).format(amount)} ${units[unitIndex]}`;
}

function providerIcon(state: PlatformProviderState) {
  if (state === "connected") return <CheckCircle2 size={16} aria-hidden="true" />;
  if (state === "partial") return <AlertCircle size={16} aria-hidden="true" />;
  return <ShieldAlert size={16} aria-hidden="true" />;
}

function VercelServiceRow({ service }: { service: VercelServiceUsage }) {
  return (
    <li className={styles.serviceRow}>
      <span className={styles.serviceIdentity}>
        <b>{service.serviceName}</b>
        <small>
          {service.consumedQuantity === null
            ? "사용 단위 미제공"
            : `${formatCount(service.consumedQuantity)} ${service.consumedUnit ?? "units"}`}
        </small>
      </span>
      <span className={styles.serviceCost}>
        <b>{formatUsd(service.effectiveCostUsd)}</b>
        <small>청구 기준 {formatUsd(service.billedCostUsd)}</small>
      </span>
    </li>
  );
}

function ApiUsageGrid({ usage }: { usage: SupabaseApiUsage }) {
  const rows = [
    ["REST", usage.restRequests],
    ["Auth", usage.authRequests],
    ["Storage", usage.storageRequests],
    ["Realtime", usage.realtimeRequests],
  ] as const;
  return (
    <div className={styles.apiGrid}>
      {rows.map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <b>{formatCount(value)}</b>
        </span>
      ))}
    </div>
  );
}

function ProviderLoadFailure({ provider, message }: { provider: "Vercel" | "Supabase"; message: string }) {
  return (
    <div className={styles.failureBlock} role="alert">
      <ShieldAlert size={18} aria-hidden="true" />
      <span>
        <b>{provider} 사용량을 확인할 수 없습니다.</b>
        <small>{message || "서버 연결 상태를 확인한 뒤 다시 시도해 주세요."}</small>
      </span>
    </div>
  );
}

export function PlatformUsagePage() {
  const [payload, setPayload] = useState<PlatformUsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshSequence, setRefreshSequence] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const { data } = await createClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("플랫폼 사용량을 보려면 다시 로그인해 주세요.");
      const response = await fetch("/api/admin/platform-usage", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal,
      });
      const responsePayload = await response.json().catch(() => null) as (PlatformUsagePayload & { message?: string }) | null;
      if (!response.ok) throw new Error(responsePayload?.message ?? "플랫폼 사용량을 불러오지 못했습니다.");
      if (!responsePayload?.vercel || !responsePayload.supabase || typeof responsePayload.cacheSeconds !== "number") {
        throw new Error("플랫폼 사용량 응답 형식이 올바르지 않습니다.");
      }
      setPayload(responsePayload);
    } catch (loadError) {
      if (signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "플랫폼 사용량을 불러오지 못했습니다.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, refreshSequence]);

  const diskPercent = useMemo(() => {
    const disk = payload?.supabase.disk;
    if (!disk || disk.sizeBytes <= 0) return null;
    return Math.min(100, Math.max(0, disk.usedBytes / disk.sizeBytes * 100));
  }, [payload?.supabase.disk]);

  return (
    <div className={styles.page} aria-busy={loading}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}><ServerCog size={15} aria-hidden="true" /> PLATFORM CAPACITY</span>
          <h2>서버 사용량을<br /><em>과장 없이 한눈에.</em></h2>
          <p>Vercel과 Supabase가 공식 API로 제공하는 값만 표시합니다. 연결되지 않거나 공개 API가 없는 항목은 0으로 만들지 않습니다.</p>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => {
            setLoading(true);
            setError("");
            setPayload(null);
            setRefreshSequence((value) => value + 1);
          }}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? styles.spinning : undefined} aria-hidden="true" />
          {loading ? "확인 중" : "다시 확인"}
        </button>
      </section>

      <div className={styles.notice} role="status" aria-live="polite">
        <Activity size={16} aria-hidden="true" />
        <span>
          {error || (payload
            ? `마지막 서버 조회 ${formatDate(payload.generatedAt)} · 공급자 응답은 ${Math.round(payload.cacheSeconds / 60)}분간 서버에서 재사용됩니다.`
            : "공식 사용량 API를 확인하고 있습니다.")}
        </span>
      </div>

      <div className={styles.providerGrid}>
        <section className={styles.providerCard} aria-labelledby="vercel-usage-heading">
          <header className={styles.providerHeader}>
            <span className={styles.providerMark}><Cloud size={20} aria-hidden="true" /></span>
            <span>
              <small>DEPLOYMENT &amp; COMPUTE</small>
              <h3 id="vercel-usage-heading">Vercel</h3>
            </span>
            {payload ? (
              <span className={`${styles.stateBadge} ${styles[payload.vercel.state]}`}>
                {providerIcon(payload.vercel.state)} {providerStateLabel[payload.vercel.state]}
              </span>
            ) : !loading ? <span className={`${styles.stateBadge} ${styles.unavailable}`}>{providerIcon("unavailable")} 조회 실패</span> : null}
          </header>

          {payload ? (
            <>
              <p className={styles.providerMessage}>{payload.vercel.message}</p>
              <div className={styles.summaryGrid}>
                <span><small>요금제</small><b>{payload.vercel.plan?.toUpperCase() ?? "확인 불가"}</b></span>
                <span><small>연결 대상</small><b title={payload.vercel.targetId ?? undefined}>{payload.vercel.targetId ?? "미설정"}</b></span>
                <span><small>최근 30일 실효 비용</small><b>{payload.vercel.totals ? formatUsd(payload.vercel.totals.effectiveCostUsd) : "—"}</b></span>
                <span><small>청구 기준 비용</small><b>{payload.vercel.totals ? formatUsd(payload.vercel.totals.billedCostUsd) : "—"}</b></span>
                <span><small>공급자 조회</small><b>{formatDate(payload.vercel.fetchedAt)}</b></span>
              </div>
              <div className={styles.sectionTitle}>
                <span><Activity size={15} aria-hidden="true" /> 서비스별 사용량</span>
                <small>공식 FOCUS 사용량·비용</small>
              </div>
              {payload.vercel.services.length > 0 ? (
                <ul className={styles.serviceList}>
                  {payload.vercel.services.map((service) => (
                    <VercelServiceRow key={`${service.serviceName}:${service.consumedUnit ?? ""}`} service={service} />
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyState}>현재 조회 가능한 Vercel 사용량 행이 없습니다.</p>
              )}
              <p className={styles.limitation}>
                Vercel 공식 API는 실제 사용량·비용을 제공하지만 모든 서비스의 계약상 총한도를 함께 제공하지 않습니다. 확인되지 않은 백분율은 표시하지 않습니다.
              </p>
            </>
          ) : loading
            ? <div className={styles.loadingBlock}>Vercel 공식 API 확인 중</div>
            : <ProviderLoadFailure provider="Vercel" message={error} />}
        </section>

        <section className={styles.providerCard} aria-labelledby="supabase-usage-heading">
          <header className={styles.providerHeader}>
            <span className={`${styles.providerMark} ${styles.supabaseMark}`}><Database size={20} aria-hidden="true" /></span>
            <span>
              <small>DATABASE &amp; BACKEND</small>
              <h3 id="supabase-usage-heading">Supabase</h3>
            </span>
            {payload ? (
              <span className={`${styles.stateBadge} ${styles[payload.supabase.state]}`}>
                {providerIcon(payload.supabase.state)} {providerStateLabel[payload.supabase.state]}
              </span>
            ) : !loading ? <span className={`${styles.stateBadge} ${styles.unavailable}`}>{providerIcon("unavailable")} 조회 실패</span> : null}
          </header>

          {payload ? (
            <>
              <p className={styles.providerMessage}>{payload.supabase.message}</p>
              <div className={styles.summaryGrid}>
                <span><small>조직 요금제</small><b>{payload.supabase.plan?.toUpperCase() ?? "확인 불가"}</b></span>
                <span><small>연결 대상</small><b title={payload.supabase.targetId ?? undefined}>{payload.supabase.targetId ?? "미설정"}</b></span>
                <span><small>1일 간격 API 집계</small><b>{payload.supabase.apiUsage ? formatCount(payload.supabase.apiUsage.totalRequests) : "—"}</b></span>
                <span><small>선택 Add-on</small><b>{payload.supabase.selectedAddons.length > 0 ? `${payload.supabase.selectedAddons.length}개` : "없음 또는 확인 불가"}</b></span>
                <span><small>공급자 조회</small><b>{formatDate(payload.supabase.fetchedAt)}</b></span>
              </div>

              {payload.supabase.apiUsage && (
                <>
                  <div className={styles.sectionTitle}><span><Activity size={15} aria-hidden="true" /> 1일 간격 API 구성 · 공급자 반환 범위 합계</span></div>
                  <ApiUsageGrid usage={payload.supabase.apiUsage} />
                </>
              )}

              {payload.supabase.disk && (
                <div className={styles.diskPanel}>
                  <span className={styles.diskHeading}><HardDrive size={16} aria-hidden="true" /><b>DB 파일시스템 사용률</b></span>
                  <span className={styles.diskValues}>
                    <b>{formatBytes(payload.supabase.disk.usedBytes)}</b>
                    <small>/ {formatBytes(payload.supabase.disk.sizeBytes)}</small>
                  </span>
                  <progress value={diskPercent ?? 0} max={100} aria-label="Supabase DB 파일시스템 사용률" />
                  <small>가용 {formatBytes(payload.supabase.disk.availableBytes)} · 과금 quota가 아닌 현재 디스크 사용률입니다.</small>
                </div>
              )}

              {payload.supabase.selectedAddons.length > 0 && (
                <div className={styles.addonPanel}>
                  <div className={styles.sectionTitle}><span><ServerCog size={15} aria-hidden="true" /> 현재 Add-on</span></div>
                  <ul>
                    {payload.supabase.selectedAddons.map((addon) => (
                      <li key={`${addon.type}:${addon.variantId}`}>
                        <span><b>{addon.name}</b><small>{addon.type}</small></span>
                        <b>{formatUsd(addon.price.amount)} / {addon.price.interval === "monthly" ? "월" : "시간"}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.unsupportedPanel}>
                <span><ShieldAlert size={17} aria-hidden="true" /><b>공식 API에서 제공하지 않는 과금 지표</b></span>
                <p>다음 값은 Supabase 조직 Usage 화면과 동일하게 계산할 공개 API가 없어 임의 추정하지 않습니다.</p>
                <ul>
                  {payload.supabase.unsupportedBillingMetrics.map((metric) => <li key={metric}>{metric}</li>)}
                </ul>
              </div>
            </>
          ) : loading
            ? <div className={styles.loadingBlock}>Supabase 공식 API 확인 중</div>
            : <ProviderLoadFailure provider="Supabase" message={error} />}
        </section>
      </div>
    </div>
  );
}
