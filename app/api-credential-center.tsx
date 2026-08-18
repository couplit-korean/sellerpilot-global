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
  ShieldCheck,
  Play,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey, type ChannelDefinition } from "../lib/channels/catalog";

type Credential = {
  id: string;
  channel: ActiveChannelKey;
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

type ChannelOperationName =
  | "categories.list"
  | "categories.suggest"
  | "categories.attributes"
  | "categories.validate"
  | "listing.create"
  | "listing.update"
  | "listing.stop"
  | "price.update"
  | "inventory.update"
  | "orders.list"
  | "orders.get"
  | "shipment.acknowledge"
  | "shipment.confirm";

const channelOperationOptions: { value: ChannelOperationName; label: string }[] = [
  { value: "categories.list", label: "카테고리 조회" },
  { value: "categories.suggest", label: "상품명 카테고리 추천" },
  { value: "categories.attributes", label: "필수 속성 조회" },
  { value: "categories.validate", label: "카테고리 유효성 검사" },
  { value: "listing.create", label: "상품 등록" },
  { value: "listing.update", label: "상품 수정" },
  { value: "listing.stop", label: "판매 중지" },
  { value: "price.update", label: "가격 변경" },
  { value: "inventory.update", label: "재고 변경" },
  { value: "orders.list", label: "주문 목록" },
  { value: "orders.get", label: "주문 상세" },
  { value: "shipment.acknowledge", label: "발주 확인" },
  { value: "shipment.confirm", label: "송장·발송 처리" },
];

const writeOperations = new Set<ChannelOperationName>([
  "listing.create", "listing.update", "listing.stop", "price.update", "inventory.update", "shipment.acknowledge", "shipment.confirm",
]);

function operationTemplate(channel: ActiveChannelKey, operation: ChannelOperationName): Record<string, unknown> {
  if (operation === "categories.list") {
    if (channel === "smartstore") return { leafOnly: true };
    if (channel === "ebay") return { categoryTreeId: "0" };
    if (channel === "shopee") return { shopId: "", query: { language: "en" } };
    if (channel === "coupang") return { categoryId: "0" };
    return channel === "qoo10" ? { params: {} } : { query: {} };
  }
  if (operation === "categories.suggest") {
    if (channel === "qoo10") return { query: "상품명", params: {} };
    if (channel === "shopee") return { shopId: "", queryText: "Product name", query: { language: "en" } };
    if (channel === "lazada") return { query: "Product name", queryParams: {} };
    if (channel === "coupang") return { query: "상품명", body: { productDescription: "", brand: "", attributes: {} } };
    if (channel === "smartstore") return { query: "상품명" };
    if (channel === "ebay") return { query: "Product name", marketplaceId: "EBAY_US", categoryTreeId: "" };
    return {};
  }
  if (operation === "categories.attributes" || operation === "categories.validate") {
    if (channel === "qoo10") return { categoryId: "", params: {} };
    if (channel === "shopee") return { shopId: "", categoryId: "", query: { language: "en" } };
    if (channel === "lazada") return { categoryId: "", queryParams: {} };
    if (channel === "coupang" || channel === "smartstore") return { categoryId: "" };
    if (channel === "ebay") return { categoryTreeId: "0", categoryId: "" };
    return {};
  }
  if (operation === "orders.list") {
    if (channel === "qoo10") return { params: {} };
    if (channel === "shopee") return { shopId: "", query: { time_range_field: "create_time", time_from: "", time_to: "", page_size: 50 } };
    if (channel === "lazada") return { query: { created_after: "" } };
    if (channel === "coupang") return { query: { createdAtFrom: "", createdAtTo: "", status: "ACCEPT" } };
    if (channel === "smartstore") return { query: { lastChangedFrom: "" } };
    return { query: { limit: 50 } };
  }
  if (operation === "orders.get") {
    if (channel === "qoo10") return { params: { OrderNo: "" } };
    if (channel === "shopee") return { shopId: "", orderSn: "" };
    if (channel === "lazada") return { orderId: "" };
    if (channel === "coupang") return { shipmentBoxId: "" };
    if (channel === "smartstore") return { productOrderId: "" };
    return { orderId: "" };
  }
  if (operation === "listing.create") {
    if (channel === "qoo10") return { params: { SecondSubCat: "", ItemTitle: "", ItemPrice: "", ItemQty: "", ShippingNo: "", ItemDescription: "" } };
    if (channel === "lazada") return { request: { Product: { PrimaryCategory: "", Attributes: {}, Skus: { Sku: [] } } } };
    if (channel === "shopee") return { shopId: "", body: {} };
    if (channel === "coupang" || channel === "smartstore") return { body: {} };
    return { sku: "", inventoryItem: {}, offer: {}, publish: false };
  }
  if (operation === "listing.update") {
    if (channel === "qoo10") return { params: { ItemCode: "" } };
    if (channel === "lazada") return { request: { Product: {} } };
    if (channel === "shopee") return { shopId: "", body: {} };
    if (channel === "coupang") return { body: {} };
    if (channel === "smartstore") return { originProductNo: "", body: {} };
    return { offerId: "", body: {} };
  }
  if (operation === "listing.stop") {
    if (channel === "qoo10") return { params: { ItemCode: "", Status: "2" } };
    if (channel === "shopee") return { shopId: "", body: { item_list: [] } };
    if (channel === "lazada") return { request: { Request: { Product: {} } } };
    if (channel === "coupang") return { vendorItemId: "" };
    if (channel === "smartstore") return { originProductNo: "", body: {} };
    return { offerId: "" };
  }
  if (operation === "price.update" || operation === "inventory.update") {
    if (channel === "qoo10") return { params: { ItemCode: "", ItemPrice: "", ItemQty: "" } };
    if (channel === "shopee") return { shopId: "", body: { item_id: "", model: [] } };
    if (channel === "lazada") return { request: { Product: { Skus: { Sku: [] } } } };
    if (channel === "coupang") return operation === "price.update" ? { vendorItemId: "", price: 10000, forceSalePriceUpdate: false } : { vendorItemId: "", quantity: 0 };
    if (channel === "smartstore") return operation === "price.update" ? { body: {} } : { originProductNo: "", body: {} };
    return operation === "price.update" ? { offerId: "", body: {} } : { sku: "", body: {} };
  }
  if (operation === "shipment.acknowledge") {
    if (channel === "qoo10") return { params: { OrderNo: "" } };
    if (channel === "shopee") return { shopId: "", query: { order_sn: "" } };
    if (channel === "lazada") return { query: {}, request: {} };
    if (channel === "coupang") return { shipmentBoxIds: [] };
    if (channel === "smartstore") return { body: { productOrderIds: [] } };
    return {};
  }
  if (channel === "qoo10") return { params: { OrderNo: "", ShippingCorp: "", TrackingNo: "" } };
  if (channel === "shopee") return { shopId: "", body: { order_sn: "" } };
  if (channel === "lazada") return { query: {}, request: {} };
  if (channel === "coupang" || channel === "smartstore") return { body: {} };
  return { orderId: "", body: {} };
}

const channelDefinitions: ChannelDefinition[] = activeChannelKeys.map((key) => channelCatalog[key]);

const actionLabels: Record<string, string> = {
  created: "최초 등록", rotated: "키 교체", token_refreshed: "토큰 갱신", schedule_updated: "일정 변경", tested: "연결 검사", revoked: "폐기", restored: "복원",
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
  const [oauthStartingId, setOauthStartingId] = useState("");
  const [pendingOAuth, setPendingOAuth] = useState<{ channelName: string; authorizationUrl: string } | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("SellerPilot 연결 설정을 확인해 주세요.");
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
    if (listError) setError(listError.message.includes("administrator") ? "이 계정에는 채널 연결 관리 권한이 없습니다." : "채널 연결 상태를 불러오지 못했습니다.");
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
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const response = await fetch("/api/admin/channel-credentials/test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ credentialId: credential.id, channel: credential.channel }),
      });
      const payload = await response.json().catch(() => ({ message: "연결 검사 응답을 읽지 못했습니다." })) as { message: string };
      if (!response.ok) throw new Error(payload.message);
      notify(payload.message);
      await load();
    } catch (connectionError) {
      notify(connectionError instanceof Error ? connectionError.message : "연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setTestingId("");
    }
  };

  const startOAuth = async (credential: Credential) => {
    setOauthStartingId(credential.id);
    setPendingOAuth(null);
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const response = await fetch(`/api/admin/channel-credentials/${credential.channel}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
        body: JSON.stringify({
          credentialId: credential.id,
          environment: credential.environment,
          secretPayload: {},
          startOAuth: true,
        }),
      });
      const payload = await response.json().catch(() => ({ message: `${channelCatalog[credential.channel].name} OAuth 응답을 읽지 못했습니다.` })) as { message: string; authorizationUrl?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message);
      setError("");
      setPendingOAuth({ channelName: channelCatalog[credential.channel].name, authorizationUrl: payload.authorizationUrl });
      notify(`${channelCatalog[credential.channel].name} 판매자 승인 링크를 준비했습니다.`);
    } catch (oauthError) {
      const message = oauthError instanceof Error ? oauthError.message : "판매 채널 OAuth를 시작하지 못했습니다.";
      setError(message);
      notify(message);
    } finally {
      setOauthStartingId("");
    }
  };

  return (
    <div className="page-stack credential-page">
      <section className="credential-hero">
        <div><span><ShieldCheck size={14} /> 판매 채널 연결</span><h2>판매 채널을 안전하게 연결하고<br /><em>한곳에서 관리하세요.</em></h2><p>연결 상태와 만료 일정을 확인하고, 필요한 경우 판매 채널을 다시 연결할 수 있습니다.</p></div>
        <aside><LockKeyhole size={21} /><b>연결 정보 안전 보호</b><small>중요한 정보는 암호화되며 저장 후 다시 표시되지 않습니다.</small></aside>
      </section>

      <section className="credential-system-strip">
        <article><DatabaseZap size={18} /><span><small>연결 정보 보호</small><b>안전하게 저장</b><em className={isSupabaseConfigured ? "ok" : "bad"}>{isSupabaseConfigured ? "정상" : "확인 필요"}</em></span></article>
        <article><KeyRound size={18} /><span><small>연결된 채널</small><b>{activeByChannel.size} / {channelDefinitions.length}</b><em>{loading ? "확인 중" : "현재 상태"}</em></span></article>
        <article className={expiringCount ? "attention" : ""}><CalendarClock size={18} /><span><small>갱신 필요</small><b>{expiringCount}건</b><em>{expiringCount ? "일정을 확인해 주세요" : "현재 없음"}</em></span></article>
      </section>

      {error && <div className="credential-alert"><AlertTriangle size={16} /><span><b>연결 설정 확인</b>{error}</span><button onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></div>}
      {pendingOAuth && <div className="credential-alert"><KeyRound size={16} /><span><b>{pendingOAuth.channelName} 판매자 승인 준비 완료</b>승인 화면에서 로그인하고 연결을 허용해 주세요.</span><button onClick={() => window.location.assign(pendingOAuth.authorizationUrl)}><KeyRound size={14} />판매자 승인 화면 열기</button><button aria-label="승인 링크 닫기" onClick={() => setPendingOAuth(null)}><X size={14} /></button></div>}

      <section className="credential-channel-grid">
        {channelDefinitions.map((channel) => {
          const credential = activeByChannel.get(channel.key);
          const graceCredential = credential
            ? credentials.find((item) => item.channel === channel.key && item.environment === credential.environment && item.status === "grace")
            : undefined;
          const days = remainingDays(credential?.expires_at ?? null);
          const tone = expiryTone(days, credential?.warning_days ?? 30);
          return <article className={`credential-card ${channel.key}`} key={channel.key}>
            <header><span className="credential-channel-code">{channel.code}</span><div><small>{channel.market}</small><h3>{channel.name}</h3></div><span className={`connection-state ${credential ? "connected" : "empty"}`}><i />{credential ? "연결됨" : "연결 필요"}</span></header>
            <div className="credential-policy"><Clock3 size={13} />{channel.credentialPolicy}</div>
            <div className="credential-source-links">{channel.officialDocs.slice(0, 2).map((doc) => <a href={doc.url} target="_blank" rel="noreferrer" key={doc.url}>{doc.label}</a>)}</div>
            <div className="credential-lifecycle">
              <div><small>만료일</small><b>{credential ? formatDate(credential.expires_at) : "미설정"}</b><em className={tone}>{days === null ? "일정 입력 필요" : days < 0 ? `${Math.abs(days)}일 경과` : `${days}일 남음`}</em></div>
              <div><small>갱신 알림</small><b>{credential ? `${credential.warning_days}일 전` : "30일 전"}</b><em>{credential ? `${credential.rotation_interval_days}일마다 확인` : "연결할 때 설정"}</em></div>
              <div><small>최근 연결 확인</small><b>{credential?.last_check_status === "passed" ? "정상" : credential?.last_check_status === "failed" ? "확인 필요" : credential?.last_check_status === "manual" ? "직접 확인" : "확인 전"}</b><em>{formatDate(credential?.last_checked_at ?? null, true)}</em></div>
            </div>
            {credential?.last_check_message && <p className={`last-check ${credential.last_check_status}`}>{credential.last_check_status === "passed" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{credential.last_check_message}</p>}
            {graceCredential && <p className="credential-grace"><RotateCcw size={13} /><span><b>이전 연결 정보 임시 보관</b>{formatDate(graceCredential.grace_ends_at, true)}까지 복구할 수 있습니다.</span></p>}
            <footer><button className="credential-secondary" onClick={() => credential && void testConnection(credential)} disabled={!credential || testingId === credential.id}>{testingId === credential?.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}연결 확인</button>{channel.oauth && credential && <button className="credential-secondary" onClick={() => void startOAuth(credential)} disabled={oauthStartingId === credential.id}>{oauthStartingId === credential.id ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}다시 연결</button>}<button className="credential-primary" onClick={() => setEditing(channel)}><RotateCcw size={14} />{credential ? "연결 정보 변경" : "연결하기"}</button></footer>
          </article>;
        })}
      </section>

      <section className="panel credential-history-panel">
        <div className="panel-heading"><div><h3>최근 연결 기록</h3></div><button className="filter-button" onClick={() => setShowAudit((current) => !current)}><History size={14} />{showAudit ? "접기" : "전체 기록"}<ChevronDown size={13} /></button></div>
        <div className="credential-history-list">{(showAudit ? audits : audits.slice(0, 5)).map((row) => <div key={row.id}><span className={`audit-action ${row.action}`}>{actionLabels[row.action] ?? row.action}</span><b>{channelDefinitions.find((channel) => channel.key === row.channel)?.name ?? row.channel}</b><small>{row.environment === "production" ? "판매용" : "테스트용"}</small><em>{formatDate(row.occurred_at, true)}</em></div>)}{!audits.length && <p>아직 연결 기록이 없습니다. 채널을 연결하면 변경 내용이 여기에 표시됩니다.</p>}</div>
      </section>

      {editing && <CredentialEditor channel={editing} current={activeByChannel.get(editing.key)} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); notify(message); await load(); }} />}
    </div>
  );
}

function ApiOperationConsole({ target, onClose, onCredentialChanged, notify }: { target: { channel: ChannelDefinition; credential: Credential }; onClose: () => void; onCredentialChanged: () => Promise<void>; notify: (message: string) => void }) {
  const [operation, setOperation] = useState<ChannelOperationName>("categories.list");
  const [argumentsJson, setArgumentsJson] = useState(() => JSON.stringify(operationTemplate(target.channel.key, "categories.list"), null, 2));
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [resultJson, setResultJson] = useState("");
  const isWrite = writeOperations.has(operation);
  const availableOperations = channelOperationOptions.filter((item) => !(target.channel.key === "ebay" && item.value === "shipment.acknowledge"));

  const changeOperation = (nextOperation: ChannelOperationName) => {
    setOperation(nextOperation);
    setArgumentsJson(JSON.stringify(operationTemplate(target.channel.key, nextOperation), null, 2));
    setConfirmWrite(false);
    setResultJson("");
    setError("");
    setIdempotencyKey(crypto.randomUUID());
  };

  const execute = async (event: FormEvent) => {
    event.preventDefault();
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(argumentsJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
      args = parsed as Record<string, unknown>;
    } catch {
      setError("작업 인자는 유효한 JSON 객체여야 합니다.");
      return;
    }
    if (isWrite && !confirmWrite) {
      setError("외부 판매채널을 변경하는 작업입니다. 실행 확인에 동의해 주세요.");
      return;
    }
    setRunning(true);
    setError("");
    setResultJson("");
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const response = await fetch("/api/admin/channel-operations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
        body: JSON.stringify({ credentialId: target.credential.id, channel: target.channel.key, operation, idempotencyKey, confirmWrite, arguments: args }),
      });
      const payload = await response.json().catch(() => ({ message: "판매채널 응답을 읽지 못했습니다." })) as Record<string, unknown>;
      setResultJson(JSON.stringify(payload, null, 2));
      if (!response.ok) setError(typeof payload.message === "string" ? payload.message : `API 실행 실패 · HTTP ${response.status}`);
      else {
        notify(`${target.channel.name} ${channelOperationOptions.find((item) => item.value === operation)?.label ?? operation} 검수가 완료됐습니다.`);
        if (payload.credentialRefreshed === true) {
          await onCredentialChanged();
          onClose();
          return;
        }
        setIdempotencyKey(crypto.randomUUID());
      }
    } catch {
      setError("API 실행 요청을 전송하지 못했습니다. 네트워크와 로그인 세션을 확인해 주세요.");
    } finally {
      setRunning(false);
    }
  };

  return <div className="credential-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="credential-modal operation-console" role="dialog" aria-modal="true" aria-label={`${target.channel.name} API 실행 검수`} onSubmit={execute}>
    <header><div><span>{target.channel.code}</span><div><small>PROTECTED LIVE API CONSOLE</small><h3>{target.channel.name} API 실행 검수</h3></div></div><button type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button></header>
    <div className="operation-console-warning"><ShieldCheck size={18} /><span><b>Vault 키를 브라우저에 노출하지 않고 서버에서만 호출합니다.</b><small>상품·주문 실데이터가 변경될 수 있습니다. 비밀키는 아래 JSON에 입력하지 마세요.</small></span></div>
    <div className="operation-console-body">
      <div className="operation-console-controls"><label><span>실행 작업</span><select value={operation} onChange={(event) => changeOperation(event.target.value as ChannelOperationName)}>{availableOperations.map((item) => <option value={item.value} key={item.value}>{item.label} · {item.value}</option>)}</select></label><label><span>중복 방지 키</span><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} minLength={16} maxLength={160} /></label></div>
      <label className="operation-json-field"><span>채널별 작업 인자 JSON</span><textarea value={argumentsJson} onChange={(event) => setArgumentsJson(event.target.value)} spellCheck={false} rows={13} /></label>
      <div className="operation-console-meta"><a href={target.channel.officialDocs[0]?.url} target="_blank" rel="noreferrer">공식 개발자 문서 열기</a><span>환경 · {target.credential.environment === "production" ? "운영 Production" : "Sandbox"}</span></div>
      {isWrite && <div className="operation-write-confirm"><input id="confirm-channel-write" type="checkbox" checked={confirmWrite} onChange={(event) => setConfirmWrite(event.target.checked)} /><label htmlFor="confirm-channel-write"><b>실제 외부 데이터 변경을 확인했습니다.</b><small>동일한 중복 방지 키로는 다시 실행되지 않습니다.</small></label></div>}
      {error && <p className="credential-form-error"><AlertTriangle size={14} />{error}</p>}
      {resultJson && <pre className="operation-console-result" aria-label="API 실행 결과">{resultJson}</pre>}
    </div>
    <footer><button type="button" className="credential-secondary" onClick={onClose}>닫기</button><button type="submit" className="credential-primary" disabled={running || !idempotencyKey}>{running ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}{isWrite ? "확인 후 실행" : "읽기 실행"}</button></footer>
  </form></div>;
}

// Kept as an internal maintenance tool, but intentionally not exposed in the customer navigation.
void ApiOperationConsole;

function CredentialEditor({ channel, current, onClose, onSaved }: { channel: ChannelDefinition; current?: Credential; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const defaultExpiry = current?.expires_at ? current.expires_at.slice(0, 10) : "";
  const [form, setForm] = useState<Record<string, string>>({
    country: channel.key === "lazada" ? "my" : "",
    market: channel.key === "coupang" ? "KR" : "",
    token_type: channel.key === "smartstore" ? "SELF" : "",
    marketplace_id: channel.key === "ebay" ? "EBAY_US" : "",
  });
  const [environment, setEnvironment] = useState<"sandbox" | "production">(current?.environment ?? "production");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [rotationDays, setRotationDays] = useState(String(current?.rotation_interval_days ?? (channel.key === "shopee" || channel.key === "lazada" ? 30 : channel.key === "coupang" || channel.key === "ebay" ? 180 : 90)));
  const [warningDays, setWarningDays] = useState(String(current?.warning_days ?? (channel.key === "lazada" || channel.key === "coupang" ? 14 : 30)));
  const [graceDays, setGraceDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const requiredMissing = current ? [] : channel.fields.filter((field) => !field.optional && !form[field.key]?.trim());
    if (requiredMissing.length) {
      setError(`${requiredMissing.map((field) => field.label).join(" · ")} 입력이 필요합니다.`);
      return;
    }
    if (channel.key === "smartstore" && !["SELF", "SELLER"].includes((form.token_type || "SELF").trim().toUpperCase())) {
      setError("네이버 인증 유형은 SELF 또는 SELLER여야 합니다.");
      return;
    }
    if (channel.key === "smartstore" && (form.token_type || "SELF").trim().toUpperCase() === "SELLER" && !current && !form.account_id?.trim()) {
      setError("SELLER 인증 유형은 연결된 판매자 ID 또는 UID(account_id)가 필요합니다.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const secretPayload = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
      const expiryIso = expiresAt ? new Date(`${expiresAt}T23:59:59+09:00`).toISOString() : null;
      const { data: sessionData } = await createClient().auth.getSession();
      if (!sessionData.session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const endpoint = channel.oauth
        ? `/api/admin/channel-credentials/${channel.key}/authorize`
        : "/api/admin/channel-credentials/rotate";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ credentialId: current?.id, channel: channel.key, environment, secretPayload, expiresAt: expiryIso, rotationDays: Number(rotationDays), warningDays: Number(warningDays), graceDays: current ? Number(graceDays) : 0, startOAuth: channel.oauth && !current }),
      });
      const payload = await response.json().catch(() => ({ message: `${channel.name} 인증 응답을 읽지 못했습니다.` })) as { message: string; authorizationUrl?: string };
      if (!response.ok) throw new Error(payload.message);
      await onSaved(`${channel.name} ${current ? "연결 정보 변경" : "연결 준비"}가 완료됐습니다. 중요한 정보는 안전하게 보관됩니다.`);
      if (payload.authorizationUrl) window.location.assign(payload.authorizationUrl);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "채널 연결 정보를 저장하지 못했습니다.";
      setError(message.includes("administrator") ? "관리자 권한이 필요합니다." : message);
    } finally {
      setSaving(false);
    }
  };

  return <div className="credential-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><form className="credential-modal" role="dialog" aria-modal="true" aria-label={`${channel.name} ${current ? "연결 정보 변경" : "연결"}`} onSubmit={submit}>
    <header><div><span>{channel.code}</span><div><small>안전한 연결</small><h3>{channel.name} {current ? "연결 정보 변경" : "연결하기"}</h3></div></div><button type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button></header>
    <div className="secret-warning"><EyeOff size={17} /><span><b>기존 연결 정보는 다시 표시하지 않습니다.</b><small>새로 입력한 정보는 암호화해 안전하게 보관합니다.</small></span></div>
    <div className="credential-form-grid">{channel.fields.map((field) => <label key={field.key}><span>{field.label}{!current && !field.optional && <em>필수</em>}</span><div className="credential-input">{field.options ? <select value={form[field.key] ?? field.options[0]?.value ?? ""} onChange={(event) => setForm((currentForm) => ({ ...currentForm, [field.key]: event.target.value }))}>{field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input type={field.secret ? "password" : "text"} value={form[field.key] ?? ""} onChange={(event) => setForm((currentForm) => ({ ...currentForm, [field.key]: event.target.value }))} placeholder={current ? `${field.label} 유지 시 비워두기` : field.placeholder} autoComplete="off" />}{field.secret && <LockKeyhole size={14} />}</div>{field.help && <small className="credential-field-help">{field.help}</small>}</label>)}</div>
    <section className="rotation-settings"><h4><CalendarClock size={15} />연결 갱신 일정</h4><div><label><span>사용 목적</span><select value={environment} onChange={(event) => setEnvironment(event.target.value as "sandbox" | "production")}><option value="production">실제 판매용</option><option value="sandbox">테스트용</option></select></label><label><span>만료일</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label><span>확인 주기</span><select value={rotationDays} onChange={(event) => setRotationDays(event.target.value)}><option value="30">30일</option><option value="60">60일</option><option value="90">90일</option><option value="180">180일</option></select></label><label><span>미리 알림</span><select value={warningDays} onChange={(event) => setWarningDays(event.target.value)}><option value="7">7일 전</option><option value="14">14일 전</option><option value="30">30일 전</option><option value="60">60일 전</option></select></label>{current && <label><span>이전 정보 보관</span><select value={graceDays} onChange={(event) => setGraceDays(event.target.value)}><option value="0">보관하지 않음</option><option value="3">3일</option><option value="7">7일</option><option value="14">14일</option></select></label>}</div></section>
    {error && <p className="credential-form-error"><AlertTriangle size={14} />{error}</p>}
    <footer><button type="button" className="credential-secondary" onClick={onClose}>취소</button><button type="submit" className="credential-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />}안전하게 저장</button></footer>
  </form></div>;
}
