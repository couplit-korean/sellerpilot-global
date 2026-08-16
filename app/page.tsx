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
  Bell,
  Bot,
  Box,
  CalendarDays,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  ClipboardCheck,
  Command,
  Eye,
  EyeOff,
  ExternalLink,
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
  Link2,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  KeyRound,
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
  TrendingUp,
  Trash2,
  Truck,
  Upload,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AiProductStudio } from "./ai-product-studio";
import { AcceptanceChecklistPage } from "./acceptance-checklist";
import { ApiCredentialCenter } from "./api-credential-center";
import { ChannelReadinessPage } from "./channel-readiness";
import { MarginCalculatorPage } from "./margin-calculator";
import { channels, DEMO_DATA_META, orders, productImages, products, tickets, type ChannelKey } from "./mock-data";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";

type View =
  | "overview"
  | "products"
  | "publishing"
  | "margin"
  | "orders"
  | "cs"
  | "readiness"
  | "credentials"
  | "qoo10"
  | "shopee"
  | "lazada"
  | "coupang"
  | "elevenst"
  | "smartstore"
  | "ebay"
  | "alibaba"
  | "one688"
  | "acceptance"
  | "storyboard";

const navGroups = [
  {
    label: "운영",
    items: [
      { id: "overview" as View, label: "통합 대시보드", icon: LayoutDashboard },
      { id: "products" as View, label: "상품 관리", icon: Package },
      { id: "publishing" as View, label: "상품 등록", icon: CloudUpload, badge: "12" },
      { id: "margin" as View, label: "마진 계산", icon: Calculator },
      { id: "orders" as View, label: "주문 · 판매", icon: ShoppingCart },
      { id: "cs" as View, label: "CS 통합함", icon: Headphones, badge: "7" },
      { id: "readiness" as View, label: "채널 연동 준비", icon: ShieldCheck },
      { id: "credentials" as View, label: "API 키 · 인증", icon: KeyRound },
    ],
  },
  {
    label: "판매 채널",
    items: [
      { id: "qoo10" as View, label: "Qoo10 Japan", channel: "Q" },
      { id: "shopee" as View, label: "Shopee SG", channel: "S" },
      { id: "lazada" as View, label: "Lazada MY", channel: "L" },
      { id: "coupang" as View, label: "쿠팡", channel: "C" },
      { id: "elevenst" as View, label: "11번가", channel: "11" },
      { id: "smartstore" as View, label: "네이버 스마트스토어", channel: "N" },
      { id: "ebay" as View, label: "eBay Global", channel: "E" },
      { id: "alibaba" as View, label: "Alibaba.com", channel: "A", disabled: true },
      { id: "one688" as View, label: "1688.com", channel: "1688", disabled: true },
    ],
  },
  {
    label: "기획",
    items: [
      { id: "acceptance" as View, label: "개발 · 실검수", icon: ClipboardCheck },
      { id: "storyboard" as View, label: "서비스 스토리보드", icon: FileText },
    ],
  },
];

const pageMeta: Record<View, { title: string; description: string }> = {
  overview: { title: "통합 대시보드", description: "모든 채널의 오늘을 한눈에 확인하세요." },
  products: { title: "상품 관리", description: "채널별 등록 상태, 재고와 판매 성과를 관리합니다." },
  publishing: { title: "상품 등록 센터", description: "대표사진과 다양한 각도 사진, 설명과 링크를 함께 분석해 채널 등록을 자동화합니다." },
  margin: { title: "마진 계산", description: "원가와 채널 비용을 반영해 순이익과 목표 마진 판매가를 계산합니다." },
  orders: { title: "주문 · 판매", description: "전체 채널의 주문과 배송 흐름을 한곳에서 처리합니다." },
  cs: { title: "CS 통합함", description: "언어와 채널이 달라도 하나의 상담함에서 응대합니다." },
  readiness: { title: "채널 연동 준비", description: "실제 판매자·개발자 콘솔 상태와 API 연결 차단 요인을 증거 기준으로 관리합니다." },
  credentials: { title: "API 키 · 인증 관리", description: "채널 키의 보관, 만료, 교체, 연결 검사와 감사기록을 한곳에서 관리합니다." },
  qoo10: { title: "Qoo10 Japan", description: "일본 스토어의 상품, 매출, 주문, CS 성과입니다." },
  shopee: { title: "Shopee Singapore", description: "싱가포르 스토어의 상품, 매출, 주문, CS 성과입니다." },
  lazada: { title: "Lazada Malaysia", description: "말레이시아 스토어의 상품, 매출, 주문, CS 성과입니다." },
  coupang: { title: "쿠팡", description: "쿠팡 스토어의 상품, 매출, 주문, CS 성과입니다." },
  elevenst: { title: "11번가", description: "11번가 스토어의 상품, 매출, 주문, CS 성과입니다." },
  smartstore: { title: "네이버 스마트스토어", description: "스마트스토어의 상품, 매출, 주문, CS 성과입니다." },
  ebay: { title: "eBay Global", description: "글로벌 스토어의 상품, 매출, 주문, CS 성과입니다." },
  alibaba: { title: "Alibaba.com", description: "글로벌 B2B 채널 연동을 준비하고 있습니다." },
  one688: { title: "1688.com", description: "중국 내수 B2B 채널 연동을 준비하고 있습니다." },
  acceptance: { title: "개발 · 실검수", description: "PPT 기반 175개 요구사항의 개발 상태와 실제 작동 증거를 분리해 관리합니다." },
  storyboard: { title: "서비스 스토리보드", description: "로그인부터 자동 등록, 판매, CS까지의 전체 사용자 흐름입니다." },
};

const channelPerformance = [
  { code: "Q", name: "Qoo10 Japan", revenue: "₩22.4M", orders: "584", rate: 92, delta: "+18.6%", view: "qoo10" as View },
  { code: "S", name: "Shopee Singapore", revenue: "₩16.8M", orders: "438", rate: 71, delta: "+12.1%", view: "shopee" as View },
  { code: "L", name: "Lazada Malaysia", revenue: "₩9.7M", orders: "262", rate: 46, delta: "+8.4%", view: "lazada" as View },
  { code: "C", name: "쿠팡", revenue: "₩18.6M", orders: "512", rate: 78, delta: "+15.3%", view: "coupang" as View },
  { code: "11", name: "11번가", revenue: "₩7.4M", orders: "198", rate: 39, delta: "+6.7%", view: "elevenst" as View },
  { code: "N", name: "네이버 스마트스토어", revenue: "₩14.9M", orders: "406", rate: 65, delta: "+11.8%", view: "smartstore" as View },
  { code: "E", name: "eBay Global", revenue: "₩6.8M", orders: "144", rate: 33, delta: "+5.9%", view: "ebay" as View },
];

const ticketChannelCodes: Record<string, string> = {
  Qoo10: "Q",
  Shopee: "S",
  Lazada: "L",
  쿠팡: "C",
  "11번가": "11",
  "네이버 스마트스토어": "N",
  eBay: "E",
};

const channelByCode = new Map(Object.values(channels).map((channel) => [channel.letter, channel]));
const monthlyTopProducts = [...products].sort((a, b) => b.sales - a.sales).slice(0, 10);
const channelFactors: Record<ChannelKey, { sales: string; orders: string; products: string; cs: string; rate: number }> = {
  qoo10: { sales: "₩22.4M", orders: "584", products: "326", cs: "96.2%", rate: 84 },
  shopee: { sales: "₩16.8M", orders: "438", products: "284", cs: "93.8%", rate: 69 },
  lazada: { sales: "₩9.7M", orders: "262", products: "219", cs: "92.6%", rate: 53 },
  coupang: { sales: "₩18.6M", orders: "512", products: "318", cs: "95.4%", rate: 79 },
  elevenst: { sales: "₩7.4M", orders: "198", products: "241", cs: "91.8%", rate: 61 },
  smartstore: { sales: "₩14.9M", orders: "406", products: "304", cs: "97.1%", rate: 88 },
  ebay: { sales: "₩6.8M", orders: "144", products: "172", cs: "90.9%", rate: 58 },
};

const initialExchangeRates = [
  { code: "USD", unit: 1, value: 1378.4, change: 0.24 },
  { code: "JPY", unit: 100, value: 931.12, change: -0.18 },
  { code: "SGD", unit: 1, value: 1072.65, change: 0.08 },
  { code: "MYR", unit: 1, value: 325.84, change: -0.11 },
];

function ChannelMark({ code, size = "md" }: { code: string; size?: "sm" | "md" | "lg" }) {
  const config = channelByCode.get(code) ?? channels.qoo10;
  return <span className={`channel-mark ${size} ${code.length > 1 ? "wide" : ""}`} style={{ "--channel-color": config.color } as React.CSSProperties}>{code}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("완료") || status === "판매중" || status === "정상" ? "success" : status.includes("주의") || status.includes("대기") || status === "처리 중" ? "warning" : status.includes("긴급") || status === "품절" || status.includes("실패") ? "danger" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}

function SparkLine({ points, color = "#e85d04", fill = false }: { points: string; color?: string; fill?: boolean }) {
  return (
    <svg className="sparkline" viewBox="0 0 120 42" aria-hidden="true" preserveAspectRatio="none">
      {fill && <polygon points={`0,42 ${points} 120,42`} fill={color} opacity=".08" />}
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoginScreen({ onLogin, onPasswordReset }: { onLogin: (email: string, password: string) => Promise<string | null>; onPasswordReset: (email: string) => Promise<string | null> }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    const loginError = await onLogin(email.trim(), password);
    setLoading(false);
    if (loginError) setError(loginError);
  };

  const requestPasswordReset = async () => {
    if (!email.trim()) {
      setError("비밀번호를 재설정할 관리자 이메일을 먼저 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    const resetError = await onPasswordReset(email.trim());
    setLoading(false);
    setError(resetError ?? "비밀번호 재설정 링크를 이메일로 보냈습니다.");
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong><small>SELLER CONTROL</small></div>
        <div className="login-message">
          <span className="login-section-label">글로벌 셀러 통합 업무 화면</span>
          <h1>주문·상품·문의 업무를<br />하나의 작업대에서.</h1>
          <p>판매 채널을 오가며 확인하던 주문, 상품 등록, 재고, 정산과 고객 문의를<br />업무 우선순위에 맞춰 한 화면에 정리했습니다.</p>
          <div className="login-operations-preview">
            <div className="preview-heading"><b>오늘의 운영 브리핑</b><span>2026.08.16 · 09:42</span></div>
            <div className="preview-task urgent"><span>01</span><div><b>오늘 발송 마감</b><small>18건 · 오후 2시 이전 처리</small></div><strong>18</strong></div>
            <div className="preview-task"><span>02</span><div><b>신규 주문 확인</b><small>7개 채널 통합</small></div><strong>46</strong></div>
            <div className="preview-task"><span>03</span><div><b>답변 대기 문의</b><small>1시간 초과 2건 포함</small></div><strong>7</strong></div>
            <div className="preview-settlement"><span>오늘 정산 예정</span><b>₩4,820,400</b><em>3개 채널</em></div>
          </div>
          <div className="login-market-row"><span>판매 채널</span><div><ChannelMark code="Q" size="sm" /><ChannelMark code="S" size="sm" /><ChannelMark code="L" size="sm" /><ChannelMark code="C" size="sm" /><ChannelMark code="11" size="sm" /><ChannelMark code="N" size="sm" /><ChannelMark code="E" size="sm" /></div><b><i />연동 상태 통합 관리</b></div>
        </div>
        <footer><span>SellerPilot Commerce Control</span><span>상품 · 주문 · CS · 정산 통합 운영</span></footer>
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
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button" onClick={() => void requestPasswordReset()}>비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <label className="remember-row"><input type="checkbox" defaultChecked /><span><Check size={12} /></span>로그인 상태 유지</label>
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />접속 중...</> : <>대시보드 접속<ArrowRight size={18} /></>}</button>
          <div className="demo-account"><ShieldCheck size={15} /><span>Supabase Auth로 인증하며 채널 키 원문은 로그인 후에도 표시하지 않습니다.<br /><b>관리자 초대 메일에서 비밀번호를 설정해 주세요.</b></span></div>
        </form>
        <div className="login-support"><HelpCircle size={15} />접속에 문제가 있나요? <button>운영 지원팀 문의</button></div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, delta, detail, icon: Icon, tone, reverse }: { label: string; value: string; delta: string; detail: string; icon: React.ComponentType<{ size?: number }>; tone: string; reverse?: boolean }) {
  return (
    <article className="metric-card">
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong></div>
      <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
      <div className="metric-foot"><span className={reverse ? "negative" : "positive"}>{reverse ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta}</span><small>{detail}</small></div>
    </article>
  );
}

function OverviewPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [period, setPeriod] = useState("30일");
  const [exchangeRates, setExchangeRates] = useState(initialExchangeRates);
  const [rateUpdatedAt, setRateUpdatedAt] = useState("화면 기준값");
  const [rateSource, setRateSource] = useState("실데이터 확인 중");
  const chartPoints = period === "7일" ? "0,31 18,29 36,33 54,20 72,24 90,14 108,18 120,7" : period === "90일" ? "0,35 12,33 24,28 36,31 48,22 60,25 72,15 84,18 96,10 108,13 120,5" : "0,36 10,32 20,34 30,27 40,29 50,20 60,23 70,14 80,18 90,9 100,13 110,4 120,7";

  const refreshExchangeRates = useCallback(async () => {
    setRateSource("기준 환율 확인 중");
    try {
      const response = await fetch("/api/exchange-rates", { cache: "no-store" });
      if (!response.ok) throw new Error("exchange-rate request failed");
      const payload = await response.json() as { source: string; asOf: string; rates: typeof initialExchangeRates };
      setExchangeRates(payload.rates);
      setRateUpdatedAt(payload.asOf);
      setRateSource(`${payload.source} · 일일 기준`);
    } catch {
      setRateSource("연결 실패 · 화면 기준값 유지");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshExchangeRates(), 0);
    const interval = window.setInterval(() => void refreshExchangeRates(), 3_600_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshExchangeRates]);

  return (
    <div className="page-stack">
      <section className="daily-briefing">
        <div className="briefing-copy"><span>8월 16일 일요일</span><h2>오늘 처리할 업무가 <b>31건</b> 있습니다.</h2><p>발송 마감과 고객 요청을 먼저 확인하세요.</p></div>
        <div className="briefing-tasks">
          <button onClick={() => onNavigate("orders")}><span className="task-tone order" /><small>신규 주문</small><b>46</b><em>7개 채널</em></button>
          <button onClick={() => onNavigate("orders")}><span className="task-tone shipping" /><small>오늘 발송 마감</small><b>18</b><em>14:00 이전</em></button>
          <button onClick={() => onNavigate("cs")}><span className="task-tone claim" /><small>취소·반품·교환</small><b>6</b><em>신규 3건</em></button>
          <button onClick={() => onNavigate("publishing")}><span className="task-tone error" /><small>등록 오류</small><b>2</b><em>속성 확인</em></button>
        </div>
        <aside className="briefing-settlement"><span>오늘 정산 예정</span><strong>₩4,820,400</strong><small>스마트스토어 · 쿠팡 · 11번가</small><button>정산 내역 보기<ChevronRight size={14} /></button></aside>
      </section>
      <section className="overview-toolbar">
        <article className="exchange-widget" aria-label="현재 환율">
          <div className="exchange-title"><span><i />기준 환율</span><small>KRW 기준 · {rateUpdatedAt}</small><small>{rateSource}</small></div>
          <div className="exchange-rate-list">{exchangeRates.map((rate) => <div className="exchange-rate" key={rate.code}><small>{rate.code} {rate.unit}</small><strong>₩{rate.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><em className={rate.change >= 0 ? "up" : "down"}>{rate.change >= 0 ? "▲" : "▼"} {Math.abs(rate.change).toFixed(2)}%</em></div>)}</div>
          <button type="button" className="exchange-refresh" aria-label="환율 새로고침" title="환율 새로고침" onClick={refreshExchangeRates}><RefreshCw size={14} /></button>
        </article>
        <div className="overview-date-actions"><div className="period-control"><CalendarDays size={15} /><button>2026.07.17</button><span>—</span><button>2026.08.15</button></div><div className="segmented-control">{["7일", "30일", "90일"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
      </section>

      <section className="metric-grid">
        <MetricCard label="총 매출" value={period === "7일" ? "₩24.8M" : period === "90일" ? "₩258.4M" : "₩96.6M"} delta="17.2%" detail="이전 기간 대비" icon={CircleDollarSign} tone="violet" />
        <MetricCard label="주문" value={period === "7일" ? "706" : period === "90일" ? "7,114" : "2,544"} delta="12.8%" detail="취소율 1.8%" icon={ShoppingBag} tone="blue" />
        <MetricCard label="등록 완료" value="326" delta="8.4%" detail="등록 대기 12건" icon={PackageCheck} tone="green" />
        <MetricCard label="CS 응답률" value="94.6%" delta="2.1%" detail="평균 18분" icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">매출 분석</span><h3>채널 통합 매출</h3></div><button className="ghost-button">리포트 보기<ChevronRight size={15} /></button></div>
          <div className="chart-legend"><span><i className="legend-dot q" />Qoo10 <b>₩22.4M</b></span><span><i className="legend-dot s" />Shopee <b>₩16.8M</b></span><span><i className="legend-dot l" />Lazada <b>₩9.7M</b></span></div>
          <div className="revenue-chart">
            <div className="chart-y-labels"><span>2.0M</span><span>1.5M</span><span>1.0M</span><span>0.5M</span><span>0</span></div>
            <div className="chart-stage">
              <div className="chart-grid-lines"><i /><i /><i /><i /><i /></div>
              <svg viewBox="0 0 120 42" preserveAspectRatio="none" role="img" aria-label="최근 매출 추이">
                <defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e85d04" stopOpacity=".18" /><stop offset="100%" stopColor="#e85d04" stopOpacity="0" /></linearGradient></defs>
                <polygon points={`0,42 ${chartPoints} 120,42`} fill="url(#areaGradient)" />
                <polyline points={chartPoints} fill="none" stroke="#e85d04" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="110" cy={period === "7일" ? "4" : period === "90일" ? "13" : "4"} r="1.8" fill="#fff" stroke="#e85d04" strokeWidth="1.2" />
              </svg>
              <div className="chart-x-labels"><span>7/17</span><span>7/24</span><span>7/31</span><span>8/7</span><span>8/15</span></div>
            </div>
          </div>
        </article>

        <article className="panel top-ranking-card">
          <div className="panel-heading"><div><span className="panel-kicker">최근 30일 판매량 기준</span><h3>이번 달 판매 TOP 10</h3></div><span className="rank-crown">1–10</span></div>
          <div className="monthly-ranking-list">
            {monthlyTopProducts.map((product, index) => <button className={`ranking-row ${index < 3 ? "podium" : ""}`} key={product.id} onClick={() => onNavigate("products")}>
              <span className="ranking-number">{index + 1}</span>
              <span className="ranking-thumb"><Image src={product.image} alt="" fill sizes="38px" /></span>
              <span className="ranking-product"><b>{product.name}</b><small>{product.channels.length}개 채널 판매중</small></span>
              <span className="ranking-channels">{product.channels.slice(0, 3).map((code) => <ChannelMark key={code} code={code} size="sm" />)}{product.channels.length > 3 && <em>+{product.channels.length - 3}</em>}</span>
              <span className="ranking-sales"><b>{product.sales.toLocaleString()}개</b><small>{product.revenue}</small></span>
            </button>)}
          </div>
          <button className="full-ghost-button" onClick={() => onNavigate("products")}>전체 상품 성과 보기<ArrowRight size={15} /></button>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel channel-performance">
          <div className="panel-heading"><div><span className="panel-kicker">연동 준비 상태</span><h3>채널별 운영 미리보기</h3></div><span className="live-label"><i />샘플</span></div>
          <div className="channel-list">
            {channelPerformance.map((channel) => <button className="channel-row" key={channel.code} onClick={() => onNavigate(channel.view)}><ChannelMark code={channel.code} /><div className="channel-name"><strong>{channel.name}</strong><span><i />실계정 미연결 · 화면 검증용 데이터</span></div><div className="channel-metric"><small>샘플 매출</small><b>{channel.revenue}</b></div><div className="channel-metric"><small>샘플 주문</small><b>{channel.orders}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.rate}%` }} /></span><b>{channel.delta}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">오늘 자동 등록 작업</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("publishing")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>338</strong><span>이번 달 처리</span></div><i /><div><strong>96.4%</strong><span>자동 등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: 4, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: 8, tone: "blue", icon: Upload }, { label: "등록 완료", value: 326, tone: "green", icon: CheckCircle2 }, { label: "확인 필요", value: 5, tone: "red", icon: AlertCircle }].map((item) => <div key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">우선 처리 필요</span><h3>지금 확인할 항목</h3></div><span className="count-chip">7</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고 10개 이하 상품 3건</b><small>품절 전 재입고가 필요합니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 2건</b><small>카테고리 속성 누락을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("cs")}><span className="alert-icon blue"><MessageCircleMore size={16} /></span><span><b>1시간 이상 미답변 CS 2건</b><small>Qoo10 Japan 문의입니다.</small></span><em>답변하기<ChevronRight size={14} /></em></button>
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-heading"><div><span className="panel-kicker">자주 쓰는 메뉴</span><h3>빠른 실행</h3></div></div>
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

type UploadedPhoto = { name: string; url: string; file: File };

const optionalPhotoSlots = [
  { id: "front", label: "정면", guide: "제품 전체 정면" },
  { id: "back", label: "후면", guide: "뒷면 표시사항" },
  { id: "left", label: "좌측면", guide: "왼쪽 측면" },
  { id: "right", label: "우측면", guide: "오른쪽 측면" },
  { id: "top", label: "상단", guide: "상단 패키지" },
  { id: "bottom", label: "하단", guide: "하단 제조정보" },
  { id: "label", label: "성분 · 라벨", guide: "글자가 선명하게" },
  { id: "barcode", label: "바코드", guide: "숫자까지 보이게" },
] as const;

function PublishingPage({ notify }: { notify: (message: string) => void }) {
  const [running, setRunning] = useState(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [description, setDescription] = useState("국내 제조 이너뷰티 제품으로, 화이트토마토와 글루타치온을 간편하게 섭취할 수 있는 30정 패키지입니다. 일본·싱가포르·말레이시아 판매를 준비합니다.");
  const [productUrl, setProductUrl] = useState("https://example.com/products/white-tomato-glutathione");
  const [uploadError, setUploadError] = useState("");
  const [studioRequestId, setStudioRequestId] = useState(0);

  const toPhoto = (file: File): UploadedPhoto => ({ name: file.name, url: URL.createObjectURL(file), file });

  const selectMainPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (mainPhoto) URL.revokeObjectURL(mainPhoto.url);
    setMainPhoto(toPhoto(file));
    setUploadError("");
    event.target.value = "";
  };

  const selectSlotPhoto = (slotId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSlotPhotos((current) => {
      if (current[slotId]) URL.revokeObjectURL(current[slotId].url);
      return { ...current, [slotId]: toPhoto(file) };
    });
    event.target.value = "";
  };

  const selectExtraPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setExtraPhotos((current) => [...current, ...files.map(toPhoto)]);
    event.target.value = "";
  };

  const removeSlotPhoto = (slotId: string) => {
    setSlotPhotos((current) => {
      const next = { ...current };
      if (next[slotId]) URL.revokeObjectURL(next[slotId].url);
      delete next[slotId];
      return next;
    });
  };

  const removeExtraPhoto = (index: number) => {
    setExtraPhotos((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  };

  const openProductUrl = () => {
    try {
      const url = new URL(productUrl);
      if (!url.protocol.startsWith("http")) throw new Error("invalid protocol");
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } catch {
      notify("http:// 또는 https://로 시작하는 상품 링크를 입력해 주세요.");
    }
  };

  const startAutomation = () => {
    if (!mainPhoto) {
      setUploadError("AI 상품 분석을 시작하려면 대표사진 1장이 반드시 필요합니다.");
      notify("대표사진 1장을 먼저 등록해 주세요.");
      return;
    }
    const photoCount = 1 + Object.keys(slotPhotos).length + extraPhotos.length;
    setRunning(true);
    setUploadError("");
    const context = [description.trim() ? "상품 설명" : "", productUrl.trim() ? "참고 링크" : ""].filter(Boolean).join("과 ");
    notify(`${photoCount}장의 사진${context ? `, ${context}` : ""}이 AI 분석 자료에 반영되었습니다.`);
    setStudioRequestId((current) => current + 1);
  };

  const totalPhotoCount = (mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length;

  return (
    <div className="page-stack publishing-page">
      <section className="publishing-hero">
        <div><span className="eyebrow dark"><Sparkles size={14} /> AI PRODUCT PUBLISHER</span><h2>사진은 충분히,<br /><em>등록은 한 번에.</em></h2><p>대표사진과 여러 각도의 옵션 사진, 상품 설명과 참고 링크를 함께 분석해<br />더 정확한 상품 정보와 채널별 등록 초안을 생성합니다.</p></div>
        <div className="automation-flow-mini"><span><ImagePlus size={17} />다각도 사진</span><ArrowRight size={15} /><span><Bot size={17} />통합 분석</span><ArrowRight size={15} /><span><Languages size={17} />다국어</span><ArrowRight size={15} /><span><Globe2 size={17} />7개 채널</span></div>
      </section>
      <section className="publishing-layout">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><span className="panel-kicker">NEW PRODUCT</span><h3>새 상품 분석 자료</h3></div><span className="step-chip">STEP 1 / 3</span></div>

          <section className="main-photo-section">
            <div className="upload-section-heading"><div><b>대표사진</b><span className="required-chip">필수</span><small>검색 결과와 채널 목록에서 가장 먼저 보이는 이미지입니다.</small></div><em>{mainPhoto ? "1장 등록됨" : "미등록"}</em></div>
            <label className={`drop-zone main-drop-zone ${mainPhoto ? "has-photo" : ""} ${running ? "running" : ""}`} htmlFor="main-product-photo">
              <input id="main-product-photo" className="visually-hidden" type="file" accept="image/*" onChange={selectMainPhoto} />
              {mainPhoto ? <><span className="main-photo-preview"><Image src={mainPhoto.url} alt="등록한 대표 상품 사진" fill sizes="700px" unoptimized /></span><span className="photo-preview-overlay"><ImagePlus size={17} />대표사진 교체</span><strong className="photo-file-name">{mainPhoto.name}</strong></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>대표 상품 사진을 넣으세요</strong><p>클릭하여 JPG, PNG, WEBP 파일 선택 · 대표사진 1장 필수</p><em><ImagePlus size={15} />대표사진 선택</em></>}
              {running && <span className="analysis-overlay"><LoaderCircle className="spin" size={29} /><b>사진·설명·링크 통합 분석 중</b><small>OCR과 상품 정보 교차검증을 진행하고 있습니다.</small><i><span /></i></span>}
            </label>
            {uploadError && <p className="upload-error"><AlertCircle size={14} />{uploadError}</p>}
          </section>

          <section className="option-photo-section">
            <div className="upload-section-heading"><div><b>옵션 사진</b><span className="optional-chip">선택</span><small>각도와 표시사항이 많을수록 분석 정확도가 높아집니다.</small></div><em>{Object.keys(slotPhotos).length} / {optionalPhotoSlots.length}장</em></div>
            <div className="option-photo-grid">
              {optionalPhotoSlots.map((slot) => {
                const photo = slotPhotos[slot.id];
                return <div className={`option-slot-wrap ${photo ? "has-photo" : ""}`} key={slot.id}><label className="option-photo-slot" htmlFor={`option-photo-${slot.id}`}><input id={`option-photo-${slot.id}`} className="visually-hidden" type="file" accept="image/*" onChange={(event) => selectSlotPhoto(slot.id, event)} />{photo ? <><Image src={photo.url} alt={`${slot.label} 상품 사진`} fill sizes="180px" unoptimized /><span className="slot-photo-label"><b>{slot.label}</b><small>클릭하여 교체</small></span></> : <><span><ImagePlus size={18} /></span><b>{slot.label}</b><small>{slot.guide}</small></>}</label>{photo && <button type="button" className="remove-photo-button" aria-label={`${slot.label} 사진 삭제`} onClick={() => removeSlotPhoto(slot.id)}><Trash2 size={13} /></button>}</div>;
              })}
            </div>
          </section>

          <section className="extra-photo-section">
            <div className="upload-section-heading"><div><b>추가 사진</b><span className="optional-chip">여러 장</span><small>상세컷, 구성품, 포장 상태 등 필요한 만큼 한 번에 선택할 수 있습니다.</small></div><em>{extraPhotos.length}장 추가됨</em></div>
            <label className="extra-photo-uploader" htmlFor="extra-product-photos"><input id="extra-product-photos" className="visually-hidden" type="file" accept="image/*" multiple onChange={selectExtraPhotos} /><Plus size={17} /><span><b>추가 사진 더 넣기</b><small>여러 파일을 동시에 선택할 수 있습니다.</small></span></label>
            {extraPhotos.length > 0 && <div className="extra-photo-list">{extraPhotos.map((photo, index) => <div key={`${photo.name}-${index}`}><span><Image src={photo.url} alt={`추가 상품 사진 ${index + 1}`} fill sizes="100px" unoptimized /></span><small>{index + 1}</small><button type="button" aria-label={`추가 사진 ${index + 1} 삭제`} onClick={() => removeExtraPhoto(index)}><X size={12} /></button></div>)}</div>}
          </section>

          <section className="product-context-section">
            <div className="upload-section-heading"><div><b>상품 분석 참고 정보</b><span className="optional-chip">선택</span><small>입력한 텍스트와 공개 링크의 상품 정보를 이미지 분석 결과와 함께 반영합니다.</small></div></div>
            <label className="context-field"><span>상품 간략 설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="용도, 재질, 구성, 핵심 특징, 판매 국가 등 사진만으로 알기 어려운 정보를 입력하세요." /><small>{description.length} / 1,000자</small></label>
            <label className="context-field"><span>참고 상품 링크</span><div className="product-link-input"><Link2 size={16} /><input type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} placeholder="https:// 제조사 또는 공급사 상품 페이지" /><button type="button" onClick={openProductUrl} disabled={!productUrl.trim()}><ExternalLink size={14} />링크 열기</button></div><small>로그인 없이 접근 가능한 제조사·공급사·공식 상품 링크를 권장합니다.</small></label>
            <div className="analysis-context-note"><ShieldCheck size={16} /><span><b>AI 분석 반영 방식</b><small>대표사진을 기준으로 옵션 사진의 OCR·바코드와 설명·링크 정보를 교차검증합니다. 충돌하는 정보는 자동 확정하지 않고 확인 필요로 표시합니다.</small></span></div>
          </section>

          <div className="analysis-start-bar"><span><b>{totalPhotoCount}장</b>의 상품 사진 · 설명 {description.trim() ? "입력됨" : "미입력"} · 링크 {productUrl.trim() ? "입력됨" : "미입력"}</span><button type="button" onClick={startAutomation} disabled={running}>{running ? <><LoaderCircle className="spin" size={17} />분석 중</> : <><WandSparkles size={17} />AI 상품 분석 시작</>}</button></div>
        </article>
        <aside className="panel publishing-settings"><div className="panel-heading"><div><span className="panel-kicker">PUBLISH TO</span><h3>등록할 채널</h3></div><Settings size={16} /></div>
          <div className="publish-channel-list">{Object.values(channels).map((channel) => <label key={channel.letter} className={channel.enabled ? "" : "channel-disabled"}><ChannelMark code={channel.letter} /><span><b>{channel.name}{!channel.enabled && <em>준비중</em>}</b><small>{channel.enabled ? `${channel.market} · API 연결 전` : `${channel.market} · 연동 준비 중`}</small></span><input type="checkbox" defaultChecked={channel.enabled} disabled={!channel.enabled} aria-label={`${channel.name} 등록 ${channel.enabled ? "선택" : "비활성화"}`} /><i><Check size={12} /></i></label>)}</div>
          <div className="auto-options"><h4>자동화 옵션</h4><label><span><b>AI 다국어 번역</b><small>한국어, 일본어, 영어, 말레이어</small></span><input type="checkbox" aria-label="AI 다국어 번역 사용" defaultChecked /><i /></label><label><span><b>마진 기반 가격 계산</b><small>목표 마진 28% 적용</small></span><input type="checkbox" aria-label="마진 기반 가격 계산 사용" defaultChecked /><i /></label><label><span><b>검증 통과 시 자동 등록</b><small>신뢰도 97% 이상</small></span><input type="checkbox" aria-label="검증 통과 시 자동 등록 사용" defaultChecked /><i /></label></div>
        </aside>
      </section>
      <AiProductStudio
        mainPhoto={mainPhoto}
        photos={mainPhoto ? [mainPhoto, ...Object.values(slotPhotos), ...extraPhotos] : []}
        description={description}
        productUrl={productUrl}
        requestId={studioRequestId}
        onRunningChange={setRunning}
        notify={notify}
        sampleImage={productImages[0]}
      />
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">TODAY&apos;S QUEUE</span><h3>오늘의 등록 작업</h3></div><button className="ghost-button">작업 이력<ChevronRight size={15} /></button></div>
        <div className="queue-table"><div className="queue-header"><span>상품</span><span>AI 분석</span><span>상세페이지</span><span>채널 등록</span><span>상태</span></div>{[
          { name: "화이트토마토 글루타치온 30정", image: 0, ai: "완료", detail: "다국어 완료", channel: "7 / 7", status: "등록 완료" },
          { name: "저분자 피쉬콜라겐 60포", image: 1, ai: "완료", detail: "다국어 완료", channel: "4 / 7", status: "등록 중" },
          { name: "콜드브루 콜라겐 젤리", image: 2, ai: "검토 필요", detail: "대기", channel: "0 / 7", status: "확인 필요" },
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
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input placeholder="문의 검색" /></div><button className="icon-only-button"><Filter size={16} /></button></div><div className="ticket-tabs"><button className="active">미답변 <span>7</span></button><button>처리 중</button><button>완료</button></div>{tickets.map((ticket) => <button key={ticket.id} className={`ticket-item ${selected.id === ticket.id ? "active" : ""}`} onClick={() => { setSelected(ticket); setReply(""); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back"><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><button className="filter-button">처리 중<ChevronDown size={14} /></button><button className="icon-only-button"><MoreHorizontal size={18} /></button></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>{orders[0].product}</b></span><em>{orders[0].id}<ChevronRight size={14} /></em></div><div className="message-date"><span>오늘</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.subject === "복용 방법 문의" ? "Can I take two tablets at once after a meal? Please let me know the recommended daily intake." : selected.subject === "옵션 변경 요청" ? "I selected the wrong option. Could you change it before shipping?" : "주문한 지 3일이 지났는데 아직 송장 조회가 되지 않아요. 언제부터 확인할 수 있나요?"}</p><span>자동 번역됨 · 원문 보기</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />AI가 주문 정보와 정책을 반영한 답변 초안을 만들었습니다.</span><button onClick={() => setReply("고객님의 주문과 배송 현황을 확인한 뒤 신속히 안내드리겠습니다.")}><RefreshCw size={13} />다시 생성</button></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="답변을 입력하세요." /><div><span><button><Languages size={15} />일본어로 전송<ChevronDown size={13} /></button><button><FileText size={15} />템플릿</button></span><button className="send-button" disabled={!reply} onClick={sendReply}>답변 전송<Send size={15} /></button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>총 주문</small><b>4건</b></div><div><small>누적 구매</small><b>₩184,200</b></div></div><div className="detail-section"><h5>현재 주문</h5><div className="mini-order"><span className="tiny-thumb"><Image src={productImages[0]} alt="" fill sizes="40px" /></span><span><b>화이트토마토 글루타치온</b><small>1개 · ¥4,280</small></span></div><dl><div><dt>주문번호</dt><dd>{orders[0].id}</dd></div><div><dt>배송상태</dt><dd><StatusBadge status="배송중" /></dd></div><div><dt>운송장</dt><dd>JP-78392018</dd></div></dl></div><div className="detail-section"><h5>AI 응대 가이드</h5><p className="ai-guide"><Bot size={16} />배송사 인계 후 송장 반영에는 최대 24시간이 걸릴 수 있습니다. 환불을 먼저 제안하지 마세요.</p></div></aside>
      </section>
    </div>
  );
}

function ChannelPage({ channelKey, onNavigate }: { channelKey: ChannelKey; onNavigate: (view: View) => void }) {
  const channel = channels[channelKey];
  const factors = channelFactors[channelKey];
  const observedStatus: Partial<Record<ChannelKey, string>> = {
    qoo10: "판매자 콘솔 확인 · QAPI 미검증",
    shopee: "사용자 요청 · 이번 API 연동 범위 제외",
    lazada: "OAuth 승인 완료 · 고정 송신 IP 차단",
  };
  return (
    <div className="page-stack">
      <section className="channel-hero" style={{ "--channel-color": channel.color } as React.CSSProperties}><div><ChannelMark code={channel.letter} size="lg" /><span><small>{channel.market} 판매 채널</small><h2>{channel.name}</h2><em><i />{observedStatus[channelKey] ?? "실계정 미연결 · 샘플 화면"}</em></span></div><div><button className="filter-button" onClick={() => onNavigate("readiness")}><ShieldCheck size={15} />연동 준비도</button><button className="primary-button" disabled><RefreshCw size={15} />API 연결 후 동기화</button></div></section>
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
    { no: "04", title: "AI 상세·썸네일 제작", desc: "GPT 이미지 분석, gpt-image-2 연출컷, 3종 썸네일과 편집 가능한 상세페이지 생성", view: "publishing" as View, icon: WandSparkles, outcome: "Puck 블록으로 직접 수정 가능한 초안" },
    { no: "05", title: "채널별 마진 검증", desc: "원가·수수료·환율·광고비를 반영해 목표 마진 판매가를 결정", view: "margin" as View, icon: Calculator, outcome: "팔아도 남는 가격 확정" },
    { no: "06", title: "7개 채널 동시 등록", desc: "Qoo10·Shopee·Lazada·쿠팡·11번가·스마트스토어·eBay 규격으로 자동 변환", view: "publishing" as View, icon: Globe2, outcome: "채널별 오류 즉시 추적" },
    { no: "07", title: "주문 · 재고 통합", desc: "각 채널 주문을 모으고 중앙 재고를 동기화", view: "orders" as View, icon: PackageCheck, outcome: "중복판매·품절 방지" },
    { no: "08", title: "다국어 CS 응대", desc: "문의 자동번역과 주문정보 기반 AI 답변 초안", view: "cs" as View, icon: Bot, outcome: "응답시간 단축" },
    { no: "09", title: "성과 개선", desc: "채널·상품별 매출, 전환율, CS와 오류 데이터를 비교", view: "qoo10" as View, icon: TrendingUp, outcome: "잘 팔리는 상품에 집중" },
  ];
  return (
    <div className="page-stack storyboard-page">
      <section className="storyboard-intro"><div><span className="eyebrow dark"><FileText size={14} /> PRODUCT STORYBOARD · V1.3</span><h2>운영자가 길을 잃지 않는<br /><em>9개의 핵심 장면</em></h2><p>‘오늘 무엇을 봐야 하는가’에서 시작해 등록, AI 제작, 판매, CS, 개선까지<br />하나의 루프로 연결한 멀티채널 커머스 운영 경험입니다.</p></div><div className="oss-card"><span>OPEN SOURCE FOUNDATION</span><strong>Ant Design</strong><em>MIT · ENTERPRISE PATTERNS</em><p>복잡한 판매 업무를 익숙하고 확실하게 처리하는 관리자 화면 원칙</p><strong>Radix UI</strong><em>MIT · ACCESSIBLE PRIMITIVES</em><p>키보드와 보조기기 사용까지 고려한 상호작용 기반</p><strong>TanStack Table</strong><em>MIT · DATA WORKFLOWS</em><p>상품·주문·CS 데이터의 정렬, 필터, 선택과 밀도 높은 표현</p><strong>Puck</strong><em>MIT · PAGE EDITOR</em><p>React·Next.js용 드래그앤드롭 상세페이지 편집기</p></div></section>
      <section className="story-flow"><div className="flow-line" />{scenes.map((scene, index) => <article className="story-scene" key={scene.no}><div className="scene-number">{scene.no}</div><div className="scene-icon"><scene.icon size={22} /></div><div className="scene-copy"><span>{index < 2 ? "DISCOVER" : index < 5 ? "AUTOMATE" : index < 7 ? "OPERATE" : "GROW"}</span><h3>{scene.title}</h3><p>{scene.desc}</p><em><CheckCircle2 size={14} />{scene.outcome}</em></div><button onClick={() => onNavigate(scene.view)}>화면 열기<ArrowRight size={15} /></button></article>)}</section>
      <section className="panel information-architecture"><div className="panel-heading"><div><span className="panel-kicker">INFORMATION ARCHITECTURE</span><h3>화면 구성과 운영 목적</h3></div></div><div className="ia-grid"><div><span className="ia-icon"><LayoutDashboard size={19} /></span><b>총괄</b><small>핵심 KPI · 베스트 상품 · 채널 건강도 · 긴급 항목</small></div><div><span className="ia-icon"><Package size={19} /></span><b>상품</b><small>상품 원장 · 채널 상태 · 재고 · 판매 성과</small></div><div><span className="ia-icon"><CloudUpload size={19} /></span><b>등록</b><small>촬영 · AI 분석 · 번역 · 가격 · 게시 작업</small></div><div><span className="ia-icon"><Calculator size={19} /></span><b>마진</b><small>원가 · 채널 수수료 · 환율 · 목표 판매가</small></div><div><span className="ia-icon"><ShoppingCart size={19} /></span><b>주문</b><small>통합 주문 · 출고 · 배송 · 중앙 재고</small></div><div><span className="ia-icon"><Headphones size={19} /></span><b>CS</b><small>문의 통합 · 자동 번역 · AI 답변 · SLA</small></div><div><span className="ia-icon"><Store size={19} /></span><b>채널별</b><small>매출 · 주문 · 전환율 · 상품 · 운영 점수</small></div></div></section>
    </div>
  );
}

function DashboardShell({ onLogout, userEmail }: { onLogout: () => Promise<void>; userEmail: string }) {
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
    if (view === "margin") return <MarginCalculatorPage notify={notify} />;
    if (view === "orders") return <OrdersPage />;
    if (view === "cs") return <CsPage notify={notify} />;
    if (view === "readiness") return <ChannelReadinessPage />;
    if (view === "credentials") return <ApiCredentialCenter notify={notify} />;
    if (view === "acceptance") return <AcceptanceChecklistPage />;
    if (view === "storyboard") return <StoryboardPage onNavigate={navigate} />;
    return <ChannelPage channelKey={view as ChannelKey} onNavigate={navigate} />;
  }, [view]);

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head"><div className="brand-lockup light"><span className="brand-symbol"><Zap size={17} fill="currentColor" /></span><span className="sidebar-brand-copy"><strong>SellerPilot</strong><small>SELLER CONTROL</small></span></div><button aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
        <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const isActive = view === item.id;
          const isDisabled = "disabled" in item && item.disabled;
          return <button key={item.id} className={`${isActive ? "active" : ""} ${isDisabled ? "channel-disabled" : ""}`.trim()} onClick={() => { if (!isDisabled) navigate(item.id); }} disabled={isDisabled} aria-label={isDisabled ? `${item.label} 연동 준비 중` : item.label}>{Icon ? <Icon size={17} /> : <ChannelMark code={(item as { channel: string }).channel} size="sm" />}<span>{item.label}</span>{isDisabled ? <em>준비중</em> : "badge" in item && item.badge ? <em>{item.badge}</em> : isActive ? <ChevronRight size={14} /> : null}</button>;
        })}</div>)}</nav>
        <div className="sidebar-insight"><div><Activity size={15} /><span>채널 연결 현황</span><em>LIVE</em></div><p><b>3개 채널</b> 개발자 인증을<br />보안 저장소와 연결 중입니다.</p><span><i /></span><small>키 만료일·갱신 주기 관리</small></div>
        <div className="sidebar-foot"><button><LifeBuoy size={17} /><span>도움말 · 가이드</span></button><button onClick={() => navigate("credentials")}><Settings size={17} /><span>API · 보안 설정</span></button><button onClick={() => void onLogout()}><LogOut size={17} /><span>로그아웃</span></button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}

      <section className="app-main">
        <div className="app-header-stack">
          <div className="commerce-service-rail" aria-label="채널 운영 상태">
            <strong>통합 판매관리</strong>
            <span><i className="rail-ok" />상품 원장 정상</span>
            <span><i className="rail-pending" />채널 인증 점검 중</span>
            <span><i className="rail-ok" />보안 저장소 연결</span>
            <em>마지막 동기화 09:42</em>
          </div>
          <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" aria-label="전체 메뉴 열기" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className="demo-data-badge"><Activity size={13} /><b>{DEMO_DATA_META.label}</b><small>{DEMO_DATA_META.기준일} 기준</small></span><button className="global-search" aria-label="통합 검색 열기" onClick={() => setSearchOpen(true)}><Search size={16} /><span>상품, 주문, CS 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap"><button className="top-icon-button" aria-label="알림" onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} /><i /></button>{notificationsOpen && <div className="notification-popover"><div><h4>알림</h4><button onClick={() => setNotificationsOpen(false)}>모두 읽음</button></div><button><span className="alert-icon danger"><Box size={15} /></span><span><b>재고 부족 상품이 있습니다.</b><small>3개 상품 · 5분 전</small></span></button><button><span className="alert-icon warning"><AlertCircle size={15} /></span><span><b>등록 실패 2건을 확인하세요.</b><small>Qoo10 · 18분 전</small></span></button></div>}</div><button className="user-menu"><span className="user-avatar">관</span><span><b>{userEmail.split("@")[0]}</b><small>보안 관리자</small></span><ChevronDown size={14} /></button></div>
          </header>
        </div>
        <div className="app-content">{content}</div>
      </section>

      {searchOpen && <div className="command-overlay" role="button" tabIndex={0} aria-label="검색창 닫기" onClick={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Enter") setSearchOpen(false); }}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="통합 검색"><div className="command-input"><Search size={18} /><input placeholder="상품명, 주문번호, 고객명 검색" /><button aria-label="검색창 닫기" onClick={() => setSearchOpen(false)}><X size={17} /></button></div><span className="command-label">빠른 이동</span>{navGroups[0].items.map((item) => { const Icon = "icon" in item ? item.icon : null; return Icon ? <button key={item.id} onClick={() => { navigate(item.id); setSearchOpen(false); }}><Icon size={17} /><span>{item.label}</span><ArrowRight size={14} /></button> : null; })}</div></div>}
      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span><button onClick={() => setToast("")}><X size={14} /></button></div>}
    </main>
  );
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseClient();
    void supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setUserEmail(data.session?.user.email ?? "");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      setUserEmail(session?.user.email ?? "");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    const { error } = await createSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) return "아이디 또는 비밀번호를 확인해 주세요.";
    return null;
  };

  const resetPassword = async (email: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
    const { error } = await createSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
    return error ? "재설정 메일을 보내지 못했습니다. 관리자에게 문의해 주세요." : null;
  };

  const logout = async () => {
    if (isSupabaseConfigured) await createSupabaseClient().auth.signOut();
    setAuthenticated(false);
    setUserEmail("");
  };

  return authenticated
    ? <DashboardShell onLogout={logout} userEmail={userEmail} />
    : <LoginScreen onLogin={login} onPasswordReset={resetPassword} />;
}
