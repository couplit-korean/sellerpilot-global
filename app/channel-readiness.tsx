"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { channelCatalog } from "../lib/channels/catalog";
import { customerFacingCopy } from "../lib/user-facing-errors";
import {
  channelReadiness,
  type ReadinessState,
} from "./channel-readiness-data";

const stateLabels: Record<ReadinessState, string> = {
  verified: "연결됨",
  partial: "확인 필요",
  blocked: "조치 필요",
  not_configured: "연결 전",
};

function ReadinessBadge({ state }: { state: ReadinessState }) {
  const Icon = state === "verified" ? CheckCircle2 : state === "blocked" ? AlertTriangle : state === "partial" ? Clock3 : CircleDashed;
  return <span className={`readiness-badge ${state}`}><Icon size={14} />{stateLabels[state]}</span>;
}

export function ChannelReadinessPage() {
  const connectedCount = channelReadiness.filter((channel) => channel.overall === "verified").length;
  const attentionCount = channelReadiness.filter((channel) => channel.overall === "partial" || channel.overall === "blocked").length;
  const remainingCount = channelReadiness.filter((channel) => channel.overall === "not_configured").length;

  return (
    <div className="page-stack readiness-page customer-readiness-page">
      <section className="readiness-hero">
        <div>
          <span className="readiness-eyebrow"><Link2 size={14} /> 판매 채널 연결 상태</span>
          <h2>판매 채널이 잘 연결되어 있는지<br /><em>한눈에 확인하세요.</em></h2>
          <p>상품 등록과 주문 수집에 필요한 연결 상태를 보여드립니다. 조치가 필요한 채널은 다음에 해야 할 일을 함께 안내합니다.</p>
        </div>
        <aside>
          <ShieldCheck size={20} />
          <span><b>연결 정보 안전 보호</b><small>판매 채널의 비밀번호와 인증 정보는 암호화하여 안전하게 보관합니다.</small></span>
        </aside>
      </section>

      <section className="readiness-summary" aria-label="판매 채널 연결 요약">
        <article><span>연결 완료</span><strong>{connectedCount}</strong><small>바로 사용할 수 있어요</small></article>
        <article className={attentionCount ? "warning" : ""}><span>확인 필요</span><strong>{attentionCount}</strong><small>안내된 항목을 확인해 주세요</small></article>
        <article><span>연결 전</span><strong>{remainingCount}</strong><small>채널 연결이 필요해요</small></article>
      </section>

      <section className="readiness-channel-grid" aria-label="판매 채널별 연결 상태">
        {channelReadiness.map((channel) => (
          <article className={`readiness-channel-card ${channel.key}`} key={channel.key}>
            <header>
              <span className="readiness-channel-mark">{channel.code}</span>
              <div><small>{customerFacingCopy(channel.market)}</small><h3>{channel.name}</h3></div>
              <ReadinessBadge state={channel.overall} />
            </header>
            <p className="readiness-channel-summary">{customerFacingCopy(channel.summary)}</p>
            <div className="readiness-checks">
              {channel.checks.map((check) => (
                <div key={check.label}>
                  <span><b>{customerFacingCopy(check.label)}</b><small>{customerFacingCopy(check.evidence)}</small></span>
                  <ReadinessBadge state={check.state} />
                </div>
              ))}
            </div>
            {channel.blockers.length > 0 && <div className="readiness-blockers">
              <span><AlertTriangle size={14} /> 확인해 주세요</span>
              <ul>{channel.blockers.map((blocker) => <li key={blocker}>{customerFacingCopy(blocker)}</li>)}</ul>
            </div>}
            <footer><span>다음 단계</span><p>{customerFacingCopy(channel.nextAction)}</p></footer>
            <div className="readiness-doc-links">{channelCatalog[channel.key].officialDocs.slice(0, 1).map((doc) => <a href={doc.url} target="_blank" rel="noreferrer" key={doc.url}>판매 채널 도움말<ExternalLink size={12} /></a>)}</div>
          </article>
        ))}
      </section>
    </div>
  );
}
