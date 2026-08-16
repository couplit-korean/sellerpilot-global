"use client";

import Image from "next/image";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
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
  PackageSearch,
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
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AiProductStudio } from "./ai-product-studio";
import { AcceptanceChecklistPage } from "./acceptance-checklist";
import { ApiCredentialCenter } from "./api-credential-center";
import { ChannelReadinessPage } from "./channel-readiness";
import { CategoryClassificationWorkbench } from "./category-classification-workbench";
import { ProductPublishWorkbench } from "./product-publish-workbench";
import { MarginCalculatorPage } from "./margin-calculator";
import { channels, type ChannelKey } from "./channel-config";
import { useOperationsSnapshot, type OperationsSnapshot } from "./use-operations-snapshot";
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
      { id: "publishing" as View, label: "상품 등록", icon: CloudUpload },
      { id: "margin" as View, label: "마진 계산", icon: Calculator },
      { id: "orders" as View, label: "주문 · 판매", icon: ShoppingCart },
      { id: "cs" as View, label: "CS 통합함", icon: Headphones },
      { id: "readiness" as View, label: "채널 연동 준비", icon: ShieldCheck },
      { id: "credentials" as View, label: "API 키 · 인증", icon: KeyRound },
    ],
  },
  {
    label: "판매 채널",
    items: [
      { id: "qoo10" as View, label: "Qoo10 Japan", channel: "Q" },
      { id: "shopee" as View, label: "Shopee Global", channel: "S" },
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
  shopee: { title: "Shopee Global", description: "8개 국가 Shopee 숍의 상품, 매출, 주문, CS 성과입니다." },
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
type DisplayProduct = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  stock: number;
  sales: number;
  revenue: string;
  status: string;
  channels: string[];
};

type DisplayOrder = {
  id: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
};

type DisplayTicket = {
  id: string;
  customer: string;
  channel: string;
  subject: string;
  preview: string;
  time: string;
  status: "긴급" | "답변 대기" | "처리 중" | "처리 완료";
};

const productStatusLabel = {
  draft: "등록 대기",
  active: "판매중",
  low_stock: "재고주의",
  out_of_stock: "품절",
  archived: "판매 종료",
} as const;

const orderStatusLabel = {
  paid: "결제완료",
  ready_to_ship: "출고대기",
  shipped: "배송중",
  delivered: "배송완료",
  cancelled: "취소완료",
  refunded: "환불완료",
} as const;

const ticketStatusLabel = {
  urgent: "긴급",
  waiting: "답변 대기",
  in_progress: "처리 중",
  resolved: "처리 완료",
} as const;

const channelNameByKey: Record<string, string> = {
  qoo10: "Qoo10",
  shopee: "Shopee",
  lazada: "Lazada",
  coupang: "쿠팡",
  elevenst: "11번가",
  smartstore: "네이버 스마트스토어",
  ebay: "eBay",
};

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value));
}

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
            <div className="preview-heading"><b>운영 워크플로</b><span>LIVE DATA ONLY</span></div>
            <div className="preview-task urgent"><span>01</span><div><b>상품 등록 전 검증</b><small>카테고리 · 필수속성 · 이미지 확인</small></div><strong>READY</strong></div>
            <div className="preview-task"><span>02</span><div><b>판매 채널 동기화</b><small>유효한 API 키가 있는 채널만 실행</small></div><strong>API</strong></div>
            <div className="preview-task"><span>03</span><div><b>주문 · 문의 통합</b><small>실제 주문과 고객 문의만 운영 DB 집계</small></div><strong>LIVE</strong></div>
            <div className="preview-settlement"><span>대시보드 집계 기준</span><b>실데이터 전용</b><em>샘플 자동 생성 없음</em></div>
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
          <div className="input-wrap"><UserRound size={17} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="관리자 이메일" /></div>
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button" onClick={() => void requestPasswordReset()}>비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <div className="remember-row"><span><Check size={12} /></span>이 브라우저에서 로그인 세션 유지</div>
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />접속 중...</> : <>대시보드 접속<ArrowRight size={18} /></>}</button>
          <div className="demo-account"><ShieldCheck size={15} /><span>Supabase Auth로 인증하며 채널 키 원문은 로그인 후에도 표시하지 않습니다.<br /><b>관리자 초대 메일에서 비밀번호를 설정해 주세요.</b></span></div>
        </form>
        <div className="login-support"><HelpCircle size={15} />접속에 문제가 있나요? <a href="mailto:couplit.official@gmail.com?subject=SellerPilot%20운영%20지원%20문의">운영 지원팀 문의</a></div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, delta, detail, icon: Icon, tone, reverse }: { label: string; value: string; delta?: string; detail: string; icon: React.ComponentType<{ size?: number }>; tone: string; reverse?: boolean }) {
  return (
    <article className="metric-card">
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong></div>
      <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
      <div className="metric-foot">{delta ? <span className={reverse ? "negative" : "positive"}>{reverse ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta}</span> : <span className="neutral"><Activity size={13} />LIVE</span>}<small>{detail}</small></div>
    </article>
  );
}

function formatCompactWon(value: number) {
  return `₩${Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

function ProductVisual({ src, size }: { src: string | null; size: string }) {
  return src ? <Image src={src} alt="" fill sizes={size} /> : <span className="product-image-missing"><Package size={17} /><small>NO IMAGE</small></span>;
}

function OverviewPage({ onNavigate, displayProducts, operationSummary, channelMetrics, pipeline, operationsAvailable }: {
  onNavigate: (view: View) => void;
  displayProducts: DisplayProduct[];
  operationSummary: OperationsSnapshot["summary"] | null;
  channelMetrics: OperationsSnapshot["channelMetrics"];
  pipeline: OperationsSnapshot["pipeline"] | null;
  operationsAvailable: boolean;
}) {
  const [period, setPeriod] = useState("30일");
  const [exchangeRates, setExchangeRates] = useState(initialExchangeRates);
  const [rateUpdatedAt, setRateUpdatedAt] = useState("화면 기준값");
  const [rateSource, setRateSource] = useState("실데이터 확인 중");
  const [today] = useState(() => new Date());
  const monthlyTopProducts = useMemo(() => [...displayProducts].sort((a, b) => b.sales - a.sales).slice(0, 10), [displayProducts]);
  const summary = operationSummary ?? { revenue30dKrw: 0, sold30d: 0, orderCount: 0, paidOrderCount: 0, readyToShipCount: 0, openTicketCount: 0, lowStockCount: 0, productCount: 0, registrationErrorCount: 0, activeCredentialCount: 0 };
  const livePipeline = pipeline ?? { aiRunning: 0, listingQueued: 0, listingPublished: 0, listingFailed: 0 };
  const totalTasks = summary.readyToShipCount + summary.openTicketCount + summary.lowStockCount + summary.registrationErrorCount;
  const totalListings = livePipeline.listingPublished + livePipeline.listingFailed;
  const successRate = totalListings > 0 ? (livePipeline.listingPublished / totalListings) * 100 : 0;
  const maxChannelRevenue = Math.max(1, ...channelMetrics.map((channel) => channel.revenue30dKrw));
  const currentDate = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(today);
  const rangeDays = period === "7일" ? 7 : period === "90일" ? 90 : 30;
  const rangeStart = new Date(today.getTime() - (rangeDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const rangeEnd = today.toISOString().slice(0, 10);

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
        <div className="briefing-copy"><span>{currentDate}</span><h2>현재 처리할 업무가 <b>{operationsAvailable ? `${totalTasks}건` : "확인 중"}</b> 있습니다.</h2><p>실제 주문·재고·CS·등록 오류를 기준으로 집계합니다.</p></div>
        <div className="briefing-tasks">
          <button onClick={() => onNavigate("orders")}><span className="task-tone order" /><small>통합 주문</small><b>{operationsAvailable ? summary.orderCount : "—"}</b><em>실주문 원장</em></button>
          <button onClick={() => onNavigate("orders")}><span className="task-tone shipping" /><small>출고 대기</small><b>{operationsAvailable ? summary.readyToShipCount : "—"}</b><em>채널 상태 동기화</em></button>
          <button onClick={() => onNavigate("cs")}><span className="task-tone claim" /><small>미처리 CS</small><b>{operationsAvailable ? summary.openTicketCount : "—"}</b><em>통합 문의함</em></button>
          <button onClick={() => onNavigate("publishing")}><span className="task-tone error" /><small>등록 오류</small><b>{operationsAvailable ? summary.registrationErrorCount : "—"}</b><em>실패 작업</em></button>
        </div>
        <aside className="briefing-settlement"><span>운영 API 연결</span><strong>{operationsAvailable ? `${summary.activeCredentialCount} / 7` : "확인 중"}</strong><small>운영 키가 활성화된 판매 채널</small><button onClick={() => onNavigate("credentials")}>키 · 인증 관리<ChevronRight size={14} /></button></aside>
      </section>
      <section className="overview-toolbar">
        <article className="exchange-widget" aria-label="현재 환율">
          <div className="exchange-title"><span><i />기준 환율</span><small>KRW 기준 · {rateUpdatedAt}</small><small>{rateSource}</small></div>
          <div className="exchange-rate-list">{exchangeRates.map((rate) => <div className="exchange-rate" key={rate.code}><small>{rate.code} {rate.unit}</small><strong>₩{rate.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><em className={rate.change >= 0 ? "up" : "down"}>{rate.change >= 0 ? "▲" : "▼"} {Math.abs(rate.change).toFixed(2)}%</em></div>)}</div>
          <button type="button" className="exchange-refresh" aria-label="환율 새로고침" title="환율 새로고침" onClick={refreshExchangeRates}><RefreshCw size={14} /></button>
        </article>
        <div className="overview-date-actions"><div className="period-control"><CalendarDays size={15} /><button>{rangeStart}</button><span>—</span><button>{rangeEnd}</button></div><div className="segmented-control">{["7일", "30일", "90일"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
      </section>

      <section className="metric-grid">
        <MetricCard label="30일 매출" value={operationsAvailable ? formatCompactWon(summary.revenue30dKrw) : "—"} detail="실제 게시 상품 매출 집계" icon={CircleDollarSign} tone="violet" />
        <MetricCard label="주문" value={operationsAvailable ? summary.orderCount.toLocaleString() : "—"} detail={`결제완료 ${summary.paidOrderCount} · 출고대기 ${summary.readyToShipCount}`} icon={ShoppingBag} tone="blue" />
        <MetricCard label="관리 상품" value={operationsAvailable ? summary.productCount.toLocaleString() : "—"} detail={`최근 30일 ${summary.sold30d.toLocaleString()}개 판매`} icon={PackageCheck} tone="green" />
        <MetricCard label="미처리 CS" value={operationsAvailable ? summary.openTicketCount.toLocaleString() : "—"} detail={`재고주의 ${summary.lowStockCount}건`} icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">실매출 분석</span><h3>채널별 최근 30일 매출</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>상품 원장<ChevronRight size={15} /></button></div>
          <div className="live-channel-bars">{channelMetrics.map((channel) => <button key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><span><i style={{ background: channel.color }} />{channel.name}</span><b>{formatCompactWon(channel.revenue30dKrw)}</b><em>{channel.orderCount.toLocaleString()}건</em><small><i style={{ width: `${Math.round((channel.revenue30dKrw / maxChannelRevenue) * 100)}%`, background: channel.color }} /></small></button>)}</div>
        </article>

        <article className="panel top-ranking-card">
          <div className="panel-heading"><div><span className="panel-kicker">최근 30일 판매량 기준</span><h3>이번 달 판매 TOP 10</h3></div><span className="rank-crown">1–10</span></div>
          <div className="monthly-ranking-list">
            {monthlyTopProducts.map((product, index) => <button className={`ranking-row ${index < 3 ? "podium" : ""}`} key={product.id} onClick={() => onNavigate("products")}>
              <span className="ranking-number">{index + 1}</span>
              <span className="ranking-thumb"><ProductVisual src={product.image} size="38px" /></span>
              <span className="ranking-product"><b>{product.name}</b><small>{product.channels.length}개 채널 판매중</small></span>
              <span className="ranking-channels">{product.channels.slice(0, 3).map((code) => <ChannelMark key={code} code={code} size="sm" />)}{product.channels.length > 3 && <em>+{product.channels.length - 3}</em>}</span>
              <span className="ranking-sales"><b>{product.sales.toLocaleString()}개</b><small>{product.revenue}</small></span>
            </button>)}
            {monthlyTopProducts.length === 0 && <div className="live-empty-state"><PackageSearch size={26} /><b>실판매 상품이 아직 없습니다.</b><small>채널 키 연결 후 상품·주문 동기화를 실행하면 순위가 표시됩니다.</small></div>}
          </div>
          <button className="full-ghost-button" onClick={() => onNavigate("products")}>전체 상품 성과 보기<ArrowRight size={15} /></button>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel channel-performance">
          <div className="panel-heading"><div><span className="panel-kicker">실계정 운영 상태</span><h3>채널별 실데이터</h3></div><span className="live-label"><i />LIVE</span></div>
          <div className="channel-list">
            {channelMetrics.map((channel) => <button className="channel-row" key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><ChannelMark code={channel.channelCode} /><div className="channel-name"><strong>{channel.name}</strong><span className={channel.credentialStatus === "active" ? "connected" : ""}><i />{channel.credentialStatus === "active" ? "운영 키 연결" : "API 키 연결 필요"}</span></div><div className="channel-metric"><small>30일 매출</small><b>{formatCompactWon(channel.revenue30dKrw)}</b></div><div className="channel-metric"><small>실주문</small><b>{channel.orderCount.toLocaleString()}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.credentialStatus === "active" ? 100 : 0}%` }} /></span><b>{channel.failedAttemptCount ? `오류 ${channel.failedAttemptCount}` : "정상"}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">오늘 자동 등록 작업</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("publishing")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>{totalListings}</strong><span>실제 등록 처리</span></div><i /><div><strong>{successRate.toFixed(1)}%</strong><span>등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: livePipeline.aiRunning, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: livePipeline.listingQueued, tone: "blue", icon: Upload }, { label: "등록 완료", value: livePipeline.listingPublished, tone: "green", icon: CheckCircle2 }, { label: "확인 필요", value: livePipeline.listingFailed, tone: "red", icon: AlertCircle }].map((item) => <div key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">우선 처리 필요</span><h3>지금 확인할 항목</h3></div><span className="count-chip">{summary.lowStockCount + summary.registrationErrorCount + summary.openTicketCount}</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고주의 상품 {summary.lowStockCount}건</b><small>실재고와 재주문 기준으로 집계했습니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 {summary.registrationErrorCount}건</b><small>카테고리·필수 속성·API 응답을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("cs")}><span className="alert-icon blue"><MessageCircleMore size={16} /></span><span><b>미처리 CS {summary.openTicketCount}건</b><small>각 채널에서 동기화된 실제 문의입니다.</small></span><em>답변하기<ChevronRight size={14} /></em></button>
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-heading"><div><span className="panel-kicker">자주 쓰는 메뉴</span><h3>빠른 실행</h3></div></div>
          <div className="quick-action-grid"><button onClick={() => onNavigate("publishing")}><span><ImagePlus size={19} /></span><b>새 상품 등록</b><small>사진으로 시작</small></button><button onClick={() => onNavigate("orders")}><span><Truck size={19} /></span><b>출고 처리</b><small>대기 {summary.readyToShipCount}건</small></button><button onClick={() => onNavigate("cs")}><span><Bot size={19} /></span><b>AI 답변</b><small>대기 {summary.openTicketCount}건</small></button></div>
        </article>
      </section>
    </div>
  );
}

function ProductsPage({ onNavigate, displayProducts }: { onNavigate: (view: View) => void; displayProducts: DisplayProduct[] }) {
  const [query, setQuery] = useState("");
  const filtered = displayProducts.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()) || product.sku.toLowerCase().includes(query.toLowerCase()));
  const activeCount = displayProducts.filter((product) => product.status === "판매중").length;
  const lowStockCount = displayProducts.filter((product) => product.status === "재고주의").length;
  const outOfStockCount = displayProducts.filter((product) => product.status === "품절").length;
  return (
    <div className="page-stack">
      <section className="summary-strip"><div><Package size={18} /><span>전체 상품<strong>{displayProducts.length}</strong></span></div><div><CheckCircle2 size={18} /><span>정상 판매<strong>{activeCount}</strong></span></div><div><AlertCircle size={18} /><span>재고 주의<strong>{lowStockCount}</strong></span></div><div><Box size={18} /><span>품절<strong>{outOfStockCount}</strong></span></div><button className="primary-button" onClick={() => onNavigate("publishing")}><Plus size={16} />새 상품 등록</button></section>
      <section className="panel data-panel">
        <div className="data-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, SKU 검색" /></div><button className="filter-button" disabled><Filter size={15} />채널 필터<ChevronDown size={14} /></button><button className="filter-button" disabled><ListFilter size={15} />상태 필터<ChevronDown size={14} /></button><span className="toolbar-spacer" /><button className="icon-text-button" disabled title="채널 운영 키 연결 후 활성화"><RefreshCw size={15} />채널 동기화</button><button className="icon-only-button" aria-label="더보기" disabled><MoreHorizontal size={18} /></button></div>
        <div className="table-wrap"><table className="data-table product-table"><thead><tr><th><input type="checkbox" aria-label="전체 선택" /></th><th>상품</th><th>판매 채널</th><th>재고</th><th>30일 판매</th><th>30일 매출</th><th>상태</th><th /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><input type="checkbox" aria-label={`${product.name} 선택`} /></td><td><div className="product-cell"><div className="product-thumb"><ProductVisual src={product.image} size="52px" /></div><span><b>{product.name}</b><small>{product.sku} · {product.id}</small></span></div></td><td><div className="channel-stack">{product.channels.map((code) => <ChannelMark key={code} code={code} size="sm" />)}</div></td><td><strong className={product.stock < 20 ? "stock-low" : ""}>{product.stock}</strong><small> 개</small></td><td><b>{product.sales}</b><small> 개</small></td><td><b>{product.revenue}</b></td><td><StatusBadge status={product.status} /></td><td><button className="table-action"><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div>
        {filtered.length === 0 && <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>실상품 데이터가 없습니다.</b><small>상품을 등록하거나 채널 동기화를 실행하면 이 목록에 표시됩니다.</small></div>}
        <div className="table-footer"><span>총 {displayProducts.length}개 중 1–{filtered.length}개 표시</span><div><button disabled><ChevronRight className="flip" size={15} /></button><button className="active">1</button><button disabled><ChevronRight size={15} /></button></div></div>
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

function PublishingPage({ notify, channelMetrics, pipeline }: { notify: (message: string) => void; channelMetrics: OperationsSnapshot["channelMetrics"]; pipeline: OperationsSnapshot["pipeline"] | null }) {
  const [running, setRunning] = useState(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [description, setDescription] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [studioRequestId, setStudioRequestId] = useState(0);
  const [analyzedProductName, setAnalyzedProductName] = useState("");
  const [analyzedProductId, setAnalyzedProductId] = useState<string | null>(null);
  const [categoryDraftRef] = useState(() => crypto.randomUUID());
  const [publishRefreshVersion, setPublishRefreshVersion] = useState(0);
  const [channelSelection, setChannelSelection] = useState<Record<string, boolean>>({});
  const connectedChannelKeys = useMemo(() => channelMetrics.filter((metric) => metric.credentialStatus === "active").map((metric) => metric.channelKey), [channelMetrics]);
  const selectedChannels = useMemo(() => connectedChannelKeys.filter((key) => channelSelection[key] !== false), [channelSelection, connectedChannelKeys]);

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
        <aside className="panel publishing-settings"><div className="panel-heading"><div><span className="panel-kicker">OFFICIAL PREFLIGHT</span><h3>API 검증 대상 채널</h3></div><Settings size={16} /></div>
          <div className="publish-channel-list">{Object.entries(channels).map(([key, channel]) => { const connected = connectedChannelKeys.includes(key); const selectable = channel.enabled && connected; const selected = selectedChannels.includes(key); return <label key={channel.letter} className={selectable ? "" : "channel-disabled"}><ChannelMark code={channel.letter} /><span><b>{channel.name}{!channel.enabled ? <em>준비중</em> : !connected ? <em>키 필요</em> : null}</b><small>{!channel.enabled ? `${channel.market} · 연동 준비 중` : connected ? `${channel.market} · 공식 API 분류 대상` : `${channel.market} · API 키 연결 필요`}</small></span><input type="checkbox" checked={selected} disabled={!selectable} onChange={(event) => setChannelSelection((current) => ({ ...current, [key]: event.target.checked }))} aria-label={`${channel.name} API 검증 ${selected ? "선택됨" : selectable ? "선택 가능" : "비활성화"}`} /><i><Check size={12} /></i></label>; })}</div>
          <div className="auto-options"><h4>등록 실행 조건</h4><div className="automation-requirement"><span><b>ChatGPT CLI 분석 완료</b><small>실제 작업 결과가 저장된 상품만 진행</small></span><em>필수</em></div><div className="automation-requirement"><span><b>공식 카테고리 확정</b><small>말단 카테고리와 필수 속성 저장 필요</small></span><em>필수</em></div><div className="automation-requirement"><span><b>쓰기 전 최종 확인</b><small>가격·재고·배송 정보 검토 뒤 API 실행</small></span><em>필수</em></div></div>
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
        onResultReady={(studioResult, productId) => {
          setAnalyzedProductName(studioResult.product.name);
          setAnalyzedProductId(productId);
          setPublishRefreshVersion((current) => current + 1);
        }}
      />
      <CategoryClassificationWorkbench
        productId={analyzedProductId}
        productName={analyzedProductName || description.slice(0, 180)}
        description={description}
        sourceRef={analyzedProductId ?? categoryDraftRef}
        enabledChannels={selectedChannels}
        notify={notify}
        onConfirmed={() => setPublishRefreshVersion((current) => current + 1)}
      />
      <ProductPublishWorkbench
        productId={analyzedProductId}
        selectedChannels={selectedChannels}
        refreshVersion={publishRefreshVersion}
        notify={notify}
      />
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE QUEUE</span><h3>실제 등록 작업 현황</h3></div><button className="ghost-button" onClick={() => notify("채널 작업 이력은 API 운영 콘솔에서 확인할 수 있습니다.")}>작업 이력<ChevronRight size={15} /></button></div>
        <div className="queue-live-summary"><div><small>AI 실행 중</small><b>{pipeline?.aiRunning ?? 0}건</b></div><div><small>등록 대기</small><b>{pipeline?.listingQueued ?? 0}건</b></div><div><small>등록 완료</small><b>{pipeline?.listingPublished ?? 0}건</b></div><div><small>확인 필요</small><b>{pipeline?.listingFailed ?? 0}건</b></div></div>
        {!pipeline || pipeline.aiRunning + pipeline.listingQueued + pipeline.listingPublished + pipeline.listingFailed === 0 ? <div className="live-empty-state"><Upload size={26} /><b>실제 등록 작업이 아직 없습니다.</b><small>대표사진 분석과 카테고리 확정 후 채널 등록을 실행하면 여기에 표시됩니다.</small></div> : null}
      </section>
    </div>
  );
}

function OrdersPage({ displayOrders, onAdvance }: { displayOrders: DisplayOrder[]; onAdvance: (order: DisplayOrder) => Promise<void> }) {
  const [active, setActive] = useState("전체 주문");
  const paidCount = displayOrders.filter((order) => order.status === "결제완료").length;
  const readyCount = displayOrders.filter((order) => order.status === "출고대기").length;
  const shippingCount = displayOrders.filter((order) => order.status === "배송중").length;
  return (
    <div className="page-stack">
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>통합 주문</small><strong>{displayOrders.length}</strong></div><em>운영 원장</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>{readyCount}</strong></div><em className="neutral">결제완료 {paidCount}건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중</small><strong>{shippingCount}</strong></div><em className="neutral">상태 변경 가능</em></article><article><span className="metric-icon green"><CircleDollarSign size={19} /></span><div><small>데이터 연결</small><strong>DB</strong></div><em>1분 자동 갱신</em></article></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>{readyCount}</span>}</button>)}</div><div className="search-field"><Search size={16} /><input placeholder="주문번호, 구매자 검색" /></div><button className="filter-button"><Filter size={15} />필터</button></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문상태</th><th>주문시간</th><th /></tr></thead><tbody>{displayOrders.filter((order) => active === "전체 주문" || active === "완료 · 취소" && ["배송완료", "취소완료", "환불완료"].includes(order.status) || order.status === active).map((order) => <tr key={order.id}><td><b className="mono">{order.id}</b></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><span className="truncate-product">{order.product}</span></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} /></td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action" title="다음 주문 상태로 변경" aria-label={`${order.id} 다음 상태로 변경`} onClick={() => void onAdvance(order)}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
        {displayOrders.length === 0 && <div className="live-empty-state table-empty"><ShoppingCart size={28} /><b>동기화된 실제 주문이 없습니다.</b><small>채널 API 키 연결 후 주문 조회를 실행하면 표시됩니다.</small></div>}
        <div className="bulk-order-bar"><span><input type="checkbox" disabled />선택한 주문</span><button disabled><Truck size={15} />일괄 출고 처리</button><button disabled>송장 업로드</button><span className="toolbar-spacer" /><small>실제 주문 API 연결 후 활성화</small><button className="table-action" disabled><RefreshCw size={15} /></button></div>
      </section>
    </div>
  );
}

function CsPage({ notify, displayTickets, displayOrders, onSend }: { notify: (message: string) => void; displayTickets: DisplayTicket[]; displayOrders: DisplayOrder[]; onSend: (ticket: DisplayTicket, reply: string) => Promise<boolean> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const selected = displayTickets.find((ticket) => ticket.id === selectedId) ?? displayTickets[0] ?? null;
  const sendReply = async () => {
    if (selected && await onSend(selected, reply)) {
      notify(`${selected.customer} 고객 문의를 처리 완료로 저장했습니다.`);
      setReply("");
    }
  };
  const linkedOrder = selected ? displayOrders.find((order) => order.customer === selected.customer) ?? null : null;
  return (
    <div className="page-stack cs-page">
      <section className="cs-summary"><div><span className="metric-icon violet"><Inbox size={18} /></span><span><small>미처리 문의</small><strong>{displayTickets.length}</strong></span></div><div><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>긴급 문의</small><strong>{displayTickets.filter((ticket) => ticket.status === "긴급").length}</strong></span></div><div><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>연결 주문</small><strong>{displayOrders.length}</strong></span></div><div><span className="metric-icon blue"><Bot size={18} /></span><span><small>AI 답변</small><strong>CLI</strong></span></div></section>
      {!selected ? <section className="panel live-empty-state large"><Inbox size={32} /><b>동기화된 실제 문의가 없습니다.</b><small>채널 API 연결 후 문의를 동기화하면 고객 정보와 주문 맥락이 표시됩니다.</small></section> :
      <section className="cs-workspace panel">
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input placeholder="문의 검색" /></div><button className="icon-only-button"><Filter size={16} /></button></div><div className="ticket-tabs"><button className="active">미답변 <span>{displayTickets.length}</span></button><button>처리 중</button><button>완료</button></div>{displayTickets.map((ticket) => <button key={ticket.id} className={`ticket-item ${selected.id === ticket.id ? "active" : ""}`} onClick={() => { setSelectedId(ticket.id); setReply(""); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back"><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><button className="filter-button">처리 중<ChevronDown size={14} /></button><button className="icon-only-button"><MoreHorizontal size={18} /></button></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b></span><em>{linkedOrder?.id ?? "-"}<ChevronRight size={14} /></em></div><div className="message-date"><span>실제 수신 문의</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.preview}</p><span>채널 동기화 원문</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />ChatGPT CLI 답변 생성은 채널 정책·주문 데이터 연결 후 실행합니다.</span><button disabled><RefreshCw size={13} />CLI 생성</button></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="실제 답변을 입력하세요." /><div><span><button disabled><Languages size={15} />번역 후 전송<ChevronDown size={13} /></button><button disabled><FileText size={15} />템플릿</button></span><button className="send-button" disabled={!reply} onClick={() => void sendReply()}>답변 저장<Send size={15} /></button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>총 주문</small><b>{displayOrders.filter((order) => order.customer === selected.customer).length}건</b></div><div><small>데이터 출처</small><b>실제 채널 API</b></div></div><div className="detail-section"><h5>현재 주문</h5><div className="mini-order"><span className="tiny-thumb"><Package size={17} /></span><span><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b><small>{linkedOrder?.amount ?? "-"}</small></span></div><dl><div><dt>주문번호</dt><dd>{linkedOrder?.id ?? "-"}</dd></div><div><dt>배송상태</dt><dd><StatusBadge status={linkedOrder?.status ?? "확인 필요"} /></dd></div><div><dt>운송장</dt><dd>배송 API 동기화 값</dd></div></dl></div><div className="detail-section"><h5>응대 원칙</h5><p className="ai-guide"><Bot size={16} />실제 주문·배송 상태를 확인한 뒤 답변을 저장하세요.</p></div></aside>
      </section>}
    </div>
  );
}

function ChannelPage({ channelKey, onNavigate, metric, displayProducts }: {
  channelKey: ChannelKey;
  onNavigate: (view: View) => void;
  metric: OperationsSnapshot["channelMetrics"][number] | null;
  displayProducts: DisplayProduct[];
}) {
  const channel = channels[channelKey];
  const connected = metric?.credentialStatus === "active";
  const channelProducts = displayProducts.filter((product) => product.channels.includes(channel.letter)).sort((a, b) => b.sales - a.sales);
  const revenue = metric?.revenue30dKrw ?? 0;
  const orderCount = metric?.orderCount ?? 0;
  const averageOrder = orderCount > 0 ? revenue / orderCount : 0;
  return (
    <div className="page-stack">
      <section className="channel-hero" style={{ "--channel-color": channel.color } as React.CSSProperties}><div><ChannelMark code={channel.letter} size="lg" /><span><small>{channel.market} 판매 채널</small><h2>{channel.name}</h2><em className={connected ? "connected" : ""}><i />{connected ? "운영 API 키 연결 · 실데이터 집계" : "운영 API 키 연결 필요"}</em></span></div><div><button className="filter-button" onClick={() => onNavigate("readiness")}><ShieldCheck size={15} />연동 준비도</button><button className="primary-button" onClick={() => onNavigate("credentials")}><KeyRound size={15} />API 운영 콘솔</button></div></section>
      <section className="metric-grid channel-metrics"><MetricCard label="30일 매출" value={formatCompactWon(revenue)} detail="실제 게시 상품 매출" icon={CircleDollarSign} tone="violet" /><MetricCard label="주문" value={orderCount.toLocaleString()} detail={`출고대기 ${metric?.readyToShipCount ?? 0}건`} icon={ShoppingBag} tone="blue" /><MetricCard label="판매 상품" value={(metric?.publishedCount ?? 0).toLocaleString()} detail={`관리 상품 ${metric?.productCount ?? 0}개`} icon={Package} tone="green" /><MetricCard label="미처리 CS" value={(metric?.openTicketCount ?? 0).toLocaleString()} detail="실제 채널 문의" icon={Headphones} tone="orange" /></section>
      <section className="channel-detail-grid"><article className="panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE PERFORMANCE</span><h3>최근 30일 운영 집계</h3></div><span className="live-label"><i />DB</span></div><div className="channel-live-summary"><div><small>판매량</small><b>{(metric?.sold30d ?? 0).toLocaleString()}개</b></div><div><small>평균 주문금액</small><b>{formatCompactWon(averageOrder)}</b></div><div><small>실주문</small><b>{orderCount.toLocaleString()}건</b></div><div><small>최근 API 오류</small><b>{metric?.failedAttemptCount ?? 0}건</b></div></div></article><article className="panel store-health"><div className="panel-heading"><div><span className="panel-kicker">CONNECTION</span><h3>채널 연결 상태</h3></div><span className={`score-grade ${connected ? "connected" : ""}`}>{connected ? "ON" : "OFF"}</span></div>{[{ label: "운영 자격증명", score: connected ? "연결됨" : "키 필요" }, { label: "등록 상품", score: `${metric?.publishedCount ?? 0}개` }, { label: "출고 대기", score: `${metric?.readyToShipCount ?? 0}건` }, { label: "실패 작업", score: `${metric?.failedAttemptCount ?? 0}건` }].map((item) => <div className="health-row" key={item.label}><span>{item.label}</span><b>{item.score}</b></div>)}</article></section>
      <section className="panel data-panel"><div className="panel-heading table-title"><div><span className="panel-kicker">LIVE PRODUCTS</span><h3>채널 내 판매 상품</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>전체 상품<ChevronRight size={15} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>순위</th><th>상품</th><th>30일 판매</th><th>30일 매출</th><th>재고</th><th>상태</th></tr></thead><tbody>{channelProducts.slice(0, 10).map((product, index) => <tr key={product.id}><td><b className="rank-number">{String(index + 1).padStart(2, "0")}</b></td><td><div className="product-cell"><div className="product-thumb"><ProductVisual src={product.image} size="52px" /></div><span><b>{product.name}</b><small>{product.sku}</small></span></div></td><td><b>{product.sales}</b>개</td><td><b>{product.revenue}</b></td><td><b>{product.stock}</b>개</td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div>{channelProducts.length === 0 && <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>이 채널의 실상품이 없습니다.</b><small>API 키 연결 후 상품 동기화 또는 신규 등록을 실행하세요.</small></div>}</section>
    </div>
  );
}

function StoryboardPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const scenes = [
    { no: "01", title: "관리자 로그인", desc: "ID·PW를 입력해 운영 데이터에 안전하게 접근", view: "overview" as View, icon: LockKeyhole, outcome: "권한별 대시보드 진입" },
    { no: "02", title: "통합 현황 파악", desc: "매출, 주문, 등록, CS와 월간 베스트 상품을 한 화면에서 확인", view: "overview" as View, icon: LayoutDashboard, outcome: "30초 안에 오늘의 우선순위 결정" },
    { no: "03", title: "사진으로 상품 등록", desc: "정면·라벨·바코드 사진을 올려 상품 사실정보 추출", view: "publishing" as View, icon: ImagePlus, outcome: "반복 입력 제거" },
    { no: "04", title: "AI 상세·썸네일 제작", desc: "ChatGPT CLI 분석, codex-image 연출컷, 3종 썸네일과 편집 가능한 상세페이지 생성", view: "publishing" as View, icon: WandSparkles, outcome: "Puck 블록으로 직접 수정 가능한 초안" },
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
  const operations = useOperationsSnapshot();
  const operationSummary = operations.data?.summary ?? null;
  const channelMetrics = useMemo(() => operations.data?.channelMetrics ?? [], [operations.data]);
  const pipeline = operations.data?.pipeline ?? null;
  const meta = pageMeta[view];

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const displayProducts = useMemo<DisplayProduct[]>(() => operations.data?.products.map((product) => ({
    id: product.externalCode,
    name: product.name,
    sku: product.sku,
    image: product.imageUrl ?? null,
    stock: product.available,
    sales: product.sold30d,
    revenue: `₩${Math.round(product.revenue30dKrw).toLocaleString("ko-KR")}`,
    status: productStatusLabel[product.status],
    channels: product.listingChannels,
  })) ?? [], [operations.data]);

  const displayOrders = useMemo<DisplayOrder[]>(() => operations.data?.orders.map((order) => ({
    id: order.externalOrderId,
    channel: order.channelCode,
    customer: order.customerName,
    product: order.productName,
    amount: new Intl.NumberFormat("ko-KR", { style: "currency", currency: order.currency, maximumFractionDigits: order.currency === "KRW" ? 0 : 2 }).format(order.amount),
    status: orderStatusLabel[order.status],
    time: relativeTime(order.orderedAt),
  })) ?? [], [operations.data]);

  const displayTickets = useMemo<DisplayTicket[]>(() => operations.data?.tickets.map((ticket) => ({
    id: ticket.externalTicketId,
    customer: ticket.customerName,
    channel: channelNameByKey[ticket.channelKey] ?? ticket.channelKey,
    subject: ticket.subject,
    preview: ticket.translatedMessage ?? ticket.message,
    time: relativeTime(ticket.receivedAt),
    status: ticketStatusLabel[ticket.status],
  })) ?? [], [operations.data]);

  const advanceOrder = useCallback(async (order: DisplayOrder) => {
    const source = operations.data?.orders.find((item) => item.externalOrderId === order.id);
    if (!source) {
      notify("운영 DB 마이그레이션 적용 후 주문 상태를 변경할 수 있습니다.");
      return;
    }
    const nextStatus = ({
      paid: "ready_to_ship",
      ready_to_ship: "shipped",
      shipped: "delivered",
      delivered: "delivered",
      cancelled: "cancelled",
      refunded: "refunded",
    } as const)[source.status];
    try {
      const response = await operations.authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "order_status", id: source.id, status: nextStatus }),
      });
      if (!response.ok) throw new Error("주문 상태를 저장하지 못했습니다.");
      await operations.reload();
      notify(`${order.id} 주문을 ${orderStatusLabel[nextStatus]} 상태로 변경했습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "주문 상태를 저장하지 못했습니다.");
    }
  }, [operations, notify]);

  const saveTicketReply = useCallback(async (ticket: DisplayTicket, reply: string) => {
    const source = operations.data?.tickets.find((item) => item.externalTicketId === ticket.id);
    if (!source) {
      notify("운영 DB 마이그레이션 적용 후 CS 답변을 저장할 수 있습니다.");
      return false;
    }
    try {
      const response = await operations.authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "ticket_update", id: source.id, status: "resolved", replyDraft: reply }),
      });
      if (!response.ok) throw new Error("CS 답변을 저장하지 못했습니다.");
      await operations.reload();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "CS 답변을 저장하지 못했습니다.");
      return false;
    }
  }, [operations, notify]);

  const navigate = useCallback((next: View) => {
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const content = (() => {
    if (view === "overview") return <OverviewPage onNavigate={navigate} displayProducts={displayProducts} operationSummary={operationSummary} channelMetrics={channelMetrics} pipeline={pipeline} operationsAvailable={operations.state === "database"} />;
    if (view === "products") return <ProductsPage onNavigate={navigate} displayProducts={displayProducts} />;
    if (view === "publishing") return <PublishingPage notify={notify} channelMetrics={channelMetrics} pipeline={pipeline} />;
    if (view === "margin") return <MarginCalculatorPage notify={notify} scenarios={operations.data?.marginScenarios ?? []} onChanged={() => void operations.reload()} />;
    if (view === "orders") return <OrdersPage displayOrders={displayOrders} onAdvance={advanceOrder} />;
    if (view === "cs") return <CsPage notify={notify} displayTickets={displayTickets} displayOrders={displayOrders} onSend={saveTicketReply} />;
    if (view === "readiness") return <ChannelReadinessPage />;
    if (view === "credentials") return <ApiCredentialCenter notify={notify} />;
    if (view === "acceptance") return <AcceptanceChecklistPage />;
    if (view === "storyboard") return <StoryboardPage onNavigate={navigate} />;
    const channelKey = view as ChannelKey;
    return <ChannelPage channelKey={channelKey} onNavigate={navigate} metric={channelMetrics.find((metric) => metric.channelKey === channelKey) ?? null} displayProducts={displayProducts} />;
  })();

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head"><div className="brand-lockup light"><span className="brand-symbol"><Zap size={17} fill="currentColor" /></span><span className="sidebar-brand-copy"><strong>SellerPilot</strong><small>SELLER CONTROL</small></span></div><button aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
        <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const isActive = view === item.id;
          const isDisabled = "disabled" in item && item.disabled;
          return <button key={item.id} className={`${isActive ? "active" : ""} ${isDisabled ? "channel-disabled" : ""}`.trim()} onClick={() => { if (!isDisabled) navigate(item.id); }} disabled={isDisabled} aria-label={isDisabled ? `${item.label} 연동 준비 중` : item.label}>{Icon ? <Icon size={17} /> : <ChannelMark code={(item as { channel: string }).channel} size="sm" />}<span>{item.label}</span>{isDisabled ? <em>준비중</em> : isActive ? <ChevronRight size={14} /> : null}</button>;
        })}</div>)}</nav>
        <div className="sidebar-insight"><div><Activity size={15} /><span>채널 연결 현황</span><em>LIVE</em></div><p><b>7개 판매채널</b> 인증과 기능 차이를<br />보안 저장소에서 관리합니다.</p><span><i /></span><small>키 만료일·OAuth·갱신 주기 관리</small></div>
        <div className="sidebar-foot"><button><LifeBuoy size={17} /><span>도움말 · 가이드</span></button><button onClick={() => navigate("credentials")}><Settings size={17} /><span>API · 보안 설정</span></button><button onClick={() => void onLogout()}><LogOut size={17} /><span>로그아웃</span></button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}

      <section className="app-main">
        <div className="app-header-stack">
          <div className="commerce-service-rail" aria-label="채널 운영 상태">
            <strong>통합 판매관리</strong>
            <span><i className={operations.state === "database" ? "rail-ok" : "rail-pending"} />{operations.state === "database" ? "실데이터 원장 연결" : "운영 원장 확인 중"}</span>
            <span><i className={operationSummary?.activeCredentialCount ? "rail-ok" : "rail-pending"} />운영 키 {operationSummary?.activeCredentialCount ?? 0}개 연결</span>
            <span><i className="rail-ok" />보안 저장소 연결</span>
            <em>{operations.state === "database" ? "운영 DB 1분 자동 갱신" : operations.state === "loading" ? "운영 DB 확인 중" : "운영 DB 연결 오류"}</em>
          </div>
          <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" aria-label="전체 메뉴 열기" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className={`demo-data-badge ${operations.state === "database" ? "database" : ""}`} title={operations.message}><Activity size={13} /><b>{operations.state === "database" ? "실데이터" : operations.state === "loading" ? "연결 확인" : "연결 오류"}</b><small>{operations.state === "database" ? "Supabase 운영 원장" : operations.message}</small></span><button className="global-search" aria-label="통합 검색 열기" onClick={() => setSearchOpen(true)}><Search size={16} /><span>상품, 주문, CS 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap"><button className="top-icon-button" aria-label="알림" onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} />{Boolean((operationSummary?.lowStockCount ?? 0) + (operationSummary?.registrationErrorCount ?? 0)) && <i />}</button>{notificationsOpen && <div className="notification-popover"><div><h4>실시간 알림</h4><button onClick={() => setNotificationsOpen(false)}>닫기</button></div><button onClick={() => navigate("products")}><span className="alert-icon danger"><Box size={15} /></span><span><b>재고주의 상품 {operationSummary?.lowStockCount ?? 0}건</b><small>운영 원장 실재고 기준</small></span></button><button onClick={() => navigate("publishing")}><span className="alert-icon warning"><AlertCircle size={15} /></span><span><b>등록 실패 {operationSummary?.registrationErrorCount ?? 0}건</b><small>채널 API 작업 이력 기준</small></span></button></div>}</div><button className="user-menu"><span className="user-avatar">관</span><span><b>{userEmail.split("@")[0]}</b><small>보안 관리자</small></span><ChevronDown size={14} /></button></div>
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
  const [accessState, setAccessState] = useState<"checking" | "signed_out" | "admin" | "forbidden">(isSupabaseConfigured ? "checking" : "signed_out");
  const [userEmail, setUserEmail] = useState("");
  const [pendingChannelOAuth, setPendingChannelOAuth] = useState<{ channel: "shopee" | "lazada" | "ebay"; code: string; state: string; shopId?: string; mainAccountId?: string } | null>(null);
  const [oauthNotice, setOauthNotice] = useState("");
  const oauthHandled = useRef(false);

  useEffect(() => {
    const captureCallback = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code") ?? "";
      const state = params.get("state") ?? "";
      const channel = state.startsWith("sellerpilot-shopee-") ? "shopee" : state.startsWith("sellerpilot-lazada-") ? "lazada" : state.startsWith("sellerpilot-ebay-") ? "ebay" : null;
      if (!code || !channel) return;
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      setPendingChannelOAuth({
        channel,
        code,
        state,
        shopId: params.get("shop_id") ?? undefined,
        mainAccountId: params.get("main_account_id") ?? undefined,
      });
    }, 0);
    return () => window.clearTimeout(captureCallback);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseClient();
    const verifyAdmin = async (session: Session | null) => {
      if (!session) {
        setUserEmail("");
        setAccessState("signed_out");
        return;
      }
      setUserEmail(session.user.email ?? "");
      const { data: isAdmin, error } = await supabase.rpc("sellerpilot_is_admin");
      setAccessState(!error && isAdmin === true ? "admin" : "forbidden");
    };
    void supabase.auth.getSession().then(({ data }) => void verifyAdmin(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessState(session ? "checking" : "signed_out");
      window.setTimeout(() => void verifyAdmin(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (accessState !== "admin" || !pendingChannelOAuth || oauthHandled.current) return;
    oauthHandled.current = true;
    const completeChannelOAuth = async () => {
      try {
        const { data: sessionData } = await createSupabaseClient().auth.getSession();
        const response = await fetch(`/api/admin/channel-credentials/${pendingChannelOAuth.channel}/authorize`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
          body: JSON.stringify({
            secretPayload: {
              authorization_code: pendingChannelOAuth.code,
              ...(pendingChannelOAuth.shopId ? { shop_id: pendingChannelOAuth.shopId } : {}),
              ...(pendingChannelOAuth.mainAccountId ? { main_account_id: pendingChannelOAuth.mainAccountId } : {}),
            },
            oauthState: pendingChannelOAuth.state,
          }),
        });
        const payload = await response.json().catch(() => ({ message: "채널 OAuth 응답을 읽지 못했습니다." })) as { message: string };
        if (!response.ok) throw new Error(payload.message);
        setOauthNotice(payload.message);
      } catch (oauthError) {
        setOauthNotice(oauthError instanceof Error ? oauthError.message : "채널 OAuth 연결을 완료하지 못했습니다.");
      } finally {
        setPendingChannelOAuth(null);
        window.setTimeout(() => setOauthNotice(""), 6_000);
      }
    };
    void completeChannelOAuth();
  }, [accessState, pendingChannelOAuth]);

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
    setAccessState("signed_out");
    setUserEmail("");
  };

  if (accessState === "checking") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><LoaderCircle className="spin" size={24} /><h2>관리자 권한 확인 중</h2><p>로그인 세션과 운영 데이터 접근 권한을 안전하게 확인하고 있습니다.</p></div></section></main>;
  }
  if (accessState === "forbidden") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><AlertTriangle size={26} /><h2>관리자 권한이 필요합니다.</h2><p>{userEmail || "현재 계정"}은 SellerPilot 관리자 명단에 없습니다. Supabase의 <b>sellerpilot_private.admin_users</b> 승인 후 접근할 수 있습니다.</p><button type="button" className="login-submit" onClick={() => void logout()}><LogOut size={16} />다른 계정으로 로그인</button></div></section></main>;
  }
  return accessState === "admin"
    ? <><DashboardShell onLogout={logout} userEmail={userEmail} />{oauthNotice && <div className="toast"><KeyRound size={18} /><span>{oauthNotice}</span><button onClick={() => setOauthNotice("")}><X size={14} /></button></div>}</>
    : <LoginScreen onLogin={login} onPasswordReset={resetPassword} />;
}
