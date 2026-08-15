"use client";

import Image from "next/image";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  Box,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  Command,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Globe2,
  Headphones,
  HelpCircle,
  ImagePlus,
  Inbox,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircleMore,
  MoreHorizontal,
  Package,
  PackageCheck,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Upload,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { channels, DEMO_DATA_META, orders, productImages, products, tickets, type ChannelKey } from "./mock-data";

type View =
  | "overview"
  | "products"
  | "publishing"
  | "orders"
  | "cs"
  | "qoo10"
  | "shopee"
  | "lazada"
  | "storyboard";

const navGroups = [
  {
    label: "운영",
    items: [
      { id: "overview" as View, label: "통합 대시보드", icon: LayoutDashboard },
      { id: "products" as View, label: "상품 관리", icon: Package },
      { id: "publishing" as View, label: "상품 등록", icon: CloudUpload, badge: "12" },
      { id: "orders" as View, label: "주문 · 판매", icon: ShoppingCart },
      { id: "cs" as View, label: "CS 통합함", icon: Headphones, badge: "7" },
    ],
  },
  {
    label: "판매 채널",
    items: [
      { id: "qoo10" as View, label: "Qoo10 Japan", channel: "Q" },
      { id: "shopee" as View, label: "Shopee SG", channel: "S" },
      { id: "lazada" as View, label: "Lazada MY", channel: "L" },
    ],
  },
  {
    label: "기획",
    items: [{ id: "storyboard" as View, label: "서비스 스토리보드", icon: FileText }],
  },
];

const pageMeta: Record<View, { title: string; description: string }> = {
  overview: { title: "통합 대시보드", description: "모든 채널의 오늘을 한눈에 확인하세요." },
  products: { title: "상품 관리", description: "채널별 등록 상태, 재고와 판매 성과를 관리합니다." },
  publishing: { title: "상품 등록 센터", description: "사진 한 장에서 다국어 상품 페이지와 채널 등록까지 자동화합니다." },
  orders: { title: "주문 · 판매", description: "전체 채널의 주문과 배송 흐름을 한곳에서 처리합니다." },
  cs: { title: "CS 통합함", description: "언어와 채널이 달라도 하나의 상담함에서 응대합니다." },
  qoo10: { title: "Qoo10 Japan", description: "일본 스토어의 상품, 매출, 주문, CS 성과입니다." },
  shopee: { title: "Shopee Singapore", description: "싱가포르 스토어의 상품, 매출, 주문, CS 성과입니다." },
  lazada: { title: "Lazada Malaysia", description: "말레이시아 스토어의 상품, 매출, 주문, CS 성과입니다." },
  storyboard: { title: "서비스 스토리보드", description: "로그인부터 자동 등록, 판매, CS까지의 전체 사용자 흐름입니다." },
};

function ChannelMark({ code, size = "md" }: { code: string; size?: "sm" | "md" | "lg" }) {
  const config = code === "Q" ? channels.qoo10 : code === "S" ? channels.shopee : channels.lazada;
  return <span className={`channel-mark ${size}`} style={{ "--channel-color": config.color } as React.CSSProperties}>{code}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("완료") || status === "판매중" || status === "정상" ? "success" : status.includes("주의") || status.includes("대기") || status === "처리 중" ? "warning" : status.includes("긴급") || status === "품절" || status.includes("실패") ? "danger" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}

function SparkLine({ points, color = "#5b5cf0", fill = false }: { points: string; color?: string; fill?: boolean }) {
  return (
    <svg className="sparkline" viewBox="0 0 120 42" aria-hidden="true" preserveAspectRatio="none">
      {fill && <polygon points={`0,42 ${points} 120,42`} fill={color} opacity=".08" />}
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("demo@sellerpilot.kr");
  const [password, setPassword] = useState("seller2026");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    window.setTimeout(onLogin, 650);
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-lockup light"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong></div>
        <div className="login-message">
          <span className="eyebrow"><Sparkles size={14} /> AI COMMERCE OPERATING SYSTEM</span>
          <h1>한 번의 등록,<br /><em>모든 마켓에.</em></h1>
          <p>상품 등록부터 판매, 주문, CS까지.<br />흩어진 글로벌 채널을 하나의 운영 화면으로 연결합니다.</p>
          <div className="login-proof-list">
            <div><CheckCircle2 size={17} /><span><b>3개 글로벌 채널</b><small>Qoo10 · Shopee · Lazada 실시간 통합</small></span></div>
            <div><CheckCircle2 size={17} /><span><b>사진 기반 AI 등록</b><small>OCR · 번역 · 가격 · 상세페이지 자동 생성</small></span></div>
            <div><CheckCircle2 size={17} /><span><b>24시간 운영 현황</b><small>매출 · 재고 · 등록 오류 · CS 즉시 확인</small></span></div>
          </div>
        </div>
        <div className="login-orbit orbit-a" />
        <div className="login-orbit orbit-b" />
        <div className="floating-insight insight-sales">
          <span className="mini-icon"><TrendingUp size={15} /></span>
          <div><small>이번 달 매출</small><strong>₩48.9M</strong></div>
          <em>+17.2%</em>
        </div>
        <div className="floating-insight insight-channel">
          <div className="mini-channels"><ChannelMark code="Q" size="sm" /><ChannelMark code="S" size="sm" /><ChannelMark code="L" size="sm" /></div>
          <div><small>연결된 채널</small><strong>모두 정상 운영 중</strong></div>
          <CheckCircle2 size={17} />
        </div>
        <footer>© 2026 SellerPilot. Global commerce, under control.</footer>
      </section>

      <section className="login-form-panel">
        <div className="mobile-brand"><div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong></div></div>
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-heading">
            <span className="secure-mark"><LockKeyhole size={21} /></span>
            <h2>운영센터 로그인</h2>
            <p>관리자 계정으로 통합 대시보드에 접속하세요.</p>
          </div>
          <label className="field-label" htmlFor="email">아이디</label>
          <div className="input-wrap"><UserRound size={17} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="admin@company.com" /></div>
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button">비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <label className="remember-row"><input type="checkbox" defaultChecked /><span><Check size={12} /></span>로그인 상태 유지</label>
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />접속 중...</> : <>대시보드 접속<ArrowRight size={18} /></>}</button>
          <div className="demo-account"><ShieldCheck size={15} /><span>화면 확인용 계정이 입력되어 있습니다.<br /><b>로그인 버튼을 눌러 바로 둘러보세요.</b></span></div>
        </form>
        <div className="login-support"><HelpCircle size={15} />접속에 문제가 있나요? <button>운영 지원팀 문의</button></div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, delta, detail, icon: Icon, tone, reverse }: { label: string; value: string; delta: string; detail: string; icon: React.ComponentType<{ size?: number }>; tone: string; reverse?: boolean }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong></div>
      <div className="metric-foot"><span className={reverse ? "negative" : "positive"}>{reverse ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta}</span><small>{detail}</small></div>
    </article>
  );
}

function OverviewPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [period, setPeriod] = useState("30일");
  const chartPoints = period === "7일" ? "0,31 18,29 36,33 54,20 72,24 90,14 108,18 120,7" : period === "90일" ? "0,35 12,33 24,28 36,31 48,22 60,25 72,15 84,18 96,10 108,13 120,5" : "0,36 10,32 20,34 30,27 40,29 50,20 60,23 70,14 80,18 90,9 100,13 110,4 120,7";
  return (
    <div className="page-stack">
      <section className="overview-toolbar">
        <div className="period-control"><CalendarDays size={15} /><button>2026.07.17</button><span>—</span><button>2026.08.15</button></div>
        <div className="segmented-control">{["7일", "30일", "90일"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div>
      </section>

      <section className="metric-grid">
        <MetricCard label="총 매출" value={period === "7일" ? "₩13.8M" : period === "90일" ? "₩126.4M" : "₩48.9M"} delta="17.2%" detail="이전 기간 대비" icon={CircleDollarSign} tone="violet" />
        <MetricCard label="주문" value={period === "7일" ? "364" : period === "90일" ? "3,492" : "1,284"} delta="12.8%" detail="취소율 1.8%" icon={ShoppingBag} tone="blue" />
        <MetricCard label="등록 완료" value="326" delta="8.4%" detail="등록 대기 12건" icon={PackageCheck} tone="green" />
        <MetricCard label="CS 응답률" value="94.6%" delta="2.1%" detail="평균 18분" icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">SALES OVERVIEW</span><h3>채널 통합 매출</h3></div><button className="ghost-button">리포트 보기<ChevronRight size={15} /></button></div>
          <div className="chart-legend"><span><i className="legend-dot q" />Qoo10 <b>₩22.4M</b></span><span><i className="legend-dot s" />Shopee <b>₩16.8M</b></span><span><i className="legend-dot l" />Lazada <b>₩9.7M</b></span></div>
          <div className="revenue-chart">
            <div className="chart-y-labels"><span>2.0M</span><span>1.5M</span><span>1.0M</span><span>0.5M</span><span>0</span></div>
            <div className="chart-stage">
              <div className="chart-grid-lines"><i /><i /><i /><i /><i /></div>
              <svg viewBox="0 0 120 42" preserveAspectRatio="none" role="img" aria-label="최근 매출 추이">
                <defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b5cf0" stopOpacity=".22" /><stop offset="100%" stopColor="#5b5cf0" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`0,42 ${chartPoints} 120,42`} fill="url(#areaGradient)" />
                <polyline points={chartPoints} fill="none" stroke="#5b5cf0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="110" cy={period === "7일" ? "4" : period === "90일" ? "13" : "4"} r="1.8" fill="#fff" stroke="#5b5cf0" strokeWidth="1.2" />
              </svg>
              <div className="chart-x-labels"><span>7/17</span><span>7/24</span><span>7/31</span><span>8/7</span><span>8/15</span></div>
            </div>
          </div>
        </article>

        <article className="panel top-product-card">
          <div className="panel-heading"><div><span className="panel-kicker">BEST PRODUCT · 30 DAYS</span><h3>이번 달 판매 1위</h3></div><span className="rank-crown">#1</span></div>
          <div className="top-product-visual"><Image src={productImages[0]} alt="화이트토마토 글루타치온" fill sizes="320px" /></div>
          <div className="top-product-copy"><div><span>이너뷰티 · 건강식품</span><h4>화이트토마토<br />글루타치온 30정</h4></div><div className="product-channel-row"><ChannelMark code="Q" size="sm" /><ChannelMark code="S" size="sm" /><ChannelMark code="L" size="sm" /><span>3개 채널 판매중</span></div></div>
          <div className="top-product-stats"><div><small>판매량</small><strong>382<em>개</em></strong></div><div><small>매출</small><strong>₩12.8<em>M</em></strong></div><div><small>전월 대비</small><strong className="up">+26.4<em>%</em></strong></div></div>
          <button className="full-ghost-button" onClick={() => onNavigate("products")}>상품 상세 보기<ArrowRight size={15} /></button>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel channel-performance">
          <div className="panel-heading"><div><span className="panel-kicker">CHANNEL HEALTH</span><h3>채널별 운영 현황</h3></div><span className="live-label"><i />LIVE</span></div>
          <div className="channel-list">
            {[
              { code: "Q", name: "Qoo10 Japan", revenue: "₩22.4M", orders: "584", rate: 92, delta: "+18.6%", view: "qoo10" as View },
              { code: "S", name: "Shopee Singapore", revenue: "₩16.8M", orders: "438", rate: 71, delta: "+12.1%", view: "shopee" as View },
              { code: "L", name: "Lazada Malaysia", revenue: "₩9.7M", orders: "262", rate: 46, delta: "+8.4%", view: "lazada" as View },
            ].map((channel) => <button className="channel-row" key={channel.code} onClick={() => onNavigate(channel.view)}><ChannelMark code={channel.code} /><div className="channel-name"><strong>{channel.name}</strong><span><i />API 정상 · 최근 동기화 2분 전</span></div><div className="channel-metric"><small>매출</small><b>{channel.revenue}</b></div><div className="channel-metric"><small>주문</small><b>{channel.orders}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.rate}%` }} /></span><b>{channel.delta}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">AUTOMATION PIPELINE</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("publishing")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>338</strong><span>이번 달 처리</span></div><i /><div><strong>96.4%</strong><span>자동 등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: 4, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: 8, tone: "blue", icon: Upload }, { label: "등록 완료", value: 326, tone: "green", icon: CheckCircle2 }, { label: "확인 필요", value: 5, tone: "red", icon: AlertCircle }].map((item) => <div key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">NEEDS ATTENTION</span><h3>지금 확인할 항목</h3></div><span className="count-chip">7</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고 10개 이하 상품 3건</b><small>품절 전 재입고가 필요합니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 2건</b><small>카테고리 속성 누락을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("cs")}><span className="alert-icon blue"><MessageCircleMore size={16} /></span><span><b>1시간 이상 미답변 CS 2건</b><small>Qoo10 Japan 문의입니다.</small></span><em>답변하기<ChevronRight size={14} /></em></button>
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-heading"><div><span className="panel-kicker">QUICK START</span><h3>빠른 실행</h3></div></div>
          <div className="quick-action-grid"><button onClick={() => onNavigate("publishing")}><span><ImagePlus size={19} /></span><b>새 상품 등록</b><small>사진으로 시작</small></button><button onClick={() => onNavigate("orders")}><span><Truck size={19} /></span><b>출고 처리</b><small>대기 24건</small></button><button onClick={() => onNavigate("cs")}><span><Bot size={19} /></span><b>AI 답변</b><small>대기 7건</small></button></div>
        </article>
      </section>
    </div>
  );
}

function ProductsPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [query, setQuery] = useState("");
  const filtered = products.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()) || product.sku.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page-stack">
      <section className="summary-strip"><div><Package size={18} /><span>전체 상품<strong>428</strong></span></div><div><CheckCircle2 size={18} /><span>정상 판매<strong>397</strong></span></div><div><AlertCircle size={18} /><span>재고 주의<strong>18</strong></span></div><div><Box size={18} /><span>품절<strong>13</strong></span></div><button className="primary-button" onClick={() => onNavigate("publishing")}><Plus size={16} />새 상품 등록</button></section>
      <section className="panel data-panel">
        <div className="data-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, SKU 검색" /></div><button className="filter-button"><Filter size={15} />채널 전체<ChevronDown size={14} /></button><button className="filter-button"><ListFilter size={15} />상태 전체<ChevronDown size={14} /></button><span className="toolbar-spacer" /><button className="icon-text-button"><RefreshCw size={15} />동기화</button><button className="icon-only-button" aria-label="더보기"><MoreHorizontal size={18} /></button></div>
        <div className="table-wrap"><table className="data-table product-table"><thead><tr><th><input type="checkbox" aria-label="전체 선택" /></th><th>상품</th><th>판매 채널</th><th>재고</th><th>30일 판매</th><th>30일 매출</th><th>상태</th><th /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><input type="checkbox" aria-label={`${product.name} 선택`} /></td><td><div className="product-cell"><div className="product-thumb"><Image src={product.image} alt="" fill sizes="52px" /></div><span><b>{product.name}</b><small>{product.sku} · {product.id}</small></span></div></td><td><div className="channel-stack">{product.channels.map((code) => <ChannelMark key={code} code={code} size="sm" />)}</div></td><td><strong className={product.stock < 20 ? "stock-low" : ""}>{product.stock}</strong><small> 개</small></td><td><b>{product.sales}</b><small> 개</small></td><td><b>{product.revenue}</b></td><td><StatusBadge status={product.status} /></td><td><button className="table-action"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div>
        <div className="table-footer"><span>총 428개 중 1–{filtered.length}개 표시</span><div><button disabled><ChevronRight className="flip" size={15} /></button><button className="active">1</button><button>2</button><button>3</button><button><ChevronRight size={15} /></button></div></div>
      </section>
    </div>
  );
}

function PublishingPage({ notify }: { notify: (message: string) => void }) {
  const [running, setRunning] = useState(false);
  const startAutomation = () => {
    setRunning(true);
    notify("새 상품이 AI 분석 대기열에 추가되었습니다.");
    window.setTimeout(() => setRunning(false), 2600);
  };
  return (
    <div className="page-stack publishing-page">
      <section className="publishing-hero">
        <div><span className="eyebrow dark"><Sparkles size={14} /> AI PRODUCT PUBLISHER</span><h2>사진 한 장이면,<br /><em>3개 마켓 등록 준비 완료.</em></h2><p>상품 사진을 올리면 AI가 OCR, 상품 식별, 다국어 번역, 가격 계산,<br />상세페이지 생성을 거쳐 각 채널 형식으로 자동 변환합니다.</p></div>
        <div className="automation-flow-mini"><span><ImagePlus size={17} />사진</span><ArrowRight size={15} /><span><Bot size={17} />AI 분석</span><ArrowRight size={15} /><span><Languages size={17} />4개 언어</span><ArrowRight size={15} /><span><Globe2 size={17} />3개 채널</span></div>
      </section>
      <section className="publishing-layout">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><span className="panel-kicker">NEW PRODUCT</span><h3>새 상품 등록</h3></div><span className="step-chip">STEP 1 / 3</span></div>
          <button className={`drop-zone ${running ? "running" : ""}`} onClick={startAutomation}>
            {running ? <><span className="upload-graphic active"><LoaderCircle className="spin" size={31} /></span><strong>상품 이미지를 읽고 있습니다</strong><p>OCR과 품질 검사를 진행 중입니다...</p><div className="upload-progress"><i /></div></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>상품 사진을 여기에 놓으세요</strong><p>또는 클릭하여 JPG, PNG 파일 선택 · 최대 20MB</p><em><ImagePlus size={15} />사진 선택하기</em></>}
          </button>
          <div className="capture-guide"><div><span>01</span><b>제품 정면</b><small>제품 전체가 보이게</small></div><ChevronRight size={14} /><div><span>02</span><b>성분 · 규격</b><small>라벨이 선명하게</small></div><ChevronRight size={14} /><div><span>03</span><b>바코드</b><small>숫자까지 보이게</small></div></div>
        </article>
        <aside className="panel publishing-settings"><div className="panel-heading"><div><span className="panel-kicker">PUBLISH TO</span><h3>등록할 채널</h3></div><Settings size={16} /></div>
          <div className="publish-channel-list">{Object.values(channels).map((channel) => <label key={channel.letter}><ChannelMark code={channel.letter} /><span><b>{channel.name}</b><small>{channel.market} 스토어 · API 정상</small></span><input type="checkbox" defaultChecked /><i><Check size={12} /></i></label>)}</div>
          <div className="auto-options"><h4>자동화 옵션</h4><label><span><b>AI 다국어 번역</b><small>한국어, 일본어, 영어, 말레이어</small></span><input type="checkbox" defaultChecked /><i /></label><label><span><b>마진 기반 가격 계산</b><small>목표 마진 28% 적용</small></span><input type="checkbox" defaultChecked /><i /></label><label><span><b>검증 통과 시 자동 등록</b><small>신뢰도 97% 이상</small></span><input type="checkbox" defaultChecked /><i /></label></div>
        </aside>
      </section>
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">TODAY'S QUEUE</span><h3>오늘의 등록 작업</h3></div><button className="ghost-button">작업 이력<ChevronRight size={15} /></button></div>
        <div className="queue-table"><div className="queue-header"><span>상품</span><span>AI 분석</span><span>상세페이지</span><span>채널 등록</span><span>상태</span></div>{[
          { name: "화이트토마토 글루타치온 30정", image: 0, ai: "완료", detail: "4개 언어 완료", channel: "3 / 3", status: "등록 완료" },
          { name: "저분자 피쉬콜라겐 60포", image: 1, ai: "완료", detail: "4개 언어 완료", channel: "2 / 3", status: "등록 중" },
          { name: "콜드브루 콜라겐 젤리", image: 2, ai: "검토 필요", detail: "대기", channel: "0 / 3", status: "확인 필요" },
        ].map((item) => <div className="queue-row" key={item.name}><span className="queue-product"><span className="tiny-thumb"><Image src={productImages[item.image]} alt="" fill sizes="38px" /></span><b>{item.name}</b></span><span><StatusBadge status={item.ai} /></span><span>{item.detail}</span><span><b>{item.channel}</b></span><span><StatusBadge status={item.status} /></span></div>)}</div>
      </section>
    </div>
  );
}

function OrdersPage() {
  const [active, setActive] = useState("전체 주문");
  return (
    <div className="page-stack">
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>오늘 주문</small><strong>46</strong></div><em>+12.2%</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>24</strong></div><em className="neutral">오늘 마감 18건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중</small><strong>138</strong></div><em className="neutral">지연 3건</em></article><article><span className="metric-icon green"><CircleDollarSign size={19} /></span><div><small>오늘 매출</small><strong>₩2.84M</strong></div><em>+8.6%</em></article></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>24</span>}</button>)}</div><div className="search-field"><Search size={16} /><input placeholder="주문번호, 구매자 검색" /></div><button className="filter-button"><Filter size={15} />필터</button></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문상태</th><th>주문시간</th><th /></tr></thead><tbody>{orders.filter((order) => active === "전체 주문" || active === "완료 · 취소" || order.status === active).map((order) => <tr key={order.id}><td><b className="mono">{order.id}</b></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><span className="truncate-product">{order.product}</span></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} /></td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action"><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
        <div className="bulk-order-bar"><span><input type="checkbox" />선택한 주문</span><button><Truck size={15} />일괄 출고 처리</button><button>송장 업로드</button><span className="toolbar-spacer" /><small>마지막 주문 동기화: 방금 전</small><button className="table-action"><RefreshCw size={15} /></button></div>
      </section>
    </div>
  );
}

function CsPage({ notify }: { notify: (message: string) => void }) {
  const [selected, setSelected] = useState(tickets[0]);
  const [reply, setReply] = useState("안녕하세요, 고객님. 주문하신 상품은 현재 현지 배송사로 인계되어 이동 중입니다. 송장 반영까지 최대 24시간 정도 소요될 수 있으며, 내일 오전까지 조회되지 않을 경우 바로 다시 확인해 드리겠습니다. 이용에 불편을 드려 죄송합니다.");
  const sendReply = () => { notify(`${selected.customer} 고객에게 답변을 전송했습니다.`); setReply(""); };
  return (
    <div className="page-stack cs-page">
      <section className="cs-summary"><div><span className="metric-icon violet"><Inbox size={18} /></span><span><small>답변 대기</small><strong>7</strong></span></div><div><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>평균 첫 응답</small><strong>18분</strong></span></div><div><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>24시간 해결률</small><strong>94.6%</strong></span></div><div><span className="metric-icon blue"><Bot size={18} /></span><span><small>AI 초안 사용률</small><strong>81%</strong></span></div></section>
      <section className="cs-workspace panel">
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input placeholder="문의 검색" /></div><button className="icon-only-button"><Filter size={16} /></button></div><div className="ticket-tabs"><button className="active">미답변 <span>7</span></button><button>처리 중</button><button>완료</button></div>{tickets.map((ticket) => <button key={ticket.id} className={`ticket-item ${selected.id === ticket.id ? "active" : ""}`} onClick={() => { setSelected(ticket); setReply(""); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticket.channel === "Qoo10" ? "Q" : ticket.channel === "Shopee" ? "S" : "L"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back"><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><button className="filter-button">처리 중<ChevronDown size={14} /></button><button className="icon-only-button"><MoreHorizontal size={18} /></button></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>{orders[0].product}</b></span><em>{orders[0].id}<ChevronRight size={14} /></em></div><div className="message-date"><span>오늘</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.subject === "복용 방법 문의" ? "Can I take two tablets at once after a meal? Please let me know the recommended daily intake." : selected.subject === "옵션 변경 요청" ? "I selected the wrong option. Could you change it before shipping?" : "주문한 지 3일이 지났는데 아직 송장 조회가 되지 않아요. 언제부터 확인할 수 있나요?"}</p><span>자동 번역됨 · 원문 보기</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />AI가 주문 정보와 정책을 반영한 답변 초안을 만들었습니다.</span><button onClick={() => setReply("고객님의 주문과 배송 현황을 확인한 뒤 신속히 안내드리겠습니다.")}><RefreshCw size={13} />다시 생성</button></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="답변을 입력하세요." /><div><span><button><Languages size={15} />일본어로 전송<ChevronDown size={13} /></button><button><FileText size={15} />템플릿</button></span><button className="send-button" disabled={!reply} onClick={sendReply}>답변 전송<Send size={15} /></button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>총 주문</small><b>4건</b></div><div><small>누적 구매</small><b>₩184,200</b></div></div><div className="detail-section"><h5>현재 주문</h5><div className="mini-order"><span className="tiny-thumb"><Image src={productImages[0]} alt="" fill sizes="40px" /></span><span><b>화이트토마토 글루타치온</b><small>1개 · ¥4,280</small></span></div><dl><div><dt>주문번호</dt><dd>{orders[0].id}</dd></div><div><dt>배송상태</dt><dd><StatusBadge status="배송중" /></dd></div><div><dt>운송장</dt><dd>JP-78392018</dd></div></dl></div><div className="detail-section"><h5>AI 응대 가이드</h5><p className="ai-guide"><Bot size={16} />배송사 인계 후 송장 반영에는 최대 24시간이 걸릴 수 있습니다. 환불을 먼저 제안하지 마세요.</p></div></aside>
      </section>
    </div>
  );
}

function ChannelPage({ channelKey }: { channelKey: ChannelKey }) {
  const channel = channels[channelKey];
  const factors = channelKey === "qoo10" ? { sales: "₩22.4M", orders: "584", products: "326", cs: "96.2%", rate: 84 } : channelKey === "shopee" ? { sales: "₩16.8M", orders: "438", products: "284", cs: "93.8%", rate: 69 } : { sales: "₩9.7M", orders: "262", products: "219", cs: "92.6%", rate: 53 };
  return (
    <div className="page-stack">
      <section className="channel-hero" style={{ "--channel-color": channel.color } as React.CSSProperties}><div><ChannelMark code={channel.letter} size="lg" /><span><small>{channel.market} 판매 채널</small><h2>{channel.name}</h2><em><i />API 정상 · 2분 전 동기화</em></span></div><div><button className="filter-button"><RefreshCw size={15} />지금 동기화</button><button className="primary-button"><Store size={15} />스토어 보기</button></div></section>
      <section className="metric-grid channel-metrics"><MetricCard label="30일 매출" value={factors.sales} delta="18.6%" detail="이전 30일 대비" icon={CircleDollarSign} tone="violet" /><MetricCard label="주문" value={factors.orders} delta="12.8%" detail="취소 11건" icon={ShoppingBag} tone="blue" /><MetricCard label="판매 상품" value={factors.products} delta="14" detail="이번 달 신규" icon={Package} tone="green" /><MetricCard label="CS 응답률" value={factors.cs} delta="2.1%" detail="평균 16분" icon={Headphones} tone="orange" /></section>
      <section className="channel-detail-grid"><article className="panel"><div className="panel-heading"><div><span className="panel-kicker">PERFORMANCE</span><h3>매출 · 주문 추이</h3></div><button className="filter-button">최근 30일<ChevronDown size={14} /></button></div><div className="large-spark"><div><span><i style={{ background: channel.color }} />매출</span><span><i className="orders" />주문</span></div><SparkLine points="0,36 10,34 20,29 30,31 40,23 50,26 60,18 70,20 80,12 90,16 100,8 110,12 120,4" color={channel.color} fill /></div><div className="chart-stat-row"><div><small>평균 객단가</small><b>₩38,420</b></div><div><small>전환율</small><b>4.82%</b></div><div><small>광고 ROAS</small><b>468%</b></div><div><small>반품률</small><b>1.4%</b></div></div></article><article className="panel store-health"><div className="panel-heading"><div><span className="panel-kicker">STORE SCORE</span><h3>스토어 건강도</h3></div><span className="score-grade">A</span></div><div className="health-score"><strong>{factors.rate}<small>/100</small></strong><div><span><i style={{ width: `${factors.rate}%`, background: channel.color }} /></span><small>상위 12% 수준</small></div></div>{[{ label: "상품 정보 완성도", score: "98%" }, { label: "배송 SLA 준수", score: "94%" }, { label: "CS 응답 품질", score: "96%" }, { label: "재고 안정성", score: "82%" }].map((item) => <div className="health-row" key={item.label}><span>{item.label}</span><b>{item.score}</b></div>)}</article></section>
      <section className="panel data-panel"><div className="panel-heading table-title"><div><span className="panel-kicker">TOP PRODUCTS</span><h3>채널 내 판매 상품</h3></div><button className="ghost-button">전체 상품<ChevronRight size={15} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>순위</th><th>상품</th><th>판매량</th><th>매출</th><th>전환율</th><th>재고</th><th>상태</th></tr></thead><tbody>{products.slice(0, 4).map((product, index) => <tr key={product.id}><td><b className="rank-number">{String(index + 1).padStart(2, "0")}</b></td><td><div className="product-cell"><div className="product-thumb"><Image src={product.image} alt="" fill sizes="52px" /></div><span><b>{product.name}</b><small>{product.sku}</small></span></div></td><td><b>{product.sales}</b>개</td><td><b>{product.revenue}</b></td><td><b>{(5.8 - index * .6).toFixed(1)}%</b></td><td><b>{product.stock}</b>개</td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div></section>
    </div>
  );
}

function StoryboardPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const scenes = [
    { no: "01", title: "관리자 로그인", desc: "ID·PW를 입력해 운영 데이터에 안전하게 접근", view: "overview" as View, icon: LockKeyhole, outcome: "권한별 대시보드 진입" },
    { no: "02", title: "통합 현황 파악", desc: "매출, 주문, 등록, CS와 월간 베스트 상품을 한 화면에서 확인", view: "overview" as View, icon: LayoutDashboard, outcome: "30초 안에 오늘의 우선순위 결정" },
    { no: "03", title: "사진으로 상품 등록", desc: "정면·라벨·바코드 사진을 올려 상품 사실정보 추출", view: "publishing" as View, icon: ImagePlus, outcome: "반복 입력 제거" },
    { no: "04", title: "AI 자동 가공", desc: "OCR, 상품 매칭, 상세페이지, 4개 언어, 가격·마진 자동 계산", view: "publishing" as View, icon: WandSparkles, outcome: "검증 가능한 등록 초안" },
    { no: "05", title: "채널 동시 등록", desc: "Qoo10, Shopee, Lazada 규격으로 변환해 자동 게시", view: "publishing" as View, icon: Globe2, outcome: "채널별 오류 즉시 추적" },
    { no: "06", title: "주문 · 재고 통합", desc: "각 채널 주문을 모으고 중앙 재고를 동기화", view: "orders" as View, icon: PackageCheck, outcome: "중복판매·품절 방지" },
    { no: "07", title: "다국어 CS 응대", desc: "문의 자동번역과 주문정보 기반 AI 답변 초안", view: "cs" as View, icon: Bot, outcome: "응답시간 단축" },
    { no: "08", title: "성과 개선", desc: "채널·상품별 매출, 전환율, CS와 오류 데이터를 비교", view: "qoo10" as View, icon: TrendingUp, outcome: "잘 팔리는 상품에 집중" },
  ];
  return (
    <div className="page-stack storyboard-page">
      <section className="storyboard-intro"><div><span className="eyebrow dark"><FileText size={14} /> PRODUCT STORYBOARD · V1.0</span><h2>운영자가 길을 잃지 않는<br /><em>8개의 핵심 장면</em></h2><p>‘오늘 무엇을 봐야 하는가’에서 시작해 등록, 판매, CS, 개선까지<br />하나의 루프로 연결한 멀티채널 커머스 운영 경험입니다.</p></div><div className="oss-card"><span>OPEN SOURCE FOUNDATION</span><strong>shadcn/ui</strong><em>121K+ GitHub Stars</em><p>접근 가능한 컴포넌트 구조와 데이터 대시보드 패턴</p><strong>Lucide</strong><em>24K+ GitHub Stars</em><p>일관된 오픈소스 아이콘 시스템</p></div></section>
      <section className="story-flow"><div className="flow-line" />{scenes.map((scene, index) => <article className="story-scene" key={scene.no}><div className="scene-number">{scene.no}</div><div className="scene-icon"><scene.icon size={22} /></div><div className="scene-copy"><span>{index < 2 ? "DISCOVER" : index < 5 ? "AUTOMATE" : index < 7 ? "OPERATE" : "GROW"}</span><h3>{scene.title}</h3><p>{scene.desc}</p><em><CheckCircle2 size={14} />{scene.outcome}</em></div><button onClick={() => onNavigate(scene.view)}>화면 열기<ArrowRight size={15} /></button></article>)}</section>
      <section className="panel information-architecture"><div className="panel-heading"><div><span className="panel-kicker">INFORMATION ARCHITECTURE</span><h3>화면 구성과 운영 목적</h3></div></div><div className="ia-grid"><div><span className="ia-icon"><LayoutDashboard size={19} /></span><b>총괄</b><small>핵심 KPI · 베스트 상품 · 채널 건강도 · 긴급 항목</small></div><div><span className="ia-icon"><Package size={19} /></span><b>상품</b><small>상품 원장 · 채널 상태 · 재고 · 판매 성과</small></div><div><span className="ia-icon"><CloudUpload size={19} /></span><b>등록</b><small>촬영 · AI 분석 · 번역 · 가격 · 게시 작업</small></div><div><span className="ia-icon"><ShoppingCart size={19} /></span><b>주문</b><small>통합 주문 · 출고 · 배송 · 중앙 재고</small></div><div><span className="ia-icon"><Headphones size={19} /></span><b>CS</b><small>문의 통합 · 자동 번역 · AI 답변 · SLA</small></div><div><span className="ia-icon"><Store size={19} /></span><b>채널별</b><small>매출 · 주문 · 전환율 · 상품 · 운영 점수</small></div></div></section>
    </div>
  );
}

function DashboardShell({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const meta = pageMeta[view];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const navigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const content = useMemo(() => {
    if (view === "overview") return <OverviewPage onNavigate={navigate} />;
    if (view === "products") return <ProductsPage onNavigate={navigate} />;
    if (view === "publishing") return <PublishingPage notify={notify} />;
    if (view === "orders") return <OrdersPage />;
    if (view === "cs") return <CsPage notify={notify} />;
    if (view === "storyboard") return <StoryboardPage onNavigate={navigate} />;
    return <ChannelPage channelKey={view as ChannelKey} />;
  }, [view]);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head"><div className="brand-lockup light"><span className="brand-symbol"><Zap size={17} fill="currentColor" /></span><strong>SellerPilot</strong></div><button aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
        <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const isActive = view === item.id;
          return <button key={item.id} className={isActive ? "active" : ""} onClick={() => navigate(item.id)}>{Icon ? <Icon size={17} /> : <ChannelMark code={(item as { channel: string }).channel} size="sm" />}<span>{item.label}</span>{"badge" in item && item.badge ? <em>{item.badge}</em> : isActive ? <ChevronRight size={14} /> : null}</button>;
        })}</div>)}</nav>
        <div className="sidebar-insight"><div><Sparkles size={15} /><span>AI 자동화</span><em>ON</em></div><p>오늘 <b>46건</b>의 반복 작업을<br />자동으로 처리했습니다.</p><span><i /></span><small>시스템 정상 운영 중</small></div>
        <div className="sidebar-foot"><button><LifeBuoy size={17} /><span>도움말 · 가이드</span></button><button><Settings size={17} /><span>설정</span></button><button onClick={onLogout}><LogOut size={17} /><span>로그아웃</span></button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className="demo-data-badge"><Activity size={13} /><b>{DEMO_DATA_META.label}</b><small>{DEMO_DATA_META.기준일} 기준</small></span><button className="global-search" onClick={() => setSearchOpen(true)}><Search size={16} /><span>상품, 주문, CS 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap"><button className="top-icon-button" aria-label="알림" onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} /><i /></button>{notificationsOpen && <div className="notification-popover"><div><h4>알림</h4><button onClick={() => setNotificationsOpen(false)}>모두 읽음</button></div><button><span className="alert-icon danger"><Box size={15} /></span><span><b>재고 부족 상품이 있습니다.</b><small>3개 상품 · 5분 전</small></span></button><button><span className="alert-icon warning"><AlertCircle size={15} /></span><span><b>등록 실패 2건을 확인하세요.</b><small>Qoo10 · 18분 전</small></span></button></div>}</div><button className="user-menu"><span className="user-avatar">김</span><span><b>김창희</b><small>최고 관리자</small></span><ChevronDown size={14} /></button></div>
        </header>
        <div className="app-content">{content}</div>
      </section>

      {searchOpen && <div className="command-overlay" onClick={() => setSearchOpen(false)}><div className="command-dialog" onClick={(event) => event.stopPropagation()}><div className="command-input"><Search size={18} /><input autoFocus placeholder="상품명, 주문번호, 고객명 검색" /><button onClick={() => setSearchOpen(false)}><X size={17} /></button></div><span className="command-label">빠른 이동</span>{navGroups[0].items.slice(0, 5).map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { navigate(item.id); setSearchOpen(false); }}><Icon size={17} /><span>{item.label}</span><ArrowRight size={14} /></button>; })}</div></div>}
      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span><button onClick={() => setToast("")}><X size={14} /></button></div>}
    </main>
  );
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  return authenticated ? <DashboardShell onLogout={() => setAuthenticated(false)} /> : <LoginScreen onLogin={() => setAuthenticated(true)} />;
}
