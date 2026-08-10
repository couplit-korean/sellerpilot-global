"use client";

import { ChangeEvent, useMemo, useState } from "react";

type AnalysisState = "idle" | "analyzing" | "ready";

const channelConfig = [
  {
    id: "qoo10",
    name: "Qoo10 Japan",
    mark: "Q",
    currency: "JPY",
    symbol: "¥",
    fx: 9.25,
    fee: 12.4,
    lowest: 3980,
    status: "API 키 확인 필요",
    tone: "coral",
  },
  {
    id: "shopee",
    name: "Shopee Singapore",
    mark: "S",
    currency: "SGD",
    symbol: "S$",
    fx: 1040,
    fee: 11.5,
    lowest: 42.9,
    status: "OpenAPI 연결 준비됨",
    tone: "orange",
  },
  {
    id: "lazada",
    name: "Lazada Malaysia",
    mark: "L",
    currency: "MYR",
    symbol: "RM",
    fx: 328,
    fee: 12.5,
    lowest: 129.9,
    status: "Open Platform 인증 필요",
    tone: "violet",
  },
] as const;

const priceCandidates = [
  { source: "Qoo10", title: "히알루론 수분 세럼 50ml", price: "¥3,980", shipping: "무료", match: 96 },
  { source: "Shopee SG", title: "Hyaluron Moisture Serum 50ml", price: "S$42.90", shipping: "S$2.10", match: 93 },
  { source: "Lazada MY", title: "Hyaluronic Moisture Serum 50ml", price: "RM129.90", shipping: "무료", match: 89 },
] as const;

const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

export default function Home() {
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("촬영 이미지가 아직 없습니다");
  const [cost, setCost] = useState(14600);
  const [logistics, setLogistics] = useState(4900);
  const [packaging, setPackaging] = useState(600);
  const [targetMargin, setTargetMargin] = useState(28);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    "qoo10",
    "shopee",
    "lazada",
  ]);
  const [draftCreated, setDraftCreated] = useState(false);

  const totalCost = cost + logistics + packaging;

  const channelResults = useMemo(
    () =>
      channelConfig.map((channel) => {
        const retained = 1 - channel.fee / 100 - targetMargin / 100;
        const minimumForTarget = totalCost / channel.fx / Math.max(retained, 0.08);
        const marketFit = channel.lowest * 0.985;
        const recommended = Math.max(minimumForTarget, marketFit);
        const rounded = channel.currency === "JPY" ? Math.ceil(recommended / 10) * 10 : Math.ceil(recommended * 10) / 10;
        const netProfit = rounded * channel.fx * (1 - channel.fee / 100) - totalCost;
        const margin = (netProfit / (rounded * channel.fx)) * 100;
        const gap = ((rounded - channel.lowest) / channel.lowest) * 100;

        return { ...channel, recommended: rounded, margin, gap, netProfit };
      }),
    [targetMargin, totalCost],
  );

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(file));
    setFileName(file.name);
    setAnalysisState("idle");
    setDraftCreated(false);
  };

  const runAnalysis = () => {
    setAnalysisState("analyzing");
    setDraftCreated(false);
    window.setTimeout(() => setAnalysisState("ready"), 1100);
  };

  const toggleChannel = (id: string) => {
    setSelectedChannels((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setDraftCreated(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="셀러파일럿 홈">
          <span className="brand-mark">S</span>
          <span>
            <strong>셀러파일럿</strong>
            <small>Global listing copilot</small>
          </span>
        </a>
        <nav className="topnav" aria-label="주요 메뉴">
          <a className="active" href="#workspace">새 상품</a>
          <a href="#pricing">가격 분석</a>
          <a href="#channels">채널 연결</a>
        </nav>
        <div className="header-actions">
          <span className="save-state"><i /> 자동 저장됨</span>
          <button className="quiet-button" type="button">검토 모드</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <span className="eyebrow"><b>NEW</b> 사진 한 장에서 등록 초안까지</span>
          <h1>찍고, 비교하고,<br /><em>마진이 남을 때만</em> 등록하세요.</h1>
          <p>상품 사진을 기준으로 동일·유사 상품을 찾고, 3개 마켓의 최저가와 비용을 한 화면에서 검토합니다.</p>
        </div>
        <div className="hero-flow" aria-label="자동화 흐름">
          <div><span>01</span><b>상품 인식</b><small>사진 · OCR · 바코드</small></div>
          <i>→</i>
          <div><span>02</span><b>시장 비교</b><small>동일상품 · 최저가</small></div>
          <i>→</i>
          <div><span>03</span><b>등록 초안</b><small>번역 · 채널별 필드</small></div>
        </div>
      </section>

      <section className="workspace" id="workspace">
        <div className="section-heading">
          <div>
            <span className="step-label">STEP 01</span>
            <h2>상품 사진 넣기</h2>
            <p>정면 사진과 바코드·라벨 사진을 함께 넣으면 정확도가 올라갑니다.</p>
          </div>
          <span className="demo-badge">MVP 데모 분석</span>
        </div>

        <div className="intake-grid">
          <div className="upload-card">
            <div className={`photo-stage ${imageUrl ? "has-image" : ""}`}>
              {imageUrl ? (
                <img src={imageUrl} alt="업로드한 상품 미리보기" />
              ) : (
                <div className="sample-product" aria-hidden="true">
                  <span className="sample-cap" />
                  <span className="sample-label">MOISTURE<br /><b>SERUM</b><small>50 ml</small></span>
                </div>
              )}
              <span className="photo-tag">대표 이미지</span>
            </div>
            <div className="upload-meta">
              <div>
                <strong>{imageUrl ? "촬영 이미지 준비됨" : "샘플 상품으로 시작"}</strong>
                <span>{fileName}</span>
              </div>
              <label className="file-button">
                사진 선택
                <input type="file" accept="image/*" onChange={onFile} />
              </label>
            </div>
          </div>

          <div className="analysis-card">
            <div className="analysis-topline">
              <span className={`pulse-state ${analysisState}`}><i /> {analysisState === "ready" ? "분석 완료" : analysisState === "analyzing" ? "분석 중" : "분석 대기"}</span>
              <span>예상 10–20초</span>
            </div>
            <h3>AI가 채울 상품 정보</h3>
            <div className="field-preview">
              <label>인식 상품명</label>
              <strong>{analysisState === "ready" ? "히알루론 수분 세럼 50ml" : "사진 분석 후 자동 생성"}</strong>
            </div>
            <div className="field-row">
              <div><label>카테고리</label><strong>{analysisState === "ready" ? "뷰티 · 스킨케어" : "—"}</strong></div>
              <div><label>브랜드</label><strong>{analysisState === "ready" ? "브랜드 확인 필요" : "—"}</strong></div>
            </div>
            <div className="confidence-row">
              <span>동일상품 신뢰도</span>
              <div><i style={{ width: analysisState === "ready" ? "94%" : "8%" }} /></div>
              <strong>{analysisState === "ready" ? "94%" : "—"}</strong>
            </div>
            <button className="primary-button" type="button" onClick={runAnalysis} disabled={analysisState === "analyzing"}>
              {analysisState === "analyzing" ? "상품 정보를 분석하고 있습니다…" : analysisState === "ready" ? "다시 분석하기" : "AI 분석 시작"}
            </button>
            <p className="fine-print">실서비스에서는 이미지 검색, OCR, 바코드, 제조사 DB를 교차 검증합니다.</p>
          </div>
        </div>
      </section>

      <section className="comparison-section">
        <div className="section-heading compact">
          <div>
            <span className="step-label">STEP 02</span>
            <h2>동일·유사 상품 확인</h2>
          </div>
          <button className="text-button" type="button" onClick={runAnalysis}>후보 다시 찾기 ↗</button>
        </div>
        <div className="candidate-table" role="table" aria-label="유사 상품 가격 후보">
          <div className="candidate-head" role="row">
            <span>판매처</span><span>검색된 상품</span><span>판매가</span><span>배송비</span><span>일치도</span>
          </div>
          {priceCandidates.map((candidate, index) => (
            <div className="candidate-row" role="row" key={candidate.source}>
              <span><i className={`market-dot dot-${index}`} />{candidate.source}</span>
              <span>{candidate.title}<small>{index === 0 ? "이미지·용량·성분명 일치" : "이미지·상품명 유사"}</small></span>
              <strong>{candidate.price}</strong>
              <span>{candidate.shipping}</span>
              <span><b>{candidate.match}%</b><i className="match-bar"><i style={{ width: `${candidate.match}%` }} /></i></span>
            </div>
          ))}
        </div>
        <p className="sample-note">현재 표는 기능 확인용 예시 데이터입니다. 실연동 시 조회 시각과 상품 URL을 함께 저장합니다.</p>
      </section>

      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <div>
            <span className="step-label">STEP 03</span>
            <h2>마진 시뮬레이션</h2>
            <p>원가, 국제배송, 채널 수수료, 환율을 반영해 등록가 하한선을 계산합니다.</p>
          </div>
          <div className="target-control">
            <label htmlFor="margin-range">목표 마진</label>
            <strong>{targetMargin}%</strong>
            <input id="margin-range" type="range" min="10" max="45" value={targetMargin} onChange={(event) => setTargetMargin(Number(event.target.value))} />
          </div>
        </div>

        <div className="pricing-layout">
          <aside className="cost-panel">
            <h3>상품 비용</h3>
            <label>매입 원가 <span>KRW</span><input type="number" value={cost} onChange={(event) => setCost(Number(event.target.value))} /></label>
            <label>국제 배송비 <span>KRW</span><input type="number" value={logistics} onChange={(event) => setLogistics(Number(event.target.value))} /></label>
            <label>포장·기타비 <span>KRW</span><input type="number" value={packaging} onChange={(event) => setPackaging(Number(event.target.value))} /></label>
            <div className="cost-total"><span>총 변동원가</span><strong>₩{formatNumber(totalCost)}</strong></div>
            <p>광고비·반품 충당금은 채널별 고급 설정에서 추가합니다.</p>
          </aside>

          <div className="channel-grid">
            {channelResults.map((channel) => {
              const selected = selectedChannels.includes(channel.id);
              const aboveMarket = channel.gap > 0;
              return (
                <article className={`channel-card ${selected ? "selected" : ""}`} key={channel.id}>
                  <div className="channel-head">
                    <span className={`channel-mark ${channel.tone}`}>{channel.mark}</span>
                    <div><h3>{channel.name}</h3><span>{channel.currency} · 수수료 {channel.fee}%</span></div>
                    <label className="switch" aria-label={`${channel.name} 등록 대상`}>
                      <input type="checkbox" checked={selected} onChange={() => toggleChannel(channel.id)} />
                      <i />
                    </label>
                  </div>
                  <div className="market-price"><span>확인된 최저가</span><strong>{channel.symbol}{formatNumber(channel.lowest, channel.currency === "JPY" ? 0 : 2)}</strong></div>
                  <div className="recommended-price">
                    <span>권장 등록가</span>
                    <strong>{channel.symbol}{formatNumber(channel.recommended, channel.currency === "JPY" ? 0 : 1)}</strong>
                    <em className={aboveMarket ? "warn" : "good"}>{aboveMarket ? `최저가보다 ${formatNumber(channel.gap, 1)}% 높음` : `최저가보다 ${formatNumber(Math.abs(channel.gap), 1)}% 낮음`}</em>
                  </div>
                  <div className="profit-strip"><span>예상 순이익 <b>₩{formatNumber(channel.netProfit)}</b></span><strong>{formatNumber(channel.margin, 1)}%</strong></div>
                  <p className="connector-state"><i className={channel.id === "shopee" ? "ready" : "pending"} /> {channel.status}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="publish-section" id="channels">
        <div>
          <span className="step-label inverted">FINAL CHECK</span>
          <h2>게시 전에 한 번만 확인하세요.</h2>
          <p>AI가 만든 내용은 초안으로 저장되고, 카테고리 규제·브랜드·배송 정책을 통과한 상품만 게시할 수 있습니다.</p>
          <div className="checklist">
            <span className={analysisState === "ready" ? "done" : ""}><i>{analysisState === "ready" ? "✓" : "1"}</i> 상품 인식</span>
            <span className="done"><i>✓</i> 가격·마진</span>
            <span><i>3</i> 필수정보 검수</span>
            <span><i>4</i> 채널 게시</span>
          </div>
        </div>
        <div className="publish-card">
          <span>선택한 채널</span>
          <strong>{selectedChannels.length}개 마켓</strong>
          <p>Qoo10 Japan · Shopee SG · Lazada MY</p>
          <button type="button" onClick={() => setDraftCreated(true)} disabled={analysisState !== "ready" || selectedChannels.length === 0}>
            {draftCreated ? "초안 3건 생성 완료 ✓" : "등록 초안 만들기"}
          </button>
          <small>{analysisState === "ready" ? "실제 게시 없이 검수 대기열에 저장합니다." : "먼저 상품 사진 분석을 완료해 주세요."}</small>
        </div>
      </section>

      <section className="readiness-section">
        <div className="section-heading compact">
          <div><span className="step-label">연동 점검 결과</span><h2>현재 계정 기준 준비 상태</h2></div>
          <span className="checked-at">2026.08.10 확인</span>
        </div>
        <div className="readiness-grid">
          <article><span className="channel-mark coral">Q</span><div><h3>Qoo10 Japan</h3><p>QAPI에서 상품 신규등록·수정·조회 지원</p></div><b className="status amber">키 확인</b></article>
          <article><span className="channel-mark orange">S</span><div><h3>Shopee</h3><p>인하우스 앱 Online · Live 권한 연결 확인</p></div><b className="status green">준비됨</b></article>
          <article><span className="channel-mark violet">L</span><div><h3>Lazada Malaysia</h3><p>셀러 로그인 확인 · Open Platform 앱 인증 필요</p></div><b className="status blue">인증 필요</b></article>
        </div>
      </section>

      <footer>
        <span className="brand-mark small">S</span>
        <p><strong>셀러파일럿 MVP</strong> · 자동 등록 전 검수 중심 설계</p>
        <span>가격·환율·수수료는 게시 직전에 다시 확인합니다.</span>
      </footer>
    </main>
  );
}
