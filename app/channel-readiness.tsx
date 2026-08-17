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
  Radio,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import {
  activeChannelKeys,
  capabilityLabels,
  capabilityModeLabels,
  channelCatalog,
  type ChannelCapabilityKey,
} from "../lib/channels/catalog";
import {
  channelReadiness,
  channelReadinessObservedAt,
  integrationGates,
  qoo10RegistrationMap,
  type ReadinessState,
} from "./channel-readiness-data";

const stateLabels: Record<ReadinessState, string> = {
  verified: "확인 완료",
  partial: "일부 준비",
  blocked: "차단 요인",
  not_configured: "미구성",
};

function ReadinessBadge({ state }: { state: ReadinessState }) {
  const Icon = state === "verified" ? CheckCircle2 : state === "blocked" ? AlertTriangle : state === "partial" ? Clock3 : CircleDashed;
  return <span className={`readiness-badge ${state}`}><Icon size={12} />{stateLabels[state]}</span>;
}

export function ChannelReadinessPage() {
  const capabilityKeys = Object.keys(capabilityLabels) as ChannelCapabilityKey[];
  const onlineApps = channelReadiness.filter((channel) => channel.appState.includes("Online")).length;
  const verifiedChecks = channelReadiness.flatMap((channel) => channel.checks).filter((check) => check.state === "verified").length;
  const blockerCount = channelReadiness.reduce((total, channel) => total + channel.blockers.length, 0);

  return (
    <div className="page-stack readiness-page">
      <section className="readiness-hero">
        <div>
          <span className="readiness-eyebrow"><Radio size={14} /> READ-ONLY ACCOUNT INSPECTION · {channelReadinessObservedAt}</span>
          <h2>로그인됐다는 사실과<br /><em>API가 작동한다는 증거를 분리합니다.</em></h2>
          <p>6개 활성 판매채널의 공식 문서 구현 상태와 실제 콘솔 확인 상태를 분리했습니다. 자격증명 원문·일회성 코드는 저장하지 않고, 키가 없는 채널은 실계정 통과로 표시하지 않습니다.</p>
        </div>
        <aside>
          <ShieldCheck size={20} />
          <span><b>보안 원칙</b><small>앱 키·시크릿·파트너 ID·IP는 서버 비밀 참조로만 연결하고 화면과 로그에서 마스킹합니다.</small></span>
        </aside>
      </section>

      <section className="readiness-summary" aria-label="채널 연동 준비 상태 요약">
        <article><span>실콘솔 확인</span><strong>2 / 6</strong><small>Qoo10 · Lazada</small></article>
        <article><span>대상 Online 앱</span><strong>{onlineApps} / 1</strong><small>Lazada 운영 앱</small></article>
        <article><span>확인된 근거</span><strong>{verifiedChecks}</strong><small>문서·코드·화면 증거</small></article>
        <article className="warning"><span>현재 차단 요인</span><strong>{blockerCount}</strong><small>키·승인·고정 IP·Partner 앱</small></article>
        <article className="danger"><span>API E2E 통과</span><strong>0 / 6</strong><small>실계정 읽기 기준</small></article>
      </section>

      <section className="readiness-channel-grid">
        {channelReadiness.map((channel) => (
          <article className={`readiness-channel-card ${channel.key}`} key={channel.key}>
            <header>
              <span className="readiness-channel-mark">{channel.code}</span>
              <div><small>{channel.console}</small><h3>{channel.name}</h3><p>{channel.market}</p></div>
              <ReadinessBadge state={channel.overall} />
            </header>
            <div className="readiness-app-state"><i />{channel.appState}</div>
            <p className="readiness-channel-summary">{channel.summary}</p>
            <div className="readiness-doc-links">{channelCatalog[channel.key].officialDocs.map((doc) => <a href={doc.url} target="_blank" rel="noreferrer" key={doc.url}>{doc.label}<ExternalLink size={11} /></a>)}</div>
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
          </article>
        ))}
      </section>

      <section className="panel channel-capability-panel">
        <div className="panel-heading">
          <div><span className="panel-kicker">CHANNEL CAPABILITY ROUTING</span><h3>채널별 지원 방식 · 대체 흐름</h3></div>
          <span className="field-map-proof"><ShieldCheck size={14} />공식 문서 기준</span>
        </div>
        <p className="capability-intro">같은 버튼을 무조건 호출하지 않습니다. API·주기조회·웹훅·미지원·문서승인 필요 상태를 먼저 판정하고, 미지원 동작은 해당 채널 콘솔로 안내합니다.</p>
        <div className="table-wrap capability-table-wrap">
          <table className="capability-table">
            <thead><tr><th>기능</th>{activeChannelKeys.map((key) => <th key={key}>{channelCatalog[key].name}</th>)}</tr></thead>
            <tbody>{capabilityKeys.map((capability) => <tr key={capability}><td><b>{capabilityLabels[capability]}</b></td>{activeChannelKeys.map((key) => {
              const item = channelCatalog[key].capabilities[capability];
              return <td key={key}><span className={`capability-mode ${item.mode}`}>{capabilityModeLabels[item.mode]}</span><small>{item.note}</small></td>;
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
