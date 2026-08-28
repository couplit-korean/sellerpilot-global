"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  MessageCircleMore,
  Radio,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import {
  activeChannelKeys,
  capabilityLabels,
  channelCatalog,
  isActiveChannelKey,
  type ChannelCapabilityKey,
} from "../lib/channels/catalog";
import { channels } from "./channel-config";
import {
  channelReadiness,
  channelReadinessObservedAt,
  integrationGates,
  qoo10RegistrationMap,
  resolveChannelGatewayActivity,
  resolveChannelReadiness,
  type ReadinessState,
} from "./channel-readiness-data";
import { channelCapabilityReleasePresentation } from "../lib/channels/operation-availability";
import type { OperationsSnapshot } from "./use-operations-snapshot";

const stateLabels: Record<ReadinessState, string> = {
  verified: "확인 완료",
  partial: "일부 준비",
  blocked: "차단 요인",
  not_configured: "미구성",
};

function safeSyncErrorMessage(value: string | null) {
  if (!value) return "";
  const printable = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, 180);
}

function ReadinessBadge({ state }: { state: ReadinessState }) {
  const Icon = state === "verified" ? CheckCircle2 : state === "blocked" ? AlertTriangle : state === "partial" ? Clock3 : CircleDashed;
  return <span className={`readiness-badge ${state}`}><Icon size={12} />{stateLabels[state]}</span>;
}

export function ChannelReadinessPage({ embedded = false, channelMetrics = [], syncStatus = [], onOpenCs }: {
  embedded?: boolean;
  channelMetrics?: OperationsSnapshot["channelMetrics"];
  syncStatus?: OperationsSnapshot["syncStatus"];
  onOpenCs?: (channel: OperationsSnapshot["channelMetrics"][number]["channelKey"]) => void;
}) {
  const capabilityKeys = Object.keys(capabilityLabels) as ChannelCapabilityKey[];
  const resolvedReadiness = channelReadiness.map((channel) => resolveChannelReadiness(
    channel,
    channelMetrics.find((metric) => metric.channelKey === channel.key),
    resolveChannelGatewayActivity(channel.key, syncStatus),
  ));
  const consoleVerifiedChannels = resolvedReadiness.filter((channel) => channel.consoleVerified);
  const hasLiveMetrics = channelMetrics.length > 0;
  const registeredCredentials = hasLiveMetrics
    ? channelMetrics.filter((metric) => metric.credentialStatus !== "missing").length
    : resolvedReadiness.filter((channel) => channel.apiReadPassed).length;
  const apiReadPassed = resolvedReadiness.filter((channel) => channel.apiReadPassed).length;
  const verifiedChecks = resolvedReadiness.flatMap((channel) => channel.checks).filter((check) => check.state === "verified").length;
  const blockerCount = resolvedReadiness.reduce((total, channel) => total + channel.blockers.length, 0);

  return (
    <div className="page-stack readiness-page">
      {!embedded && <section className="readiness-hero">
        <div>
          <span className="readiness-eyebrow"><Radio size={14} /> LAST CONSOLE SNAPSHOT · {channelReadinessObservedAt} · LIVE DB MERGED</span>
          <h2>로그인됐다는 사실과<br /><em>API가 작동한다는 증거를 분리합니다.</em></h2>
          <p>운영 대상 {resolvedReadiness.length}개 판매채널의 마지막 콘솔 스냅샷과 현재 Vault·인증 키 읽기·주문/문의 게이트웨이 상태를 분리해 병합합니다. 과거 심사 결과는 날짜가 붙은 이력으로만 표시하며 현재 운영 DB 근거를 덮어쓰지 않습니다.</p>
        </div>
        <aside>
          <ShieldCheck size={20} />
          <span><b>보안 원칙</b><small>앱 키·시크릿·파트너 ID·IP는 서버 비밀 참조로만 연결하고 화면과 로그에서 마스킹합니다.</small></span>
        </aside>
      </section>}

      <section className="readiness-summary" aria-label="채널 연동 준비 상태 요약">
        <article><span>판매채널 실콘솔</span><strong>{consoleVerifiedChannels.length} / {resolvedReadiness.length}</strong><small>{channelReadinessObservedAt} 마지막 스냅샷</small></article>
        <article><span>Vault 운영 키</span><strong>{registeredCredentials} / {resolvedReadiness.length}</strong><small>현재 운영 DB 실시간 집계</small></article>
        <article><span>확인된 근거</span><strong>{verifiedChecks}</strong><small>문서·코드·화면 증거</small></article>
        <article className="warning"><span>현재 차단 요인</span><strong>{blockerCount}</strong><small>키·승인·고정 IP·Partner 앱</small></article>
        <article className="danger"><span>인증 키 읽기 통과</span><strong>{apiReadPassed} / {resolvedReadiness.length}</strong><small>게이트웨이 진행·조정 상태와 별도 판정</small></article>
      </section>

      <section className="readiness-channel-grid">
        {resolvedReadiness.map((channel) => {
          const apiDefinition = isActiveChannelKey(channel.key) ? channelCatalog[channel.key] : null;
          const officialDocs = channel.officialDocs ?? apiDefinition?.officialDocs ?? [];
          const liveMetric = channelMetrics.find((metric) => metric.channelKey === channel.key);
          const inquiryState = syncStatus
            .filter((item) => item.channel_key === channel.key && item.data_type === "inquiries")
            .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ?? null;
          return <article className={`readiness-channel-card ${channel.key}`} key={channel.key}>
            <header>
              <span className="readiness-channel-mark">{channels[channel.key].mark}</span>
              <div><small>{channel.console}</small><h3>{channel.name}</h3><p>{channel.market}</p></div>
              <ReadinessBadge state={channel.overall} />
            </header>
            <div className={`readiness-app-state ${liveMetric ? "live" : ""}`}><i />{channel.appState}</div>
            <div className={`readiness-inquiry-state ${inquiryState?.status ?? "never"}`}><MessageCircleMore size={13} /><span><b>문의 동기화</b><small>{inquiryState ? `${inquiryState.status} · 원장 ${inquiryState.imported_count ?? 0}건${safeSyncErrorMessage(inquiryState.last_error) ? ` · ${safeSyncErrorMessage(inquiryState.last_error)}` : ""}` : "실행 기록 없음"}</small></span>{isActiveChannelKey(channel.key) && onOpenCs ? <button type="button" onClick={() => onOpenCs(channel.key)}>문의함 열기<ArrowRight size={12} /></button> : null}</div>
            <p className="readiness-channel-summary">{channel.summary}</p>
            <div className="readiness-doc-links">{officialDocs.map((doc) => <a href={doc.url} target="_blank" rel="noreferrer" key={doc.url}>{doc.label}<ExternalLink size={11} /></a>)}</div>
            <div className="readiness-checks">
              {channel.checks.map((check) => (
                <div key={check.label}>
                  <span><b>{check.label}</b><small>{check.evidence}</small></span>
                  <ReadinessBadge state={check.state} />
                </div>
              ))}
            </div>
            <div className="readiness-blockers">
              <span><AlertTriangle size={13} /> 개발 전 해소</span>
              <ul>{channel.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
            <footer><span>다음 검수 흐름</span><p>{channel.nextAction}</p></footer>
          </article>;
        })}
      </section>

      <section className="panel channel-capability-panel">
        <div className="panel-heading">
          <div><span className="panel-kicker">CHANNEL CAPABILITY ROUTING</span><h3>채널별 지원 방식 · 대체 흐름</h3></div>
          <span className="field-map-proof"><ShieldCheck size={14} />공식 문서 기준</span>
        </div>
        <p className="capability-intro">공식 문서에 API가 있어도 현재 원격 식별·재조회·권한 검증이 끝나지 않은 기능은 출시 차단으로 표시합니다. 실제 실행 화면과 같은 release gate를 사용합니다.</p>
        <div className="table-wrap capability-table-wrap">
          <table className="capability-table">
            <thead><tr><th>기능</th>{activeChannelKeys.map((key) => <th key={key}>{channelCatalog[key].name}</th>)}</tr></thead>
            <tbody>{capabilityKeys.map((capability) => <tr key={capability}><td><b>{capabilityLabels[capability]}</b></td>{activeChannelKeys.map((key) => {
              const item = channelCapabilityReleasePresentation(key, capability);
              return <td key={key}><span className={`capability-mode ${item.mode}`}>{item.label}</span><small>{item.note}</small></td>;
            })}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel qoo10-field-map">
        <div className="panel-heading">
          <div><span className="panel-kicker">QOO10 ACTUAL REGISTRATION SCHEMA</span><h3>QSM 개별 상품등록 필드 맵</h3></div>
          <span className="field-map-proof"><ClipboardCheck size={14} />실계정 화면 확인</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>입력 그룹</th><th>실제 필드</th><th>SellerPilot 사전검사</th></tr></thead>
            <tbody>{qoo10RegistrationMap.map((row) => <tr key={row.group}><td><b>{row.group}</b></td><td>{row.fields}</td><td>{row.rule}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="qoo10-image-rule">
          <span><b>대표 이미지</b><em>정확히 1장 필수</em><small>권장 800×800 · 최소 600×600</small></span>
          <span><b>추가 이미지</b><em>최대 50장</em><small>드래그 순서변경 · URL 업로드 지원</small></span>
          <span><b>상품 동영상</b><em>최대 1개</em><small>MP4 · 50MB 이하</small></span>
          <span><b>상세 이미지</b><em>합계 40MB</em><small>권장폭 820px · 개별 1MB 이하</small></span>
        </div>
      </section>

      <section className="panel integration-gate-panel">
        <div className="panel-heading">
          <div><span className="panel-kicker">PRODUCTION CONNECTION GATES</span><h3>채널별로 동일하게 통과해야 하는 5단계</h3></div>
          <span className="gate-zero"><LockKeyhole size={14} />채널별 Gate 01 대기</span>
        </div>
        <div className="integration-gate-list">
          {integrationGates.map((gate, index) => (
            <article key={gate.gate}>
              <span>{gate.gate}</span>
              <div><b>{gate.title}</b><p>{gate.description}</p></div>
              <em>{gate.state}</em>
              {index < integrationGates.length - 1 && <ArrowRight size={15} />}
            </article>
          ))}
        </div>
      </section>

      <section className="readiness-security-note">
        <KeyRound size={18} />
        <div><b>실제 연결은 Vault 저장과 채널별 읽기 진단이 모두 통과한 뒤 완료로 판정합니다.</b><p>브라우저 로그인이나 OAuth 승인 코드 수신만으로 완료 처리하지 않습니다. HMAC·OAuth·판매자키 검사를 통과한 뒤 테스트상품 쓰기와 주문 동기화를 단계적으로 승인합니다.</p></div>
        <ServerCog size={22} />
      </section>
    </div>
  );
}
