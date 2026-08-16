"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  DatabaseZap,
  EyeOff,
  History,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";

type Credential = {
  id: string;
  channel: "qoo10" | "shopee" | "lazada";
  environment: "sandbox" | "production";
  version: number;
  fingerprint: string;
  status: "active" | "grace" | "revoked" | "invalid";
  expires_at: string | null;
  rotation_interval_days: number;
  warning_days: number;
  grace_ends_at: string | null;
  last_rotated_at: string;
  last_checked_at: string | null;
  last_check_status: "passed" | "failed" | "manual" | null;
  last_check_message: string | null;
  created_at: string;
};

type AuditRow = {
  id: number;
  channel: string;
  environment: string;
  action: string;
  safe_detail: Record<string, unknown>;
  occurred_at: string;
};

type ChannelDefinition = {
  key: Credential["channel"];
  code: string;
  name: string;
  market: string;
  consolePolicy: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
};

const channelDefinitions: ChannelDefinition[] = [
  {
    key: "qoo10", code: "Q", name: "Qoo10 Japan", market: "Japan · QAPI", consolePolicy: "만료 표시 없음 · 내부 교체 주기 권장",
    fields: [
      { key: "seller_id", label: "Seller ID", placeholder: "판매자 ID" },
      { key: "api_key", label: "QAPI Key", secret: true, placeholder: "새 QAPI 키" },
      { key: "test_item_code", label: "테스트 상품번호", placeholder: "승인된 읽기 검사 상품" },
    ],
  },
  {
    key: "shopee", code: "S", name: "Shopee Open Platform", market: "Singapore · Production", consolePolicy: "현재 콘솔 키 만료 관찰일 2026.09.15",
    fields: [
      { key: "partner_id", label: "Partner ID", placeholder: "숫자 Partner ID" },
      { key: "partner_key", label: "Partner Key", secret: true, placeholder: "새 Partner Key" },
      { key: "shop_id", label: "Shop ID", placeholder: "숫자 Shop ID" },
      { key: "access_token", label: "Access Token", secret: true, placeholder: "판매점 Access Token" },
      { key: "refresh_token", label: "Refresh Token", secret: true, placeholder: "선택 입력" },
    ],
  },
  {
    key: "lazada", code: "L", name: "Lazada Open Platform", market: "Malaysia · Production", consolePolicy: "Access 30일 · Refresh 180일",
    fields: [
      { key: "app_key", label: "App Key", placeholder: "Lazada App Key" },
      { key: "app_secret", label: "App Secret", secret: true, placeholder: "새 App Secret" },
      { key: "access_token", label: "Access Token", secret: true, placeholder: "판매자 Access Token" },
      { key: "refresh_token", label: "Refresh Token", secret: true, placeholder: "판매자 Refresh Token" },
      { key: "country", label: "국가 코드", placeholder: "my" },
    ],
  },
];

const actionLabels: Record<string, string> = {
  created: "최초 등록", rotated: "키 교체", schedule_updated: "일정 변경", tested: "연결 검사", revoked: "폐기", restored: "복원",
};

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "미설정";
  return new Intl.DateTimeFormat("ko-KR", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(value));
}

function remainingDays(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function expiryTone(days: number | null, warningDays: number) {
  if (days === null) return "neutral";
  if (days <= 7) return "danger";
  if (days <= warningDays) return "warning";
  return "success";
}

export function ApiCredentialCenter({ notify }: { notify: (message: string) => void }) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ChannelDefinition | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [testingId, setTestingId] = useState("");

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("Supabase 운영 환경 연결값이 아직 배포되지 않았습니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
      setLoading(false);
      return;
    }
    const [{ data, error: listError }, { data: auditData, error: auditError }] = await Promise.all([
      supabase.rpc("sellerpilot_list_credentials"),
      supabase.rpc("sellerpilot_list_credential_audit", { p_limit: 80 }),
    ]);
    if (listError) setError(listError.message.includes("administrator") ? "이 계정에 키 관리 관리자 권한이 없습니다." : "키 메타데이터를 불러오지 못했습니다.");
    else {
      setCredentials((data ?? []) as Credential[]);
      setError("");
    }
    if (!auditError) setAudits((auditData ?? []) as AuditRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const activeByChannel = useMemo(() => {
    const result = new Map<Credential["channel"], Credential>();
    for (const channel of channelDefinitions) {
      const active = credentials.find((item) => item.channel === channel.key && item.environment === "production" && item.status === "active")
        ?? credentials.find((item) => item.channel === channel.key && item.status === "active");
      if (active) result.set(channel.key, active);
    }
    return result;
  }, [credentials]);
  const expiringCount = [...activeByChannel.values()].filter((item) => {
    const days = remainingDays(item.expires_at);
    return days !== null && days <= item.warning_days;
  }).length;

  const testConnection = async (credential: Credential) => {
    setTestingId(credential.id);
    const { data: sessionData } = await createClient().auth.getSession();
    const response = await fetch("/api/admin/channel-credentials/test", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
      body: JSON.stringify({ credentialId: credential.id, channel: credential.channel }),
    });
    const payload = await response.json().catch(() => ({ message: "연결 검사 응답을 읽지 못했습니다." })) as { message: string };
    notify(payload.message);
    setTestingId("");
    await load();
  };

  return (
    <div className="page-stack credential-page">
      <section className="credential-hero">
        <div><span><ShieldCheck size={14} /> SECURE CONNECTION CONTROL</span><h2>API 키는 숨기고,<br /><em>수명과 교체 흐름은 선명하게.</em></h2><p>키 원문은 Supabase Vault에 암호화 저장됩니다. 운영 화면은 지문·버전·만료·검사 결과만 다루며 저장 후에는 원문을 다시 보여주지 않습니다.</p></div>
        <aside><LockKeyhole size={21} /><b>브라우저 원문 재조회 차단</b><small>관리자 로그인 · 새 키 일회성 입력 · 서버 검사 · 감사기록</small></aside>
      </section>

      <section className="credential-system-strip">
        <article><DatabaseZap size={18} /><span><small>비밀 저장소</small><b>Supabase Vault</b><em className={isSupabaseConfigured ? "ok" : "bad"}>{isSupabaseConfigured ? "환경 연결" : "미연결"}</em></span></article>
        <article><ServerCog size={18} /><span><small>운영 배포</small><b>sellerpilot-global</b><em className="ok">Vercel Production</em></span></article>
        <article><KeyRound size={18} /><span><small>활성 채널 키</small><b>{activeByChannel.size} / 3</b><em>{loading ? "확인 중" : "Vault 메타데이터"}</em></span></article>
        <article className={expiringCount ? "attention" : ""}><CalendarClock size={18} /><span><small>교체 경고</small><b>{expiringCount}건</b><em>{expiringCount ? "일정 확인 필요" : "현재 없음"}</em></span></article>
      </section>

      {error && <div className="credential-alert"><AlertTriangle size={16} /><span><b>연결 설정 확인</b>{error}</span><button onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></div>}

      <section className="credential-channel-grid">
        {channelDefinitions.map((channel) => {
          const credential = activeByChannel.get(channel.key);
          const graceCredential = credential
            ? credentials.find((item) => item.channel === channel.key && item.environment === credential.environment && item.status === "grace")
            : undefined;
          const days = remainingDays(credential?.expires_at ?? null);
          const tone = expiryTone(days, credential?.warning_days ?? 30);
          return <article className={`credential-card ${channel.key}`} key={channel.key}>
            <header><span className="credential-channel-code">{channel.code}</span><div><small>{channel.market}</small><h3>{channel.name}</h3></div><span className={`connection-state ${credential ? "connected" : "empty"}`}><i />{credential ? "키 등록됨" : "등록 필요"}</span></header>
            <div className="credential-policy"><Clock3 size={13} />{channel.consolePolicy}</div>
            <div className="credential-lifecycle">
              <div><small>활성 버전</small><b>{credential ? `v${credential.version}` : "—"}</b><em>{credential ? `지문 ${credential.fingerprint}` : "Vault 대기"}</em></div>
              <div><small>만료일</small><b>{credential ? formatDate(credential.expires_at) : "미설정"}</b><em className={tone}>{days === null ? "일정 입력 필요" : days < 0 ? `${Math.abs(days)}일 경과` : `${days}일 남음`}</em></div>
              <div><small>자동 경고</small><b>{credential ? `${credential.warning_days}일 전` : "30일 전"}</b><em>{credential ? `${credential.rotation_interval_days}일 교체 주기` : "등록 시 변경 가능"}</em></div>
              <div><small>최근 연결 검사</small><b>{credential?.last_check_status === "passed" ? "정상" : credential?.last_check_status === "failed" ? "실패" : credential?.last_check_status === "manual" ? "수동 확인" : "미실행"}</b><em>{formatDate(credential?.last_checked_at ?? null, true)}</em></div>
            </div>
            {credential?.last_check_message && <p className={`last-check ${credential.last_check_status}`}>{credential.last_check_status === "passed" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{credential.last_check_message}</p>}
            {graceCredential && <p className="credential-grace"><RotateCcw size={13} /><span><b>이전 v{graceCredential.version} 롤백 유예</b>{formatDate(graceCredential.grace_ends_at, true)}까지 Vault 보관</span></p>}
            <footer><button className="credential-secondary" onClick={() => credential && void testConnection(credential)} disabled={!credential || testingId === credential.id}>{testingId === credential?.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}연결 검사</button><button className="credential-primary" onClick={() => setEditing(channel)}><RotateCcw size={14} />{credential ? "키 교체" : "키 등록"}</button></footer>
          </article>;
        })}
      </section>

      <section className="panel credential-history-panel">
        <div className="panel-heading"><div><span className="panel-kicker">ROTATION AUDIT</span><h3>최근 키 관리 기록</h3></div><button className="filter-button" onClick={() => setShowAudit((current) => !current)}><History size={14} />{showAudit ? "접기" : "전체 기록"}<ChevronDown size={13} /></button></div>
        <div className="credential-history-list">{(showAudit ? audits : audits.slice(0, 5)).map((row) => <div key={row.id}><span className={`audit-action ${row.action}`}>{actionLabels[row.action] ?? row.action}</span><b>{channelDefinitions.find((channel) => channel.key === row.channel)?.name ?? row.channel}</b><small>{row.environment === "production" ? "운영" : "샌드박스"}</small><em>{formatDate(row.occurred_at, true)}</em></div>)}{!audits.length && <p>아직 키 관리 기록이 없습니다. 첫 키를 등록하면 모든 변경이 이곳에 남습니다.</p>}</div>
      </section>

      {editing && <CredentialEditor channel={editing} current={activeByChannel.get(editing.key)} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); notify(message); await load(); }} />}
    </div>
  );
}

function CredentialEditor({ channel, current, onClose, onSaved }: { channel: ChannelDefinition; current?: Credential; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const defaultExpiry = current?.expires_at ? current.expires_at.slice(0, 10) : "";
  const [form, setForm] = useState<Record<string, string>>({ country: channel.key === "lazada" ? "my" : "" });
  const [environment, setEnvironment] = useState<"sandbox" | "production">(current?.environment ?? "production");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [rotationDays, setRotationDays] = useState(String(current?.rotation_interval_days ?? (channel.key === "lazada" ? 30 : 90)));
  const [warningDays, setWarningDays] = useState(String(current?.warning_days ?? (channel.key === "lazada" ? 14 : 30)));
  const [graceDays, setGraceDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const requiredMissing = channel.fields.filter((field) => !field.placeholder?.includes("선택") && !form[field.key]?.trim());
    if (requiredMissing.length) {
      setError(`${requiredMissing.map((field) => field.label).join(" · ")} 입력이 필요합니다.`);
      return;
    }
    setSaving(true);
    setError("");
    const secretPayload = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
    const { error: rotateError } = await createClient().rpc("sellerpilot_rotate_credential", {
      p_channel: channel.key,
      p_environment: environment,
      p_secret_payload: secretPayload,
      p_expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59+09:00`).toISOString() : null,
      p_rotation_interval_days: Number(rotationDays),
      p_warning_days: Number(warningDays),
      p_grace_days: current ? Number(graceDays) : 0,
    });
    setSaving(false);
    if (rotateError) {
      setError(rotateError.message.includes("administrator") ? "관리자 권한이 필요합니다." : "키를 저장하지 못했습니다. 입력값과 Vault 연결을 확인해 주세요.");
      return;
    }
    await onSaved(`${channel.name} ${current ? "키 교체" : "키 등록"}가 완료됐습니다. 원문은 Vault에만 보관됩니다.`);
  };

  return <div className="credential-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="credential-modal" role="dialog" aria-modal="true" aria-label={`${channel.name} 키 ${current ? "교체" : "등록"}`} onSubmit={submit}>
    <header><div><span>{channel.code}</span><div><small>ONE-TIME SECRET INPUT</small><h3>{channel.name} {current ? "키 교체" : "키 등록"}</h3></div></div><button type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button></header>
    <div className="secret-warning"><EyeOff size={17} /><span><b>기존 키는 표시하거나 자동 입력하지 않습니다.</b><small>새 값을 저장하면 원문은 즉시 Vault로 이동하고 이 화면에서는 폐기됩니다.</small></span></div>
    <div className="credential-form-grid">{channel.fields.map((field) => <label key={field.key}><span>{field.label}{!field.placeholder?.includes("선택") && <em>필수</em>}</span><div className="credential-input"><input type={field.secret ? "password" : "text"} value={form[field.key] ?? ""} onChange={(event) => setForm((currentForm) => ({ ...currentForm, [field.key]: event.target.value }))} placeholder={field.placeholder} autoComplete="off" />{field.secret && <LockKeyhole size={14} />}</div></label>)}</div>
    <section className="rotation-settings"><h4><CalendarClock size={15} />키 수명 · 교체 일정</h4><div><label><span>환경</span><select value={environment} onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}><option value="production">운영 Production</option><option value="sandbox">샌드박스</option></select></label><label><span>만료일</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label><span>교체 주기</span><select value={rotationDays} onChange={(event) => setRotationDays(event.target.value)}><option value="30">30일</option><option value="60">60일</option><option value="90">90일</option><option value="180">180일</option></select></label><label><span>만료 경고</span><select value={warningDays} onChange={(event) => setWarningDays(event.target.value)}><option value="7">7일 전</option><option value="14">14일 전</option><option value="30">30일 전</option><option value="60">60일 전</option></select></label>{current && <label><span>이전 키 유예</span><select value={graceDays} onChange={(event) => setGraceDays(event.target.value)}><option value="0">즉시 폐기</option><option value="3">3일</option><option value="7">7일</option><option value="14">14일</option></select></label>}</div></section>
    {error && <p className="credential-form-error"><AlertTriangle size={14} />{error}</p>}
    <footer><button type="button" className="credential-secondary" onClick={onClose}>취소</button><button type="submit" className="credential-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}Vault에 안전하게 저장</button></footer>
  </form></div>;
}
