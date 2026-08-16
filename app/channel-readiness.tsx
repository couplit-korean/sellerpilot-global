"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  KeyRound,
  LockKeyhole,
  Radio,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import {
  channelReadiness,
  channelReadinessObservedAt,
  integrationGates,
  qoo10RegistrationMap,
  type ReadinessState,
} from "./channel-readiness-data";

const stateLabels: Record<ReadinessState, string> = {
  verified: "화면 확인",
  partial: "일부 준비",
  blocked: "차단 요인",
  not_configured: "미구성",
};

function ReadinessBadge({ state }: { state: ReadinessState }) {
  const Icon = state === "verified" ? CheckCircle2 : state === "blocked" ? AlertTriangle : state === "partial" ? Clock3 : CircleDashed;
  return <span className={`readiness-badge ${state}`}><Icon size={12} />{stateLabels[state]}</span>;
}

export function ChannelReadinessPage() {
  const onlineApps = channelReadiness.filter((channel) => channel.appState.includes("Online")).length;
  const verifiedChecks = channelReadiness.flatMap((channel) => channel.checks).filter((check) => check.state === "verified").length;
  const blockerCount = channelReadiness.reduce((total, channel) => total + channel.blockers.length, 0);

  return (
    <div className="page-stack readiness-page">
      <section className="readiness-hero">
        <div>
          <span className="readiness-eyebrow"><Radio size={14} /> READ-ONLY ACCOUNT INSPECTION · {channelReadinessObservedAt}</span>
          <h2>로그인됐다는 사실과<br /><em>API가 작동한다는 증거를 분리합니다.</em></h2>
          <p>실제 판매자·개발자 콘솔에서 확인한 상태만 기록했습니다. 자격증명 원문과 판매자 식별자는 저장하지 않았으며, 테스트상품 생성이나 설정 변경도 수행하지 않았습니다.</p>
        </div>
        <aside>
          <ShieldCheck size={20} />
          <span><b>보안 원칙</b><small>앱 키·시크릿·파트너 ID·IP는 서버 비밀 참조로만 연결하고 화면과 로그에서 마스킹합니다.</small></span>
        </aside>
      </section>

      <section className="readiness-summary" aria-label="채널 연동 준비 상태 요약">
        <article><span>콘솔 확인</span><strong>3 / 3</strong><small>Qoo10 · Shopee · Lazada</small></article>
        <article><span>Online 개발자 앱</span><strong>{onlineApps} / 2</strong><small>Shopee · Lazada</small></article>
        <article><span>확인된 근거</span><strong>{verifiedChecks}</strong><small>읽기 전용 화면 증거</small></article>
        <article className="warning"><span>현재 차단 요인</span><strong>{blockerCount}</strong><small>콜백 · 키 · 서버 · QAPI</small></article>
        <article className="danger"><span>API E2E 통과</span><strong>0 / 3</strong><small>생성·조회·수정·중지 기준</small></article>
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
          <span className="gate-zero"><LockKeyhole size={14} />현재 Gate 01 전</span>
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
        <div><b>실제 연결 작업은 서버 환경변수와 비밀 저장소가 준비된 뒤 시작합니다.</b><p>브라우저 로그인 세션을 API 인증으로 간주하지 않습니다. 승인된 테스트상품 범위, 콜백 도메인, 고정 작업서버 IP를 먼저 확정한 뒤 읽기 API부터 단계적으로 검수합니다.</p></div>
        <ServerCog size={22} />
      </section>
    </div>
  );
}
