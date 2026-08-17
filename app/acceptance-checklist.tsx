"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  FileCheck2,
  Filter,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  acceptanceSections,
  acceptanceSummary,
  type DevelopmentStatus,
  type VerificationStatus,
} from "./acceptance-checklist-data";

type StatusFilter = "all" | DevelopmentStatus | VerificationStatus;

const developmentLabels: Record<DevelopmentStatus, string> = {
  done: "개발 완료",
  partial: "부분 구현",
  not_started: "미구현",
  excluded: "범위 제외",
};

const verificationLabels: Record<VerificationStatus, string> = {
  passed: "실검수 완료",
  pending: "실검수 대기",
  external: "외부 준비 필요",
  excluded: "범위 제외",
};

export function AcceptanceChecklistPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openSections, setOpenSections] = useState(() => new Set(["A", "B", "C", "F", "G", "N", "O", "P"]));

  const sections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return acceptanceSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          const matchesQuery = !normalized || `${item.id} ${item.title} ${section.title}`.toLowerCase().includes(normalized);
          const matchesStatus = status === "all" || item.development === status || item.verification === status;
          return matchesQuery && matchesStatus;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [query, status]);

  const visibleCount = sections.reduce((total, section) => total + section.items.length, 0);

  const toggleSection = (code: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="page-stack acceptance-page">
      <section className="acceptance-hero">
        <div>
          <span className="acceptance-eyebrow"><FileCheck2 size={15} /> PPT 31장 기반 · 175개 인수 항목</span>
          <h2>화면 완성과 실제 작동을<br /><em>같은 완료로 계산하지 않습니다.</em></h2>
          <p>개발 상태와 실계정 검수 상태를 분리해 기록합니다. 채널 API에서 상품 등록, 주문 수집, 재고 차감과 오류 복구 증거가 확인되어야 최종 완료됩니다.</p>
        </div>
        <aside>
          <ShieldCheck size={21} />
          <div><strong>현재 단계 · Qoo10 쓰기 PoC 완료, Shopee·Lazada 재인증 필요</strong><span>Qoo10 테스트상품 생성·재조회 성공 · Shopee 과거 8개 숍 UNLIST 이력은 유지되지만 현재 토큰 갱신 실패 · Lazada OAuth 만료/누락</span></div>
        </aside>
      </section>

      <section className="acceptance-summary" aria-label="175개 요구사항 진행 요약">
        <article><span>전체 요구사항</span><strong>{acceptanceSummary.total}</strong><small>PPT 의도 기반</small></article>
        <article className="verified"><span>개발 완료</span><strong>{acceptanceSummary.development.done}</strong><small>코드·DB 실행 검증</small></article>
        <article className="partial"><span>부분 구현</span><strong>{acceptanceSummary.development.partial}</strong><small>외부 데이터 연결 전</small></article>
        <article className="pending"><span>미구현</span><strong>{acceptanceSummary.development.notStarted}</strong><small>백엔드·자동화 중심</small></article>
        <article className="external"><span>외부 준비 필요</span><strong>{acceptanceSummary.verification.external}</strong><small>계정·API·정책 · 제외 {acceptanceSummary.development.excluded}</small></article>
      </section>

      <section className="acceptance-gates">
        <div><span>GATE 0</span><b>범위·계정·테스트상품</b><em>실상품·스튜디오 이미지 5장 확보</em></div>
        <i />
        <div><span>GATE 1</span><b>Qoo10·Shopee·Lazada API PoC</b><em>Qoo10 생성·재조회 통과 · Shopee·Lazada 현재 OAuth 재승인 필요</em></div>
        <i />
        <div><span>PHASE 1–3</span><b>운영코어·콘텐츠·매칭</b><em>핵심 코어 구현 · 고도화 지속</em></div>
        <i />
        <div><span>PHASE 4</span><b>30–100 SKU 제한운영</b><em>미착수</em></div>
      </section>

      <section className="panel acceptance-panel">
        <div className="acceptance-toolbar">
          <div className="acceptance-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="REQ-ID 또는 기능 검색" /></div>
          <label><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="검수 상태 필터"><option value="all">모든 상태</option><option value="partial">부분 구현</option><option value="not_started">미구현</option><option value="external">외부 준비 필요</option><option value="pending">실검수 대기</option><option value="done">개발 완료</option><option value="passed">실검수 완료</option><option value="excluded">범위 제외</option></select><ChevronDown size={14} /></label>
          <span>{visibleCount}개 표시</span>
        </div>

        <div className="acceptance-legend">
          <span><i className="dev-partial" />부분 구현: 화면·로직은 있으나 운영 데이터 미연결</span>
          <span><i className="dev-todo" />미구현: 개발 증거 없음</span>
          <span><i className="verify-external" />외부 준비: 계정·권한·정책 결정 필요</span>
        </div>

        <div className="acceptance-sections">
          {sections.map((section) => {
            const open = openSections.has(section.code) || Boolean(query) || status !== "all";
            const sectionDeveloped = section.items.filter((item) => item.development === "partial" || item.development === "done").length;
            return <article className="acceptance-section" key={section.code}>
              <button className="acceptance-section-head" onClick={() => toggleSection(section.code)} aria-expanded={open}>
                <span className="acceptance-code">{section.code}</span>
                <span><b>{section.title}</b><small>{section.intent}</small></span>
                <em>PPT {section.pptSlides}</em>
                <span className="acceptance-section-count"><b>{sectionDeveloped}</b> / {section.items.length} 구현 진행</span>
                <ChevronDown className={open ? "open" : ""} size={17} />
              </button>
              {open && <div className="acceptance-items">
                <div className="acceptance-item acceptance-item-head"><span>REQ-ID</span><span>개발 항목</span><span>개발 상태</span><span>실검수</span></div>
                {section.items.map((item) => <div className="acceptance-item" key={item.id}>
                  <span><b>{item.id}</b><small>{item.priority}</small></span>
                  <span>{item.title}</span>
                  <span className={`acceptance-status dev-${item.development}`}>{item.development === "partial" ? <AlertTriangle size={13} /> : item.development === "done" ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}{developmentLabels[item.development]}</span>
                  <span className={`acceptance-status verify-${item.verification}`}>{item.verification === "external" ? <ExternalLink size={13} /> : item.verification === "passed" ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}{verificationLabels[item.verification]}</span>
                </div>)}
              </div>}
            </article>;
          })}
        </div>
      </section>

      <section className="acceptance-note"><AlertTriangle size={16} /><div><b>최종 완료 기준</b><p>사진 업로드 후 시스템이 자동 등록·자동 제외·재촬영 요청 중 하나를 결정하고, 등록된 상품의 주문·재고·가격·알림이 Qoo10 Japan, Shopee 8개 숍, Lazada에서 안정적으로 운영되는 증거가 있어야 합니다.</p></div></section>
    </div>
  );
}
